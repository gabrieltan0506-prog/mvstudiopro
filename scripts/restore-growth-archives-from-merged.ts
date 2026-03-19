import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { classifyTrendItem, countLabels } from "../server/growth/trendTaxonomy";
import { getGrowthTrendStats, readTrendStore, updateTrendBackfillProgress } from "../server/growth/trendStore";
import type { TrendArchiveEntry } from "../server/growth/trendStore";
import type { GrowthPlatform } from "../shared/growth";
import type { PlatformTrendCollection, TrendItem } from "../server/growth/trendCollector";

type CsvRow = {
  platform: string;
  source: string;
  collected_at: string;
  window_days: string;
  item_id: string;
  title: string;
  author: string;
  url: string;
  published_at: string;
  likes: string;
  comments: string;
  shares: string;
  views: string;
  hot_value: string;
  content_type: string;
  tags: string;
};

const DEFAULT_MERGED_DIR = "/tmp/recovery-merged-17-19";
const DEFAULT_STORE_DIR = path.resolve(process.env.GROWTH_STORE_DIR || path.join(process.cwd(), ".cache", "growth"));
const CURRENT_FILE = path.join(DEFAULT_STORE_DIR, "current.json");
const LEGACY_FILE = path.resolve(process.env.GROWTH_LEGACY_STORE_FILE || path.join(path.dirname(DEFAULT_STORE_DIR), "growth-trends.json"));
const ARCHIVE_DIR = path.join(DEFAULT_STORE_DIR, "archive");
const RECOVERY_TAG = "csv-recovery-17-19";

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

async function readCsvRows(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [] as CsvRow[];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])) as CsvRow;
    return row;
  });
}

