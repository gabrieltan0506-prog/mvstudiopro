import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { growthPlatformValues, type GrowthPlatform } from "@shared/growth";
import type { PlatformTrendCollection, TrendItem } from "./trendCollector";
import { nowShanghaiIso, toShanghaiIso } from "./time";
import { normalizeStringList } from "./trendNormalize";
const execFileAsync = promisify(execFile);

export type TrendSchedulerState = {
  platform: GrowthPlatform;
  lastRunAt?: string;
  lastSuccessAt?: string;
  nextRunAt?: string;
  failureCount: number;
  totalRuns?: number;
  totalFailures?: number;
  successCount?: number;
  lastDurationMs?: number;
  lastCollectedCount?: number;
  lastAddedCount?: number;
  lastMergedCount?: number;
  burstMode?: boolean;
  burstTriggeredAt?: string;
  burstEnterCount?: number;
  burstExitCount?: number;
  burstStableRuns?: number;
  burstLowYieldRuns?: number;
  lastFrequencyLabel?: string;
  lastError?: string;
};

export type TrendArchiveEntry = {
  platform: GrowthPlatform;
  bucket: string;
  bucketCounts: Record<string, number>;
  industryCounts?: Record<string, number>;
  ageCounts?: Record<string, number>;
  contentCounts?: Record<string, number>;
  archivedAt: string;
  source: PlatformTrendCollection["source"];
  itemCount: number;
  dedupedCount: number;
  requestCount?: number;
  pageDepth?: number;
  targetPerRun?: number;
  referenceMinItems?: number;
  referenceMaxItems?: number;
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

export type TrendBackfillPlatformProgress = {
  platform: GrowthPlatform;
  target: number;
  currentTotal: number;
  archivedTotal: number;
  addedCount?: number;
  mergedCount?: number;
  plateauCount?: number;
  status: "pending" | "running" | "done" | "plateau" | "error";
  error?: string;
};

export type TrendBackfillProgress = {
  mode?: "live" | "history";
  active: boolean;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string;
  currentRound: number;
  maxRounds: number;
  targetPerPlatform: number;
  selectedWindowDays?: number;
  status: "idle" | "running" | "completed" | "partial" | "failed";
  platforms: TrendBackfillPlatformProgress[];
  note?: string;
};

export type TrendMailDigestState = {
  lastSentAt?: string;
  lastManifestPath?: string;
  lastWindowMinutes?: number;
  pendingAttachmentBytes?: number;
  pendingCreatedAt?: string;
  pendingSubjectBase?: string;
  pendingTextBase?: string;
  pendingHtmlBase?: string;
  pendingAttachmentBatches?: Array<Array<{
    filename: string;
    path?: string;
    contentType?: string;
  }>>;
};

export type TrendHistoryLedgerEntry = {
  key: string;
  bucket: string;
  industryLabels: string[];
  ageLabels: string[];
  contentLabels: string[];
  firstSeenAt: string;
  lastSeenAt: string;
};

export type TrendHistoryPlatformSummary = {
  platform: GrowthPlatform;
  archivedItems: number;
  bucketCounts: Record<string, number>;
  industryCounts: Record<string, number>;
  ageCounts: Record<string, number>;
  contentCounts: Record<string, number>;
  firstSeenAt?: string;
  lastSeenAt?: string;
};

export type TrendHistoryState = {
  updatedAt: string;
  source: "ledger";
  platforms: Partial<Record<GrowthPlatform, TrendHistoryPlatformSummary>>;
};

type TrendStoreFile = {
  updatedAt: string;
  collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>;
  scheduler: Partial<Record<GrowthPlatform, TrendSchedulerState>>;
  archiveIndex: TrendArchiveEntry[];
  history?: TrendHistoryState;
  backfill?: TrendBackfillProgress;
  backfillLive?: TrendBackfillProgress;
  backfillHistory?: TrendBackfillProgress;
  mailDigest?: TrendMailDigestState;
};

type TrendStoreRuntimeMeta = {
  updatedAt?: string;
  scheduler?: Partial<Record<GrowthPlatform, TrendSchedulerState>>;
  backfill?: TrendBackfillProgress;
  backfillLive?: TrendBackfillProgress;
  backfillHistory?: TrendBackfillProgress;
  mailDigest?: TrendMailDigestState;
};

export type GrowthDebugSummaryPlatform = {
  platform: GrowthPlatform;
  currentTotal: number;
  archivedTotal: number;
};

export type GrowthDebugSummary = {
  updatedAt: string;
  truthSource?: "platform-current" | "derived-platforms" | "current-json";
  totals: {
    currentItems: number;
    archivedItems: number;
  };
  platforms: Partial<Record<GrowthPlatform, GrowthDebugSummaryPlatform>>;
};

export type TrendCollectionStatsSummary = {
  platform: GrowthPlatform;
  source?: PlatformTrendCollection["source"];
  currentTotal: number;
  lastCollectedAt?: string;
  singleRunCount: number;
  singleRunTarget: number;
  pageDepth: number;
  requestCount: number;
  uniqueAuthors: number;
  archivedRuns: number;
  archivedItems: number;
  referenceMinItems: number;
  referenceMaxItems: number;
  bucketCounts: Record<string, number>;
  industryCounts: Record<string, number>;
  ageCounts: Record<string, number>;
  contentCounts: Record<string, number>;
};

export type TrendBucketStatsSummary = {
  bucket: string;
  currentTotal: number;
  archivedItems: number;
  archivedRuns: number;
};

export type GrowthTrendStatsSummary = {
  updatedAt: string;
  totals: {
    currentItems: number;
    currentPlatforms: number;
    archiveRuns: number;
    archivedItems: number;
    schedulerTrackedPlatforms: number;
    burstEnterCount: number;
    burstExitCount: number;
    burstActivePlatforms: number;
  };
  references: {
    schedulerIntervals: Array<{ label: string; intervalHours: number }>;
    perPlatform: Partial<Record<GrowthPlatform, { min: number; max: number }>>;
    lookbackWindows: number[];
  };
  coverage: {
    selectedWindowDays: number;
    reason: string;
    windows: Array<{
      days: number;
      archivedItems: number;
      archivedRuns: number;
      activePlatforms: number;
    }>;
  };
  platforms: TrendCollectionStatsSummary[];
  buckets: TrendBucketStatsSummary[];
  industries: Array<{ label: string; currentTotal: number; archivedItems: number }>;
  ages: Array<{ label: string; currentTotal: number; archivedItems: number }>;
  contentTypes: Array<{ label: string; currentTotal: number; archivedItems: number }>;
  scheduler: Array<TrendSchedulerState>;
};

const DEFAULT_STORE_ROOT = path.resolve(process.cwd(), ".cache");
const STORE_DIR = path.resolve(process.env.GROWTH_STORE_DIR || path.join(DEFAULT_STORE_ROOT, "growth"));
const LEGACY_STORE_FILE = path.resolve(
  process.env.GROWTH_LEGACY_STORE_FILE || path.join(path.dirname(STORE_DIR), "growth-trends.json"),
);
const STORE_FILE = path.join(STORE_DIR, "current.json");
const META_FILE = path.join(STORE_DIR, "runtime-meta.json");
const DEBUG_SUMMARY_FILE = path.join(STORE_DIR, "backups", "growth-debug-summary.json");
const ARCHIVE_INDEX_FILE = path.join(STORE_DIR, "archive-index.json");
const HISTORY_SUMMARY_FILE = path.join(STORE_DIR, "history-summary.json");
const ARCHIVE_DIR = path.join(STORE_DIR, "archive");
const PLATFORM_DIR = path.join(STORE_DIR, "platforms");
const PLATFORM_CURRENT_DIR = path.join(STORE_DIR, "platform-current");
const PLATFORM_CURRENT_MANIFEST_FILE = path.join(STORE_DIR, "platform-current-manifest.json");
const HISTORY_LEDGER_DIR = path.join(STORE_DIR, "history-ledger");
const GITHUB_OFFLOAD_CACHE_DIR = path.resolve(process.env.GROWTH_GITHUB_OFFLOAD_CACHE_DIR || path.join(DEFAULT_STORE_ROOT, "growth-github-cache"));
const GITHUB_COLD_STORE_BASE_URL = String(process.env.GROWTH_GITHUB_COLD_STORE_BASE_URL || "").trim().replace(/\/$/, "");
const BACKFILL_PLATFORMS = growthPlatformValues.filter((platform) => platform !== "weixin_channels");
const RETENTION_DAYS = 365;
const LOOKBACK_WINDOWS = [30, 60, 90, 120, 180, 270, 365];
const DEFAULT_SELECTED_WINDOW_DAYS = Math.max(30, Number(process.env.GROWTH_TARGET_WINDOW_DAYS || 365) || 365);
const IS_FLY_VOLUME_STORE = STORE_DIR.startsWith("/data/");
const EXPORT_DIR = path.resolve(
  process.env.GROWTH_EXPORT_DIR
    || (IS_FLY_VOLUME_STORE ? path.join("/tmp", "growth-exports") : path.join(STORE_DIR, "exports")),
);
const SHOULD_WRITE_LEGACY_MIRROR = process.env.GROWTH_WRITE_LEGACY_MIRROR === "1" || !IS_FLY_VOLUME_STORE;
const SHOULD_WRITE_DERIVED_PLATFORM_FILES = process.env.GROWTH_WRITE_DERIVED_PLATFORM_FILES !== "0";
const DISABLE_HISTORY_LEDGER_UPDATES = !/^(0|false|no)$/i.test(
  String(process.env.GROWTH_DISABLE_HISTORY_LEDGER_UPDATES || "1").trim(),
);
let historyReconcilePromise: Promise<TrendStoreFile> | null = null;

async function ensureStoreDir() {
  await fs.mkdir(STORE_DIR, { recursive: true });
  await fs.mkdir(path.dirname(DEBUG_SUMMARY_FILE), { recursive: true });
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  await fs.mkdir(EXPORT_DIR, { recursive: true });
  await fs.mkdir(PLATFORM_DIR, { recursive: true });
  await fs.mkdir(PLATFORM_CURRENT_DIR, { recursive: true });
  await fs.mkdir(HISTORY_LEDGER_DIR, { recursive: true });
  await fs.mkdir(GITHUB_OFFLOAD_CACHE_DIR, { recursive: true });
}

function canUseGithubColdStore() {
  return Boolean(GITHUB_COLD_STORE_BASE_URL);
}

function getColdStoreAssetUrl(assetName: string) {
  if (!GITHUB_COLD_STORE_BASE_URL) return "";
  return `${GITHUB_COLD_STORE_BASE_URL}/${assetName}`;
}

async function downloadColdStoreAsset(assetName: string, cacheRelativePath: string) {
  if (!canUseGithubColdStore()) return null;
  const url = getColdStoreAssetUrl(assetName);
  if (!url) return null;
  const cachePath = path.join(GITHUB_OFFLOAD_CACHE_DIR, cacheRelativePath);
  try {
    await fs.access(cachePath);
    return cachePath;
  } catch {}
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, bytes);
  return cachePath;
}

