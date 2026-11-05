import {
  privateGrowthBackupTarget,
  runBackupGh,
} from "./growth-backup-target.mjs";
import { parseGrowthArchiveManifest } from "../shared/growthArchiveRestore.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  growthColdStoreReleaseTag,
  LEGACY_GROWTH_RELEASE,
} from "../shared/growthColdStoreRelease.mjs";

// 只复用已发布清单且 GitHub 资产摘要仍一致的归档；旧清单无源指纹时重新备份。
export function planArchiveBatch(snapshot, assets, manifests) {
  const byName = new Map(assets.map(asset => [asset.name, asset]));
  const pending = [],
    reused = [],
    selected = [],
    reclaim = [];
  const cleanupInputs = new Map();
  const validAsset = (name, bytes, sha) => {
    const asset = byName.get(name);
    return (
      Number.isSafeInteger(bytes) &&
      bytes > 0 &&
      /^[a-f0-9]{64}$/.test(sha) &&
      asset?.state === "uploaded" &&
      asset.size === bytes &&
      asset.digest === `sha256:${sha}`
    );
  };
  for (const line of snapshot.trim().split(/\r?\n/).filter(Boolean)) {
    const [dir, fingerprint, bytes, extra] = line.split("\t");
    if (
      !/^[\w.-]+$/.test(dir) ||
      dir === "." ||
      dir === ".." ||
      !/^[a-f0-9]{64}$/.test(fingerprint) ||
      !/^\d+$/.test(bytes) ||
      !Number.isSafeInteger(Number(bytes)) ||
      extra !== undefined
    )
      throw new Error("归档快照清单非法，停止规划");
    // 新快照输出实际文件字节；旧空快照也不得进入新上传或复用删源队列。
    if (
      Number(bytes) === 0 ||
      fingerprint === createHash("sha256").update("[]").digest("hex")
    )
      continue;
    let verified = false;
    let reclaimRow = null;
    try {
      const name = `archive-${dir}.manifest.json`,
        raw = manifests.get(name);
      const manifest = JSON.parse(raw);
      verified =
        validAsset(
          name,
          Buffer.byteLength(raw),
          createHash("sha256").update(raw).digest("hex")
        ) &&
        manifest.schemaVersion === 1 &&
        manifest.dir === dir &&
        manifest.sourceFingerprint === fingerprint &&
        manifest.archive?.assetName === `archive-${dir}.tar.gz` &&
        Number.isSafeInteger(manifest.archive.bytes) &&
        manifest.archive.bytes > 0 &&
        /^[a-f0-9]{64}$/.test(manifest.archive.sha256) &&
        Array.isArray(manifest.parts) &&
        manifest.parts.length > 0 &&
        manifest.parts.every(
          (part, i) =>
            part.index === i &&
            part.assetName ===
              (manifest.parts.length === 1
                ? manifest.archive.assetName
                : `${manifest.archive.assetName}.part-${String(i).padStart(4, "0")}`) &&
            validAsset(part.assetName, part.bytes, part.sha256)
        ) &&
        manifest.parts.reduce((n, p) => n + p.bytes, 0) ===
          manifest.archive.bytes &&
        (manifest.parts.length !== 1 ||
          manifest.parts[0].sha256 === manifest.archive.sha256);
      // 修订附件上传完不代表已提交；消费者先读指针，必须一起核对。
      const manifestAsset = byName.get(name);
      const manifestTag = manifestAsset?.releaseTag || growthColdStoreReleaseTag(name);
      const pointerName = `archive-${dir}.latest.json`;
      if (verified && (manifestTag.startsWith("growth-archive-revision-") || byName.has(pointerName))) {
        const expectedTag = `growth-archive-revision-${dir}-${fingerprint}`;
        const pointer = Buffer.from(JSON.stringify({
          schemaVersion: 1,
          dir,
          releaseTag: expectedTag,
          manifest: { assetName: name, bytes: Buffer.byteLength(raw), sha256: createHash("sha256").update(raw).digest("hex") },
        }, null, 2));
        verified = manifestTag === expectedTag && validAsset(pointerName, pointer.length, createHash("sha256").update(pointer).digest("hex"));
      }
      if (verified && /^\d{4}-\d{2}-\d{2}(?:-\d{2})?$/.test(dir)) {
        // 备份复用并非删除证据：旧清单还须有完整、同源的逐文件清单。
        const checked = parseGrowthArchiveManifest(manifest, dir);
        const files = checked.inventory;
        const sourceMatches = files?.length
          && files.some(f => /^bilibili-[^/]+\.json\.gz$/.test(f.path))
          && files.reduce((n,f)=>n+f.bytes,0) === Number(bytes)
          && createHash("sha256").update(JSON.stringify(files.map(f=>[f.path,f.bytes,f.sha256]))).digest("hex") === fingerprint;
        const sameRelease = manifest.parts.every(part => {
          const asset = byName.get(part.assetName);
          return (asset?.releaseTag || growthColdStoreReleaseTag(part.assetName)) === manifestTag;
        });
        if (sourceMatches && sameRelease) {
          reclaimRow = [dir,fingerprint,bytes,manifest.archive.assetName,manifest.archive.bytes,
            manifest.archive.sha256,name,manifestAsset.size,manifestAsset.digest.slice("sha256:".length),manifestTag].join("\t");
          cleanupInputs.set(dir, {dir,releaseTag:manifestTag,sourceFingerprint:fingerprint,
            manifestName:name,manifestBase64:Buffer.from(raw,"utf8").toString("base64")});
        }
      }
    } catch {
      /* 缺失或损坏的旧清单不能充当备份凭证。 */
    }
    (verified ? reused : pending).push(line);
    if (reclaimRow) reclaim.push(reclaimRow);
  }
  let totalBytes = 0;
  for (const line of pending) {
    const bytes = Number(line.split("\t")[2]);
    if (
      selected.length &&
      (selected.length >= 12 || totalBytes + bytes > 512 * 1024 * 1024)
    )
      break;
    selected.push(line);
    totalBytes += bytes;
  }
  const reclaimSelected = [];
  let reclaimBytes = 0;
  for (const line of reclaim) {
    const bytes = Number(line.split("\t")[2]);
    if (reclaimSelected.length >= 4 || reclaimBytes + bytes > 512 * 1024 * 1024) continue;
    reclaimSelected.push(line);
    reclaimBytes += bytes;
  }
  return {
    selected,
    reused: reused.length,
    reclaim: reclaimSelected,
    reclaimRemaining: reclaim.length - reclaimSelected.length,
    reusedCleanup: reclaimSelected.map(line => cleanupInputs.get(line.split("\t")[0])),
    pending: pending.length,
    remaining: pending.length - selected.length,
  };
}

