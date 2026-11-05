import {
  privateGrowthBackupTarget,
  runBackupGh,
} from "./growth-backup-target.mjs";
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
  if (!/^[0-9]+-[0-9]+(?:-backup)?$/.test(batchId))
    fail("archive_batch_invalid");
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
        assets.push({ name, file, dir, ...actual });
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
    const inventoryFile = path.join(root, "source-inventory.json");
    const expected = fs.existsSync(inventoryFile)
      ? JSON.parse(fs.readFileSync(inventoryFile, "utf8")).inventories?.[dir]
      : null;
    if (process.env.GROWTH_REQUIRE_SOURCE_INVENTORY === "1" && !expected)
      fail(`archive_source_inventory_missing:${dir}`);
    if (
      expected &&
      (expected.errors.length ||
        JSON.stringify(
          expected.files
            .slice()
            .sort((a, b) => a.path.localeCompare(b.path, "en"))
        ) !==
          JSON.stringify(
            verified.inventory
              .slice()
              .sort((a, b) => a.path.localeCompare(b.path, "en"))
          ))
    )
      fail(`archive_source_inventory_mismatch:${dir}`);
    if (
      expected &&
      sha(
        JSON.stringify(expected.files.map(f => [f.path, f.bytes, f.sha256]))
      ) !== fingerprint
    )
      fail(`archive_source_fingerprint_mismatch:${dir}`);
    content.push(verified);
    const manifest = {
      schemaVersion: 1,
      dir,
      sourceFingerprint: fingerprint,
      inventory: verified.inventory,
      archive: { assetName: asset, ...actual },
      parts: descriptions,
    };
    const name = `archive-${dir}.manifest.json`,
      file = path.join(root, "assets", name);
    const raw = Buffer.from(JSON.stringify(manifest, null, 2));
    fs.writeFileSync(file, raw);
    assets.push({ name, file, dir, bytes: raw.length, sha256: sha(raw) });
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

