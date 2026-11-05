import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { gunzip as gunzipCb } from "node:zlib";
import { promisify } from "node:util";

const gunzip = promisify(gunzipCb);

async function listGzipFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return listGzipFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".json.gz") ? [fullPath] : [];
  }));
  return nested.flat();
}

/** Each CLI owns one child; failure evidence and other invocations are never cleaned. */
export async function withGrowthArchiveVerificationCache<T>(
  cacheRoot: string,
  cleanup: boolean,
  work: (ownedCache: string) => Promise<T>,
): Promise<T> {
  if (!cleanup) return work(cacheRoot);
  if (!/^\/tmp\/growth-cold-verify-[0-9A-Za-z._-]+$/.test(cacheRoot))
    throw new Error("growth_archive_verify_cleanup_root_invalid");
  await fs.mkdir(cacheRoot, { recursive: true });
  if (!(await fs.lstat(cacheRoot)).isDirectory())
    throw new Error("growth_archive_verify_cleanup_root_type");
  const ownedCache = await fs.mkdtemp(path.join(cacheRoot, "run-"));
  const token = randomUUID();
  const ownerPath = path.join(ownedCache, ".verification-owner");
  await fs.writeFile(ownerPath, token, { flag: "wx" });
  const isOwner = async () => await fs.readFile(ownerPath, "utf8").catch(() => "") === token;
  try {
    const result = await work(ownedCache);
    if (!await isOwner()) throw new Error("growth_archive_verify_cleanup_ownership_lost");
    await fs.rm(ownedCache, { recursive: true, force: true });
    return result;
  } catch (error) {
    // An interrupted/unavailable restore is evidence, not permission to wipe a
    // shared cache or another verifier's lock. Retain this run for diagnosis.
    if (await isOwner()) {
      await fs.writeFile(path.join(ownedCache, "verification-failure.json"), JSON.stringify({
        schemaVersion: 1,
        failedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      }, null, 2)).catch(() => {});
    }
    console.error(`growth_archive_verify_evidence_retained:${ownedCache}`);
    throw error;
  }
}

async function main() {
  const dirName = String(process.argv[2] || "").trim();
  const cacheRoot = String(process.env.GROWTH_GITHUB_OFFLOAD_CACHE_DIR || "");
  const result = await withGrowthArchiveVerificationCache(
    cacheRoot,
    process.env.GROWTH_COLD_VERIFY_CLEANUP === "1",
    async ownedCache => {
      if (ownedCache) process.env.GROWTH_GITHUB_OFFLOAD_CACHE_DIR = ownedCache;
      // trendStore reads this environment at module initialization. Import only
      // after selecting the invocation's private directory.
      const { ensureOffloadedArchiveDir } = await import("./trendStore");
      const restoredDir = await ensureOffloadedArchiveDir(dirName);
      if (!restoredDir) throw new Error(`growth_archive_restore_unavailable:${dirName}`);
      const files = await listGzipFiles(restoredDir);
      if (!files.length) throw new Error(`growth_archive_restore_empty:${dirName}`);
      for (const file of files) {
        const value = JSON.parse((await gunzip(await fs.readFile(file))).toString("utf8")) as { items?: unknown[] };
        if (!Array.isArray(value.items)) throw new Error(`growth_archive_restore_invalid_json:${path.basename(file)}`);
      }
      return { ok: true, dir: dirName, files: files.length };
    },
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