export function loadArchiveInventory(directory, snapshot, repo, gh) {
  const wanted = new Set(
    snapshot
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line =>
        growthColdStoreReleaseTag(
          `archive-${line.split("\t")[0]}.manifest.json`
        )
      )
  );
  for (const line of snapshot.trim().split(/\r?\n/).filter(Boolean)) {
    const [dir, fp] = line.split("\t");
    wanted.add(`growth-archive-revision-${dir}-${fp}`);
  }
  wanted.add(LEGACY_GROWTH_RELEASE);
  // 分页枚举实际存在的仓，不能把鉴权/网络失败误判为新仓不存在。
  const releases = JSON.parse(
    gh(["api", "--paginate", "--slurp", `repos/${repo}/releases?per_page=100`])
  ).flat();
  // A confirmed private repository can start without a legacy release; empty inventory is not an authentication failure.
  const assets = [],
    manifests = new Map();
  const selected = releases.filter(release => wanted.has(release.tag_name));
  const priority = tag =>
    tag === LEGACY_GROWTH_RELEASE
      ? 0
      : tag.startsWith("growth-archive-revision-")
        ? 2
        : 1;
  selected.sort((a, b) => priority(a.tag_name) - priority(b.tag_name));
  for (const release of selected) {
    const entries = JSON.parse(
      gh([
        "api",
        "--paginate",
        "--slurp",
        `repos/${repo}/releases/${release.id}/assets?per_page=100`,
      ])
    ).flat();
    assets.push(
      ...entries.map(asset => ({ ...asset, releaseTag: release.tag_name }))
    );
    const names = entries
      .filter(asset => /^archive-.+\.manifest\.json$/.test(asset.name))
      .map(asset => asset.name);
    if (!names.length) continue;
    const cached = fs.mkdtempSync(path.join(directory, "previous-manifests-"));
    gh([
      "release",
      "download",
      release.tag_name,
      "--pattern",
      "archive-*.manifest.json",
      "--dir",
      cached,
    ]);
    for (const name of names)
      manifests.set(name, fs.readFileSync(path.join(cached, name), "utf8"));
  }
  return { assets, manifests };
}

