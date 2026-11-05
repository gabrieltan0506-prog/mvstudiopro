import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";

export const GROWTH_BACKUP_POINTER = "growth-backup-latest.json";
export const GROWTH_BACKUP_MANIFEST = "growth-backup-generation.json";
export const GROWTH_BACKUP_PART_BYTES = 256 * 1024 * 1024;
const sha = b => createHash("sha256").update(b).digest("hex");
const safeName = value =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
const validDigest = value => /^[a-f0-9]{64}$/.test(value || "");
const validSize = value => Number.isSafeInteger(value) && value > 0;
const fail = reason => {
  throw new Error(`growth_backup_${reason}`);
};

export function generationAssetUrl(baseUrl, releaseTag, assetName) {
  if (!/^growth-backup-\d+-\d+$/.test(releaseTag) || !safeName(assetName))
    fail("asset_location_invalid");
  const base = String(baseUrl).replace(/\/$/, "");
  // Mirrors must expose the same sibling release layout. Never follow a URL supplied by a manifest.
  if (!base.endsWith("/growth-cold-store-latest"))
    fail("generation_base_unsupported");
  return `${base.slice(0, -"growth-cold-store-latest".length)}${releaseTag}/${assetName}`;
}

export function validateBackupGenerationManifest(manifest, pointer) {
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.batchId !== pointer.batchId ||
    manifest.releaseTag !== pointer.releaseTag ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length
  )
    fail("manifest_invalid");
  const names = new Set(),
    parts = new Map();
  for (const file of manifest.files) {
    if (
      !safeName(file.logicalAssetName) ||
      names.has(file.logicalAssetName) ||
      !validSize(file.bytes) ||
      !validDigest(file.sha256) ||
      !Array.isArray(file.parts) ||
      !file.parts.length
    )
      fail("manifest_file_invalid");
    names.add(file.logicalAssetName);
    let offset = 0;
    file.parts.forEach((part, index) => {
      if (
        !safeName(part.assetName) ||
        part.index !== index ||
        part.offset !== offset ||
        !validSize(part.bytes) ||
        part.bytes > GROWTH_BACKUP_PART_BYTES ||
        !validDigest(part.sha256)
      )
        fail("manifest_part_invalid");
      const previous = parts.get(part.assetName);
      if (
        previous &&
        (previous.bytes !== part.bytes || previous.sha256 !== part.sha256)
      )
        fail("manifest_part_collision");
      parts.set(part.assetName, part);
      offset += part.bytes;
    });
    if (!Number.isSafeInteger(offset) || offset !== file.bytes)
      fail("manifest_size_mismatch");
  }
  return manifest;
}

/** Pin this result for a restore transaction so different assets cannot come from different generations. */
export async function loadGrowthBackupGeneration(
  baseUrl,
  { fetchImpl = fetch, signal } = {}
) {
  const response = await fetchImpl(
    `${String(baseUrl).replace(/\/$/, "")}/${GROWTH_BACKUP_POINTER}`,
    { cache: "no-store", signal }
  );
  if (response.status === 404) return null;
  if (!response.ok) fail(`pointer_http_${response.status}`);
  const pointer = await response.json();
  if (
    pointer?.schemaVersion !== 1 ||
    !/^\d+-\d+$/.test(pointer.batchId || "") ||
    pointer.releaseTag !== `growth-backup-${pointer.batchId}` ||
    pointer.manifest?.assetName !== GROWTH_BACKUP_MANIFEST ||
    !validSize(pointer.manifest.bytes) ||
    !validDigest(pointer.manifest.sha256)
  )
    fail("pointer_invalid");
  const url = generationAssetUrl(
    baseUrl,
    pointer.releaseTag,
    pointer.manifest.assetName
  );
  const result = await fetchImpl(url, { cache: "no-store", signal });
  if (!result.ok) fail(`manifest_http_${result.status}`);
  const raw = Buffer.from(await result.arrayBuffer());
  if (
    raw.length !== pointer.manifest.bytes ||
    sha(raw) !== pointer.manifest.sha256
  )
    fail("manifest_integrity");
  const manifest = validateBackupGenerationManifest(
    JSON.parse(raw.toString("utf8")),
    pointer
  );
  return { pointer, manifest };
}

async function localIntegrity(file) {
  const stat = await fs.lstat(file).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat?.isFile()) return null;
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest("hex") };
}

/** Null pointer alone permits legacy fallback; a missing asset in a committed generation never does. */
export async function downloadGrowthBackupGenerationAsset({
  baseUrl,
  logicalName,
  cacheDir,
  fetchImpl = fetch,
  signal,
  generation,
}) {
  if (!safeName(logicalName)) fail("logical_name_invalid");
  const resolved =
    generation === undefined
      ? await loadGrowthBackupGeneration(baseUrl, { fetchImpl, signal })
      : await generation;
  if (resolved === null) return { attempted: false, filePath: null };
  const { pointer, manifest } = resolved;
  validateBackupGenerationManifest(manifest, pointer);
  const file = manifest.files.find(
    entry => entry.logicalAssetName === logicalName
  );
  if (!file)
    return { attempted: true, filePath: null, generationId: pointer.batchId };
  const directory = path.join(
    path.resolve(cacheDir),
    "generations",
    pointer.batchId
  );
  await fs.mkdir(directory, { recursive: true });
  const destination = path.join(directory, logicalName);
  const existing = await localIntegrity(destination);
  if (existing?.bytes === file.bytes && existing.sha256 === file.sha256)
    return {
      attempted: true,
      filePath: destination,
      generationId: pointer.batchId,
    };
  const temporary = `${destination}.next-${randomUUID()}`;
  const handle = await fs.open(temporary, "wx");
  const aggregate = createHash("sha256");
  let total = 0;
  try {
    for (const part of file.parts) {
      signal?.throwIfAborted();
      const response = await fetchImpl(
        generationAssetUrl(baseUrl, pointer.releaseTag, part.assetName),
        { cache: "no-store", signal }
      );
      if (!response.ok || !response.body) fail(`part_http_${response.status}`);
      const digest = createHash("sha256");
      let count = 0;
      // Stream directly to the unique stage file, with backpressure and bounded memory.
      for await (const raw of Readable.fromWeb(response.body)) {
        const chunk = Buffer.from(raw);
        count += chunk.length;
        if (count > part.bytes) fail("part_size_overflow");
        digest.update(chunk);
        aggregate.update(chunk);
        let written = 0;
        while (written < chunk.length) {
          const result = await handle.write(
            chunk,
            written,
            chunk.length - written,
            null
          );
          if (!result.bytesWritten) fail("cache_write_short");
          written += result.bytesWritten;
        }
      }
      if (count !== part.bytes || digest.digest("hex") !== part.sha256)
        fail("part_integrity");
      total += count;
    }
    if (total !== file.bytes || aggregate.digest("hex") !== file.sha256)
      fail("assembly_integrity");
    await handle.sync();
    await handle.close();
    await fs.rename(temporary, destination);
    return {
      attempted: true,
      filePath: destination,
      generationId: pointer.batchId,
    };
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true });
    throw error;
  }
}
