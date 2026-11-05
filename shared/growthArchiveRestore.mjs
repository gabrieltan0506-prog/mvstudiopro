import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const validator = fileURLToPath(new URL("../scripts/validate-growth-archive.py", import.meta.url));
const pending = new Map();
const safeDir = value => /^\d{4}-\d{2}-\d{2}(?:-\d{2})?$/.test(value);
const digest = value => createHash("sha256").update(value).digest("hex");
const validHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const safeRelative = value => typeof value === "string" && value.endsWith(".json.gz")
  && !/[\\\x00-\x1f]/.test(value) && value.split("/").every(p => p && p !== "." && p !== "..");

function normalizeInventory(value) {
  if (!Array.isArray(value) || !value.length) throw Error("growth_archive_inventory_empty");
  const seen = new Set();
  return value.map(row => {
    if (!safeRelative(row?.path) || seen.has(row.path) || !positive(row.bytes)
      || !validHash(row.sha256) || !Number.isSafeInteger(row.items) || row.items < 0)
      throw Error("growth_archive_inventory_invalid");
    seen.add(row.path);
    return { path: row.path, bytes: row.bytes, sha256: row.sha256, items: row.items };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export function parseGrowthArchiveManifest(value, dir) {
  const fail = () => { throw Error(`growth_archive_manifest_invalid:${dir}`); };
  const expected = `archive-${dir}.tar.gz`;
  if (!safeDir(dir) || value?.schemaVersion !== 1 || value.dir !== dir
    || value.archive?.assetName !== expected || !positive(value.archive.bytes)
    || !validHash(value.archive.sha256) || !Array.isArray(value.parts) || !value.parts.length) fail();
  const parts = [...value.parts].sort((a, b) => a.index - b.index);
  let bytes = 0;
  for (const [index, part] of parts.entries()) {
    const name = parts.length === 1 ? expected : `${expected}.part-${String(index).padStart(4, "0")}`;
    if (part.index !== index || part.assetName !== name || !positive(part.bytes) || !validHash(part.sha256)) fail();
    bytes += part.bytes;
  }
  if (!Number.isSafeInteger(bytes) || bytes !== value.archive.bytes
    || (parts.length === 1 && parts[0].sha256 !== value.archive.sha256)) fail();
  const inventory = value.inventory === undefined ? undefined : normalizeInventory(value.inventory);
  return { ...value, parts, ...(inventory ? { inventory } : {}) };
}

async function hashFile(file) {
  const st = await fs.lstat(file);
  if (!st.isFile()) throw Error(`growth_archive_not_regular:${file}`);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest("hex") };
}
async function matches(file, expected) {
  const actual = await hashFile(file).catch(() => null);
  return actual?.bytes === expected.bytes && actual.sha256 === expected.sha256;
}
async function verifyDirectory(root, inventory) {
  const wanted = new Map(inventory.map(row => [row.path, row]));
  const seen = new Set();
  async function visit(dir, relative = "") {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file, name);
      else {
        if (!entry.isFile() || !wanted.has(name) || !await matches(file, wanted.get(name)))
          throw Error(`growth_archive_cache_mismatch:${name}`);
        seen.add(name);
      }
    }
  }
  if (!(await fs.lstat(root)).isDirectory()) throw Error("growth_archive_cache_type");
  await visit(root);
  if (seen.size !== wanted.size) throw Error("growth_archive_cache_incomplete");
}
async function moveAside(file) {
  try { await fs.rename(file, `${file}.invalid-${randomUUID()}`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
async function download(file, name, expected, fetchAsset, legacy = false) {
  if (expected && await matches(file, expected)) return file;
  // Preserve corrupt cached bytes for diagnosis; never overwrite an existing backup.
  await moveAside(file);
  const response = await fetchAsset(name, legacy);
  if (!response || response.status === 404) return null;
  if (!response.ok || !response.body) throw Error(`growth_archive_download_failed:${name}:${response.status}`);
  const next = `${file}.next-${randomUUID()}`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(next, { flags: "wx" }));
    if (expected && !await matches(next, expected)) throw Error(`growth_archive_part_mismatch:${name}`);
    await fs.rename(next, file);
    return file;
  } finally { await fs.rm(next, { force: true }); }
}

async function restore({ dir, cacheRoot, fetchAsset }) {
  if (!safeDir(dir)) throw Error(`growth_archive_dir_invalid:${dir}`);
  // Pointer is committed only after its immutable revision is complete. A failed
  // pointer read is not absence and must never silently restore an older generation.
  const pointerResponse = await fetchAsset(`archive-${dir}.latest.json`, false);
  let pointer = null;
  if (pointerResponse && pointerResponse.status !== 404) {
    if (!pointerResponse.ok) throw Error(`growth_archive_pointer_fetch:${pointerResponse.status}`);
    pointer = await pointerResponse.json();
    if (pointer?.schemaVersion !== 1 || pointer.dir !== dir
      || !new RegExp(`^growth-archive-revision-${dir}-[a-f0-9]{64}$`).test(pointer.releaseTag)
      || pointer.manifest?.assetName !== `archive-${dir}.manifest.json`
      || !positive(pointer.manifest.bytes) || !validHash(pointer.manifest.sha256))
      throw Error(`growth_archive_pointer_invalid:${dir}`);
  }
  const fetchVersionAsset = (name, legacy) => fetchAsset(name, legacy, pointer?.releaseTag);
  const response = await fetchVersionAsset(`archive-${dir}.manifest.json`, false);
  let manifest = null, manifestHash = "legacy";
  if (response && response.status !== 404) {
    if (!response.ok) throw Error(`growth_archive_manifest_fetch:${response.status}`);
    const raw = Buffer.from(await response.arrayBuffer());
    if (pointer && (raw.length !== pointer.manifest.bytes || digest(raw) !== pointer.manifest.sha256))
      throw Error(`growth_archive_pointer_manifest_mismatch:${dir}`);
    manifest = parseGrowthArchiveManifest(JSON.parse(raw.toString("utf8")), dir);
    manifestHash = digest(raw);
  } else if (pointer) throw Error(`growth_archive_pointer_manifest_missing:${dir}`);
  const version = manifest?.archive.sha256 || "legacy";
  const root = path.join(cacheRoot, "archive-verified", dir, version);
  await fs.mkdir(root, { recursive: true });
  const target = path.join(root, "contents");
  const receiptFile = path.join(root, "restore-receipt.json");
  const lock = path.join(root, ".restore.lock");
  const token = randomUUID();
  // Never steal by age: another process may still be unpacking. Its caller can retry.
  try { await fs.mkdir(lock); }
  catch (error) { if (error.code === "EEXIST") throw Error(`growth_archive_restore_busy:${dir}`); throw error; }
  await fs.writeFile(path.join(lock, "owner"), token, { flag: "wx" });
  const assertOwner = async () => {
    if (await fs.readFile(path.join(lock, "owner"), "utf8") !== token) throw Error("growth_archive_restore_lease_lost");
  };
  let stage;
  try {
    const receipt = await fs.readFile(receiptFile, "utf8").then(JSON.parse).catch(() => null);
    if (receipt?.manifestHash === manifestHash && receipt?.archiveSha === manifest?.archive.sha256 && manifest) {
      const inventory = (() => { try { return normalizeInventory(receipt.inventory); } catch { return null; } })();
      if (inventory && (!manifest.inventory || JSON.stringify(inventory) === JSON.stringify(manifest.inventory))) {
        try { await verifyDirectory(target, inventory); await assertOwner(); return target; } catch { /* rebuild safely */ }
      }
    }
    const bundle = path.join(root, `archive-${dir}.tar.gz`);
    if (manifest) {
      if (!await matches(bundle, manifest.archive)) {
        await moveAside(bundle);
        const next = `${bundle}.next-${randomUUID()}`;
        try {
          await fs.writeFile(next, "", { flag: "wx" });
          for (const part of manifest.parts) {
            await assertOwner();
            const partFile = path.join(root, `part-${part.index}`);
            if (!await download(partFile, part.assetName, part, fetchVersionAsset)) throw Error(`growth_archive_part_missing:${part.assetName}`);
            await pipeline(createReadStream(partFile), createWriteStream(next, { flags: "a" }));
          }
          if (!await matches(next, manifest.archive)) throw Error(`growth_archive_reassembly_mismatch:${dir}`);
          await fs.rename(next, bundle);
        } finally { await fs.rm(next, { force: true }); }
      }
    } else if (!await download(bundle, `archive-${dir}.tar.gz`, null, fetchVersionAsset, true)) return null;
    // The exact publication validator checks types, names, duplicates, gzip CRC,
    // JSON/items and every file hash. No path-only tar listing is treated as validation.
    const { stdout } = await exec("python3", [validator, dir, bundle], { maxBuffer: 32 * 1024 * 1024 });
    const verified = JSON.parse(stdout);
    const inventory = normalizeInventory(verified.inventory);
    if (manifest?.inventory && JSON.stringify(inventory) !== JSON.stringify(manifest.inventory))
      throw Error(`growth_archive_inventory_mismatch:${dir}`);
    await assertOwner();
    stage = await fs.mkdtemp(path.join(root, ".stage-"));
    await exec("tar", ["-xzf", bundle, "-C", stage], { maxBuffer: 1024 * 1024 });
    const staged = path.join(stage, dir);
    await verifyDirectory(staged, inventory);
    await assertOwner();
    await moveAside(target);
    await fs.rename(staged, target);
    const receiptNext = `${receiptFile}.next-${token}`;
    await fs.writeFile(receiptNext, JSON.stringify({ schemaVersion: 1, dir, manifestHash, archiveSha: manifest?.archive.sha256 || (await hashFile(bundle)).sha256, inventory }));
    await fs.rename(receiptNext, receiptFile);
    return target;
  } finally {
    if (stage) await fs.rm(stage, { recursive: true, force: true });
    if (await fs.readFile(path.join(lock, "owner"), "utf8").catch(() => "") === token)
      await fs.rm(lock, { recursive: true, force: true });
  }
}

export function restoreGrowthArchive(options) {
  const key = `${path.resolve(options.cacheRoot)}:${options.dir}`;
  if (!pending.has(key)) {
    const work = restore(options).finally(() => pending.delete(key));
    pending.set(key, work);
  }
  return pending.get(key);
}