export function publishArchiveBatch(root, gh = runBackupGh) {
  fs.rmSync(path.join(root, "DELETE_READY"), { force: true });
  fs.rmSync(path.join(root, "UPLOAD_VERIFIED"), { force: true });
  const assets = prepareArchivePublication(root);
  const target = privateGrowthBackupTarget(gh);
  gh = target.gh;
  const repo = target.repository;
  const releases = JSON.parse(
    gh(["api", "--paginate", "--slurp", `repos/${repo}/releases?per_page=100`])
  ).flat();
  const manifestFile = path.join(root, "offload-manifest.json");
  const batch = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const revisionTag = dir =>
    `growth-archive-revision-${dir}-${batch.archives.find(a => a.dir === dir).sourceFingerprint}`;
  const tags = new Set([
    LEGACY_GROWTH_RELEASE,
    ...assets.map(publicationTag),
    ...batch.archives.map(a => revisionTag(a.dir)),
  ]);
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
  const releaseIds = new Map(releases.map(r => [r.tag_name, r.id]));
  const refreshInventory = tag => {
    if (!releaseIds.has(tag)) {
      const rows = JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/releases?per_page=100`])).flat();
      const found = rows.filter(r => r.tag_name === tag);
      if (found.length !== 1) fail("archive_release_identity_unconfirmed");
      releaseIds.set(tag, found[0].id);
    }
    const rows = JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/releases/${releaseIds.get(tag)}/assets?per_page=100`])).flat();
    inventory.set(tag, rows);
    return rows;
  };
  const matches = (a, b) =>
    b.state === "uploaded" &&
    b.size === a.bytes &&
    b.digest === `sha256:${a.sha256}`;
  // A conflicting canonical asset is historical evidence, never overwritten. Publish
  // a content-identified revision, then commit a small pointer after every metadata verification.
  const revised = new Set();
  for (const asset of assets.filter(a => a.dir)) {
    for (const tag of new Set([LEGACY_GROWTH_RELEASE, publicationTag(asset)])) {
      // 曾有修订指针时继续显式提交修订，避免旧指针遮蔽重新出现的原版内容。
      if ((inventory.get(tag) || []).some(a => a.name === `archive-${asset.dir}.latest.json`))
        revised.add(asset.dir);
      const existing = (inventory.get(tag) || []).filter(
        a => a.name === asset.name
      );
      if (existing.length > 1 || existing.some(a => !matches(asset, a)))
        revised.add(asset.dir);
    }
  }
  for (const asset of assets.filter(a => a.dir)) {
    if (revised.has(asset.dir)) asset.releaseTag = revisionTag(asset.dir);
    const existing = (inventory.get(publicationTag(asset)) || []).filter(
      a => a.name === asset.name
    );
    if (existing.length > 1 || existing.some(a => !matches(asset, a)))
      fail(`archive_asset_conflict:${publicationTag(asset)}/${asset.name}`);
  }
  for (const archive of batch.archives)
    archive.releaseTag = revised.has(archive.dir)
      ? revisionTag(archive.dir)
      : growthColdStoreReleaseTag(archive.asset);
  const batchRaw = Buffer.from(JSON.stringify(batch, null, 2));
  const batchAsset = assets.find(
    a => a.name === `offload-manifest-${batch.batchId}.json`
  );
  fs.writeFileSync(manifestFile, batchRaw);
  fs.writeFileSync(batchAsset.file, batchRaw);
  Object.assign(batchAsset, { bytes: batchRaw.length, sha256: sha(batchRaw) });
  const previousBatch = (
    inventory.get(publicationTag(batchAsset)) || []
  ).filter(a => a.name === batchAsset.name);
  if (
    previousBatch.length > 1 ||
    previousBatch.some(a => !matches(batchAsset, a))
  )
    fail("archive_batch_manifest_conflict");
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
    const actual = refreshInventory(tag).filter(row => row.name === asset.name);
    if (actual.length !== 1 || !matches(asset, actual[0]))
      fail(`archive_upload_metadata_mismatch:${asset.name}`);
    const row = `${asset.name}\t${asset.bytes}\t${asset.sha256}\n`;
    fs.appendFileSync(path.join(root, "verified-assets.tsv"), row);
    if (asset.name.endsWith(".manifest.json"))
      fs.appendFileSync(path.join(root, "manifest-assets.tsv"), row);
  }
  for (const dir of revised) {
    const asset = assets.find(
      a => a.dir === dir && a.name.endsWith(".manifest.json")
    );
    const pointer = {
      schemaVersion: 1,
      dir,
      releaseTag: revisionTag(dir),
      manifest: {
        assetName: asset.name,
        bytes: asset.bytes,
        sha256: asset.sha256,
      },
    };
    const name = `archive-${dir}.latest.json`,
      file = path.join(root, name);
    fs.writeFileSync(file, JSON.stringify(pointer, null, 2));
    const tag = growthColdStoreReleaseTag(name);
    if (!inventory.has(tag)) {
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
        "Growth archive revision pointers",
      ]);
      inventory.set(tag, []);
    }
    // Only this pointer is replaceable; immutable versions remain available on failure.
    const expected = {
      bytes: fs.statSync(file).size,
      sha256: sha(fs.readFileSync(file)),
    };
    const existing = (inventory.get(tag) || []).find(a => a.name === name);
    if (!existing || !matches(expected, existing))
      gh(["release", "upload", tag, `${file}#${name}`, "--clobber"]);
    const committed = refreshInventory(tag).filter(row => row.name === name);
    if (committed.length !== 1 || !matches(expected, committed[0])) fail("archive_pointer_commit_unverified");
  }
  fs.writeFileSync(
    path.join(root, "publication-result.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        batchId: batch.batchId,
        uploaded: batch.archives.map(a => ({
          dir: a.dir,
          releaseTag: a.releaseTag,
        })),
        revised: [...revised],
        sourceDeletionAuthorized: false,
        verification: "github-uploaded-size-sha256-metadata",
        remoteRestoreVerified: false,
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(root, "UPLOAD_VERIFIED"),
    `${hashFiles([manifestFile]).sha256}  ${manifestFile}\n`
  );
  console.log(
    `本批 ${assets.length} 个附件已校验；历史版本和全部来源保留，未授权删除。`
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
