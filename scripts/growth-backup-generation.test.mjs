import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import {
  prepareBackupGeneration,
  publishBackupGeneration,
  validateBackupContents,
} from "./growth-backup-generation.mjs";
import {
  loadGrowthBackupGeneration,
  downloadGrowthBackupGenerationAsset,
  GROWTH_BACKUP_POINTER,
  GROWTH_BACKUP_MANIFEST,
  validateBackupGenerationManifest,
} from "../shared/growthBackupGeneration.mjs";
const digest = b => createHash("sha256").update(b).digest("hex");
const base =
  "https://test.invalid/owner/repo/releases/download/growth-cold-store-latest";
const temporary = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "growth-generation-test-"));
const description = (name, raw, index = 0, offset = 0) => ({
  assetName: name,
  bytes: raw.length,
  sha256: digest(raw),
  index,
  offset,
});
function fixture() {
  const root = temporary();
  fs.mkdirSync(path.join(root, "release-current"));
  fs.mkdirSync(path.join(root, "platform-current"));
  for (const name of [
    "current",
    "runtime-meta",
    "archive-index",
    "history-summary",
  ])
    fs.writeFileSync(
      path.join(root, `${name}.json.gz`),
      gzipSync(name === "archive-index" ? "[]" : "{}")
    );
  for (const name of ["backup-manifest.json", "cold-restore-manifest.json"])
    fs.writeFileSync(path.join(root, name), "{}");
  execFileSync(
    "tar",
    [
      "-czf",
      path.join(root, "growth-restore-bundle.tar.gz"),
      "-C",
      root,
      "backup-manifest.json",
    ],
    { env: { ...process.env, COPYFILE_DISABLE: "1" } }
  );
  fs.writeFileSync(
    path.join(root, "source-coverage.json"),
    JSON.stringify({ complete: false, excluded: ["archive"] })
  );
  const files = [];
  for (const platform of [
    "douyin",
    "xiaohongshu",
    "bilibili",
    "weixin_channels",
  ]) {
    const raw = gzipSync(
        JSON.stringify({ items: [{ id: `${platform}-one` }] })
      ),
      logicalAssetName = `platform-current-${platform}.current.json.gz`,
      assetName = `${logicalAssetName}.batch-123-1.part-0000`;
    fs.writeFileSync(
      path.join(root, "platform-current", logicalAssetName),
      raw
    );
    fs.writeFileSync(path.join(root, "release-current", assetName), raw);
    files.push({
      platform,
      logicalAssetName,
      bytes: raw.length,
      sha256: digest(raw),
      parts: [description(assetName, raw)],
    });
  }
  const bundled = path.join(root, "current-bundle.tar");
  execFileSync(
    "tar",
    [
      "-cf",
      bundled,
      "-C",
      path.join(root, "platform-current"),
      ...files.map(f => f.logicalAssetName),
    ],
    { env: { ...process.env, COPYFILE_DISABLE: "1" } }
  );
  const raw = fs.readFileSync(bundled),
    assetName = "growth-platform-current-complete.batch-123-1.tar.part-0000";
  fs.writeFileSync(path.join(root, "release-current", assetName), raw);
  fs.writeFileSync(
    path.join(root, "release-current", "platform-current-batch-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      batchId: "123-1",
      files,
      bundle: {
        logicalAssetName: "growth-platform-current-complete.tar",
        bytes: raw.length,
        sha256: digest(raw),
        parts: [description(assetName, raw)],
      },
    })
  );
  return root;
}
function remote() {
  const releases = new Map([
      ["growth-cold-store-latest", { id: 1, files: new Map() }],
    ]),
    calls = [];
  let next = 2;
  const result = { releases, calls, failAfterUpload: null, brokenDigest: null };
  result.add = (tag, name, raw, label = name) => {
    if (!releases.has(tag)) releases.set(tag, { id: next++, files: new Map() });
    releases.get(tag).files.set(name, { raw: Buffer.from(raw), label });
  };
  const assetRows = r =>
    [...r.files].map(([name, { raw, label }]) => ({
      name,
      label,
      state: "uploaded",
      size: raw.length,
      digest: `sha256:${name === result.brokenDigest ? "0".repeat(64) : digest(raw)}`,
    }));
  result.gh = args => {
    calls.push(args);
    assert(!args.includes("delete") && !args.includes("DELETE"));
    if (args[0] === "repo")
      return JSON.stringify({
        nameWithOwner: "gabrieltan0506-prog/mvstudiopro-growth-data",
        isPrivate: true,
      });
    if (args[0] === "api") {
      const endpoint = args.at(-1);
      if (endpoint.endsWith("releases?per_page=100"))
        return JSON.stringify([
          [...releases].map(([tag, r]) => ({ tag_name: tag, id: r.id })),
        ]);
      if (endpoint.includes("/releases/tags/")) {
        const tag = endpoint.split("/releases/tags/")[1],
          r = releases.get(tag);
        return JSON.stringify({ id: r.id, tag_name: tag });
      }
      const id = Number(endpoint.match(/releases\/(\d+)\/assets/)[1]),
        r = [...releases.values()].find(r => r.id === id);
      return JSON.stringify([assetRows(r)]);
    }
    const [, action, tag] = args;
    if (action === "create") {
      assert(!releases.has(tag));
      releases.set(tag, { id: next++, files: new Map() });
      return "";
    }
    if (action === "upload") {
      const [file, label] = args[3].split("#"),
        name = path.basename(file),
        r = releases.get(tag);
      if (args.includes("--clobber")) assert.equal(name, GROWTH_BACKUP_POINTER);
      else assert(!r.files.has(name), `cannot overwrite ${name}`);
      r.files.set(name, { raw: fs.readFileSync(file), label });
      if (result.failAfterUpload === name) {
        result.failAfterUpload = null;
        throw Error("simulated connection interrupted after receipt");
      }
      return "";
    }
    throw Error(`Unexpected command ${JSON.stringify(args)}`);
  };
  result.fetch = async url => {
    const pathname = new URL(url).pathname,
      match = pathname.match(/releases\/download\/([^/]+)\/([^/]+)$/);
    const file = match && releases.get(match[1])?.files.get(match[2]);
    return file
      ? new Response(file.raw)
      : new Response("missing", { status: 404 });
  };
  return result;
}

