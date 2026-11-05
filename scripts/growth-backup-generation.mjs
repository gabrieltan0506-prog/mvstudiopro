import {
  privateGrowthBackupTarget,
  runBackupGh,
} from "./growth-backup-target.mjs";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  GROWTH_BACKUP_POINTER,
  GROWTH_BACKUP_MANIFEST,
  GROWTH_BACKUP_PART_BYTES,
  validateBackupGenerationManifest,
} from "../shared/growthBackupGeneration.mjs";

const sha = b => createHash("sha256").update(b).digest("hex");
const fail = message => {
  throw new Error(`growth_backup_${message}`);
};
const required = [
  "current.json.gz",
  "runtime-meta.json.gz",
  "archive-index.json.gz",
  "history-summary.json.gz",
  "backup-manifest.json",
  "cold-restore-manifest.json",
  "growth-restore-bundle.tar.gz",
];
const optional = [
  "platform-current-snapshot-manifest.json",
  "core-snapshot-manifest.json",
  "source-inventory.json",
  "growth-debug-summary.json.gz",
  "weixin-channels-miner.json.gz",
  "growth-platforms.tar.gz",
  "growth-history-ledger.tar.gz",
  "source-coverage.json",
  "coverage.json",
];
function integrity(file) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.size <= 0)
    fail(`file_invalid:${path.basename(file)}`);
  const digest = createHash("sha256"),
    buffer = Buffer.alloc(1024 * 1024),
    fd = fs.openSync(file, "r");
  let bytes = 0;
  try {
    let n;
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) {
      digest.update(buffer.subarray(0, n));
      bytes += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  const after = fs.lstatSync(file);
  if (
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  )
    fail("source_changed");
  return { bytes, sha256: digest.digest("hex") };
}

