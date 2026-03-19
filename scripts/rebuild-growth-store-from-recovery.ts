import fs from "node:fs/promises";
import path from "node:path";
import { classifyTrendItem, countLabels } from "../server/growth/trendTaxonomy";
import {
  getGrowthTrendStats,
  mergeTrendCollections,
  readTrendStore,
  reconcileTrendHistoryState,
  updateTrendBackfillProgress,
} from "../server/growth/trendStore";
import type { GrowthPlatform } from "../shared/growth";
import type { PlatformTrendCollection, TrendItem } from "../server/growth/trendCollector";

type CsvRow = Record<string, string>;

const DEFAULT_RECOVERY_DIRS = [
  "/Users/tangenjie/Downloads/2026Mar19/recovery-merged-15-19",
  "/Users/tangenjie/Downloads/2026Mar19/recovery-merged-17-19",
  "/Users/tangenjie/Downloads/2026Mar19/recovery-merged-18-19",
];

const DEFAULT_REBUILT_STORE_FILES = [
  "/Users/tangenjie/Downloads/2026Mar19/rebuilt-platform-store/current.json",
  "/Users/tangenjie/Downloads/2026Mar19/rebuilt-platform-store/_remote-current-snapshot.json",
  "/Users/tangenjie/Downloads/2026Mar19/rebuilt-platform-store-15-19/current.json",
];

const PLATFORM_REFERENCE_DEFAULTS: Record<GrowthPlatform, { min: number; max: number }> = {
  douyin: { min: 12, max: 30 },
  kuaishou: { min: 12, max: 36 },
  bilibili: { min: 40, max: 80 },
  xiaohongshu: { min: 20, max: 60 },
  toutiao: { min: 20, max: 60 },
  weixin_channels: { min: 20, max: 60 },
};

function parseArgs(argv: string[]) {
  const recoveryDirs: string[] = [];
  const rebuiltFiles: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--recovery-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("Missing value for --recovery-dir");
      recoveryDirs.push(value);
      index += 1;
      continue;
    }
    if (arg === "--rebuilt-current") {
      const value = argv[index + 1];
      if (!value) throw new Error("Missing value for --rebuilt-current");
      rebuiltFiles.push(value);
      index += 1;
    }
  }
  return {
    recoveryDirs: recoveryDirs.length ? recoveryDirs : DEFAULT_RECOVERY_DIRS,
    rebuiltFiles: rebuiltFiles.length ? rebuiltFiles : DEFAULT_REBUILT_STORE_FILES,
  };
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

