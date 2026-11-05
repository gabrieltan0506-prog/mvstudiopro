import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readGrowthGzipJson } from "../server/growth/growthJsonStream";
import { inventoryGrowthCoverage, REQUIRED_CORE_FILES, OPTIONAL_CORE_FILES, REQUIRED_CURRENT_PLATFORMS, EXCLUDED_PLATFORMS } from "./growth-backup-coverage.mjs";

import { withGrowthStoreMutationLock } from "../server/growth/growthStoreMutationLock";

const PLATFORMS: readonly string[] = REQUIRED_CURRENT_PLATFORMS;
const PART_BYTES = 32 * 1024 * 1024;

type FilePart = {
  index: number;
  offset: number;
  bytes: number;
  sha256: string;
  assetName: string;
};

async function hashFileParts(filePath: string, assetGeneration: string, platform: string) {
  const handle = await fs.open(filePath, "r");
  const fullHash = createHash("sha256");
  const parts: FilePart[] = [];
  let offset = 0;
  let index = 0;
  try {
    while (true) {
      const buffer = Buffer.allocUnsafe(PART_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, PART_BYTES, offset);
      if (!bytesRead) break;
      const chunk = buffer.subarray(0, bytesRead);
      fullHash.update(chunk);
      parts.push({
        index,
        offset,
        bytes: bytesRead,
        sha256: createHash("sha256").update(chunk).digest("hex"),
        assetName: `platform-current-${platform}.${assetGeneration}.part-${String(index).padStart(4, "0")}`,
      });
      offset += bytesRead;
      index += 1;
    }
  } finally {
    await handle.close();
  }
  return { bytes: offset, sha256: fullHash.digest("hex"), parts };
}

async function hashSnapshotFile(filePath: string) {
  const handle = await fs.open(filePath, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  let bytes = 0;
  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead)); bytes += bytesRead;
    }
  } finally { await handle.close(); }
  return { bytes, sha256: hash.digest("hex") };
}