async function readJsonWithGzipFallback<T>(localPath: string, assetName: string, cacheRelativePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(localPath, "utf8")) as T;
  } catch {}
  const downloaded = await downloadColdStoreAsset(assetName, cacheRelativePath);
  if (!downloaded) return null;
  try {
    const { stdout } = await execFileAsync("gzip", ["-dfc", downloaded], { maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(stdout) as T;
  } catch {
    return null;
  }
}

function resolveArchiveRelativePath(filePath: string) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  const archiveIndex = normalized.indexOf("/archive/");
  if (archiveIndex >= 0) return normalized.slice(archiveIndex + "/archive/".length);
  if (normalized.startsWith("archive/")) return normalized.slice("archive/".length);
  return normalized.replace(/^\/+/, "");
}

async function ensureOffloadedArchiveDir(dirName: string) {
  if (!dirName || !canUseGithubColdStore()) return null;
  const targetDir = path.join(GITHUB_OFFLOAD_CACHE_DIR, "archive", dirName);
  try {
    await fs.access(targetDir);
    return targetDir;
  } catch {}
  const bundle = await downloadColdStoreAsset(`archive-${dirName}.tar.gz`, path.join("bundles", `archive-${dirName}.tar.gz`));
  if (!bundle) return null;
  await fs.mkdir(path.join(GITHUB_OFFLOAD_CACHE_DIR, "archive"), { recursive: true });
  try {
    await execFileAsync("tar", ["-xzf", bundle, "-C", path.join(GITHUB_OFFLOAD_CACHE_DIR, "archive")], { maxBuffer: 64 * 1024 * 1024 });
    return targetDir;
  } catch {
    return null;
  }
}

function buildGrowthDebugSummary(store: TrendStoreFile): GrowthDebugSummary {
  const isRecoveredCollection = (collection: PlatformTrendCollection | undefined) =>
    isRecoveredCollectionSource(collection?.source);

  const platforms = Object.fromEntries(
    growthPlatformValues.map((platform) => [
      platform,
      {
        platform,
        currentTotal: isRecoveredCollection(store.collections?.[platform]) ? 0 : (store.collections?.[platform]?.items?.length || 0),
        archivedTotal: store.history?.platforms?.[platform]?.archivedItems || 0,
      },
    ]),
  ) as Partial<Record<GrowthPlatform, GrowthDebugSummaryPlatform>>;

  return {
    updatedAt: store.updatedAt || nowShanghaiIso(),
    truthSource: "platform-current",
    totals: {
      currentItems: Object.values(platforms).reduce((sum, item) => sum + Number(item?.currentTotal || 0), 0),
      archivedItems: Object.values(platforms).reduce((sum, item) => sum + Number(item?.archivedTotal || 0), 0),
    },
    platforms,
  };
}

export async function readGrowthDebugSummary(): Promise<GrowthDebugSummary | null> {
  try {
    return JSON.parse(await fs.readFile(DEBUG_SUMMARY_FILE, "utf8")) as GrowthDebugSummary;
  } catch {
    return null;
  }
}

export async function refreshTrendDebugSummary(store?: TrendStoreFile) {
  const next = store || await readTrendStore();
  const summary = buildGrowthDebugSummary(next);
  await writeJsonAtomic(DEBUG_SUMMARY_FILE, summary);
  return summary;
}

function createEmptyHistoryState(): TrendHistoryState {
  return {
    updatedAt: toShanghaiIso(0),
    source: "ledger",
    platforms: {},
  };
}

function createEmptyStore(): TrendStoreFile {
  return {
    updatedAt: toShanghaiIso(0),
    collections: {},
    scheduler: {},
    archiveIndex: [],
    history: createEmptyHistoryState(),
    backfill: {
      active: false,
      currentRound: 0,
      maxRounds: 0,
      targetPerPlatform: 0,
      status: "idle",
      platforms: [],
    },
    backfillLive: {
      active: false,
      currentRound: 0,
      maxRounds: 0,
      targetPerPlatform: 0,
      status: "idle",
      platforms: [],
      mode: "live",
    },
    backfillHistory: {
      active: false,
      currentRound: 0,
      maxRounds: 0,
      targetPerPlatform: 0,
      status: "idle",
      platforms: [],
      mode: "history",
    },
    mailDigest: {},
  };
}

