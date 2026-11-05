import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  growthColdStoreReleaseTag,
  LEGACY_GROWTH_RELEASE,
} from "../shared/growthColdStoreRelease.mjs";

const validator = fileURLToPath(
  new URL("./validate-growth-archive.py", import.meta.url)
);
const sha = raw => createHash("sha256").update(raw).digest("hex");
const fail = message => {
  throw new Error(message);
};
const safeName = name =>
  /^[0-9A-Za-z._-]+$/.test(name) && name !== "." && name !== "..";
const publicationTag = asset =>
  asset.releaseTag || growthColdStoreReleaseTag(asset.name);
function hashFiles(files) {
  const hash = createHash("sha256");
  let bytes = 0;
  const buffer = Buffer.alloc(1024 * 1024);
  for (const file of files) {
    if (!fs.lstatSync(file).isFile())
      fail(`archive_asset_type_invalid:${file}`);
    const fd = fs.openSync(file, "r");
    try {
      let n;
      while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) {
        hash.update(buffer.subarray(0, n));
        bytes += n;
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  return { bytes, sha256: hash.digest("hex") };
}
function rows(root, name, columns) {
  return fs
    .readFileSync(path.join(root, name), "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const fields = line.split("\t");
      if (fields.length !== columns) fail(`archive_table_invalid:${name}`);
      return fields;
    });
}
function integer(value, positive = true) {
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    (positive && Number(value) === 0)
  )
    fail("archive_number_invalid");
  return Number(value);
}

// 先验证整批内容、部件摘要和清单，再进行任何远端写入。
export function prepareArchivePublication(root) {
  const batchId = fs
    .readFileSync(path.join(root, "batch-id.txt"), "utf8")
    .trim();
  if (!/^[0-9]+-[0-9]+$/.test(batchId)) fail("archive_batch_invalid");
  const allParts = rows(root, "assets.tsv", 6);
  const assets = [],
    archives = [],
    content = [],
    used = new Set(),
    dirs = new Set();
  for (const [
    dir,
    asset,
    bytes,
    digest,
    fingerprint,
    sourceBytes,
    count,
  ] of rows(root, "archives.tsv", 7)) {
    if (
      !/^\d{4}-\d{2}-\d{2}(?:-\d{2})?$/.test(dir) ||
      dirs.has(dir) ||
      asset !== `archive-${dir}.tar.gz` ||
      !/^[a-f0-9]{64}$/.test(digest) ||
      !/^[a-f0-9]{64}$/.test(fingerprint)
    )
      fail("archive_row_invalid");
    dirs.add(dir);
    integer(sourceBytes);
    const parts = allParts
      .filter(row => row[0] === dir)
      .sort((a, b) => Number(a[5]) - Number(b[5]));
    if (parts.length !== integer(count)) fail("archive_parts_incomplete");
    const descriptions = parts.map(
      ([partDir, name, size, partSha, parent, index], i) => {
        if (
          !safeName(name) ||
          used.has(name) ||
          parent !== asset ||
          integer(index, false) !== i ||
          (parts.length === 1
            ? name !== asset
            : name !== `${asset}.part-${String(i).padStart(4, "0")}`)
        )
          fail("archive_part_invalid");
        const file = path.join(root, "assets", name),
          actual = hashFiles([file]);
        if (actual.bytes !== integer(size) || actual.sha256 !== partSha)
          fail(`archive_part_integrity:${name}`);
        used.add(name);
        assets.push({ name, file, ...actual });
        return { assetName: name, ...actual, index: i };
      }
    );
    const files = descriptions.map(p => path.join(root, "assets", p.assetName));
    const actual = hashFiles(files);
    if (actual.bytes !== integer(bytes) || actual.sha256 !== digest)
      fail(`archive_integrity:${dir}`);
    const verified = JSON.parse(
      execFileSync("python3", [validator, dir, ...files], {
        encoding: "utf8",
        timeout: 300_000,
        maxBuffer: 1024 * 1024,
      })
    );
    // 快照的逻辑字节必须与包内普通文件逐项总和一致，避免只打进部分文件。
    if (verified.logicalBytes !== Number(sourceBytes))
      fail(`archive_source_bytes_mismatch:${dir}`);
    content.push(verified);
    const manifest = {
      schemaVersion: 1,
      dir,
      sourceFingerprint: fingerprint,
      archive: { assetName: asset, ...actual },
      parts: descriptions,
    };
    const name = `archive-${dir}.manifest.json`,
      file = path.join(root, "assets", name);
    const raw = Buffer.from(JSON.stringify(manifest, null, 2));
    fs.writeFileSync(file, raw);
    assets.push({ name, file, bytes: raw.length, sha256: sha(raw) });
    archives.push({
      dir,
      asset,
      ...actual,
      sourceFingerprint: fingerprint,
      sourceBytes: Number(sourceBytes),
      partCount: parts.length,
      manifestAsset: name,
      parts: descriptions.map(p => ({
        asset: p.assetName,
        bytes: p.bytes,
        sha256: p.sha256,
        partIndex: p.index,
      })),
    });
  }
  if (!archives.length || used.size !== allParts.length)
    fail("archive_batch_empty_or_orphan_parts");
  const manifest = {
    schemaVersion: 3,
    batchId,
    archiveDirs: archives.map(a => a.dir),
    archives,
  };
  const raw = Buffer.from(JSON.stringify(manifest, null, 2));
  // 批次记录也不可覆盖历史记录；保留本地旧路径供删源门及 artifact 使用。
  const name = `offload-manifest-${batchId}.json`,
    file = path.join(root, name);
  fs.writeFileSync(file, raw);
  fs.writeFileSync(path.join(root, "offload-manifest.json"), raw);
  // 独立批次仓避免向已接近1000附件上限的旧仓不断追加记录。
  assets.push({
    name,
    file,
    bytes: raw.length,
    sha256: sha(raw),
    releaseTag: `growth-archive-batch-${batchId}`,
  });
  fs.writeFileSync(
    path.join(root, "content-validation.json"),
    JSON.stringify(content, null, 2)
  );
  return assets;
}

