import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { withGrowthStoreMutationLock } from "../server/growth/growthStoreMutationLock";

const execFileAsync = promisify(execFile);
const PLATFORMS = ["douyin", "xiaohongshu", "bilibili", "weixin_channels"] as const;
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

  const linkedFiles = await withGrowthStoreMutationLock("snapshot-platform-current-batch", async () => {
    const files: Array<{ platform: string; sourcePath: string; snapshotPath: string }> = [];
    for (const platform of PLATFORMS) {
      const sourcePath = path.join(storeDir, "platform-current", `${platform}.current.json.gz`);
      const stat = await fs.stat(sourcePath);
      if (!stat.isFile() || stat.size <= 0) throw new Error(`growth_current_snapshot_missing:${platform}`);
      const snapshotPath = path.join(outputDir, `platform-current-${platform}.current.json.gz`);
      await fs.link(sourcePath, snapshotPath);
      files.push({ platform, sourcePath, snapshotPath });
    }
    return files;
  });

  const files = [];
  for (const linked of linkedFiles) {
    await execFileAsync("gzip", ["-t", linked.snapshotPath]);
    const integrity = await hashFileParts(linked.snapshotPath, assetGeneration, linked.platform);
    if (!integrity.bytes || !integrity.parts.length) throw new Error(`growth_current_snapshot_empty:${linked.platform}`);
    files.push({
      platform: linked.platform,
      logicalAssetName: path.basename(linked.snapshotPath),
      snapshotFile: path.basename(linked.snapshotPath),
      ...integrity,
    });
  }

  const manifest = {
    schemaVersion: 1,
    batchId,
    assetGeneration,
    createdAt: new Date().toISOString(),
    partBytes: PART_BYTES,
    source: "fly-growth-store-hardlink-snapshot",
    files,
  };
  const manifestPath = path.join(outputDir, "snapshot-manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, outputDir, manifestPath, batchId, files: files.length }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
