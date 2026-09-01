import fs from "node:fs/promises";
import path from "node:path";
import { gunzip as gunzipCb } from "node:zlib";
import { promisify } from "node:util";
import { ensureOffloadedArchiveDir } from "./trendStore";

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

async function main() {
  const dirName = String(process.argv[2] || "").trim();
  const cleanupRoot = String(process.env.GROWTH_GITHUB_OFFLOAD_CACHE_DIR || "");
  try {
    const restoredDir = await ensureOffloadedArchiveDir(dirName);
    if (!restoredDir) throw new Error(`growth_archive_restore_unavailable:${dirName}`);

    const files = await listGzipFiles(restoredDir);
    if (!files.length) throw new Error(`growth_archive_restore_empty:${dirName}`);
    for (const file of files) {
      const value = JSON.parse((await gunzip(await fs.readFile(file))).toString("utf8")) as { items?: unknown[] };
      if (!Array.isArray(value.items)) throw new Error(`growth_archive_restore_invalid_json:${path.basename(file)}`);
    }

    process.stdout.write(`${JSON.stringify({ ok: true, dir: dirName, files: files.length })}\n`);
  } finally {
    if (
      process.env.GROWTH_COLD_VERIFY_CLEANUP === "1"
      && /^\/tmp\/growth-cold-verify-[0-9A-Za-z._-]+$/.test(cleanupRoot)
    ) {
      await fs.rm(cleanupRoot, { recursive: true, force: true });
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
