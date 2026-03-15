import fs from "node:fs/promises";
import path from "node:path";
import type { GrowthPlatform } from "@shared/growth";
import type { PlatformTrendCollection, TrendItem } from "./trendCollector";

export type TrendSchedulerState = {
  platform: GrowthPlatform;
  lastRunAt?: string;
  lastSuccessAt?: string;
  nextRunAt?: string;
  failureCount: number;
  lastError?: string;
};

export type TrendArchiveEntry = {
  platform: GrowthPlatform;
  bucket: string;
  archivedAt: string;
  source: PlatformTrendCollection["source"];
  itemCount: number;
  dedupedCount: number;
  file: string;
};

export type TrendMergeStats = {
  platform: GrowthPlatform;
  source: PlatformTrendCollection["source"];
  incomingCount: number;
  addedCount: number;
  mergedCount: number;
  dedupedCount: number;
  currentTotal: number;
  live: boolean;
  buckets: Record<string, number>;
  collectedAt: string;
};

type TrendStoreFile = {
  updatedAt: string;
  collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>;
  scheduler: Partial<Record<GrowthPlatform, TrendSchedulerState>>;
  archiveIndex: TrendArchiveEntry[];
};

const LEGACY_STORE_FILE = path.resolve(process.cwd(), ".cache", "growth-trends.json");
const STORE_DIR = path.resolve(process.cwd(), ".cache", "growth");
const STORE_FILE = path.join(STORE_DIR, "current.json");
const ARCHIVE_DIR = path.join(STORE_DIR, "archive");
const EXPORT_DIR = path.join(STORE_DIR, "exports");
const PLATFORM_DIR = path.join(STORE_DIR, "platforms");
const RETENTION_DAYS = 60;

async function ensureStoreDir() {
  await fs.mkdir(STORE_DIR, { recursive: true });
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  await fs.mkdir(EXPORT_DIR, { recursive: true });
  await fs.mkdir(PLATFORM_DIR, { recursive: true });
}

function createEmptyStore(): TrendStoreFile {
  return {
    updatedAt: new Date(0).toISOString(),
    collections: {},
    scheduler: {},
    archiveIndex: [],
  };
}

function normalizeItem(item: TrendItem): TrendItem {
  return {
    ...item,
    id: String(item.id || "").trim(),
    title: String(item.title || "").trim(),
    bucket: item.bucket ? String(item.bucket).trim() : undefined,
    author: item.author ? String(item.author).trim() : undefined,
    url: item.url ? String(item.url).trim() : undefined,
    tags: Array.from(new Set((item.tags || []).map((tag) => String(tag || "").trim()).filter(Boolean))),
  };
}

function sortItems(items: TrendItem[]) {
  return [...items].sort((left, right) => {
    const rightWeight = (right.hotValue || right.likes || right.views || 0);
    const leftWeight = (left.hotValue || left.likes || left.views || 0);
    if (rightWeight !== leftWeight) return rightWeight - leftWeight;
    const rightDate = new Date(right.publishedAt || 0).getTime();
    const leftDate = new Date(left.publishedAt || 0).getTime();
    return rightDate - leftDate;
  });
}

function dedupeTrendItems(existing: TrendItem[] = [], incoming: TrendItem[] = []) {
  const bucket = new Map<string, TrendItem>();
  for (const raw of [...existing, ...incoming]) {
    const item = normalizeItem(raw);
    if (!item.id || !item.title) continue;
    const current = bucket.get(item.id);
    if (!current) {
      bucket.set(item.id, item);
      continue;
    }
    bucket.set(item.id, {
      ...current,
      ...item,
      tags: Array.from(new Set([...(current.tags || []), ...(item.tags || [])])),
      hotValue: Math.max(current.hotValue || 0, item.hotValue || 0) || undefined,
      likes: Math.max(current.likes || 0, item.likes || 0) || undefined,
      comments: Math.max(current.comments || 0, item.comments || 0) || undefined,
      shares: Math.max(current.shares || 0, item.shares || 0) || undefined,
      views: Math.max(current.views || 0, item.views || 0) || undefined,
      publishedAt: item.publishedAt || current.publishedAt,
      url: item.url || current.url,
      author: item.author || current.author,
    });
  }
  return sortItems(Array.from(bucket.values()));
}

function getItemKey(item: TrendItem) {
  const id = String(item.id || "").trim();
  if (id) return id;
  return `${String(item.title || "").trim()}::${String(item.author || "").trim()}::${String(item.bucket || "").trim()}`;
}

function getBucketCounts(items: TrendItem[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const bucket = String(item.bucket || item.contentType || "default").trim() || "default";
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
}

async function readRawStoreFile(filePath: string): Promise<TrendStoreFile | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TrendStoreFile>;
    return {
      updatedAt: parsed.updatedAt || new Date(0).toISOString(),
      collections: parsed.collections || {},
      scheduler: parsed.scheduler || {},
      archiveIndex: parsed.archiveIndex || [],
    };
  } catch {
    return null;
  }
}