test("publishes immutable assets and manifest before the sole pointer; old assets untouched", () => {
  const root = fixture(),
    r = remote();
  r.add("growth-cold-store-latest", "current.json.gz", "old backup");
  const receipt = publishBackupGeneration(root, "123-1", { gh: r.gh });
  assert.equal(receipt.remoteRestoreVerified, false);
  assert.equal(receipt.sourceDeletionAuthorized, false);
  const writes = r.calls.filter(a => a[1] === "upload");
  assert.equal(
    path.basename(writes.at(-1)[3].split("#")[0]),
    GROWTH_BACKUP_POINTER
  );
  assert.equal(
    path.basename(writes.at(-2)[3].split("#")[0]),
    GROWTH_BACKUP_MANIFEST
  );
  assert.equal(
    r.releases
      .get("growth-cold-store-latest")
      .files.get("current.json.gz")
      .raw.toString(),
    "old backup"
  );
  const manifest = JSON.parse(
    r.releases.get("growth-backup-123-1").files.get(GROWTH_BACKUP_MANIFEST).raw
  );
  assert.equal(manifest.coverage.complete, false);
  assert(
    manifest.files.some(
      f => f.logicalAssetName === "platform-current-bilibili.current.json.gz"
    )
  );
});
test("resumes an ambiguous successful upload by digest without blindly uploading it again", () => {
  const root = fixture(),
    r = remote();
  r.failAfterUpload = "archive-index.json.gz";
  assert.throws(
    () => publishBackupGeneration(root, "123-1", { gh: r.gh }),
    /interrupted/
  );
  assert(
    !r.releases.get("growth-cold-store-latest").files.has(GROWTH_BACKUP_POINTER)
  );
  publishBackupGeneration(root, "123-1", { gh: r.gh });
  assert.equal(
    r.calls.filter(
      a => a[1] === "upload" && a[3].includes("#archive-index.json.gz")
    ).length,
    1
  );
});
test("same-name different content fails before any upload and keeps old generation", () => {
  const root = fixture(),
    r = remote();
  r.add("growth-backup-123-1", "current.json.gz", "wrong");
  assert.throws(
    () => publishBackupGeneration(root, "123-1", { gh: r.gh }),
    /asset_conflict/
  );
  assert.equal(r.calls.filter(a => a[1] === "upload").length, 0);
});
test("server metadata mismatch blocks commit and produces no success receipt", () => {
  const root = fixture(),
    r = remote();
  r.brokenDigest = "archive-index.json.gz";
  assert.throws(
    () => publishBackupGeneration(root, "123-1", { gh: r.gh }),
    /upload_unverified/
  );
  assert(
    !r.releases.get("growth-cold-store-latest").files.has(GROWTH_BACKUP_POINTER)
  );
  assert(!fs.existsSync(path.join(root, "GENERATION_UPLOADED.json")));
});
test("old reruns cannot regress the pointer", () => {
  const root = fixture(),
    r = remote();
  r.add(
    "growth-cold-store-latest",
    GROWTH_BACKUP_POINTER,
    "newer",
    "generation:124-1"
  );
  assert.throws(
    () => publishBackupGeneration(root, "123-1", { gh: r.gh }),
    /pointer_regression/
  );
  assert.equal(r.calls.filter(a => a[1] === "upload").length, 0);
});
test("missing required assets, missing platform parts and collisions fail closed", () => {
  const root = fixture();
  fs.unlinkSync(path.join(root, "runtime-meta.json.gz"));
  assert.throws(() => prepareBackupGeneration(root, "123-1"), /ENOENT/);
  const second = fixture();
  fs.writeFileSync(
    path.join(second, "platform-current", "current.json.gz"),
    "collision"
  );
  assert.throws(
    () => prepareBackupGeneration(second, "123-1"),
    /logical_collision/
  );
  const third = fixture();
  const name = fs
    .readdirSync(path.join(third, "release-current"))
    .find(n => n.startsWith("platform-current-bilibili"));
  fs.writeFileSync(path.join(third, "release-current", name), "changed");
  assert.throws(
    () => prepareBackupGeneration(third, "123-1"),
    /current_part_integrity/
  );
});
test("actual multipart generation reassembles and repairs corrupt cache with exact hashes", async () => {
  const root = fixture(),
    r = remote();
  publishBackupGeneration(root, "123-1", { gh: r.gh, partBytes: 16 });
  const generation = await loadGrowthBackupGeneration(base, {
      fetchImpl: r.fetch,
    }),
    cacheDir = temporary();
  const logicalName = "platform-current-bilibili.current.json.gz";
  assert(
    generation.manifest.files.find(f => f.logicalAssetName === logicalName)
      .parts.length > 1
  );
  const result = await downloadGrowthBackupGenerationAsset({
    baseUrl: base,
    logicalName,
    cacheDir,
    fetchImpl: r.fetch,
    generation,
  });
  const original = fs.readFileSync(
    path.join(root, "platform-current", logicalName)
  );
  assert.deepEqual(fs.readFileSync(result.filePath), original);
  fs.writeFileSync(result.filePath, "damaged");
  const repaired = await downloadGrowthBackupGenerationAsset({
    baseUrl: base,
    logicalName,
    cacheDir,
    fetchImpl: r.fetch,
    generation,
  });
  assert.deepEqual(fs.readFileSync(repaired.filePath), original);
});
test("part tampering and total-hash mismatch do not commit a destination", async () => {
  const root = fixture(),
    r = remote();
  publishBackupGeneration(root, "123-1", { gh: r.gh, partBytes: 16 });
  const generation = await loadGrowthBackupGeneration(base, {
      fetchImpl: r.fetch,
    }),
    cacheDir = temporary(),
    logicalName = "current.json.gz",
    file = generation.manifest.files.find(
      f => f.logicalAssetName === logicalName
    );
  const asset = r.releases
      .get("growth-backup-123-1")
      .files.get(file.parts[0].assetName),
    saved = asset.raw;
  asset.raw = Buffer.alloc(saved.length, 0);
  await assert.rejects(
    () =>
      downloadGrowthBackupGenerationAsset({
        baseUrl: base,
        logicalName,
        cacheDir,
        fetchImpl: r.fetch,
        generation,
      }),
    /part_integrity/
  );
  assert(
    !fs.existsSync(path.join(cacheDir, "generations", "123-1", logicalName))
  );
  asset.raw = saved;
  file.sha256 = "0".repeat(64);
  await assert.rejects(
    () =>
      downloadGrowthBackupGenerationAsset({
        baseUrl: base,
        logicalName,
        cacheDir,
        fetchImpl: r.fetch,
        generation,
      }),
    /assembly_integrity/
  );
  assert.equal(
    fs.readdirSync(path.join(cacheDir, "generations", "123-1")).length,
    0
  );
});
test("only missing pointer allows legacy fallback; auth/network/manifest errors never do", async () => {
  assert.equal(
    await loadGrowthBackupGeneration(base, {
      fetchImpl: async () => new Response("", { status: 404 }),
    }),
    null
  );
  await assert.rejects(
    () =>
      loadGrowthBackupGeneration(base, {
        fetchImpl: async () => new Response("", { status: 403 }),
      }),
    /pointer_http_403/
  );
  await assert.rejects(
    () =>
      loadGrowthBackupGeneration(base, {
        fetchImpl: async () => {
          throw Error("offline");
        },
      }),
    /offline/
  );
  const root = fixture(),
    r = remote();
  publishBackupGeneration(root, "123-1", { gh: r.gh });
  const generation = await loadGrowthBackupGeneration(base, {
    fetchImpl: r.fetch,
  });
  assert.deepEqual(
    await downloadGrowthBackupGenerationAsset({
      baseUrl: base,
      logicalName: "missing.json.gz",
      cacheDir: temporary(),
      fetchImpl: r.fetch,
      generation,
    }),
    { attempted: true, filePath: null, generationId: "123-1" }
  );
  r.releases.get("growth-backup-123-1").files.get(GROWTH_BACKUP_MANIFEST).raw =
    Buffer.from("{}");
  await assert.rejects(
    () => loadGrowthBackupGeneration(base, { fetchImpl: r.fetch }),
    /manifest_integrity/
  );
});
test("manifest rejects gaps, wrong order, unsafe paths and missing members", () => {
  const { manifest, pointer } = prepareBackupGeneration(fixture(), "123-1", {
    partBytes: 16,
  });
  for (const mutate of [
    m => (m.files[0].parts[0].offset = 1),
    m => (m.files[0].parts[0].assetName = "../escape"),
    m => m.files[0].parts.pop(),
    m => m.files[0].parts.reverse(),
  ]) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.throws(
      () => validateBackupGenerationManifest(copy, pointer),
      /growth_backup_manifest_/
    );
  }
});
test("pinned generation remains coherent when latest pointer changes and parallel readers use separate stage files", async () => {
  const root = fixture(),
    r = remote();
  publishBackupGeneration(root, "123-1", { gh: r.gh, partBytes: 16 });
  const generation = await loadGrowthBackupGeneration(base, {
      fetchImpl: r.fetch,
    }),
    cacheDir = temporary();
  r.add(
    "growth-cold-store-latest",
    GROWTH_BACKUP_POINTER,
    "new invalid pointer",
    "generation:124-1"
  );
  const results = await Promise.all(
    [1, 2].map(() =>
      downloadGrowthBackupGenerationAsset({
        baseUrl: base,
        logicalName: "current.json.gz",
        cacheDir,
        fetchImpl: r.fetch,
        generation,
      })
    )
  );
  assert.equal(results[0].filePath, results[1].filePath);
  assert.deepEqual(
    fs.readFileSync(results[0].filePath),
    fs.readFileSync(path.join(root, "current.json.gz"))
  );
});