// The runner validates real contents, not merely transport hashes. Python processes
// one JSON/member at a time so large independent files are not retained together.
const contentValidator = String.raw`
import gzip, io, json, os, sys, tarfile

def check_json(stream, name):
    value=json.load(stream)
    if os.path.basename(name).startswith("platform-current-") and name.endswith(".json.gz"):
        items=value.get("items") if isinstance(value,dict) else None
        if items is None and isinstance(value,dict) and isinstance(value.get("collection"),dict):
            items=value["collection"].get("items")
        if not isinstance(items,list): raise ValueError("platform_current_items_invalid")

def check_tar(stream):
    seen=set()
    with tarfile.open(fileobj=stream,mode="r|") as archive:
        for member in archive:
            name=member.name.rstrip("/")
            while name.startswith("./"): name=name[2:]
            if name=="." and member.isdir(): continue
            if not name or name.startswith("/") or "\\" in name or any(c in ("",".","..") for c in name.split("/")) or any(ord(c)<32 for c in name):
                raise ValueError("tar_path_invalid")
            if name in seen: raise ValueError("tar_duplicate_member")
            seen.add(name)
            if member.isdir(): continue
            if not member.isfile(): raise ValueError("tar_type_invalid")
            with archive.extractfile(member) as payload:
                if name.endswith(".json.gz"):
                    with gzip.GzipFile(fileobj=payload) as decoded: check_json(decoded,name)
                elif name.endswith(".json"): check_json(payload,name)
                else:
                    while payload.read(1024*1024): pass
    while True:
        tail=stream.read(1024*1024)
        if not tail: break
        if any(tail): raise ValueError("tar_trailing_content")

class PartsReader(io.RawIOBase):
    def __init__(self,paths): self.paths=iter(paths); self.current=None
    def readable(self): return True
    def readinto(self,buffer):
        while True:
            if self.current is None:
                try: self.current=open(next(self.paths),"rb")
                except StopIteration: return 0
            count=self.current.readinto(buffer)
            if count: return count
            self.current.close(); self.current=None
    def close(self):
        if self.current: self.current.close()
        super().close()

for file in sys.argv[1:]:
    try:
        if file.startswith("--tar-parts="):
            with PartsReader(json.loads(file[len("--tar-parts="):])) as parts, io.BufferedReader(parts) as stream: check_tar(stream)
        elif file.endswith(".tar.gz"):
            with gzip.open(file,"rb") as stream: check_tar(stream)
        elif file.endswith(".tar"):
            with open(file,"rb") as stream: check_tar(stream)
        elif file.endswith(".json.gz"):
            with gzip.open(file,"rb") as stream: check_json(stream,file)
        elif file.endswith(".json"):
            with open(file,"rb") as stream: check_json(stream,file)
    except Exception as error:
        print("growth_backup_content_invalid:"+os.path.basename(file)+":"+type(error).__name__+":"+str(error),file=sys.stderr)
        sys.exit(1)
`;
export function validateBackupContents(files, tarParts = []) {
  try {
    execFileSync(
      "python3",
      [
        "-c",
        contentValidator,
        ...files,
        ...tarParts.map(parts => `--tar-parts=${JSON.stringify(parts)}`),
      ],
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
  } catch (error) {
    throw new Error(
      String(error.stderr || "growth_backup_content_validation_failed").trim()
    );
  }
}

export function prepareBackupGeneration(
  root,
  batchId,
  { partBytes = GROWTH_BACKUP_PART_BYTES } = {}
) {
  root = path.resolve(root);
  if (!/^\d+-\d+$/.test(batchId || "")) fail("batch_invalid");
  if (
    !Number.isSafeInteger(partBytes) ||
    partBytes <= 0 ||
    partBytes > GROWTH_BACKUP_PART_BYTES
  )
    fail("part_size_invalid");
  const releaseTag = `growth-backup-${batchId}`,
    entries = new Map();
  const add = file => {
    const name = path.basename(file),
      actual = integrity(file),
      previous = entries.get(name);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) fail("asset_name_invalid");
    if (
      previous &&
      (previous.bytes !== actual.bytes || previous.sha256 !== actual.sha256)
    )
      fail(`logical_collision:${name}`);
    entries.set(name, { file, logicalAssetName: name, ...actual });
  };
  for (const name of required) add(path.join(root, name));
  for (const name of optional)
    if (fs.existsSync(path.join(root, name))) add(path.join(root, name));
  for (const directory of [
    root,
    path.join(root, "platforms"),
    path.join(root, "history-ledger"),
    path.join(root, "platform-current"),
  ]) {
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }))
      if (entry.name.endsWith(".json.gz"))
        add(path.join(directory, entry.name));
  }
  const currentManifestPath = path.join(
    root,
    "release-current",
    "platform-current-batch-manifest.json"
  );
  add(currentManifestPath);
  const current = JSON.parse(fs.readFileSync(currentManifestPath, "utf8"));
  if (
    current.batchId !== batchId ||
    !Array.isArray(current.files) ||
    !current.files.length
  )
    fail("current_manifest_invalid");
  const currentPlatforms = new Set(current.files.map(file => file.platform));
  if (
    currentPlatforms.size !== current.files.length ||
    ["douyin", "xiaohongshu", "bilibili", "weixin_channels"].some(
      p => !currentPlatforms.has(p)
    )
  )
    fail("current_platforms_incomplete");
  for (const file of [...current.files, current.bundle]) {
    if (!file || !Array.isArray(file.parts) || !file.parts.length)
      fail("current_parts_missing");
    let offset = 0;
    const aggregate = createHash("sha256");
    file.parts.forEach((part, index) => {
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part.assetName || "") ||
        part.index !== index ||
        part.offset !== offset
      )
        fail("current_part_invalid");
      const source = path.join(root, "release-current", part.assetName),
        actual = integrity(source);
      if (actual.bytes !== part.bytes || actual.sha256 !== part.sha256)
        fail("current_part_integrity");
      const fd = fs.openSync(source, "r"),
        buffer = Buffer.alloc(1024 * 1024);
      try {
        let n;
        while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)))
          aggregate.update(buffer.subarray(0, n));
      } finally {
        fs.closeSync(fd);
      }
      offset += part.bytes;
      add(source);
    });
    if (offset !== file.bytes || aggregate.digest("hex") !== file.sha256)
      fail("current_parts_incomplete");
    if (file.logicalAssetName?.endsWith(".json.gz")) {
      const logical = entries.get(file.logicalAssetName);
      if (
        !logical ||
        logical.bytes !== file.bytes ||
        logical.sha256 !== file.sha256
      )
        fail("current_logical_file_missing_or_changed");
    }
  }
  // Preserve all present release-current parts, including evidence not referenced by a current index.
  for (const entry of fs.readdirSync(path.join(root, "release-current")))
    if (/\.part-\d+$/.test(entry))
      add(path.join(root, "release-current", entry));
  validateBackupContents(
    [...entries.values()].map(entry => entry.file),
    [
      current.bundle.parts.map(part =>
        path.join(root, "release-current", part.assetName)
      ),
    ]
  );
  const directory = path.join(root, "generation-assets");
  fs.mkdirSync(directory, { recursive: true });
  const assets = new Map(),
    files = [];
  const addAsset = asset => {
    const existing = assets.get(asset.assetName);
    if (
      existing &&
      (existing.bytes !== asset.bytes || existing.sha256 !== asset.sha256)
    )
      fail("part_asset_collision");
    assets.set(asset.assetName, asset);
  };
  for (const entry of [...entries.values()].sort((a, b) =>
    a.logicalAssetName.localeCompare(b.logicalAssetName, "en")
  )) {
    const parts = [];
    if (entry.bytes <= partBytes) {
      const part = {
        assetName: entry.logicalAssetName,
        bytes: entry.bytes,
        sha256: entry.sha256,
        index: 0,
        offset: 0,
      };
      parts.push(part);
      addAsset({ ...part, file: entry.file });
    } else {
      const fd = fs.openSync(entry.file, "r"),
        hash = createHash("sha256");
      let offset = 0;
      try {
        while (offset < entry.bytes) {
          const buffer = Buffer.alloc(
            Math.min(partBytes, entry.bytes - offset)
          );
          let read = 0;
          while (read < buffer.length) {
            const n = fs.readSync(
              fd,
              buffer,
              read,
              buffer.length - read,
              offset + read
            );
            if (!n) fail("source_truncated");
            read += n;
          }
          const assetName = `${entry.logicalAssetName}.generation-part-${String(parts.length).padStart(5, "0")}`,
            file = path.join(directory, assetName);
          fs.writeFileSync(file, buffer);
          hash.update(buffer);
          const part = {
            assetName,
            bytes: read,
            sha256: sha(buffer),
            index: parts.length,
            offset,
          };
          parts.push(part);
          addAsset({ ...part, file });
          offset += read;
        }
      } finally {
        fs.closeSync(fd);
      }
      if (hash.digest("hex") !== entry.sha256) fail("source_changed");
    }
    files.push({
      logicalAssetName: entry.logicalAssetName,
      bytes: entry.bytes,
      sha256: entry.sha256,
      parts,
    });
  }
  const coveragePath = path.join(
    root,
    fs.existsSync(path.join(root, "source-coverage.json"))
      ? "source-coverage.json"
      : "coverage.json"
  );
  const coverage = fs.existsSync(coveragePath)
    ? JSON.parse(fs.readFileSync(coveragePath, "utf8"))
    : { complete: false, reason: "source_inventory_not_provided" };
  const manifest = {
    schemaVersion: 1,
    batchId,
    releaseTag,
    scope: "growth-cold-restore-selected-assets",
    coverage,
    files,
  };
  validateBackupGenerationManifest(manifest, { batchId, releaseTag });
  const raw = Buffer.from(JSON.stringify(manifest, null, 2)),
    file = path.join(directory, GROWTH_BACKUP_MANIFEST);
  fs.writeFileSync(file, raw);
  const description = {
    assetName: GROWTH_BACKUP_MANIFEST,
    file,
    bytes: raw.length,
    sha256: sha(raw),
  };
  const pointer = {
    schemaVersion: 1,
    batchId,
    releaseTag,
    manifest: {
      assetName: GROWTH_BACKUP_MANIFEST,
      bytes: raw.length,
      sha256: sha(raw),
    },
  };
  const pointerFile = path.join(directory, GROWTH_BACKUP_POINTER);
  fs.writeFileSync(pointerFile, JSON.stringify(pointer, null, 2));
  return {
    manifest,
    pointer,
    pointerFile,
    assets: [...assets.values()],
    manifestAsset: description,
  };
}

