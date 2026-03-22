#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const [baseStorePath, remoteStorePath, csvDir, outputPath, snapshotDirArg] = process.argv.slice(2);

if (!baseStorePath || !remoteStorePath || !csvDir || !outputPath) {
  console.error("Usage: node scripts/merge-growth-store-sources.mjs <base-store> <remote-store> <csv-dir> <output-store> [snapshot-dir]");
  process.exit(1);
}

const PLATFORM_ORDER = ["douyin", "xiaohongshu", "bilibili", "kuaishou", "toutiao"];

function text(value) {
  return String(value || "").trim();
}

function labels(value) {
  return Array.from(new Set((Array.isArray(value) ? value : String(value || "").split("|")).map((item) => text(item)).filter(Boolean)));
}

function normalizeItem(item) {
  return {
    ...item,
    id: text(item?.id || item?.item_id),
    title: text(item?.title),
    author: text(item?.author),
    url: text(item?.url),
    bucket: text(item?.bucket || item?.contentType),
    publishedAt: text(item?.publishedAt || item?.published_at),
    contentType: text(item?.contentType || item?.content_type),
    tags: labels(item?.tags),
    industryLabels: labels(item?.industryLabels),
    ageLabels: labels(item?.ageLabels),
    contentLabels: labels(item?.contentLabels),
    likes: Number(item?.likes || 0) || undefined,
    comments: Number(item?.comments || 0) || undefined,
    shares: Number(item?.shares || 0) || undefined,
    views: Number(item?.views || 0) || undefined,
    hotValue: Number(item?.hotValue || item?.hot_value || 0) || undefined,
  };
}

function isValidPublishedAt(value) {
  const publishedAt = text(value);
  if (!publishedAt) return true;
  if (publishedAt.length < 10) return false;
  if (/^\d+$/.test(publishedAt)) return false;
  const parsed = Date.parse(publishedAt);
  return Number.isFinite(parsed);
}

function itemKey(item) {
  const id = text(item?.id);
  if (id) return id;
  return `${text(item?.title)}::${text(item?.author)}::${text(item?.bucket || item?.contentType)}`;
}

function sortItems(items) {
  return [...items].sort((left, right) => {
    const rightWeight = right.hotValue || right.likes || right.views || 0;
    const leftWeight = left.hotValue || left.likes || left.views || 0;
    if (rightWeight !== leftWeight) return rightWeight - leftWeight;
    const rightDate = new Date(right.publishedAt || 0).getTime();
    const leftDate = new Date(left.publishedAt || 0).getTime();
    return rightDate - leftDate;
  });
}

function mergeItems(existing = [], incoming = []) {
  const map = new Map();
  for (const raw of [...existing, ...incoming]) {
    const item = normalizeItem(raw);
    if (!isValidPublishedAt(item.publishedAt)) continue;
    if (!item.id || !item.title) continue;
    const current = map.get(item.id);
    if (!current) {
      map.set(item.id, item);
      continue;
    }
    map.set(item.id, {
      ...current,
      ...item,
      tags: Array.from(new Set([...(current.tags || []), ...(item.tags || [])])),
      industryLabels: Array.from(new Set([...(current.industryLabels || []), ...(item.industryLabels || [])])),
      ageLabels: Array.from(new Set([...(current.ageLabels || []), ...(item.ageLabels || [])])),
      contentLabels: Array.from(new Set([...(current.contentLabels || []), ...(item.contentLabels || [])])),
      hotValue: Math.max(current.hotValue || 0, item.hotValue || 0) || undefined,
      likes: Math.max(current.likes || 0, item.likes || 0) || undefined,
      comments: Math.max(current.comments || 0, item.comments || 0) || undefined,
      shares: Math.max(current.shares || 0, item.shares || 0) || undefined,
      views: Math.max(current.views || 0, item.views || 0) || undefined,
      url: item.url || current.url,
      author: item.author || current.author,
      publishedAt: item.publishedAt || current.publishedAt,
      bucket: item.bucket || current.bucket,
      contentType: item.contentType || current.contentType,
    });
  }
  return sortItems(Array.from(map.values()));
}

