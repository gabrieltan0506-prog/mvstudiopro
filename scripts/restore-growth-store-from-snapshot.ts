import fs from "node:fs/promises";
import path from "node:path";
import { getGrowthTrendStats, reconcileTrendHistoryState } from "../server/growth/trendStore";

const DEFAULT_STORE_DIR = path.resolve(process.env.GROWTH_STORE_DIR || path.join(process.cwd(), ".cache", "growth"));
const LEGACY_FILE = path.resolve(process.env.GROWTH_LEGACY_STORE_FILE || path.join(path.dirname(DEFAULT_STORE_DIR), "growth-trends.json"));
const DEFAULT_SNAPSHOT_DIR = path.resolve(process.cwd(), "data", "growth-snapshots", "latest");

async function copyDir(sourceDir: string, destinationDir: string) {
  await fs.mkdir(destinationDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, destinationPath);
      continue;
    }
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
  }
}

async function pathExists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const snapshotDir = path.resolve(process.argv[2] || DEFAULT_SNAPSHOT_DIR);
  const currentFile = path.join(snapshotDir, "current.json");
  const raw = await fs.readFile(currentFile, "utf8");
  const portableStore = JSON.parse(raw) as {
    archiveIndex?: Array<Record<string, unknown> & { file?: string }>;
  } & Record<string, unknown>;

  await fs.mkdir(DEFAULT_STORE_DIR, { recursive: true });

  for (const relativeDir of ["archive", "history-ledger"]) {
    const sourceDir = path.join(snapshotDir, relativeDir);
    if (await pathExists(sourceDir)) {
      await copyDir(sourceDir, path.join(DEFAULT_STORE_DIR, relativeDir));
    }
  }

  const restoredStore = {
    ...portableStore,
    archiveIndex: (portableStore.archiveIndex || []).map((entry) => ({
      ...entry,
      file: entry.file ? path.join(DEFAULT_STORE_DIR, String(entry.file)) : "",
    })),
  };

  await fs.writeFile(
    path.join(DEFAULT_STORE_DIR, "current.json"),
    JSON.stringify(restoredStore, null, 2),
    "utf8",
  );
  await fs.writeFile(LEGACY_FILE, JSON.stringify(restoredStore, null, 2), "utf8");

  await reconcileTrendHistoryState({ force: true });
  const stats = await getGrowthTrendStats();
  console.log(JSON.stringify({
    success: true,
    snapshotDir,
    totals: stats.totals,
    platforms: stats.platforms.map((item) => ({
      platform: item.platform,
      currentTotal: item.currentTotal,
      archivedItems: item.archivedItems,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