function parseNumber(value: string) {
  const parsed = Number(String(value || "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseTags(value: string) {
  return String(value || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferPlatformAndBucket(fileName: string): { platform: GrowthPlatform; bucket: string } | null {
  const trimmed = fileName.replace(/-merged\.csv$/i, "");
  const firstDash = trimmed.indexOf("-");
  if (firstDash <= 0) return null;
  const platform = trimmed.slice(0, firstDash) as GrowthPlatform;
  const bucket = trimmed.slice(firstDash + 1);
  return { platform, bucket };
}

function dedupeItems(items: TrendItem[]) {
  const seen = new Map<string, TrendItem>();
  for (const item of items) {
    const key = String(item.id || "").trim()
      || String(item.url || "").trim()
      || `${item.title}::${item.author || ""}::${item.publishedAt || ""}`;
    if (!key) continue;
    const current = seen.get(key);
    if (!current) {
      seen.set(key, item);
      continue;
    }
    seen.set(key, {
      ...current,
      ...item,
      tags: Array.from(new Set([...(current.tags || []), ...(item.tags || [])])),
      likes: Math.max(current.likes || 0, item.likes || 0) || undefined,
      comments: Math.max(current.comments || 0, item.comments || 0) || undefined,
      shares: Math.max(current.shares || 0, item.shares || 0) || undefined,
      views: Math.max(current.views || 0, item.views || 0) || undefined,
      hotValue: Math.max(current.hotValue || 0, item.hotValue || 0) || undefined,
    });
  }
  return Array.from(seen.values());
}

function buildCollection(platform: GrowthPlatform, bucket: string, rows: CsvRow[]): PlatformTrendCollection {
  const rawItems = rows.map((row) => {
    const base: TrendItem = {
      id: String(row.item_id || "").trim(),
      title: String(row.title || "").trim(),
      bucket,
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
    };
    return {
      ...base,
      ...classifyTrendItem(base),
    };
  }).filter((item) => item.id && item.title);
  const items = dedupeItems(rawItems);
  const collectedAt = rows
    .map((row) => String(row.collected_at || "").trim())
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || new Date().toISOString();
  const windowDays = Math.max(
    1,
    ...rows.map((row) => Number(row.window_days || 0)).filter((value) => Number.isFinite(value) && value > 0),
  );
  const bucketCounts = items.reduce<Record<string, number>>((acc, item) => {
    const key = String(item.bucket || item.contentType || "default").trim() || "default";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const uniqueAuthorCount = new Set(items.map((item) => String(item.author || "").trim()).filter(Boolean)).size;
  return {
    platform,
    source: "seed",
    collectedAt,
    windowDays,
    items,
    notes: [
      `Recovered from merged CSV exports (${RECOVERY_TAG}).`,
      `Bucket ${bucket} rebuilt from deduped CSV recovery source.`,
    ],
    stats: {
      platform,
      itemCount: items.length,
      uniqueAuthorCount,
      bucketCounts,
      requestCount: 0,
      pageDepth: 0,
      targetPerRun: items.length,
      referenceMinItems: 0,
      referenceMaxItems: 0,
      collectorMode: "warehouse",
      industryCounts: countLabels(items, "industryLabels"),
      ageCounts: countLabels(items, "ageLabels"),
      contentCounts: countLabels(items, "contentLabels"),
    },
  };
}

async function writeStoreFile(store: unknown) {
  await fs.mkdir(DEFAULT_STORE_DIR, { recursive: true });
  await fs.writeFile(CURRENT_FILE, JSON.stringify(store, null, 2), "utf8");
  await fs.writeFile(LEGACY_FILE, JSON.stringify(store, null, 2), "utf8");
}

async function main() {
  const mergedDir = path.resolve(process.argv[2] || DEFAULT_MERGED_DIR);
  const entries = await fs.readdir(mergedDir);
  const csvFiles = entries.filter((name) => name.endsWith("-merged.csv"));
  if (!csvFiles.length) {
    throw new Error(`No merged CSV files found in ${mergedDir}`);
  }

  const store = await readTrendStore();
  const now = new Date().toISOString();
  const recoveryArchiveDir = path.join(ARCHIVE_DIR, RECOVERY_TAG);
  await fs.mkdir(recoveryArchiveDir, { recursive: true });

  const recoveryEntries: TrendArchiveEntry[] = [];
  for (const fileName of csvFiles) {
    const parsed = inferPlatformAndBucket(fileName);
    if (!parsed) continue;
    const rows = await readCsvRows(path.join(mergedDir, fileName));
    if (!rows.length) continue;
    const collection = buildCollection(parsed.platform, parsed.bucket, rows);
    const archiveFile = path.join(recoveryArchiveDir, `${fileName.replace(/\.csv$/i, ".json")}`);
    await fs.writeFile(archiveFile, JSON.stringify(collection, null, 2), "utf8");
    recoveryEntries.push({
      platform: parsed.platform,
      bucket: parsed.bucket,
      bucketCounts: collection.stats.bucketCounts,
      industryCounts: collection.stats.industryCounts,
      ageCounts: collection.stats.ageCounts,
      contentCounts: collection.stats.contentCounts,
      archivedAt: collection.collectedAt,
      source: collection.source,
      itemCount: collection.items.length,
      dedupedCount: collection.items.length,
      requestCount: 0,
      pageDepth: 0,
      targetPerRun: collection.items.length,
      referenceMinItems: 0,
      referenceMaxItems: 0,
      file: archiveFile,
    });
  }

  const nextStore = {
    ...store,
    updatedAt: now,
    archiveIndex: [
      ...(store.archiveIndex || []).filter((entry) => !String(entry.file || "").includes(`/${RECOVERY_TAG}/`)),
      ...recoveryEntries,
    ].sort((left, right) => new Date(right.archivedAt).getTime() - new Date(left.archivedAt).getTime()),
  };
  await writeStoreFile(nextStore);

  const stats = await getGrowthTrendStats();
  const platformProgress = (store.backfill?.platforms || []).map((item) => {
    const row = stats.platforms.find((entry) => entry.platform === item.platform);
    return {
      ...item,
      currentTotal: row?.currentTotal || 0,
      archivedTotal: row?.archivedItems || 0,
    };
  });

  await updateTrendBackfillProgress({
    active: store.backfill?.active ?? true,
    startedAt: store.backfill?.startedAt,
    finishedAt: store.backfill?.finishedAt,
    currentRound: store.backfill?.currentRound || 0,
    maxRounds: store.backfill?.maxRounds || 0,
    targetPerPlatform: store.backfill?.targetPerPlatform || 0,
    selectedWindowDays: stats.coverage.selectedWindowDays,
    status: store.backfill?.status || "running",
    platforms: platformProgress,
    note: `Historical archive restored from merged CSV exports (${RECOVERY_TAG}).`,
  });

  const updatedStats = await getGrowthTrendStats();
  const summary = {
    recoveredFiles: recoveryEntries.length,
    totals: updatedStats.totals,
    platforms: updatedStats.platforms.map((item) => ({
      platform: item.platform,
      currentTotal: item.currentTotal,
      archivedItems: item.archivedItems,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
