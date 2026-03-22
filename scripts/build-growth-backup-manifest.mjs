#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const [storeDirArg, outputPathArg] = process.argv.slice(2);

if (!storeDirArg || !outputPathArg) {
  console.error("Usage: node scripts/build-growth-backup-manifest.mjs <store-dir> <output-path>");
  process.exit(1);
}

const storeDir = path.resolve(storeDirArg);
const outputPath = path.resolve(outputPathArg);
const PLATFORM_ORDER = ["douyin", "xiaohongshu", "bilibili", "kuaishou", "toutiao"];

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function statIfExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

function number(value) {
  return Number(value || 0);
}

async function main() {
  const debugSummary = await readJsonIfExists(path.join(storeDir, "backups", "growth-debug-summary.json"), null);
  const historySummary = await readJsonIfExists(path.join(storeDir, "history-summary.json"), null);
  const runtimeMeta = await readJsonIfExists(path.join(storeDir, "runtime-meta.json"), {});
  const currentStore = await readJsonIfExists(path.join(storeDir, "current.json"), {});
  const archiveIndex = await readJsonIfExists(path.join(storeDir, "archive-index.json"), []);

  const platforms = Object.fromEntries(
    PLATFORM_ORDER.map((platform) => {
      const debugRow = debugSummary?.platforms?.[platform];
      const historyRow = historySummary?.platforms?.[platform] || currentStore?.history?.platforms?.[platform];
      const currentCollection = currentStore?.collections?.[platform];
      const currentTotal = number(debugRow?.currentTotal ?? currentCollection?.items?.length);
      const archivedTotal = number(debugRow?.archivedTotal ?? historyRow?.archivedItems);
      return [platform, { currentTotal, archivedTotal }];
    }),
  );

  const files = {
    current: await statIfExists(path.join(storeDir, "current.json")),
    runtimeMeta: await statIfExists(path.join(storeDir, "runtime-meta.json")),
    archiveIndex: await statIfExists(path.join(storeDir, "archive-index.json")),
    historySummary: await statIfExists(path.join(storeDir, "history-summary.json")),
    growthDebugSummary: await statIfExists(path.join(storeDir, "backups", "growth-debug-summary.json")),
    platforms: Object.fromEntries(
      await Promise.all(
        PLATFORM_ORDER.map(async (platform) => [
          platform,
          await statIfExists(path.join(storeDir, "platforms", `${platform}.json`)),
        ]),
      ),
    ),
  };

  const manifest = {
    createdAt: new Date().toISOString(),
    storeDir,
    truthSource: {
      current: debugSummary ? "growth-debug-summary.json" : "current.json",
      archived: historySummary ? "history-summary.json" : "current.json.history",
    },
    updatedAt: runtimeMeta?.updatedAt || currentStore?.updatedAt || debugSummary?.updatedAt || null,
    totals: {
      currentItems: Object.values(platforms).reduce((sum, item) => sum + number(item.currentTotal), 0),
      archivedItems: Object.values(platforms).reduce((sum, item) => sum + number(item.archivedTotal), 0),
      archiveRuns: Array.isArray(archiveIndex) ? archiveIndex.length : 0,
    },
    schedulerTrackedPlatforms: Object.keys(runtimeMeta?.scheduler || {}).length,
    platforms,
    files,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
