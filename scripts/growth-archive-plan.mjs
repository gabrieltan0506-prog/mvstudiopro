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
        validAsset(
          manifest.archive.assetName,
          manifest.archive.bytes,
          manifest.archive.sha256
        ) &&
        manifest.parts?.length === 1 &&
        manifest.parts[0].index === 0 &&
        manifest.parts[0].assetName === manifest.archive.assetName &&
        manifest.parts[0].bytes === manifest.archive.bytes &&
        manifest.parts[0].sha256 === manifest.archive.sha256;
      if (verified && /^\d{4}-\d{2}-\d{2}(?:-\d{2})?$/.test(dir)) {
        const manifestAsset = byName.get(name);
        reclaimRow = [
          dir, fingerprint, bytes,
          manifest.archive.assetName, manifest.archive.bytes, manifest.archive.sha256,
          name, manifestAsset.size, manifestAsset.digest.slice("sha256:".length),
          manifestAsset.releaseTag || growthColdStoreReleaseTag(name),
        ].join("\t");
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
    if (reclaimSelected.length && (reclaimSelected.length >= 4 || reclaimBytes + bytes > 512 * 1024 * 1024)) break;
    reclaimSelected.push(line);
    reclaimBytes += bytes;
  }
  return {
    selected,
    reused: reused.length,
    reclaim: reclaimSelected,
    reclaimRemaining: reclaim.length - reclaimSelected.length,
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
  wanted.add(LEGACY_GROWTH_RELEASE);
  // 分页枚举实际存在的仓，不能把鉴权/网络失败误判为新仓不存在。
  const releases = JSON.parse(
    gh(["api", "--paginate", "--slurp", `repos/${repo}/releases?per_page=100`])
  ).flat();
  if (!releases.some(release => release.tag_name === LEGACY_GROWTH_RELEASE))
    throw new Error("缺少旧冷备 Release，停止规划");
  const assets = [],
    manifests = new Map();
  const selected = releases.filter(release => wanted.has(release.tag_name));
  selected.sort(
    (a, b) =>
      Number(b.tag_name === LEGACY_GROWTH_RELEASE) -
      Number(a.tag_name === LEGACY_GROWTH_RELEASE)
  );
  for (const release of selected) {
    const entries = JSON.parse(
      gh([
        "api",
        "--paginate",
        "--slurp",
        `repos/${repo}/releases/${release.id}/assets?per_page=100`,
      ])
    ).flat();
    assets.push(...entries.map(asset => ({ ...asset, releaseTag: release.tag_name })));
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
  if (!plan.selected.length && !plan.reclaim.length)
    fs.writeFileSync(path.join(directory, "EMPTY"), "");
  if (!plan.selected.length && plan.reclaim.length)
    fs.writeFileSync(path.join(directory, "UPLOAD_EMPTY"), "");
}

function main(directory) {
  if (!directory) throw new Error("缺少归档工作目录");
  const gh = args =>
    execFileSync("gh", args, {
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 20 * 1024 * 1024,
    });
  // 身份/网络失败不能伪装成空仓库；本仓库已有固定冷备 release。
  const repo = JSON.parse(
    gh(["repo", "view", "--json", "nameWithOwner"])
  ).nameWithOwner;
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
  const summary = `归档规划：已验证且未变化 ${plan.reused} 个，本批待生产恢复后清理 ${plan.reclaim.length} 个；本批新备份 ${plan.selected.length} 个；另有新备份 ${plan.remaining} 个、旧归档清理 ${plan.reclaimRemaining} 个待后续批次。计划数量不代表删除成功。`;
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