export function writeArchivePlan(directory, plan) {
  const cleanupFile = path.join(directory,"reused-cleanup-input.json");
  fs.rmSync(cleanupFile,{force:true});
  for (const marker of ["EMPTY", "UPLOAD_EMPTY"])
    fs.rmSync(path.join(directory, marker), { force: true });
  fs.writeFileSync(
    path.join(directory, "selected.tsv"),
    plan.selected.length ? plan.selected.join("\n") + "\n" : ""
  );
  fs.writeFileSync(
    path.join(directory, "reclaim.tsv"),
    plan.reclaim.length ? plan.reclaim.join("\n") + "\n" : ""
  );
  fs.writeFileSync(
    path.join(directory, "plan.json"),
    JSON.stringify(plan, null, 2)
  );
  if (plan.reusedCleanup?.length) {
    const batchId = fs.readFileSync(path.join(directory,"batch-id.txt"),"utf8").trim();
    if (!/^\d+-\d+(?:-backup)?$/.test(batchId)) throw Error("archive_cleanup_batch_invalid");
    const archives = plan.reusedCleanup.map(({dir,releaseTag,sourceFingerprint})=>({dir,releaseTag,sourceFingerprint}));
    const manifests = Object.fromEntries(plan.reusedCleanup.map(({manifestName,manifestBase64})=>[manifestName,manifestBase64]));
    const input = {batch:{schemaVersion:3,batchId,archives},
      publication:{batchId,reused:archives.map(({dir,releaseTag})=>({dir,releaseTag}))},manifests};
    fs.writeFileSync(cleanupFile,JSON.stringify(input,null,2));
  }
  if (!plan.selected.length && !plan.reclaim.length)
    fs.writeFileSync(path.join(directory, "EMPTY"), "");
  if (!plan.selected.length && plan.reclaim.length)
    fs.writeFileSync(path.join(directory, "UPLOAD_EMPTY"), "");
}

function main(directory) {
  if (!directory) throw new Error("缺少归档工作目录");
  const { gh, repository: repo } = privateGrowthBackupTarget(runBackupGh);
  const snapshot = fs.readFileSync(
    path.join(directory, "snapshot.tsv"),
    "utf8"
  );
  const { assets, manifests } = loadArchiveInventory(
    directory,
    snapshot,
    repo,
    gh
  );
  const plan = planArchiveBatch(snapshot, assets, manifests);
  writeArchivePlan(directory, plan);
  const summary = `归档规划：已验证且未变化 ${plan.reused} 个，其中 ${plan.reclaim.length} 个进入独立还原核验清理候选；本批新备份 ${plan.selected.length} 个；另有新备份 ${plan.remaining} 个待后续批次。计划数量不代表删除成功。`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  if (plan.remaining)
    console.log(
      `::warning::归档积压尚未清空：本批之外还有 ${plan.remaining} 个目录，源数据保留。`
    );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main(process.argv[2]);