export function publishArchiveBatch(
  root,
  gh = args =>
    execFileSync("gh", args, {
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
    })
) {
  fs.rmSync(path.join(root, "DELETE_READY"), { force: true });
  const assets = prepareArchivePublication(root);
  const repo = JSON.parse(
    gh(["repo", "view", "--json", "nameWithOwner"])
  ).nameWithOwner;
  const releases = JSON.parse(
    gh(["api", "--paginate", "--slurp", `repos/${repo}/releases?per_page=100`])
  ).flat();
  const tags = new Set([LEGACY_GROWTH_RELEASE, ...assets.map(publicationTag)]);
  const inventory = new Map();
  for (const release of releases.filter(r => tags.has(r.tag_name))) {
    const entries = JSON.parse(
      gh([
        "api",
        "--paginate",
        "--slurp",
        `repos/${repo}/releases/${release.id}/assets?per_page=100`,
      ])
    ).flat();
    inventory.set(release.tag_name, entries);
  }
  const matches = (a, b) =>
    b.state === "uploaded" &&
    b.size === a.bytes &&
    b.digest === `sha256:${a.sha256}`;
  // 同时检查旧仓，防止创建新日仓附件遮蔽旧仓中不同的有效备份。
  for (const asset of assets) {
    for (const tag of new Set([LEGACY_GROWTH_RELEASE, publicationTag(asset)])) {
      const existing = (inventory.get(tag) || []).filter(
        a => a.name === asset.name
      );
      if (existing.length > 1 || existing.some(a => !matches(asset, a)))
        fail(`archive_asset_conflict:${tag}/${asset.name}`);
    }
  }
  fs.writeFileSync(path.join(root, "verified-assets.tsv"), "");
  fs.writeFileSync(path.join(root, "manifest-assets.tsv"), "");
  for (const asset of assets) {
    const tag = publicationTag(asset);
    if (!inventory.has(tag)) {
      // 只在成功枚举证实缺少时创建；权限/网络错误不当成不存在。
      gh([
        "release",
        "create",
        tag,
        "--target",
        process.env.GITHUB_SHA || "main",
        "--latest=false",
        "--title",
        tag,
        "--notes",
        "Growth 冷备；附件只新增，不覆盖",
      ]);
      inventory.set(tag, []);
    }
    if (!(inventory.get(tag) || []).some(a => a.name === asset.name)) {
      // 不使用 --clobber：即使预检后出现同名并发上传，GitHub 也会拒绝覆盖。
      // 超时/断线直接失败；下次重新枚举和回读核验，不盲目删除或重传。
      gh(["release", "upload", tag, `${asset.file}#${asset.name}`]);
    }
    const readback = fs.mkdtempSync(path.join(root, "release-readback-"));
    gh(["release", "download", tag, "-p", asset.name, "-D", readback]);
    const actual = hashFiles([path.join(readback, asset.name)]);
    if (actual.bytes !== asset.bytes || actual.sha256 !== asset.sha256)
      fail(`archive_readback_mismatch:${asset.name}`);
    const row = `${asset.name}\t${asset.bytes}\t${asset.sha256}\n`;
    fs.appendFileSync(path.join(root, "verified-assets.tsv"), row);
    if (asset.name.endsWith(".manifest.json"))
      fs.appendFileSync(path.join(root, "manifest-assets.tsv"), row);
  }
  const manifestFile = path.join(root, "offload-manifest.json");
  fs.writeFileSync(
    path.join(root, "DELETE_READY"),
    `${hashFiles([manifestFile]).sha256}  ${manifestFile}\n`
  );
  console.log(
    `本批 ${assets.length} 个附件内容验证及远端回读通过；删源仍须生产恢复和指纹保护。`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    publishArchiveBatch(path.resolve(process.argv[2]));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