test("content validation rejects corrupt gzip, JSON, platform schema and unsafe tar before upload", () => {
  const cases = [
    root =>
      fs.writeFileSync(
        path.join(root, "runtime-meta.json.gz"),
        Buffer.from("broken gzip")
      ),
    root =>
      fs.writeFileSync(
        path.join(root, "runtime-meta.json.gz"),
        gzipSync("{invalid json")
      ),
    root =>
      fs.writeFileSync(
        path.join(root, "extra.json.gz"),
        gzipSync("{invalid json")
      ),
    root =>
      fs.writeFileSync(
        path.join(root, "growth-restore-bundle.tar.gz"),
        gzipSync("not tar")
      ),
    root => {
      const source = path.join(root, "bad-link");
      fs.symlinkSync("/etc/passwd", source);
      execFileSync(
        "tar",
        [
          "-czf",
          path.join(root, "growth-restore-bundle.tar.gz"),
          "-C",
          root,
          "bad-link",
        ],
        { env: { ...process.env, COPYFILE_DISABLE: "1" } }
      );
    },
  ];
  for (const mutate of cases) {
    const root = fixture(),
      r = remote();
    mutate(root);
    assert.throws(() => publishBackupGeneration(root, "123-1", { gh: r.gh }));
    assert.equal(r.calls.length, 0);
  }
});