export async function readTrendStore(): Promise<TrendStoreFile> {
  await ensureStoreDir();
  const current = await readRawStoreFile(STORE_FILE);
  if (current) return current;

  const legacy = await readRawStoreFile(LEGACY_STORE_FILE);
  if (legacy) {
    await fs.writeFile(STORE_FILE, JSON.stringify(legacy, null, 2), "utf8");
    return legacy;
  }
  return createEmptyStore();
}

async function writeStore(next: TrendStoreFile) {
  await ensureStoreDir();
  await fs.writeFile(STORE_FILE, JSON.stringify(next, null, 2), "utf8");
  await fs.writeFile(LEGACY_STORE_FILE, JSON.stringify(next, null, 2), "utf8");
  await Promise.all(
    Object.entries(next.collections).map(async ([platform, collection]) => {
      if (!collection) return;
      const platformFile = path.join(PLATFORM_DIR, `${platform}.json`);
      await fs.writeFile(
        platformFile,
        JSON.stringify(
          {
            updatedAt: next.updatedAt,
            platform,
            collection,
          },
          null,
          2,
        ),
        "utf8",
      );
      const bucketDir = path.join(PLATFORM_DIR, platform);
      await fs.mkdir(bucketDir, { recursive: true });
      const buckets = Object.entries(
        collection.items.reduce<Record<string, TrendItem[]>>((acc, item) => {
          const bucket = String(item.bucket || item.contentType || "default").trim() || "default";
          (acc[bucket] ||= []).push(item);
          return acc;
        }, {}),
      );
      await Promise.all(
        buckets.map(async ([bucket, items]) => {
          await fs.writeFile(
            path.join(bucketDir, `${bucket}.json`),
            JSON.stringify(
              {
                updatedAt: next.updatedAt,
                platform,
                bucket,
                source: collection.source,
                collectedAt: collection.collectedAt,
                items,
              },
              null,
              2,
            ),
            "utf8",
          );
        }),
      );
    }),
  );
  return next;
}

async function pruneOldArchives(entries: TrendArchiveEntry[]) {
  const threshold = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const kept: TrendArchiveEntry[] = [];
  await Promise.all(
    entries.map(async (entry) => {
      const archivedAt = new Date(entry.archivedAt).getTime();
      if (Number.isFinite(archivedAt) && archivedAt >= threshold) {
        kept.push(entry);
        return;
      }
      try {
        await fs.unlink(entry.file);
      } catch {}
    }),
  );
  return kept;
}

function mergeCollection(
  current: PlatformTrendCollection | undefined,
  incoming: PlatformTrendCollection,
): { collection: PlatformTrendCollection; dedupedCount: number; addedCount: number; mergedCount: number } {
  const existingKeys = new Set((current?.items || []).map((item) => getItemKey(item)));
  const seenIncoming = new Set<string>();
  let addedCount = 0;
  let mergedCount = 0;
  for (const raw of incoming.items || []) {
    const key = getItemKey(normalizeItem(raw));
    if (!key || seenIncoming.has(key)) continue;
    seenIncoming.add(key);
    if (existingKeys.has(key)) mergedCount += 1;
    else addedCount += 1;
  }
  const mergedItems = dedupeTrendItems(current?.items || [], incoming.items || []);
  return {
    collection: {
      ...incoming,
      notes: Array.from(new Set([...(current?.notes || []), ...(incoming.notes || [])])),
      items: mergedItems,
      collectedAt: incoming.collectedAt,
      windowDays: Math.max(current?.windowDays || 0, incoming.windowDays || 0),
    },
    dedupedCount: mergedItems.length,
    addedCount,
    mergedCount,
  };
}

async function archiveCollection(
  platform: GrowthPlatform,
  collection: PlatformTrendCollection,
  dedupedCount: number,
): Promise<TrendArchiveEntry> {
  await ensureStoreDir();
  const datePrefix = collection.collectedAt.slice(0, 10);
  const bucket = Object.keys(getBucketCounts(collection.items)).sort().join("+") || "default";
  const fileName = `${platform}-${bucket}-${collection.collectedAt.replace(/[:.]/g, "-")}.json`;
  const absoluteFile = path.join(ARCHIVE_DIR, datePrefix, fileName);
  await fs.mkdir(path.dirname(absoluteFile), { recursive: true });
  await fs.writeFile(absoluteFile, JSON.stringify(collection, null, 2), "utf8");
  return {
    platform,
    bucket,
    archivedAt: collection.collectedAt,
    source: collection.source,
    itemCount: collection.items.length,
    dedupedCount,
    file: absoluteFile,
  };
}

export async function writeTrendStore(collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>) {
  const next = createEmptyStore();
  next.updatedAt = new Date().toISOString();
  next.collections = collections;
  return writeStore(next);
}