function readFlag(name: string) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const outputArg = readFlag("output");
  if (!outputArg) throw new Error("Usage: tsx scripts/snapshot-growth-platform-current-batch.mts --output=DIR [--batch-id=ID]");
  const outputDir = path.resolve(outputArg);
  const batchId = String(readFlag("batch-id") || `${Date.now()}-${randomUUID().slice(0, 8)}`)
    .replace(/[^0-9A-Za-z._-]+/g, "-");
  const assetGeneration = String(readFlag("asset-generation") || batchId)
    .replace(/[^0-9A-Za-z._-]+/g, "-");
  const storeDir = path.resolve(process.env.GROWTH_STORE_DIR || path.join(process.cwd(), ".cache", "growth"));
  await fs.mkdir(path.dirname(outputDir), { recursive: true });
  await fs.mkdir(outputDir, { recursive: false });
  // This marker owns only this temporary batch, never its linked source files.
  await fs.writeFile(path.join(outputDir, ".snapshot-owner.json"), JSON.stringify({
    schemaVersion: 1, batchId, pid: process.pid, createdAt: new Date().toISOString(),
  }), { flag: "wx", mode: 0o600 });

  const snapshot = await withGrowthStoreMutationLock("snapshot-platform-current-batch", async (lease) => {
    const coreFiles = [], optionalMissing = [];
    for (const relativePath of [...REQUIRED_CORE_FILES, ...OPTIONAL_CORE_FILES]) {
      await lease.assertOwned();
      const required = REQUIRED_CORE_FILES.includes(relativePath);
      const sourcePath = path.join(storeDir, relativePath);
      let stat;
      try { stat = await fs.lstat(sourcePath); }
      catch (error) {
        if (!required && (error as NodeJS.ErrnoException).code === "ENOENT") { optionalMissing.push(relativePath); continue; }
        throw error;
      }
      if (!stat.isFile() || stat.size === 0) throw new Error(`growth_core_snapshot_invalid:${relativePath}`);
      const raw = await fs.readFile(sourcePath);
      const parsed = JSON.parse(raw.toString("utf8"));
      if (relativePath === "archive-index.json" ? !Array.isArray(parsed) : !parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error(`growth_core_snapshot_schema:${relativePath}`);
      const after = await fs.lstat(sourcePath);
      if (after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
        throw new Error(`growth_core_snapshot_changed:${relativePath}`);
      const snapshotFile = `core/${relativePath}`;
      await fs.mkdir(path.dirname(path.join(outputDir, snapshotFile)), { recursive: true });
      // Core metadata includes older in-place writers; copy instead of hardlinking it.
      await fs.writeFile(path.join(outputDir, snapshotFile), raw, { flag: "wx" });
      coreFiles.push({ relativePath, snapshotFile, required, bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex") });
    }
    const guaikeiRelative = "paid-research/guaikei";
    const guaikeiRoot = path.join(storeDir, guaikeiRelative);
    if (!(await fs.lstat(guaikeiRoot)).isDirectory()) throw new Error("growth_tiktok_source_directory_invalid");
    for (const name of ["index.json", "automation.json"])
      if (!(await fs.lstat(path.join(guaikeiRoot, name))).isFile()) throw new Error(`growth_tiktok_ledger_invalid:${name}`);
    const guaikeiIndex = JSON.parse(await fs.readFile(path.join(guaikeiRoot, "index.json"), "utf8"));
    const automation = JSON.parse(await fs.readFile(path.join(guaikeiRoot, "automation.json"), "utf8"));
    if (guaikeiIndex.version !== 1 || !Array.isArray(guaikeiIndex.jobs)
        || automation.version !== 1 || !Array.isArray(automation.runs)) throw new Error("growth_tiktok_ledger_schema_invalid");
    const allowedPaidPlatforms = new Set(["douyin", "xiaohongshu", "wechat", "tiktok"]);
    const allIds = new Set<string>();
    const selectedJobs: Array<{id:string; input:{platform:string}; status:string; items:unknown[]}> = [];
    for (const job of guaikeiIndex.jobs) {
      if (!job || typeof job.id !== "string" || !/^[a-f0-9-]{36}$/i.test(job.id) || allIds.has(job.id)
          || typeof job.input?.platform !== "string" || !Array.isArray(job.items)) throw new Error("growth_tiktok_job_invalid");
      allIds.add(job.id);
      if (allowedPaidPlatforms.has(job.input.platform)) selectedJobs.push(job);
    }
    const selectedIds = new Set(selectedJobs.map(job => job.id));
    const selectedPaidFile = (name: string) => name === "index.json" || name === "automation.json"
      || (/^[a-f0-9-]{36}\..+\.json$/i.test(name) && selectedIds.has(name.slice(0,36)));
    const selectedBefore = (await fs.readdir(guaikeiRoot)).filter(selectedPaidFile).sort();
    for (const job of selectedJobs) {
      if (["completed", "empty"].includes(job.status)
          && !selectedBefore.some(name => name.startsWith(`${job.id}.`) && name.endsWith(".raw.json") && !name.endsWith(".submit.raw.json")))
        throw new Error(`growth_tiktok_completed_receipt_missing:${job.id}`);
    }
    const directoryRoots = ["platforms", "history-ledger", guaikeiRelative];
    const directoryFiles: Array<{ relativePath: string; snapshotFile: string; bytes: number; sha256: string }> = [];
    async function linkDirectory(relativePath: string) {
      await lease.assertOwned();
      const sourcePath = path.join(storeDir, relativePath);
      const stat = await fs.lstat(sourcePath);
      if (!stat.isDirectory()) throw new Error(`growth_directory_snapshot_invalid:${relativePath}`);
      await fs.mkdir(path.join(outputDir, "directories", relativePath), { recursive: true });
      for (const name of (await fs.readdir(sourcePath)).sort()) {
        if (/[\\\x00-\x1f\x7f]/.test(name)) throw new Error("growth_directory_snapshot_name_invalid");
        if (name.startsWith("._")) continue; // AppleDouble metadata is not platform JSON.
        const childRelative = `${relativePath}/${name}`;
        if (relativePath === guaikeiRelative && !selectedPaidFile(name)) continue;
        if (/^(?:platforms|history-ledger)\/(?:kuaishou|toutiao)\.json(?:\.gz)?$/.test(childRelative)) continue;
        const childSource = path.join(storeDir, childRelative);
        const before = await fs.lstat(childSource);
        if (before.isDirectory()) { await linkDirectory(childRelative); continue; }
        if (!before.isFile()) throw new Error(`growth_directory_snapshot_type_invalid:${childRelative}`);
        if (!before.size && /\.json(?:\.gz)?$/.test(name)) throw new Error(`growth_directory_snapshot_empty_json:${childRelative}`);
        const snapshotFile = `directories/${childRelative}`;
        const snapshotPath = path.join(outputDir, snapshotFile);
        await lease.assertOwned();
        await fs.link(childSource, snapshotPath);
        const integrity = await hashSnapshotFile(snapshotPath);
        if (childRelative.startsWith(`${guaikeiRelative}/`)) JSON.parse(await fs.readFile(snapshotPath,"utf8"));
        const after = await fs.lstat(snapshotPath);
        if (!after.isFile() || before.ino !== after.ino || before.dev !== after.dev
            || before.size !== after.size || before.mtimeMs !== after.mtimeMs || integrity.bytes !== before.size)
          throw new Error(`growth_directory_snapshot_changed:${childRelative}`);
        await lease.assertOwned();
        directoryFiles.push({ relativePath: childRelative, snapshotFile, ...integrity });
      }
    }
    for (const relativePath of directoryRoots) await linkDirectory(relativePath);
    const selectedAfter = (await fs.readdir(guaikeiRoot)).filter(selectedPaidFile).sort();
    if (JSON.stringify(selectedBefore) !== JSON.stringify(selectedAfter)) throw new Error("growth_tiktok_receipts_changed_during_snapshot");
    const paidResearch = {
      automaticResumeAllowed: false, restoreMode: "offline-audit-only",
      source: guaikeiRelative, platforms: [...allowedPaidPlatforms],
      sharedLedgers: ["index.json", "automation.json"], sharedLedgersMayContainExcludedPlatformMetadata: true,
      jobIds: selectedJobs.map(job => job.id), tiktokJobIds: selectedJobs.filter(job => job.input.platform === "tiktok").map(job => job.id),
      receiptFiles: selectedBefore.filter(name => !["index.json", "automation.json"].includes(name)),
      tiktokItems: selectedJobs.filter(job => job.input.platform === "tiktok").reduce((n,job) => n + job.items.length, 0),
    };
    const files: Array<{ platform: string; sourcePath: string; snapshotPath: string; inode: number; bytes: number; mtimeMs: number }> = [];
    const platforms = PLATFORMS;
    for (const platform of platforms) {
      await lease.assertOwned();
      const sourcePath = path.join(storeDir, "platform-current", `${platform}.current.json.gz`);
      const stat = await fs.lstat(sourcePath);
      if (!stat.isFile() || stat.size <= 0) throw new Error(`growth_current_snapshot_missing:${platform}`);
      const snapshotPath = path.join(outputDir, `platform-current-${platform}.current.json.gz`);
      await fs.link(sourcePath, snapshotPath);
      files.push({ platform, sourcePath, snapshotPath, inode: stat.ino, bytes: stat.size, mtimeMs: stat.mtimeMs });
    }
    const coverage = await inventoryGrowthCoverage(storeDir);
    if (coverage.missingRequired.length || coverage.errors.length) throw new Error("growth_snapshot_required_coverage_missing");
    if (JSON.stringify(selectedBefore) !== JSON.stringify((await fs.readdir(guaikeiRoot)).filter(selectedPaidFile).sort()))
      throw new Error("growth_tiktok_receipts_changed_during_snapshot");
    await lease.assertOwned();
    await fs.writeFile(path.join(outputDir, "coverage.json"), JSON.stringify(coverage, null, 2), { flag: "wx" });
    return { linkedFiles: files, coreFiles, directoryRoots, directoryFiles, paidResearch, optionalMissing, capturedAt: new Date().toISOString() };
  });

  const files = [];
  for (const linked of snapshot.linkedFiles) {
    const value = await readGrowthGzipJson<{ platform?: string; items?: unknown[]; collection?: { items?: unknown[] } }>(linked.snapshotPath);
    const items = value?.collection?.items ?? value?.items;
    if (!Array.isArray(items) || (value.platform && value.platform !== linked.platform))
      throw new Error(`growth_current_snapshot_schema:${linked.platform}`);
    const integrity = await hashFileParts(linked.snapshotPath, assetGeneration, linked.platform);
    const after = await fs.lstat(linked.snapshotPath);
    if (!after.isFile() || after.ino !== linked.inode || after.size !== linked.bytes || after.mtimeMs !== linked.mtimeMs)
      throw new Error(`growth_current_snapshot_changed:${linked.platform}`);
    if (!integrity.bytes || !integrity.parts.length) throw new Error(`growth_current_snapshot_empty:${linked.platform}`);
    files.push({
      platform: linked.platform,
      logicalAssetName: path.basename(linked.snapshotPath),
      snapshotFile: path.basename(linked.snapshotPath),
      itemCount: items.length,
      ...integrity,
    });
  }

  const manifest = {
    schemaVersion: 1,
    batchId,
    assetGeneration,
    createdAt: new Date().toISOString(),
    partBytes: PART_BYTES,
    source: "fly-growth-store-locked-core-and-current-snapshot",
    capturedAt: snapshot.capturedAt,
    coreFiles: snapshot.coreFiles,
    directoryRoots: snapshot.directoryRoots,
    directoryFiles: snapshot.directoryFiles,
    paidResearch: snapshot.paidResearch,
    dataPlatforms: ["douyin", "xiaohongshu", "bilibili", "weixin_channels", "tiktok"],
    optionalMissing: snapshot.optionalMissing,
    coverageFile: "coverage.json",
    excludedPlatforms: EXCLUDED_PLATFORMS,
    fullStoreComplete: false,
    files,
  };
  const manifestPath = path.join(outputDir, "snapshot-manifest.json");
  const nextManifestPath = `${manifestPath}.next`;
  await fs.writeFile(nextManifestPath, JSON.stringify(manifest, null, 2), { flag: "wx" });
  await fs.rename(nextManifestPath, manifestPath);
  console.log(JSON.stringify({ ok: true, outputDir, manifestPath, batchId, files: files.length }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