function bucketCounts(items) {
  const counts = {};
  for (const item of items) {
    const bucket = text(item.bucket || item.contentType || "default") || "default";
    counts[bucket] = (counts[bucket] || 0) + 1;
  }
  return counts;
}

function labelCounts(items, field) {
  const counts = {};
  for (const item of items) {
    for (const label of labels(item[field])) counts[label] = (counts[label] || 0) + 1;
  }
  return counts;
}

function buildHistorySummary(platform, items) {
  return {
    platform,
    archivedItems: items.length,
    bucketCounts: bucketCounts(items),
    industryCounts: labelCounts(items, "industryLabels"),
    ageCounts: labelCounts(items, "ageLabels"),
    contentCounts: labelCounts(items, "contentLabels"),
    firstSeenAt: sortItems(items).at(-1)?.publishedAt || undefined,
    lastSeenAt: sortItems(items).at(0)?.publishedAt || undefined,
  };
}

async function readStore(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function walk(dir, files = []) {
  try {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(absolute, files);
    else if (entry.isFile() && absolute.endsWith(".csv")) files.push(absolute);
  }
  } catch {
    return files;
  }
  return files;
}

function deriveBucket(file, platform) {
  const base = path.basename(file, ".csv");
  const prefix = `${platform}-`;
  const suffix = "-growth-trends";
  if (!base.startsWith(prefix)) return "";
  const body = base.slice(prefix.length);
  const idx = body.indexOf(suffix);
  return idx >= 0 ? body.slice(0, idx) : body;
}

async function readCsvCollections(root) {
  const files = await walk(root);
  const collections = new Map(PLATFORM_ORDER.map((platform) => [platform, []]));
  const perPlatformFiles = Object.fromEntries(PLATFORM_ORDER.map((platform) => [platform, 0]));
  for (const file of files) {
    const base = path.basename(file);
    const platform = PLATFORM_ORDER.find((item) => base.startsWith(`${item}-`));
    if (!platform) continue;
    perPlatformFiles[platform] += 1;
    const bucket = deriveBucket(file, platform);
    const csv = await fs.readFile(file, "utf8");
    for (const row of parseCsv(csv)) {
      collections.get(platform).push(normalizeItem({
        ...row,
        bucket,
        contentType: text(row.content_type || bucket),
      }));
    }
  }
  return { collections, perPlatformFiles };
}