function isRecoveredCollectionSource(source?: PlatformTrendCollection["source"]) {
  const normalized = String(source || "").toLowerCase();
  return normalized.includes("recovered") || normalized.includes("archive") || normalized.includes("csv");
}

function normalizeItem(item: TrendItem): TrendItem {
  return {
    ...item,
    id: String(item.id || "").trim(),
    title: String(item.title || "").trim(),
    bucket: item.bucket ? String(item.bucket).trim() : undefined,
    author: item.author ? String(item.author).trim() : undefined,
    url: item.url ? String(item.url).trim() : undefined,
    tags: normalizeStringList(item.tags),
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
      tags: Array.from(new Set([
        ...normalizeStringList(current.tags),
        ...normalizeStringList(item.tags),
      ])),
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

function normalizeLabels(labels: unknown) {
  return normalizeStringList(labels);
}

function getBucketCounts(items: TrendItem[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const bucket = String(item.bucket || item.contentType || "default").trim() || "default";
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
}

function getReferenceRange(collection?: PlatformTrendCollection) {
  return {
    min: collection?.stats?.referenceMinItems || 0,
    max: collection?.stats?.referenceMaxItems || 0,
  };
}

function buildHistoryLedgerEntry(item: TrendItem, observedAt: string): TrendHistoryLedgerEntry | null {
  const normalized = normalizeItem(item);
  const key = getItemKey(normalized);
  if (!key) return null;
  return {
    key,
    bucket: String(normalized.bucket || normalized.contentType || "default").trim() || "default",
    industryLabels: normalizeLabels(normalized.industryLabels),
    ageLabels: normalizeLabels(normalized.ageLabels),
    contentLabels: normalizeLabels(normalized.contentLabels),
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
  };
}

function summarizeHistoryLedger(
  platform: GrowthPlatform,
  ledger: Record<string, TrendHistoryLedgerEntry>,
): TrendHistoryPlatformSummary {
  const bucketCounts: Record<string, number> = {};
  const industryCounts: Record<string, number> = {};
  const ageCounts: Record<string, number> = {};
  const contentCounts: Record<string, number> = {};
  let firstSeenAt = "";
  let lastSeenAt = "";

  for (const entry of Object.values(ledger)) {
    bucketCounts[entry.bucket] = (bucketCounts[entry.bucket] || 0) + 1;
    for (const label of entry.industryLabels) industryCounts[label] = (industryCounts[label] || 0) + 1;
    for (const label of entry.ageLabels) ageCounts[label] = (ageCounts[label] || 0) + 1;
    for (const label of entry.contentLabels) contentCounts[label] = (contentCounts[label] || 0) + 1;
    if (!firstSeenAt || entry.firstSeenAt < firstSeenAt) firstSeenAt = entry.firstSeenAt;
    if (!lastSeenAt || entry.lastSeenAt > lastSeenAt) lastSeenAt = entry.lastSeenAt;
  }

  return {
    platform,
    archivedItems: Object.keys(ledger).length,
    bucketCounts,
    industryCounts,
    ageCounts,
    contentCounts,
    firstSeenAt: firstSeenAt || undefined,
    lastSeenAt: lastSeenAt || undefined,
  };
}

function getHistoryLedgerFile(platform: GrowthPlatform) {
  return path.join(HISTORY_LEDGER_DIR, `${platform}.json`);
}

async function readHistoryLedger(platform: GrowthPlatform): Promise<Record<string, TrendHistoryLedgerEntry>> {
  const parsed = await readJsonWithGzipFallback<{ items?: Record<string, TrendHistoryLedgerEntry> }>(
    getHistoryLedgerFile(platform),
    `history-ledger-${platform}.json.gz`,
    path.join("history-ledger", `${platform}.json.gz`),
  );
  return parsed?.items || {};
}

async function writeHistoryLedger(platform: GrowthPlatform, items: Record<string, TrendHistoryLedgerEntry>) {
  await ensureStoreDir();
  await fs.writeFile(
    getHistoryLedgerFile(platform),
    JSON.stringify(
      {
        updatedAt: nowShanghaiIso(),
        platform,
        items,
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function readAllHistoryLedgers(platforms: GrowthPlatform[]) {
  const ledgers = new Map<GrowthPlatform, Record<string, TrendHistoryLedgerEntry>>();
  for (const platform of platforms) {
    ledgers.set(platform, await readHistoryLedger(platform));
  }
  return ledgers;
}

async function refreshHistorySummary(
  store: TrendStoreFile,
  platforms: GrowthPlatform[],
) {
  const summaries: Partial<Record<GrowthPlatform, TrendHistoryPlatformSummary>> = {
    ...(store.history?.platforms || {}),
  };
  for (const platform of platforms) {
    const ledger = await readHistoryLedger(platform);
    summaries[platform] = summarizeHistoryLedger(platform, ledger);
  }
  store.history = {
    updatedAt: nowShanghaiIso(),
    source: "ledger",
    platforms: summaries,
  };
}

async function updateHistoryFromCollections(
  store: TrendStoreFile,
  collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>,
) {
  if (DISABLE_HISTORY_LEDGER_UPDATES) {
    store.history = (await readHistorySummaryFile()) || store.history || createEmptyHistoryState();
    store.history.updatedAt = nowShanghaiIso();
    return;
  }
  const touched = new Set<GrowthPlatform>();
  for (const [platform, collection] of Object.entries(collections) as Array<[GrowthPlatform, PlatformTrendCollection | undefined]>) {
    if (!collection?.items?.length) continue;
    const ledger = await readHistoryLedger(platform);
    for (const rawItem of collection.items) {
      const entry = buildHistoryLedgerEntry(rawItem, collection.collectedAt);
      if (!entry) continue;
      const current = ledger[entry.key];
      if (!current) {
        ledger[entry.key] = entry;
        continue;
      }
      ledger[entry.key] = {
        ...current,
        bucket: entry.bucket || current.bucket,
        industryLabels: normalizeLabels([...(current.industryLabels || []), ...entry.industryLabels]),
        ageLabels: normalizeLabels([...(current.ageLabels || []), ...entry.ageLabels]),
        contentLabels: normalizeLabels([...(current.contentLabels || []), ...entry.contentLabels]),
        firstSeenAt: current.firstSeenAt < entry.firstSeenAt ? current.firstSeenAt : entry.firstSeenAt,
        lastSeenAt: current.lastSeenAt > entry.lastSeenAt ? current.lastSeenAt : entry.lastSeenAt,
      };
    }
    await writeHistoryLedger(platform, ledger);
    touched.add(platform);
  }
  if (touched.size) {
    await refreshHistorySummary(store, Array.from(touched));
  } else if (!store.history) {
    store.history = createEmptyHistoryState();
  }
}

async function readArchiveCollectionItems(entry: TrendArchiveEntry): Promise<TrendItem[]> {
  try {
    const raw = await fs.readFile(entry.file, "utf8");
    const parsed = JSON.parse(raw) as Partial<PlatformTrendCollection>;
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    const relativePath = resolveArchiveRelativePath(entry.file);
    const [dirName] = relativePath.split("/");
    if (!dirName) return [];
    const archiveDir = await ensureOffloadedArchiveDir(dirName);
    if (!archiveDir) return [];
    try {
      const raw = await fs.readFile(path.join(GITHUB_OFFLOAD_CACHE_DIR, "archive", relativePath), "utf8");
      const parsed = JSON.parse(raw) as Partial<PlatformTrendCollection>;
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
      return [];
    }
  }
}

async function readRawStoreFile(filePath: string): Promise<TrendStoreFile | null> {
  try {
    const parsed = await readJsonWithGzipFallback<Partial<TrendStoreFile>>(
      filePath,
      path.basename(filePath) === "current.json" ? "current.json.gz" : `${path.basename(filePath)}.gz`,
      path.basename(filePath) === "current.json" ? "current.json.gz" : `${path.basename(filePath)}.gz`,
    );
    if (!parsed) return null;
    return {
      updatedAt: parsed.updatedAt || toShanghaiIso(0),
      collections: parsed.collections || {},
      scheduler: parsed.scheduler || {},
      archiveIndex: (parsed.archiveIndex || []).map((entry) => ({
        ...entry,
        bucketCounts: entry.bucketCounts || {},
        industryCounts: entry.industryCounts || {},
        ageCounts: entry.ageCounts || {},
        contentCounts: entry.contentCounts || {},
      })),
      history: parsed.history || createEmptyHistoryState(),
      backfill: parsed.backfill || createEmptyStore().backfill,
      backfillLive: parsed.backfillLive || createEmptyStore().backfillLive,
      backfillHistory: parsed.backfillHistory || createEmptyStore().backfillHistory,
      mailDigest: parsed.mailDigest || {},
    };
  } catch {
    return null;
  }
}

async function readArchiveIndexFile(): Promise<TrendArchiveEntry[]> {
  const parsed = await readJsonWithGzipFallback<{ archiveIndex?: TrendArchiveEntry[] } | TrendArchiveEntry[]>(
    ARCHIVE_INDEX_FILE,
    "archive-index.json.gz",
    "archive-index.json.gz",
  );
  const entries = Array.isArray(parsed) ? parsed : (parsed?.archiveIndex || []);
  return entries.map((entry) => ({
    ...entry,
    bucketCounts: entry.bucketCounts || {},
    industryCounts: entry.industryCounts || {},
    ageCounts: entry.ageCounts || {},
    contentCounts: entry.contentCounts || {},
  }));
}

async function readHistorySummaryFile(): Promise<TrendHistoryState | null> {
  return readJsonWithGzipFallback<TrendHistoryState>(
    HISTORY_SUMMARY_FILE,
    "history-summary.json.gz",
    "history-summary.json.gz",
  );
}

async function readPlatformCollectionFile(platform: GrowthPlatform): Promise<PlatformTrendCollection | undefined> {
  const parsed = await readJsonWithGzipFallback<{ collection?: PlatformTrendCollection }>(
    path.join(PLATFORM_DIR, `${platform}.json`),
    `platform-${platform}.json.gz`,
    path.join("platforms", `${platform}.json.gz`),
  );
  if (isRecoveredCollectionSource(parsed?.collection?.source)) return undefined;
  return parsed?.collection;
}

type PlatformCurrentTruthFile = {
  updatedAt: string;
  truthSource: "platform-current";
  platform: GrowthPlatform;
  collection: PlatformTrendCollection;
  history?: TrendHistoryPlatformSummary;
};

type PlatformCurrentManifest = {
  updatedAt: string;
  truthSource: "platform-current";
  platforms: Partial<Record<GrowthPlatform, {
    file: string;
    currentTotal: number;
    archivedTotal: number;
  }>>;
};

function getPlatformCurrentTruthFile(platform: GrowthPlatform) {
  return path.join(PLATFORM_CURRENT_DIR, `${platform}.current.json`);
}

async function readPlatformCurrentManifest(): Promise<PlatformCurrentManifest | null> {
  try {
    const raw = await fs.readFile(PLATFORM_CURRENT_MANIFEST_FILE, "utf8");
    return JSON.parse(raw) as PlatformCurrentManifest;
  } catch {
    return null;
  }
}

async function readPlatformCurrentTruthFile(platform: GrowthPlatform): Promise<PlatformCurrentTruthFile | null> {
  const parsed = await readJsonWithGzipFallback<PlatformCurrentTruthFile>(
    getPlatformCurrentTruthFile(platform),
    `platform-current-${platform}.json.gz`,
    path.join("platform-current", `${platform}.json.gz`),
  );
  if (!parsed?.collection || isRecoveredCollectionSource(parsed.collection?.source)) return null;
  return parsed;
}

async function readPlatformCurrentTruthStoreFile(): Promise<TrendStoreFile | null> {
  const [meta, archiveIndex, history, summary, manifest] = await Promise.all([
    readRuntimeMeta(),
    readArchiveIndexFile(),
    readHistorySummaryFile(),
    readGrowthDebugSummary(),
    readPlatformCurrentManifest(),
  ]);
  if (!manifest?.platforms || !Object.keys(manifest.platforms).length) return null;
  const truthEntries = await Promise.all(
    growthPlatformValues.map(async (platform) => [platform, await readPlatformCurrentTruthFile(platform)] as const),
  );
  const availableEntries = truthEntries.filter(([, entry]) => Boolean(entry));
  if (!availableEntries.length) return null;
  const requiredPlatforms = growthPlatformValues.filter(
    (platform) => Number(summary?.platforms?.[platform]?.currentTotal || 0) > 0,
  );
  const availablePlatforms = new Set(availableEntries.map(([platform]) => platform));
  if (requiredPlatforms.some((platform) => !availablePlatforms.has(platform))) return null;
  if ((summary?.totals.archivedItems || 0) > 0 && !history) return null;
  const collections = Object.fromEntries(
    availableEntries.map(([platform, entry]) => [platform, entry!.collection]),
  ) as Partial<Record<GrowthPlatform, PlatformTrendCollection>>;
  const historyPlatforms: Partial<Record<GrowthPlatform, TrendHistoryPlatformSummary>> = {
    ...(history?.platforms || {}),
  };
  for (const [platform, entry] of availableEntries) {
    if (entry?.history) historyPlatforms[platform] = entry.history;
  }
  return {
    updatedAt: meta.updatedAt || manifest.updatedAt || nowShanghaiIso(),
    collections,
    scheduler: meta.scheduler || {},
    archiveIndex,
    history: {
      updatedAt: history?.updatedAt || manifest.updatedAt || nowShanghaiIso(),
      source: "ledger",
      platforms: historyPlatforms,
    },
    backfill: meta.backfill || createEmptyStore().backfill,
    backfillLive: meta.backfillLive || createEmptyStore().backfillLive,
    backfillHistory: meta.backfillHistory || createEmptyStore().backfillHistory,
    mailDigest: meta.mailDigest || {},
  };
}

async function readDerivedStoreFile(): Promise<TrendStoreFile | null> {
  const [meta, archiveIndex, history, summary] = await Promise.all([
    readRuntimeMeta(),
    readArchiveIndexFile(),
    readHistorySummaryFile(),
    readGrowthDebugSummary(),
  ]);
  const collectionsEntries = await Promise.all(
    growthPlatformValues.map(async (platform) => [platform, await readPlatformCollectionFile(platform)] as const),
  );
  const hasDerivedCollections = collectionsEntries.some(([, collection]) => Boolean(collection));
  if (!hasDerivedCollections) return null;
  const requiredPlatforms = growthPlatformValues.filter(
    (platform) => Number(summary?.platforms?.[platform]?.currentTotal || 0) > 0,
  );
  const availablePlatforms = new Set(
    collectionsEntries.filter(([, collection]) => Boolean(collection)).map(([platform]) => platform),
  );
  if (requiredPlatforms.some((platform) => !availablePlatforms.has(platform))) {
    return null;
  }
  if ((summary?.totals.archivedItems || 0) > 0 && (!archiveIndex.length || !history)) {
    return null;
  }
  return {
    updatedAt: meta.updatedAt || nowShanghaiIso(),
    collections: Object.fromEntries(
      collectionsEntries.filter(([, collection]) => Boolean(collection)),
    ) as Partial<Record<GrowthPlatform, PlatformTrendCollection>>,
    scheduler: meta.scheduler || {},
    archiveIndex,
    history: history || createEmptyHistoryState(),
    backfill: meta.backfill || createEmptyStore().backfill,
    backfillLive: meta.backfillLive || createEmptyStore().backfillLive,
    backfillHistory: meta.backfillHistory || createEmptyStore().backfillHistory,
    mailDigest: meta.mailDigest || {},
  };
}

async function readRuntimeMeta(): Promise<TrendStoreRuntimeMeta> {
  try {
    const raw = await fs.readFile(META_FILE, "utf8");
    const parsed = JSON.parse(raw) as TrendStoreRuntimeMeta;
    const legacyBackfill = parsed.backfill;
    const hasSplitBackfill = Boolean(parsed.backfillLive || parsed.backfillHistory);
    return {
      updatedAt: parsed.updatedAt,
      scheduler: parsed.scheduler || {},
      backfill: hasSplitBackfill ? undefined : legacyBackfill,
      backfillLive: parsed.backfillLive,
      backfillHistory: parsed.backfillHistory,
      mailDigest: parsed.mailDigest || {},
    };
  } catch {
    return {};
  }
}

export async function readTrendRuntimeMeta(): Promise<{
  updatedAt?: string;
  scheduler: Partial<Record<GrowthPlatform, TrendSchedulerState>>;
  backfill?: TrendBackfillProgress;
  backfillLive?: TrendBackfillProgress;
  backfillHistory?: TrendBackfillProgress;
  mailDigest: TrendMailDigestState;
}> {
  const meta = await readRuntimeMeta();
  return {
    updatedAt: meta.updatedAt,
    scheduler: meta.scheduler || {},
    backfill: meta.backfill,
    backfillLive: meta.backfillLive,
    backfillHistory: meta.backfillHistory,
    mailDigest: meta.mailDigest || {},
  };
}

async function writeRuntimeMeta(next: TrendStoreRuntimeMeta) {
  await ensureStoreDir();
  await writeJsonAtomic(META_FILE, {
    updatedAt: next.updatedAt || nowShanghaiIso(),
    scheduler: next.scheduler || {},
    backfillLive: next.backfillLive,
    backfillHistory: next.backfillHistory,
    mailDigest: next.mailDigest || {},
  });
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.next`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tempPath, filePath);
}

export async function readTrendStore(options?: { preferDerivedFiles?: boolean }): Promise<TrendStoreFile> {
  await ensureStoreDir();
  if (options?.preferDerivedFiles) {
    const platformTruth = await readPlatformCurrentTruthStoreFile();
    if (platformTruth) return platformTruth;
    const derived = await readDerivedStoreFile();
    if (derived) return derived;
  }
  const current = await readRawStoreFile(STORE_FILE);
  if (current) {
    const meta = await readRuntimeMeta();
    return {
      ...current,
      updatedAt: meta.updatedAt || current.updatedAt,
      scheduler: meta.scheduler || current.scheduler || {},
      backfill: meta.backfill || current.backfill,
      backfillLive: meta.backfillLive || current.backfillLive,
      backfillHistory: meta.backfillHistory || current.backfillHistory,
      mailDigest: meta.mailDigest || current.mailDigest,
    };
  }

  const legacy = await readRawStoreFile(LEGACY_STORE_FILE);
  if (legacy) {
    await fs.writeFile(STORE_FILE, JSON.stringify(legacy, null, 2), "utf8");
    const meta = await readRuntimeMeta();
    return {
      ...legacy,
      updatedAt: meta.updatedAt || legacy.updatedAt,
      scheduler: meta.scheduler || legacy.scheduler || {},
      backfill: meta.backfill || legacy.backfill,
      backfillLive: meta.backfillLive || legacy.backfillLive,
      backfillHistory: meta.backfillHistory || legacy.backfillHistory,
      mailDigest: meta.mailDigest || legacy.mailDigest,
    };
  }

  const defaultStoreFile = path.join(DEFAULT_STORE_ROOT, "growth", "current.json");
  if (defaultStoreFile !== STORE_FILE) {
    const fallback = await readRawStoreFile(defaultStoreFile);
    if (fallback) {
      await fs.writeFile(STORE_FILE, JSON.stringify(fallback, null, 2), "utf8");
      const meta = await readRuntimeMeta();
      return {
        ...fallback,
        updatedAt: meta.updatedAt || fallback.updatedAt,
        scheduler: meta.scheduler || fallback.scheduler || {},
        backfill: meta.backfill || fallback.backfill,
        backfillLive: meta.backfillLive || fallback.backfillLive,
        backfillHistory: meta.backfillHistory || fallback.backfillHistory,
        mailDigest: meta.mailDigest || fallback.mailDigest,
      };
    }
  }
  return createEmptyStore();
}

export async function reconcileTrendHistoryState(options?: { force?: boolean }) {
  if (!options?.force && historyReconcilePromise) return historyReconcilePromise;

  const run = (async () => {
    const store = await readTrendStore();
    if (
      !options?.force
      && store.history?.source === "ledger"
      && Object.keys(store.history.platforms || {}).length > 0
    ) {
      return store;
    }
    const platforms = new Set<GrowthPlatform>(
      growthPlatformValues.filter((platform) =>
        Boolean(store.collections?.[platform]?.items?.length)
          || (store.archiveIndex || []).some((entry) => entry.platform === platform),
      ),
    );
    const ledgers = new Map<GrowthPlatform, Record<string, TrendHistoryLedgerEntry>>();

    for (const platform of Array.from(platforms)) {
      ledgers.set(platform, options?.force ? {} : await readHistoryLedger(platform));
    }

    for (const [platform, collection] of Object.entries(store.collections) as Array<[GrowthPlatform, PlatformTrendCollection | undefined]>) {
      if (!collection?.items?.length) continue;
      const ledger = ledgers.get(platform) || {};
      for (const rawItem of collection.items) {
        const entry = buildHistoryLedgerEntry(rawItem, collection.collectedAt);
        if (!entry) continue;
        const current = ledger[entry.key];
        if (!current) {
          ledger[entry.key] = entry;
          continue;
        }
        ledger[entry.key] = {
          ...current,
          bucket: entry.bucket || current.bucket,
          industryLabels: normalizeLabels([...(current.industryLabels || []), ...entry.industryLabels]),
          ageLabels: normalizeLabels([...(current.ageLabels || []), ...entry.ageLabels]),
          contentLabels: normalizeLabels([...(current.contentLabels || []), ...entry.contentLabels]),
          firstSeenAt: current.firstSeenAt < entry.firstSeenAt ? current.firstSeenAt : entry.firstSeenAt,
          lastSeenAt: current.lastSeenAt > entry.lastSeenAt ? current.lastSeenAt : entry.lastSeenAt,
        };
      }
      ledgers.set(platform, ledger);
    }

    const archiveEntries = [...(store.archiveIndex || [])].sort((left, right) =>
      new Date(left.archivedAt).getTime() - new Date(right.archivedAt).getTime(),
    );
    for (const entry of archiveEntries) {
      const items = await readArchiveCollectionItems(entry);
      if (!items.length) continue;
      const ledger = ledgers.get(entry.platform) || {};
      for (const rawItem of items) {
        const historyEntry = buildHistoryLedgerEntry(rawItem, entry.archivedAt);
        if (!historyEntry) continue;
        const current = ledger[historyEntry.key];
        if (!current) {
          ledger[historyEntry.key] = historyEntry;
          continue;
        }
        ledger[historyEntry.key] = {
          ...current,
          bucket: historyEntry.bucket || current.bucket,
          industryLabels: normalizeLabels([...(current.industryLabels || []), ...historyEntry.industryLabels]),
          ageLabels: normalizeLabels([...(current.ageLabels || []), ...historyEntry.ageLabels]),
          contentLabels: normalizeLabels([...(current.contentLabels || []), ...historyEntry.contentLabels]),
          firstSeenAt: current.firstSeenAt < historyEntry.firstSeenAt ? current.firstSeenAt : historyEntry.firstSeenAt,
          lastSeenAt: current.lastSeenAt > historyEntry.lastSeenAt ? current.lastSeenAt : historyEntry.lastSeenAt,
        };
      }
      ledgers.set(entry.platform, ledger);
    }

    const summaries: Partial<Record<GrowthPlatform, TrendHistoryPlatformSummary>> = {};
    for (const platform of growthPlatformValues) {
      const ledger = ledgers.get(platform) || {};
      await writeHistoryLedger(platform, ledger);
      summaries[platform] = summarizeHistoryLedger(platform, ledger);
    }

    store.history = {
      updatedAt: nowShanghaiIso(),
      source: "ledger",
      platforms: summaries,
    };
    store.updatedAt = nowShanghaiIso();
    await writeStore(store);
    return store;
  })();

  if (!options?.force) historyReconcilePromise = run;
  try {
    return await run;
  } finally {
    if (!options?.force) historyReconcilePromise = null;
  }
}

async function writeStore(
  next: TrendStoreFile,
  options?: {
    writeDerivedPlatformFiles?: boolean;
    writeLegacyMirror?: boolean;
    allowLowerTotals?: boolean;
  },
) {
  await ensureStoreDir();
  if (!(options?.allowLowerTotals)) {
    const existing = await readTrendStore({ preferDerivedFiles: true });
    if (existing?.collections) {
      const protectedCollections = { ...(next.collections || {}) };
      let preservedAny = false;
      for (const platform of growthPlatformValues) {
        const existingCollection = existing.collections?.[platform];
        const nextCollection = protectedCollections?.[platform];
        const existingCount = existingCollection?.items?.length || 0;
        const nextCount = nextCollection?.items?.length || 0;
        if (existingCount > 0 && nextCount < existingCount) {
          protectedCollections[platform] = existingCollection;
          preservedAny = true;
        }
      }
      if (preservedAny) {
        next = {
          ...next,
          collections: protectedCollections,
        };
      }
    }
  }
  await writeJsonAtomic(STORE_FILE, next);
  await writeRuntimeMeta({
    updatedAt: next.updatedAt,
    scheduler: next.scheduler,
    backfill: next.backfill,
    mailDigest: next.mailDigest,
  });
  await writeJsonAtomic(ARCHIVE_INDEX_FILE, {
    updatedAt: next.updatedAt,
    archiveIndex: next.archiveIndex || [],
  });
  await writeJsonAtomic(HISTORY_SUMMARY_FILE, next.history || createEmptyHistoryState());
  await refreshTrendDebugSummary(next);
  if (options?.writeLegacyMirror ?? SHOULD_WRITE_LEGACY_MIRROR) {
    await writeJsonAtomic(LEGACY_STORE_FILE, next);
  }
  if (!(options?.writeDerivedPlatformFiles ?? SHOULD_WRITE_DERIVED_PLATFORM_FILES)) {
    return next;
  }
  const platformManifest: PlatformCurrentManifest = {
    updatedAt: next.updatedAt,
    truthSource: "platform-current",
    platforms: {},
  };
  await Promise.all(
    growthPlatformValues.map(async (platform) => {
      const collection = next.collections?.[platform];
      const platformFile = path.join(PLATFORM_DIR, `${platform}.json`);
      const bucketDir = path.join(PLATFORM_DIR, platform);
      const truthFile = getPlatformCurrentTruthFile(platform);
      if (!collection || isRecoveredCollectionSource(collection.source)) {
        await fs.rm(platformFile, { force: true });
        await fs.rm(truthFile, { force: true });
        await fs.rm(bucketDir, { recursive: true, force: true });
        return;
      }
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
      const historySummary = next.history?.platforms?.[platform];
      await writeJsonAtomic(truthFile, {
        updatedAt: next.updatedAt,
        truthSource: "platform-current",
        platform,
        collection,
        history: historySummary,
      } satisfies PlatformCurrentTruthFile);
      platformManifest.platforms[platform] = {
        file: truthFile,
        currentTotal: collection.items.length,
        archivedTotal: historySummary?.archivedItems || 0,
      };
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
  await writeJsonAtomic(PLATFORM_CURRENT_MANIFEST_FILE, platformManifest);
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
  const bucketCounts = collection.stats?.bucketCounts || getBucketCounts(collection.items);
  const bucket = Object.keys(bucketCounts).sort().join("+") || "default";
  const bucketPreview = Object.keys(bucketCounts)
    .sort()
    .slice(0, 3)
    .join("+")
    .replace(/[^a-z0-9+_-]/gi, "-")
    .slice(0, 80) || "default";
  const bucketHash = createHash("sha1").update(bucket).digest("hex").slice(0, 12);
  const fileName = `${platform}-${bucketPreview}-${bucketHash}-${collection.collectedAt.replace(/[:.]/g, "-")}.json`;
  const absoluteFile = path.join(ARCHIVE_DIR, datePrefix, fileName);
  await fs.mkdir(path.dirname(absoluteFile), { recursive: true });
  await fs.writeFile(absoluteFile, JSON.stringify(collection, null, 2), "utf8");
  return {
    platform,
    bucket,
    bucketCounts,
    industryCounts: collection.stats?.industryCounts || {},
    ageCounts: collection.stats?.ageCounts || {},
    contentCounts: collection.stats?.contentCounts || {},
    archivedAt: collection.collectedAt,
    source: collection.source,
    itemCount: collection.items.length,
    dedupedCount,
    requestCount: collection.stats?.requestCount,
    pageDepth: collection.stats?.pageDepth,
    targetPerRun: collection.stats?.targetPerRun,
    referenceMinItems: collection.stats?.referenceMinItems,
    referenceMaxItems: collection.stats?.referenceMaxItems,
    file: absoluteFile,
  };
}

export async function writeTrendStore(collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>) {
  const next = createEmptyStore();
  next.updatedAt = nowShanghaiIso();
  next.collections = collections;
  const current = await readTrendStore();
  next.history = current.history || next.history;
  next.backfill = current.backfill || next.backfill;
  next.mailDigest = current.mailDigest || next.mailDigest;
  return writeStore(next);
}

export async function rebuildTrendDerivedFilesFromCurrentStore() {
  const current = await readTrendStore();
  return writeStore(current, {
    writeDerivedPlatformFiles: true,
    writeLegacyMirror: false,
    allowLowerTotals: true,
  });
}

export async function mergeTrendCollections(collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>) {
  return mergeTrendCollectionsWithOptions(collections);
}

export async function mergeTrendCollectionsWithOptions(
  collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>,
  options?: { deferHistoryLedger?: boolean },
) {
  const current = await readTrendStore({ preferDerivedFiles: true });
  const next: TrendStoreFile = {
    updatedAt: nowShanghaiIso(),
    collections: { ...current.collections },
    scheduler: current.scheduler || {},
    archiveIndex: [...(current.archiveIndex || [])],
    history: current.history || createEmptyHistoryState(),
    backfill: current.backfill || createEmptyStore().backfill,
    mailDigest: current.mailDigest || createEmptyStore().mailDigest,
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

  if (!options?.deferHistoryLedger) {
    await updateHistoryFromCollections(next, collections);
  }

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
  const meta = await readRuntimeMeta();
  const scheduler = { ...(meta.scheduler || {}) };
  const current = scheduler[platform] || {
    platform,
    failureCount: 0,
  };
  scheduler[platform] = {
    ...current,
    ...patch,
    platform,
  };
  await writeRuntimeMeta({
    updatedAt: nowShanghaiIso(),
    scheduler,
    backfillLive: meta.backfillLive,
    backfillHistory: meta.backfillHistory,
    mailDigest: meta.mailDigest,
  });
  return scheduler[platform];
}

export async function readTrendSchedulerState() {
  const meta = await readRuntimeMeta();
  return meta.scheduler || {};
}

export async function updateTrendBackfillProgress(progress: Partial<TrendBackfillProgress>) {
  const meta = await readRuntimeMeta();
  const mode = progress.mode === "live" ? "live" : "history";
  const current = mode === "live"
    ? (meta.backfillLive || createEmptyStore().backfillLive!)
    : (meta.backfillHistory || createEmptyStore().backfillHistory!);
  const summary = await readGrowthDebugSummary();
  const currentPlatformMap = new Map(
    growthPlatformValues.map((platform) => [
      platform,
      {
        currentTotal: summary?.platforms?.[platform]?.currentTotal || 0,
        archivedTotal: summary?.platforms?.[platform]?.archivedTotal || 0,
      },
    ]),
  );
  const previousPlatformMap = new Map(
    (current.platforms || []).map((item) => [item.platform, item]),
  );
  const incomingPlatformMap = new Map(
    (progress.platforms || []).map((item) => [item.platform, item]),
  );
  const mergedPlatforms = Array.from(
    new Set<GrowthPlatform>([
      ...Array.from(previousPlatformMap.keys()),
      ...Array.from(incomingPlatformMap.keys()),
      ...Array.from(currentPlatformMap.keys()),
    ]),
  ).filter((platform) => BACKFILL_PLATFORMS.includes(platform)).map((platform) => {
    const previous = previousPlatformMap.get(platform);
    const incoming = incomingPlatformMap.get(platform);
    const summaryTotals = currentPlatformMap.get(platform) || { currentTotal: 0, archivedTotal: 0 };
    const previousArchived = previous?.archivedTotal || 0;
    const incomingArchived = incoming?.archivedTotal || 0;
    const effectiveArchivedTotal = Math.max(summaryTotals.archivedTotal, previousArchived, incomingArchived);
    const effectiveCurrentTotal = Math.max(
      summaryTotals.currentTotal,
      incoming?.currentTotal || 0,
      previous?.currentTotal || 0,
    );
    return {
      ...previous,
      ...incoming,
      platform,
      currentTotal: effectiveCurrentTotal,
      archivedTotal: effectiveArchivedTotal,
      target: incoming?.target ?? previous?.target ?? current.targetPerPlatform ?? 0,
      status: incoming?.status ?? previous?.status ?? "pending",
    };
  });
  const nextBackfill: TrendBackfillProgress = {
    ...current,
    ...progress,
    mode,
    platforms: mergedPlatforms,
    updatedAt: nowShanghaiIso(),
  };
  await writeRuntimeMeta({
    updatedAt: nowShanghaiIso(),
    scheduler: meta.scheduler || {},
    backfillLive: mode === "live" ? nextBackfill : (meta.backfillLive || createEmptyStore().backfillLive),
    backfillHistory: mode === "history" ? nextBackfill : (meta.backfillHistory || createEmptyStore().backfillHistory),
    mailDigest: meta.mailDigest || {},
  });
  return nextBackfill;
}

export async function getGrowthTrendStats(): Promise<GrowthTrendStatsSummary> {
  let store = await readTrendStore({ preferDerivedFiles: true });
  if (!store.history?.platforms || !Object.keys(store.history.platforms).length) {
    store = await reconcileTrendHistoryState();
  }
  const platformMap = new Map<GrowthPlatform, TrendCollectionStatsSummary>();
  const bucketMap = new Map<string, TrendBucketStatsSummary>();
  const industryMap = new Map<string, { label: string; currentTotal: number; archivedItems: number }>();
  const ageMap = new Map<string, { label: string; currentTotal: number; archivedItems: number }>();
  const contentMap = new Map<string, { label: string; currentTotal: number; archivedItems: number }>();
  const historyPlatforms = store.history?.platforms || {};
  const historyPlatformKeys = growthPlatformValues.filter((platform) => {
    const summary = historyPlatforms[platform];
    return Boolean(summary?.archivedItems);
  });
  for (const collection of Object.values(store.collections)) {
    if (!collection) continue;
    const bucketCounts = collection.stats?.bucketCounts || getBucketCounts(collection.items);
    const reference = getReferenceRange(collection);
    platformMap.set(collection.platform, {
      platform: collection.platform,
      source: collection.source,
      currentTotal: collection.items.length,
      lastCollectedAt: collection.collectedAt,
      singleRunCount: collection.stats?.itemCount || collection.items.length,
      singleRunTarget: collection.stats?.targetPerRun || collection.items.length,
      pageDepth: collection.stats?.pageDepth || 0,
      requestCount: collection.stats?.requestCount || 0,
      uniqueAuthors: collection.stats?.uniqueAuthorCount || 0,
      archivedRuns: 0,
      archivedItems: 0,
      referenceMinItems: reference.min,
      referenceMaxItems: reference.max,
      bucketCounts,
      industryCounts: collection.stats?.industryCounts || {},
      ageCounts: collection.stats?.ageCounts || {},
      contentCounts: collection.stats?.contentCounts || {},
    });

    for (const [bucket, count] of Object.entries(bucketCounts)) {
      const current = bucketMap.get(bucket) || {
        bucket,
        currentTotal: 0,
        archivedItems: 0,
        archivedRuns: 0,
      };
      current.currentTotal += count;
      bucketMap.set(bucket, current);
    }
    for (const [label, count] of Object.entries(collection.stats?.industryCounts || {})) {
      const current = industryMap.get(label) || { label, currentTotal: 0, archivedItems: 0 };
      current.currentTotal += count;
      industryMap.set(label, current);
    }
    for (const [label, count] of Object.entries(collection.stats?.ageCounts || {})) {
      const current = ageMap.get(label) || { label, currentTotal: 0, archivedItems: 0 };
      current.currentTotal += count;
      ageMap.set(label, current);
    }
    for (const [label, count] of Object.entries(collection.stats?.contentCounts || {})) {
      const current = contentMap.get(label) || { label, currentTotal: 0, archivedItems: 0 };
      current.currentTotal += count;
      contentMap.set(label, current);
    }
  }

  for (const entry of store.archiveIndex || []) {
    const platformStats = platformMap.get(entry.platform) || {
      platform: entry.platform,
      currentTotal: 0,
      source: entry.source,
      singleRunCount: 0,
      singleRunTarget: entry.targetPerRun || 0,
      pageDepth: entry.pageDepth || 0,
      requestCount: entry.requestCount || 0,
      uniqueAuthors: 0,
      archivedRuns: 0,
      archivedItems: 0,
      referenceMinItems: entry.referenceMinItems || 0,
      referenceMaxItems: entry.referenceMaxItems || 0,
      bucketCounts: {},
      industryCounts: {},
      ageCounts: {},
      contentCounts: {},
    };
    platformStats.archivedRuns += 1;
    platformStats.referenceMinItems ||= entry.referenceMinItems || 0;
    platformStats.referenceMaxItems ||= entry.referenceMaxItems || 0;
    platformMap.set(entry.platform, platformStats);
  }

  for (const platform of growthPlatformValues) {
    const history = historyPlatforms[platform];
    if (!history) continue;
    const platformStats = platformMap.get(platform) || {
      platform,
      currentTotal: 0,
      source: undefined,
      singleRunCount: 0,
      singleRunTarget: 0,
      pageDepth: 0,
      requestCount: 0,
      uniqueAuthors: 0,
      archivedRuns: 0,
      archivedItems: 0,
      referenceMinItems: 0,
      referenceMaxItems: 0,
      bucketCounts: {},
      industryCounts: {},
      ageCounts: {},
      contentCounts: {},
    };
    platformStats.archivedItems = history.archivedItems || 0;
    platformMap.set(platform, platformStats);

    for (const [bucket, count] of Object.entries(history.bucketCounts || {})) {
      const current = bucketMap.get(bucket) || {
        bucket,
        currentTotal: 0,
        archivedItems: 0,
        archivedRuns: 0,
      };
      current.archivedItems = count;
      bucketMap.set(bucket, current);
    }

    for (const [label, count] of Object.entries(history.industryCounts || {})) {
      const current = industryMap.get(label) || { label, currentTotal: 0, archivedItems: 0 };
      current.archivedItems = count;
      industryMap.set(label, current);
    }

    for (const [label, count] of Object.entries(history.ageCounts || {})) {
      const current = ageMap.get(label) || { label, currentTotal: 0, archivedItems: 0 };
      current.archivedItems = count;
      ageMap.set(label, current);
    }

    for (const [label, count] of Object.entries(history.contentCounts || {})) {
      const current = contentMap.get(label) || { label, currentTotal: 0, archivedItems: 0 };
      current.archivedItems = count;
      contentMap.set(label, current);
    }
  }

  for (const [bucket, bucketStats] of Array.from(bucketMap.entries())) {
    bucketMap.set(bucket, bucketStats);
  }

  const platforms = Array.from(platformMap.values()).sort((left, right) => right.currentTotal - left.currentTotal);
  const buckets = Array.from(bucketMap.values()).sort((left, right) => right.currentTotal - left.currentTotal);
  const scheduler = Object.values(store.scheduler || {}).sort((left, right) => left.platform.localeCompare(right.platform));
  const coverageWindows = LOOKBACK_WINDOWS.map((days) => {
    const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
    const entries = (store.archiveIndex || []).filter((item) => {
      const time = new Date(item.archivedAt).getTime();
      return Number.isFinite(time) && time >= threshold;
    });
    const activePlatforms = historyPlatformKeys.filter((platform) => {
      const summary = historyPlatforms[platform];
      const lastSeenTime = new Date(summary?.lastSeenAt || 0).getTime();
      return Number.isFinite(lastSeenTime) && lastSeenTime >= threshold;
    }).length;
    const archivedItems = historyPlatformKeys.reduce((sum, platform) => {
      const summary = historyPlatforms[platform];
      const lastSeenTime = new Date(summary?.lastSeenAt || 0).getTime();
      if (Number.isFinite(lastSeenTime) && lastSeenTime >= threshold) {
        return sum + (summary?.archivedItems || 0);
      }
      return sum;
    }, 0);
    return {
      days,
      archivedItems,
      archivedRuns: entries.length,
      activePlatforms,
    };
  });
  const selectedCoverage =
    coverageWindows.find((window) => window.days === DEFAULT_SELECTED_WINDOW_DAYS) ||
    coverageWindows[coverageWindows.length - 1];

  return {
    updatedAt: store.updatedAt,
    totals: {
      currentItems: platforms.reduce((sum, item) => sum + item.currentTotal, 0),
      currentPlatforms: platforms.filter((item) => item.currentTotal > 0).length,
      archiveRuns: (store.archiveIndex || []).length,
      archivedItems: platforms.reduce((sum, item) => sum + item.archivedItems, 0),
      schedulerTrackedPlatforms: scheduler.length,
      burstEnterCount: scheduler.reduce((sum, item) => sum + (item.burstEnterCount || 0), 0),
      burstExitCount: scheduler.reduce((sum, item) => sum + (item.burstExitCount || 0), 0),
      burstActivePlatforms: scheduler.filter((item) => item.burstMode).length,
    },
    references: {
      schedulerIntervals: [
        { label: "周末 / 节假日 live", intervalHours: 0.33 },
        { label: "17:00-22:00", intervalHours: 2 },
        { label: "22:00-06:00", intervalHours: 3 },
        { label: "06:00-17:00", intervalHours: 4 },
        { label: "高波动 burst", intervalHours: 0.33 },
        { label: "历史回填 burst", intervalHours: 0.0083 },
      ],
      lookbackWindows: LOOKBACK_WINDOWS,
      perPlatform: Object.fromEntries(
        platforms.map((item) => [
          item.platform,
          {
            min: item.referenceMinItems,
            max: item.referenceMaxItems,
          },
        ]),
      ) as Partial<Record<GrowthPlatform, { min: number; max: number }>>,
    },
    coverage: {
      selectedWindowDays: selectedCoverage.days,
      reason: `${selectedCoverage.days} 天窗口为当前固定历史分析口径，用于优先沉淀近一年的平台样本。`,
      windows: coverageWindows,
    },
    platforms,
    buckets,
    industries: Array.from(industryMap.values()).sort((left, right) => right.currentTotal - left.currentTotal || right.archivedItems - left.archivedItems),
    ages: Array.from(ageMap.values()).sort((left, right) => right.currentTotal - left.currentTotal || right.archivedItems - left.archivedItems),
    contentTypes: Array.from(contentMap.values()).sort((left, right) => right.currentTotal - left.currentTotal || right.archivedItems - left.archivedItems),
    scheduler,
  };
}

export async function readTrendMailDigestState(): Promise<TrendMailDigestState> {
  const meta = await readRuntimeMeta();
  return meta.mailDigest || {};
}

export async function updateTrendMailDigestState(patch: Partial<TrendMailDigestState>) {
  const meta = await readRuntimeMeta();
  const mailDigest = {
    ...(meta.mailDigest || {}),
    ...patch,
  };
  await writeRuntimeMeta({
    updatedAt: nowShanghaiIso(),
    scheduler: meta.scheduler,
    backfillLive: meta.backfillLive,
    backfillHistory: meta.backfillHistory,
    mailDigest,
  });
  return mailDigest;
}

export async function exportTrendCollectionsCsv() {
  const store = await readTrendStore({ preferDerivedFiles: true });
  await ensureStoreDir();
  return exportTrendCollectionsCsvFromCollections(Object.values(store.collections));
}

export async function exportSingleTrendCollectionCsv(collection: PlatformTrendCollection) {
  await ensureStoreDir();
  return exportTrendCollectionsCsvFromCollections([collection]);
}

async function exportTrendCollectionsCsvFromCollections(
  collections: Array<PlatformTrendCollection | undefined>,
) {
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

  const createdAt = nowShanghaiIso().replace(/[:.]/g, "-");
  const files: Array<{ platform: GrowthPlatform; bucket: string; filePath: string; rows: number }> = [];
  let totalRows = 0;

  for (const collection of collections) {
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
          normalizeStringList(item.tags).join("|"),
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