export function publishBackupGeneration(
  root,
  batchId,
  { gh = runBackupGh, partBytes } = {}
) {
  fs.rmSync(path.join(root, "GENERATION_UPLOADED.json"), { force: true });
  const prepared = prepareBackupGeneration(root, batchId, { partBytes }),
    { pointer, manifestAsset } = prepared;
  const target = privateGrowthBackupTarget(gh);
  gh = target.gh;
  const repo = target.repository;
  const releases = JSON.parse(
    gh(["api", "--paginate", "--slurp", `repos/${repo}/releases?per_page=100`])
  ).flat();
  let release = releases.find(r => r.tag_name === pointer.releaseTag);
  let latest = releases.find(r => r.tag_name === "growth-cold-store-latest");
  if (!latest) {
    gh([
      "release",
      "create",
      "growth-cold-store-latest",
      "--latest=false",
      "--title",
      "Growth private backup pointer",
      "--notes",
      "Only committed generation pointers; backup contents remain immutable",
    ]);
    latest = JSON.parse(
      gh(["api", `repos/${repo}/releases/tags/growth-cold-store-latest`])
    );
  }
  const inventory = id =>
    JSON.parse(
      gh([
        "api",
        "--paginate",
        "--slurp",
        `repos/${repo}/releases/${id}/assets?per_page=100`,
      ])
    ).flat();
  const matches = (asset, remote) =>
    remote.state === "uploaded" &&
    remote.size === asset.bytes &&
    remote.digest === `sha256:${asset.sha256}`;
  const assertPointerOrder = () => {
    const pointers = inventory(latest.id).filter(
      e => e.name === GROWTH_BACKUP_POINTER
    );
    if (pointers.length > 1) fail("pointer_ambiguous");
    if (!pointers.length) return;
    const label = pointers[0].label;
    if (!/^generation:\d+-\d+$/.test(label || ""))
      fail("pointer_generation_unknown");
    const old = label.slice("generation:".length).split("-").map(BigInt),
      current = batchId.split("-").map(BigInt);
    if (old[0] > current[0] || (old[0] === current[0] && old[1] > current[1]))
      fail("pointer_regression");
  };
  assertPointerOrder();
  const all = [...prepared.assets, manifestAsset];
  let entries = release ? inventory(release.id) : [];
  // Check every immutable name before any write. An ambiguous upload is reconciled on the next invocation.
  for (const asset of all) {
    const previous = entries.filter(e => e.name === asset.assetName);
    if (previous.length > 1 || previous.some(e => !matches(asset, e)))
      fail(`asset_conflict:${asset.assetName}`);
  }
  if (!release) {
    gh([
      "release",
      "create",
      pointer.releaseTag,
      "--target",
      process.env.GITHUB_SHA || "main",
      "--latest=false",
      "--title",
      pointer.releaseTag,
      "--notes",
      "Immutable Growth backup generation; source data retained",
    ]);
    release = JSON.parse(
      gh(["api", `repos/${repo}/releases/tags/${pointer.releaseTag}`])
    );
  }
  for (const asset of all) {
    if (!entries.some(e => e.name === asset.assetName))
      gh([
        "release",
        "upload",
        pointer.releaseTag,
        `${asset.file}#${asset.assetName}`,
      ]);
    entries = inventory(release.id);
    const actual = entries.filter(e => e.name === asset.assetName);
    if (actual.length !== 1 || !matches(asset, actual[0]))
      fail(`upload_unverified:${asset.assetName}`);
  }
  // The only mutable object is committed after every immutable asset and manifest is verified.
  assertPointerOrder();
  gh([
    "release",
    "upload",
    "growth-cold-store-latest",
    `${prepared.pointerFile}#generation:${batchId}`,
    "--clobber",
  ]);
  const raw = fs.readFileSync(prepared.pointerFile),
    expected = { bytes: raw.length, sha256: sha(raw) };
  const result = inventory(latest.id).filter(
    e => e.name === GROWTH_BACKUP_POINTER
  );
  if (result.length !== 1 || !matches(expected, result[0]))
    fail("pointer_commit_unverified");
  const receipt = {
    schemaVersion: 1,
    batchId,
    releaseTag: pointer.releaseTag,
    assets: all.length,
    manifestSha256: manifestAsset.sha256,
    verification: "github-uploaded-size-sha256-metadata",
    remoteRestoreVerified: false,
    sourceDeletionAuthorized: false,
  };
  fs.writeFileSync(
    path.join(root, "GENERATION_UPLOADED.json"),
    JSON.stringify(receipt, null, 2)
  );
  return receipt;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    console.log(
      JSON.stringify(
        publishBackupGeneration(
          process.argv[2],
          process.argv[3] ||
            `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
        )
      )
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