test("platform JSON schema rejects null items even with correct gzip and hashes", () => {
  const root = fixture(),
    file = path.join(root, "platform-current-bilibili.current.json.gz");
  fs.writeFileSync(
    file,
    gzipSync(JSON.stringify({ collection: { items: null } }))
  );
  assert.throws(
    () => validateBackupContents([file]),
    /platform_current_items_invalid/
  );
  fs.writeFileSync(
    file,
    gzipSync(JSON.stringify({ collection: { items: [] } }))
  );
  assert.doesNotThrow(() => validateBackupContents([file]));
});
test("tar validator rejects traversal and duplicate members and malformed nested JSON", () => {
  for (const mode of ["traversal", "duplicate", "json"]) {
    const root = temporary(),
      file = path.join(root, "sample.tar.gz");
    execFileSync("python3", [
      "-c",
      `import tarfile,io,sys
with tarfile.open(sys.argv[1],"w:gz") as t:
 names=["../escape.json"] if sys.argv[2]=="traversal" else ["same.json","same.json"] if sys.argv[2]=="duplicate" else ["bad.json"]
 for name in names:
  raw=b"{broken" if sys.argv[2]=="json" else b"{}"
  info=tarfile.TarInfo(name); info.size=len(raw); t.addfile(info,io.BytesIO(raw))`,
      file,
      mode,
    ]);
    assert.throws(
      () => validateBackupContents([file]),
      mode === "traversal"
        ? /tar_path_invalid/
        : mode === "duplicate"
          ? /tar_duplicate_member/
          : /JSONDecodeError/
    );
  }
});

