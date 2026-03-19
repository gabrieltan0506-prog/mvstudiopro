import fs from "node:fs/promises";
import path from "node:path";
import { readTrendStore, reconcileTrendHistoryState } from "../server/growth/trendStore";

const DEFAULT_STORE_DIR = path.resolve(process.env.GROWTH_STORE_DIR || path.join(process.cwd(), ".cache", "growth"));
const DEFAULT_SNAPSHOT_DIR = path.resolve(process.cwd(), "data", "growth-snapshots", "latest");

async function copyFilePreservingParents(sourceFile: string, destinationRoot: string, relativeFile: string) {
  const destinationFile = path.join(destinationRoot, relativeFile);
  await fs.mkdir(path.dirname(destinationFile), { recursive: true });
  await fs.copyFile(sourceFile, destinationFile);
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
  await reconcileTrendHistoryState({ force: true });
  const store = await readTrendStore();

  await fs.rm(snapshotDir, { recursive: true, force: true });
  await fs.mkdir(snapshotDir, { recursive: true });

  const portableArchiveIndex = [];
  for (const entry of store.archiveIndex || []) {
    const relativeFile = path.relative(DEFAULT_STORE_DIR, entry.file);
    if (!relativeFile || relativeFile.startsWith("..")) continue;
    if (await pathExists(entry.file)) {
      await copyFilePreservingParents(entry.file, snapshotDir, relativeFile);
    }
    portableArchiveIndex.push({
      ...entry,
      file: relativeFile,
    });
  }

  const historyDir = path.join(DEFAULT_STORE_DIR, "history-ledger");
  if (await pathExists(historyDir)) {
    const historyFiles = await fs.readdir(historyDir);
    for (const fileName of historyFiles.filter((name) => name.endsWith(".json"))) {
      await copyFilePreservingParents(
        path.join(historyDir, fileName),
        snapshotDir,
        path.join("history-ledger", fileName),
      );
    }
  }

  const portableStore = {
    ...store,
    archiveIndex: portableArchiveIndex,
  };

  await fs.writeFile(
    path.join(snapshotDir, "current.json"),
    JSON.stringify(portableStore, null, 2),
    "utf8",
  );

  await fs.writeFile(
    path.join(snapshotDir, "manifest.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        snapshotDir,
        storeDir: DEFAULT_STORE_DIR,
        archiveFiles: portableArchiveIndex.length,
        historyPlatforms: Object.entries(portableStore.history?.platforms || {}).map(([platform, summary]) => ({
          platform,
          archivedItems: summary?.archivedItems || 0,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(JSON.stringify({
    success: true,
    snapshotDir,
    archiveFiles: portableArchiveIndex.length,
    historyPlatforms: Object.entries(portableStore.history?.platforms || {}).map(([platform, summary]) => ({
      platform,
      archivedItems: summary?.archivedItems || 0,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