export async function mergeTrendCollections(collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>) {
  const current = await readTrendStore();
  const next: TrendStoreFile = {
    updatedAt: new Date().toISOString(),
    collections: { ...current.collections },
    scheduler: current.scheduler || {},
    archiveIndex: [...(current.archiveIndex || [])],
  };
  const mergeStats: Partial<Record<GrowthPlatform, TrendMergeStats>> = {};

  for (const [platformKey, incoming] of Object.entries(collections) as Array<[GrowthPlatform, PlatformTrendCollection | undefined]>) {
    if (!incoming) continue;
    const merged = mergeCollection(next.collections[platformKey], incoming);
    next.collections[platformKey] = merged.collection;
    const archiveEntry = await archiveCollection(platformKey, incoming, merged.dedupedCount);
    next.archiveIndex.push(archiveEntry);
    mergeStats[platformKey] = {
      platform: platformKey,
      source: incoming.source,
      incomingCount: incoming.items.length,
      addedCount: merged.addedCount,
      mergedCount: merged.mergedCount,
      dedupedCount: merged.dedupedCount,
      currentTotal: merged.collection.items.length,
      live: incoming.source === "live",
      buckets: getBucketCounts(merged.collection.items),
      collectedAt: incoming.collectedAt,
    };
  }

  next.archiveIndex = (await pruneOldArchives(next.archiveIndex))
    .sort((left, right) => new Date(right.archivedAt).getTime() - new Date(left.archivedAt).getTime())
    .slice(0, 5000);

  const written = await writeStore(next);
  return {
    ...written,
    mergeStats,
  };
}

export async function updateTrendSchedulerState(
  platform: GrowthPlatform,
  patch: Partial<TrendSchedulerState>,
) {
  const store = await readTrendStore();
  const current = store.scheduler[platform] || {
    platform,
    failureCount: 0,
  };
  store.scheduler[platform] = {
    ...current,
    ...patch,
    platform,
  };
  store.updatedAt = new Date().toISOString();
  return writeStore(store);
}

export async function readTrendSchedulerState() {
  const store = await readTrendStore();
  return store.scheduler;
}

export async function exportTrendCollectionsCsv() {
  const store = await readTrendStore();
  await ensureStoreDir();

  const header = [
    "platform",
    "source",
    "collected_at",
    "window_days",
    "item_id",
    "title",
    "author",
    "url",
    "published_at",
    "likes",
    "comments",
    "shares",
    "views",
    "hot_value",
    "content_type",
    "tags",
  ].join(",");

  const createdAt = new Date().toISOString().replace(/[:.]/g, "-");
  const files: Array<{ platform: GrowthPlatform; bucket: string; filePath: string; rows: number }> = [];
  let totalRows = 0;

  for (const collection of Object.values(store.collections)) {
    if (!collection?.items.length) continue;
    const buckets = collection.items.reduce<Record<string, TrendItem[]>>((acc, item) => {
      const bucket = String(item.bucket || item.contentType || "default").trim() || "default";
      (acc[bucket] ||= []).push(item);
      return acc;
    }, {});

    for (const [bucket, bucketItems] of Object.entries(buckets)) {
      const lines = [header];
      for (const item of bucketItems) {
        const row = [
          collection.platform,
          collection.source,
          collection.collectedAt,
          String(collection.windowDays),
          item.id,
          item.title,
          item.author || "",
          item.url || "",
          item.publishedAt || "",
          String(item.likes || ""),
          String(item.comments || ""),
          String(item.shares || ""),
          String(item.views || ""),
          String(item.hotValue || ""),
          item.contentType || "",
          (item.tags || []).join("|"),
        ]
          .map((cell) => `"${String(cell).replace(/"/g, "\"\"")}"`)
          .join(",");
        lines.push(row);
      }

      const filePath = path.join(EXPORT_DIR, `${collection.platform}-${bucket}-growth-trends-${createdAt}.csv`);
      await fs.writeFile(filePath, lines.join("\n"), "utf8");
      files.push({
        platform: collection.platform,
        bucket,
        filePath,
        rows: Math.max(0, lines.length - 1),
      });
      totalRows += Math.max(0, lines.length - 1);
    }
  }

  const manifest = path.join(EXPORT_DIR, `growth-trends-manifest-${createdAt}.json`);
  await fs.writeFile(
    manifest,
    JSON.stringify(
      {
        createdAt,
        retentionDays: RETENTION_DAYS,
        files,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    manifestPath: manifest,
    files,
    rows: totalRows,
  };
}

export function isTrendCollectionStale(collectedAt?: string, maxAgeHours = 6) {
  if (!collectedAt) return true;
  const timestamp = new Date(collectedAt).getTime();
  if (!Number.isFinite(timestamp)) return true;
  return Date.now() - timestamp > maxAgeHours * 60 * 60 * 1000;
}
