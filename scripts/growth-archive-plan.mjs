import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// 只复用已发布清单且 GitHub 资产摘要仍一致的归档；旧清单无源指纹时重新备份。
export function planArchiveBatch(snapshot, assets, manifests) {
  const byName = new Map(assets.map(asset => [asset.name, asset]));
  const pending = [],
    reused = [],
    selected = [];
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
    } catch {
      /* 缺失或损坏的旧清单不能充当备份凭证。 */
    }
    (verified ? reused : pending).push(line);
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
  return {
    selected,
    reused: reused.length,
    pending: pending.length,
    remaining: pending.length - selected.length,
  };
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
  const { id } = JSON.parse(
    gh(["api", `repos/${repo}/releases/tags/growth-cold-store-latest`])
  );
  const assets = JSON.parse(
    gh([
      "api",
      "--paginate",
      "--slurp",
      `repos/${repo}/releases/${id}/assets?per_page=100`,
    ])
  ).flat();
  const cached = path.join(directory, "previous-manifests");
  fs.mkdirSync(cached, { recursive: true });
  if (assets.some(asset => /^archive-.+\.manifest\.json$/.test(asset.name))) {
    gh([
      "release",
      "download",
      "growth-cold-store-latest",
      "--pattern",
      "archive-*.manifest.json",
      "--dir",
      cached,
      "--clobber",
    ]);
  }
  const manifests = new Map(
    fs
      .readdirSync(cached)
      .map(name => [name, fs.readFileSync(path.join(cached, name), "utf8")])
  );
  const plan = planArchiveBatch(
    fs.readFileSync(path.join(directory, "snapshot.tsv"), "utf8"),
    assets,
    manifests
  );
  fs.writeFileSync(
    path.join(directory, "selected.tsv"),
    plan.selected.length ? plan.selected.join("\n") + "\n" : ""
  );
  fs.writeFileSync(
    path.join(directory, "plan.json"),
    JSON.stringify(plan, null, 2)
  );
  if (!plan.selected.length)
    fs.writeFileSync(path.join(directory, "EMPTY"), "");
  const summary = `归档规划：已验证且未变化 ${plan.reused} 个；本批计划 ${plan.selected.length} 个；另有 ${plan.remaining} 个待后续批次。计划数量不代表上传成功。`;
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