test("split complete-current bundle is parsed as a tar, not accepted by hashes alone", () => {
  const root = fixture(),
    file = path.join(
      root,
      "release-current",
      "platform-current-batch-manifest.json"
    ),
    current = JSON.parse(fs.readFileSync(file));
  const raw = Buffer.from("garbage tar with matching hashes"),
    part = current.bundle.parts[0];
  fs.writeFileSync(path.join(root, "release-current", part.assetName), raw);
  Object.assign(part, { bytes: raw.length, sha256: digest(raw) });
  Object.assign(current.bundle, { bytes: raw.length, sha256: digest(raw) });
  fs.writeFileSync(file, JSON.stringify(current));
  const r = remote();
  assert.throws(
    () => publishBackupGeneration(root, "123-1", { gh: r.gh }),
    /ReadError/
  );
  assert.equal(r.calls.length, 0);
});

test("generation publisher refuses public and unconfirmed repository before any remote mutation", () => {
  for (const isPrivate of [false, undefined]) {
    const calls = [];
    assert.throws(
      () =>
        publishBackupGeneration(fixture(), "123-1", {
          gh: args => {
            calls.push(args);
            return JSON.stringify({
              nameWithOwner: "gabrieltan0506-prog/mvstudiopro-growth-data",
              isPrivate,
            });
          },
        }),
      /confirmed_private/
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "repo");
  }
});
