#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const [snapshotManifestArg, platformDirArg, outputDirArg] = process.argv.slice(2);
if (!snapshotManifestArg || !platformDirArg || !outputDirArg) {
  throw new Error("Usage: node scripts/finalize-growth-platform-current-batch.mjs <snapshot-manifest> <platform-dir> <output-dir>");
}
const manifest = JSON.parse(await fs.readFile(path.resolve(snapshotManifestArg), "utf8"));
const platformDir = path.resolve(platformDirArg);
const outputDir = path.resolve(outputDirArg);
await fs.mkdir(outputDir, { recursive: true });

async function hashFile(filePath) {
  const handle = await fs.open(filePath, "r");
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    while (true) {
      const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, bytes);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      bytes += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return { bytes, sha256: hash.digest("hex") };
}

for (const file of manifest.files || []) {
  const filePath = path.join(platformDir, file.logicalAssetName);
  const integrity = await hashFile(filePath);
  if (integrity.bytes !== file.bytes || integrity.sha256 !== file.sha256) {
    throw new Error(`growth_current_batch_file_mismatch:${file.platform}`);
  }
  await execFileAsync("gzip", ["-t", filePath]);
}

const bundleName = `growth-platform-current-complete.${manifest.assetGeneration || manifest.batchId}.tar`;
const bundlePath = path.join(outputDir, bundleName);
await execFileAsync("tar", [
  "-cf",
  bundlePath,
  "-C",
  platformDir,
  ...(manifest.files || []).map((file) => file.logicalAssetName),
]);
const bundleParts = [];
const partBytes = Number(manifest.partBytes || 32 * 1024 * 1024);
const bundleHandle = await fs.open(bundlePath, "r");
const bundleHash = createHash("sha256");
let bundleBytes = 0;
try {
  for (let index = 0; ; index += 1) {
    const buffer = Buffer.allocUnsafe(partBytes);
    const { bytesRead } = await bundleHandle.read(buffer, 0, partBytes, bundleBytes);
    if (!bytesRead) break;
    const chunk = buffer.subarray(0, bytesRead);
    const assetName = `${bundleName}.part-${String(index).padStart(4, "0")}`;
    await fs.writeFile(path.join(outputDir, assetName), chunk);
    bundleHash.update(chunk);
    bundleParts.push({
      index,
      offset: bundleBytes,
      bytes: bytesRead,
      sha256: createHash("sha256").update(chunk).digest("hex"),
      assetName,
    });
    bundleBytes += bytesRead;
  }
} finally {
  await bundleHandle.close();
}
await fs.unlink(bundlePath);

const releaseManifest = {
  ...manifest,
  finalizedAt: new Date().toISOString(),
  bundle: {
    logicalAssetName: "growth-platform-current-complete.tar",
    bytes: bundleBytes,
    sha256: bundleHash.digest("hex"),
    parts: bundleParts,
  },
};
await fs.writeFile(
  path.join(outputDir, "platform-current-batch-manifest.json"),
  JSON.stringify(releaseManifest, null, 2),
  "utf8",
);
console.log(JSON.stringify({ ok: true, batchId: manifest.batchId, files: manifest.files.length, bundleParts: bundleParts.length }));