function parseCsv(source) {
  const rows = [];
  const lines = source.split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length) return rows;
  const headers = parseCsvLine(lines[0]);
  for (let index = 1; index < lines.length; index += 1) {
    const values = parseCsvLine(lines[index]);
    const row = {};
    for (let i = 0; i < headers.length; i += 1) row[headers[i]] = values[i] ?? "";
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
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

const baseStore = await readStore(baseStorePath);
const remoteStore = await readStore(remoteStorePath);
const csvSource = await readCsvCollections(csvDir);
const updatedAt = new Date().toISOString();
const finalCollections = {};
const finalHistoryPlatforms = {};
const finalBackfillPlatforms = [];
const summary = {
  base: {},
  remote: {},
  csvFiles: csvSource.perPlatformFiles,
  csvRows: {},
  final: {},
};

for (const platform of PLATFORM_ORDER) {
  const baseItems = baseStore.collections?.[platform]?.items || [];
  const remoteItems = remoteStore.collections?.[platform]?.items || [];
  const csvItems = csvSource.collections.get(platform) || [];
  const merged = mergeItems(mergeItems(baseItems, remoteItems), csvItems);
  summary.base[platform] = baseItems.length;
  summary.remote[platform] = remoteItems.length;
  summary.csvRows[platform] = csvItems.length;
  summary.final[platform] = merged.length;

  if (!merged.length) continue;
  finalCollections[platform] = {
    platform,
    source: "recovered+archive+csv",
    collectedAt: updatedAt,
    windowDays: Math.max(baseStore.collections?.[platform]?.windowDays || 0, remoteStore.collections?.[platform]?.windowDays || 0, 365),
    notes: [],
    items: merged,
    stats: {
      itemCount: merged.length,
      currentTotal: merged.length,
      archivedTotal: merged.length,
      bucketCounts: bucketCounts(merged),
      industryCounts: labelCounts(merged, "industryLabels"),
      ageCounts: labelCounts(merged, "ageLabels"),
      contentCounts: labelCounts(merged, "contentLabels"),
      uniqueAuthorCount: new Set(merged.map((item) => text(item.author)).filter(Boolean)).size,
      requestCount: merged.length,
      pageDepth: 0,
      targetPerRun: merged.length,
      referenceMinItems: 0,
      referenceMaxItems: merged.length,
    },
  };
  finalHistoryPlatforms[platform] = buildHistorySummary(platform, merged);
  finalBackfillPlatforms.push({
    platform,
    target: merged.length,
    currentTotal: merged.length,
    archivedTotal: merged.length,
    addedCount: 0,
    mergedCount: 0,
    plateauCount: 0,
    status: "done",
  });
}

const archiveIndexMap = new Map();
for (const entry of [...(remoteStore.archiveIndex || []), ...(baseStore.archiveIndex || [])]) {
  if (!entry?.file) continue;
  archiveIndexMap.set(entry.file, entry);
}

const nextStore = {
  updatedAt,
  collections: finalCollections,
  scheduler: baseStore.scheduler || remoteStore.scheduler || {},
  archiveIndex: Array.from(archiveIndexMap.values()).sort((left, right) => new Date(right.archivedAt).getTime() - new Date(left.archivedAt).getTime()),
  history: {
    updatedAt,
    source: "ledger",
    platforms: finalHistoryPlatforms,
  },
  backfill: {
    active: false,
    updatedAt,
    finishedAt: updatedAt,
    currentRound: 0,
    maxRounds: 0,
    targetPerPlatform: 0,
    selectedWindowDays: 365,
    status: "completed",
    platforms: finalBackfillPlatforms,
    note: "Merged from recovered store, fly archive rebuild, and mail zip CSVs",
  },
  mailDigest: baseStore.mailDigest || remoteStore.mailDigest || {},
};

await fs.writeFile(outputPath, JSON.stringify(nextStore, null, 2), "utf8");

if (snapshotDirArg) {
  const snapshotDir = path.resolve(snapshotDirArg);
  await fs.mkdir(path.join(snapshotDir, "platforms"), { recursive: true });
  await fs.mkdir(path.join(snapshotDir, "backups"), { recursive: true });
  await fs.writeFile(path.join(snapshotDir, "current.json"), JSON.stringify(nextStore, null, 2), "utf8");
  await fs.writeFile(path.join(snapshotDir, "runtime-meta.json"), JSON.stringify({
    updatedAt,
    scheduler: nextStore.scheduler || {},
    backfill: nextStore.backfill || {},
    mailDigest: nextStore.mailDigest || {},
  }, null, 2), "utf8");
  await fs.writeFile(path.join(snapshotDir, "archive-index.json"), JSON.stringify(nextStore.archiveIndex || [], null, 2), "utf8");
  await fs.writeFile(path.join(snapshotDir, "history-summary.json"), JSON.stringify(nextStore.history || {}, null, 2), "utf8");
  await fs.writeFile(path.join(snapshotDir, "backups", "growth-debug-summary.json"), JSON.stringify({
    updatedAt,
    totals: {
      currentItems: Object.values(finalCollections).reduce((sum, collection) => sum + (collection.items?.length || 0), 0),
      archivedItems: Object.values(finalHistoryPlatforms).reduce((sum, summary) => sum + (summary.archivedItems || 0), 0),
    },
    platforms: Object.fromEntries(
      PLATFORM_ORDER.map((platform) => [
        platform,
        {
          platform,
          currentTotal: finalCollections[platform]?.items?.length || 0,
          archivedTotal: finalHistoryPlatforms[platform]?.archivedItems || 0,
        },
      ]),
    ),
  }, null, 2), "utf8");

  for (const platform of PLATFORM_ORDER) {
    const collection = finalCollections[platform];
    if (!collection) continue;
    await fs.writeFile(
      path.join(snapshotDir, "platforms", `${platform}.json`),
      JSON.stringify({ updatedAt, platform, collection }, null, 2),
      "utf8",
    );
  }
}

console.log(JSON.stringify(summary, null, 2));