async function readCsvRows(filePath: string): Promise<CsvRow[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

function parseNumber(value: unknown) {
  const parsed = Number(String(value || "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseTags(value: unknown) {
  return String(value || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeItem(input: TrendItem): TrendItem {
  const item: TrendItem = {
    ...input,
    id: String(input.id || "").trim(),
    title: String(input.title || "").trim(),
    bucket: String(input.bucket || input.contentType || "").trim() || undefined,
    author: String(input.author || "").trim() || undefined,
    url: String(input.url || "").trim() || undefined,
    publishedAt: String(input.publishedAt || "").trim() || undefined,
    contentType: input.contentType,
    tags: Array.from(new Set((input.tags || []).map((tag) => String(tag || "").trim()).filter(Boolean))),
    industryLabels: Array.from(new Set((input.industryLabels || []).map((item) => String(item || "").trim()).filter(Boolean))),
    ageLabels: Array.from(new Set((input.ageLabels || []).map((item) => String(item || "").trim()).filter(Boolean))),
    contentLabels: Array.from(new Set((input.contentLabels || []).map((item) => String(item || "").trim()).filter(Boolean))),
    likes: parseNumber(input.likes),
    comments: parseNumber(input.comments),
    shares: parseNumber(input.shares),
    views: parseNumber(input.views),
    hotValue: parseNumber(input.hotValue),
  };
  return {
    ...item,
    ...classifyTrendItem(item),
  };
}

function getItemKey(item: TrendItem) {
  return String(item.id || "").trim()
    || String(item.url || "").trim()
    || `${String(item.title || "").trim()}::${String(item.author || "").trim()}::${String(item.publishedAt || "").trim()}`;
}

function dedupeTrendItems(items: TrendItem[]) {
  const merged = new Map<string, TrendItem>();
  for (const raw of items) {
    const item = normalizeItem(raw);
    const key = getItemKey(item);
    if (!key) continue;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, item);
      continue;
    }
    merged.set(key, {
      ...current,
      ...item,
      tags: Array.from(new Set([...(current.tags || []), ...(item.tags || [])])),
      industryLabels: Array.from(new Set([...(current.industryLabels || []), ...(item.industryLabels || [])])),
      ageLabels: Array.from(new Set([...(current.ageLabels || []), ...(item.ageLabels || [])])),
      contentLabels: Array.from(new Set([...(current.contentLabels || []), ...(item.contentLabels || [])])),
      likes: Math.max(current.likes || 0, item.likes || 0) || undefined,
      comments: Math.max(current.comments || 0, item.comments || 0) || undefined,
      shares: Math.max(current.shares || 0, item.shares || 0) || undefined,
      views: Math.max(current.views || 0, item.views || 0) || undefined,
      hotValue: Math.max(current.hotValue || 0, item.hotValue || 0) || undefined,
    });
  }
  return Array.from(merged.values());
}

function getBucketCounts(items: TrendItem[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const bucket = String(item.bucket || item.contentType || "default").trim() || "default";
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
}

function buildCollectionFromItems(
  platform: GrowthPlatform,
  items: TrendItem[],
  options: {
    collectedAt?: string;
    windowDays?: number;
    notes?: string[];
    requestCount?: number;
    pageDepth?: number;
    targetPerRun?: number;
    referenceMinItems?: number;
    referenceMaxItems?: number;
  } = {},
): PlatformTrendCollection {
  const normalizedItems = dedupeTrendItems(items);
  const uniqueAuthorCount = new Set(normalizedItems.map((item) => String(item.author || "").trim()).filter(Boolean)).size;
  const reference = PLATFORM_REFERENCE_DEFAULTS[platform];
  return {
    platform,
    source: "live",
    collectedAt: options.collectedAt || new Date().toISOString(),
    windowDays: Math.max(1, options.windowDays || 365),
    items: normalizedItems,
    notes: Array.from(new Set([
      ...(options.notes || []),
      "Recovered from merged backup CSVs and rebuilt platform stores.",
    ])),
    stats: {
      platform,
      itemCount: normalizedItems.length,
      uniqueAuthorCount,
      bucketCounts: getBucketCounts(normalizedItems),
      requestCount: options.requestCount || 0,
      pageDepth: options.pageDepth || 0,
      targetPerRun: options.targetPerRun || normalizedItems.length,
      referenceMinItems: options.referenceMinItems ?? reference.min,
      referenceMaxItems: options.referenceMaxItems ?? reference.max,
      collectorMode: "warehouse",
      industryCounts: countLabels(normalizedItems, "industryLabels"),
      ageCounts: countLabels(normalizedItems, "ageLabels"),
      contentCounts: countLabels(normalizedItems, "contentLabels"),
    },
  };
}

function mergeCollections(
  platform: GrowthPlatform,
  sources: PlatformTrendCollection[],
): PlatformTrendCollection | undefined {
  if (!sources.length) return undefined;
  const allItems = sources.flatMap((collection) => collection.items || []);
  const latestCollectedAt = sources
    .map((collection) => collection.collectedAt)
    .filter(Boolean)
    .sort()
    .slice(-1)[0];
  const windowDays = Math.max(...sources.map((collection) => collection.windowDays || 0), 365);
  const requestCount = sources.reduce((sum, collection) => sum + (collection.stats?.requestCount || 0), 0);
  const pageDepth = Math.max(...sources.map((collection) => collection.stats?.pageDepth || 0), 0);
  const targetPerRun = Math.max(...sources.map((collection) => collection.stats?.targetPerRun || 0), allItems.length);
  const referenceMinItems = Math.max(...sources.map((collection) => collection.stats?.referenceMinItems || 0), PLATFORM_REFERENCE_DEFAULTS[platform].min);
  const referenceMaxItems = Math.max(...sources.map((collection) => collection.stats?.referenceMaxItems || 0), PLATFORM_REFERENCE_DEFAULTS[platform].max);
  const notes = sources.flatMap((collection) => collection.notes || []);
  return buildCollectionFromItems(platform, allItems, {
    collectedAt: latestCollectedAt,
    windowDays,
    notes,
    requestCount,
    pageDepth,
    targetPerRun,
    referenceMinItems,
    referenceMaxItems,
  });
}

function inferPlatformAndBucket(fileName: string): { platform: GrowthPlatform; bucket: string } | null {
  const trimmed = fileName.replace(/-merged\.csv$/i, "");
  const firstDash = trimmed.indexOf("-");
  if (firstDash <= 0) return null;
  return {
    platform: trimmed.slice(0, firstDash) as GrowthPlatform,
    bucket: trimmed.slice(firstDash + 1),
  };
}

async function readRebuiltCurrentCollections(filePath: string) {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as {
    collections?: Partial<Record<GrowthPlatform, PlatformTrendCollection>>;
  };
  return raw.collections || {};
}

async function buildCollectionsFromRecoveryDirs(directories: string[]) {
  const bucketCollections = new Map<GrowthPlatform, PlatformTrendCollection[]>();
  for (const directory of directories) {
    const entries = await fs.readdir(directory);
    const csvFiles = entries.filter((name) => name.endsWith("-merged.csv"));
    for (const fileName of csvFiles) {
      const parsed = inferPlatformAndBucket(fileName);
      if (!parsed) continue;
      const rows = await readCsvRows(path.join(directory, fileName));
      if (!rows.length) continue;
      const rawItems = rows.map((row) => normalizeItem({
        id: String(row.item_id || "").trim(),
        title: String(row.title || "").trim(),
        bucket: parsed.bucket,
        author: String(row.author || "").trim() || undefined,
        url: String(row.url || "").trim() || undefined,
        publishedAt: String(row.published_at || "").trim() || undefined,
        likes: parseNumber(row.likes),
        comments: parseNumber(row.comments),
        shares: parseNumber(row.shares),
        views: parseNumber(row.views),
        hotValue: parseNumber(row.hot_value),
        contentType: (String(row.content_type || "").trim() as TrendItem["contentType"]) || undefined,
        tags: parseTags(row.tags),
      })).filter((item) => item.id && item.title);
      if (!rawItems.length) continue;
      const collectedAt = rows
        .map((row) => String(row.collected_at || "").trim())
        .filter(Boolean)
        .sort()
        .slice(-1)[0];
      const windowDays = Math.max(
        1,
        ...rows.map((row) => Number(row.window_days || 0)).filter((value) => Number.isFinite(value) && value > 0),
      );
      const collection = buildCollectionFromItems(parsed.platform, rawItems, {
        collectedAt,
        windowDays,
        notes: [
          `Recovered from ${path.basename(directory)}/${fileName}.`,
        ],
      });
      const list = bucketCollections.get(parsed.platform) || [];
      list.push(collection);
      bucketCollections.set(parsed.platform, list);
    }
  }
  return bucketCollections;
}

async function main() {
  const { recoveryDirs, rebuiltFiles } = parseArgs(process.argv.slice(2));
  const currentStore = await readTrendStore();
  const collectionsByPlatform = new Map<GrowthPlatform, PlatformTrendCollection[]>();

  for (const collection of Object.values(currentStore.collections || {})) {
    if (!collection) continue;
    const list = collectionsByPlatform.get(collection.platform) || [];
    list.push(collection);
    collectionsByPlatform.set(collection.platform, list);
  }

  for (const filePath of rebuiltFiles) {
    const collections = await readRebuiltCurrentCollections(filePath);
    for (const collection of Object.values(collections)) {
      if (!collection) continue;
      const list = collectionsByPlatform.get(collection.platform) || [];
      list.push(collection);
      collectionsByPlatform.set(collection.platform, list);
    }
  }

  const recoveredCollections = await buildCollectionsFromRecoveryDirs(recoveryDirs);
  for (const [platform, collections] of recoveredCollections.entries()) {
    const list = collectionsByPlatform.get(platform) || [];
    list.push(...collections);
    collectionsByPlatform.set(platform, list);
  }

  const mergedCollections = Object.fromEntries(
    Array.from(collectionsByPlatform.entries())
      .map(([platform, collections]) => [platform, mergeCollections(platform, collections)])
      .filter((entry): entry is [GrowthPlatform, PlatformTrendCollection] => Boolean(entry[1])),
  ) as Partial<Record<GrowthPlatform, PlatformTrendCollection>>;

  const mergedStore = await mergeTrendCollections(mergedCollections);
  await reconcileTrendHistoryState({ force: true });
  const stats = await getGrowthTrendStats();
  await updateTrendBackfillProgress({
    active: mergedStore.backfill?.active ?? true,
    startedAt: mergedStore.backfill?.startedAt,
    finishedAt: mergedStore.backfill?.finishedAt,
    currentRound: mergedStore.backfill?.currentRound || 0,
    maxRounds: mergedStore.backfill?.maxRounds || 0,
    targetPerPlatform: mergedStore.backfill?.targetPerPlatform || 0,
    selectedWindowDays: stats.coverage.selectedWindowDays,
    status: mergedStore.backfill?.status || "running",
    platforms: stats.platforms.map((platform) => ({
      platform: platform.platform,
      target: mergedStore.backfill?.platforms.find((item) => item.platform === platform.platform)?.target || 0,
      currentTotal: platform.currentTotal,
      archivedTotal: platform.archivedItems,
      addedCount: mergedStore.backfill?.platforms.find((item) => item.platform === platform.platform)?.addedCount || 0,
      mergedCount: mergedStore.backfill?.platforms.find((item) => item.platform === platform.platform)?.mergedCount || 0,
      plateauCount: mergedStore.backfill?.platforms.find((item) => item.platform === platform.platform)?.plateauCount || 0,
      status: mergedStore.backfill?.platforms.find((item) => item.platform === platform.platform)?.status || "running",
      error: mergedStore.backfill?.platforms.find((item) => item.platform === platform.platform)?.error,
    })),
    note: "Recovered from local merged CSV backups and rebuilt platform stores.",
  });

  const refreshedStats = await getGrowthTrendStats();
  console.log(JSON.stringify({
    recoveryDirs,
    rebuiltFiles,
    totals: refreshedStats.totals,
    platforms: refreshedStats.platforms.map((item) => ({
      platform: item.platform,
      currentTotal: item.currentTotal,
      archivedItems: item.archivedItems,
      buckets: item.bucketCounts,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
