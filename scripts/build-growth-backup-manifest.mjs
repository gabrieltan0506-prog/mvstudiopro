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
/** 本次用户授权的四平台备份范围；快手、头条来源和历史备份保留。 */
const PLATFORM_ORDER = ["douyin", "weixin_channels", "xiaohongshu", "bilibili"];

async function readJsonIfExists(filePath, fallback) {
  for (const candidate of [filePath, `${filePath}.gz`]) {
    let raw;
    try { raw = await fs.readFile(candidate); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (candidate.endsWith(".gz")) {
      const { gunzipSync } = await import("node:zlib"); raw = gunzipSync(raw);
    }
    return JSON.parse(raw.toString("utf8"));
  }
  if (["current.json", "runtime-meta.json", "archive-index.json", "history-summary.json"].includes(path.basename(filePath)))
    throw new Error(`growth_backup_required_missing:${path.basename(filePath)}`);
  return fallback;
}

async function statIfExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error(`growth_backup_invalid_file:${filePath}`);
    return stat.size;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

function number(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("growth_backup_count_invalid");
  return n;
}
function total(rows, key) {
  return rows.every(row => row[key] !== null) ? rows.reduce((n, row) => n + row[key], 0) : null;
}

async function main() {
  const debugSummary = await readJsonIfExists(path.join(storeDir, "backups", "growth-debug-summary.json"), null);
  const historySummary = await readJsonIfExists(path.join(storeDir, "history-summary.json"), null);
  const runtimeMeta = await readJsonIfExists(path.join(storeDir, "runtime-meta.json"), {});
  const currentStore = await readJsonIfExists(path.join(storeDir, "current.json"), {});
  const platformCurrentManifest = await readJsonIfExists(path.join(storeDir, "platform-current-manifest.json"), null);
  await readJsonIfExists(path.join(storeDir, "weixin-channels-miner.json"), null);
  const archiveIndexValue = await readJsonIfExists(path.join(storeDir, "archive-index.json"), []);
  // 读取正式包装对象与历史数组，计数取索引数组，不改写备份源文件。
  const archiveIndex = Array.isArray(archiveIndexValue) ? archiveIndexValue : archiveIndexValue?.archiveIndex;

  if (!Array.isArray(archiveIndex)) throw new Error("growth_backup_archive_index_invalid");

  const platforms = Object.fromEntries(
    PLATFORM_ORDER.map((platform) => {
      const debugRow = debugSummary?.platforms?.[platform];
      const historyRow = historySummary?.platforms?.[platform] || currentStore?.history?.platforms?.[platform];
      const manifestRow = platformCurrentManifest?.platforms?.[platform];
      const currentCollection = currentStore?.collections?.[platform];
      const currentTotal = number(debugRow?.currentTotal ?? manifestRow?.currentTotal ?? currentCollection?.items?.length);
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
    weixinChannelsMiner: await statIfExists(path.join(storeDir, "weixin-channels-miner.json")),
    platforms: Object.fromEntries(
      await Promise.all(
        PLATFORM_ORDER.map(async (platform) => [
          platform,
          (await statIfExists(path.join(storeDir, "platforms", `${platform}.json.gz`)))
            ?? await statIfExists(path.join(storeDir, "platforms", `${platform}.json`)),
        ]),
      ),
    ),
    platformCurrent: Object.fromEntries(
      await Promise.all(
        PLATFORM_ORDER.map(async (platform) => [
          platform,
          (await statIfExists(path.join(storeDir, "platform-current", `${platform}.current.json.gz`)))
            ?? await statIfExists(path.join(storeDir, "platform-current", `${platform}.current.json`)),
        ]),
      ),
    ),
  };

  const manifest = {
    schemaVersion: 2,
    scope: "scheduled-core-backup",
    fullStoreComplete: false,
    excludedPlatforms: ["kuaishou", "toutiao"],
    dataPlatforms: ["douyin", "xiaohongshu", "bilibili", "weixin_channels", "tiktok"],
    tiktokSource: "paid-research/guaikei/index.json and associated receipts; see snapshot manifest",
    missingCountsAreUnknown: true,
    createdAt: new Date().toISOString(),
    storeDir,
    truthSource: {
      current: platformCurrentManifest ? "platform-current-manifest.json" : (debugSummary ? "growth-debug-summary.json" : "current.json"),
      archived: historySummary ? "history-summary.json" : "current.json.history",
    },
    updatedAt: runtimeMeta?.updatedAt || currentStore?.updatedAt || debugSummary?.updatedAt || null,
    totals: {
      currentItems: total(Object.values(platforms), "currentTotal"),
      archivedItems: total(Object.values(platforms), "archivedTotal"),
      archiveRuns: archiveIndex.length,
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
