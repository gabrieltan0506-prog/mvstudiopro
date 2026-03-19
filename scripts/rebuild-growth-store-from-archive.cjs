#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const STORE_DIR = path.resolve(process.argv[2] || process.env.GROWTH_STORE_DIR || path.join(process.cwd(), ".cache", "growth"));
const LEGACY_STORE_FILE = path.resolve(
  process.env.GROWTH_LEGACY_STORE_FILE || path.join(path.dirname(STORE_DIR), "growth-trends.json"),
);
const ARCHIVE_DIR = path.join(STORE_DIR, "archive");
const PLATFORM_DIR = path.join(STORE_DIR, "platforms");
const HISTORY_LEDGER_DIR = path.join(STORE_DIR, "history-ledger");
const PLATFORM_ORDER = ["douyin", "xiaohongshu", "bilibili", "kuaishou", "toutiao", "weixin_channels"];
const WRITE_PLATFORM_EXPORTS = ["1", "true", "yes", "on"].includes(String(process.env.WRITE_GROWTH_PLATFORM_EXPORTS || "").toLowerCase());

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLabels(values) {
  return Array.from(new Set((values || []).map((value) => normalizeText(value)).filter(Boolean)));
}

function normalizeItem(item) {
  return {
    ...item,
    id: normalizeText(item?.id),
    title: normalizeText(item?.title),
    bucket: item?.bucket ? normalizeText(item.bucket) : undefined,
    author: item?.author ? normalizeText(item.author) : undefined,
    url: item?.url ? normalizeText(item.url) : undefined,
    tags: Array.from(new Set((item?.tags || []).map((value) => normalizeText(value)).filter(Boolean))),
  };
}

function getPlatformFromFile(file) {
  const base = path.basename(file);
  return PLATFORM_ORDER.find((platform) => base.startsWith(`${platform}-`) || file.includes(`/${platform}/`)) || null;
}

function getObservedAt(file, parsed) {
  const candidates = [
    parsed?.archivedAt,
    parsed?.collectedAt,
    parsed?.collection?.collectedAt,
    parsed?.collection?.archivedAt,
  ].map((value) => normalizeText(value)).filter(Boolean);
  if (candidates.length) return candidates.sort().at(-1);
  const dateDir = file.match(/archive\/(\d{4}-\d{2}-\d{2})\//)?.[1];
  if (dateDir) return `${dateDir}T00:00:00.000Z`;
  return new Date().toISOString();
}

function getSource(parsed) {
  return normalizeText(parsed?.source || parsed?.collection?.source || "archive-rebuild");
}

function getItems(parsed) {
  if (Array.isArray(parsed?.items)) return parsed.items;
  if (Array.isArray(parsed?.collection?.items)) return parsed.collection.items;
  if (Array.isArray(parsed)) return parsed;
  return [];
}

function getBucketCounts(items) {
  const counts = {};
  for (const raw of items) {
    const bucket = normalizeText(raw?.bucket || raw?.contentType || "default") || "default";
    counts[bucket] = (counts[bucket] || 0) + 1;
  }
  return counts;
}

function getItemKey(item) {
  const id = normalizeText(item?.id);
  if (id) return id;
  return `${normalizeText(item?.title)}::${normalizeText(item?.author)}::${normalizeText(item?.bucket || item?.contentType)}`;
}

function buildLedgerEntry(item, observedAt) {
  const normalized = normalizeItem(item);
  const key = getItemKey(normalized);
  if (!key || !normalized.title) return null;
  return {
    key,
    bucket: normalizeText(normalized.bucket || normalized.contentType || "default") || "default",
    industryLabels: normalizeLabels(normalized.industryLabels),
    ageLabels: normalizeLabels(normalized.ageLabels),
    contentLabels: normalizeLabels(normalized.contentLabels),
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
  };
}

function summarizeLedger(platform, ledger) {
  const bucketCounts = {};
  const industryCounts = {};
  const ageCounts = {};
  const contentCounts = {};
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

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function walk(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(absolute, files);
    else if (entry.isFile() && absolute.endsWith(".json")) files.push(absolute);
  }
  return files;
}

async function main() {
  await ensureDir(STORE_DIR);
  await ensureDir(HISTORY_LEDGER_DIR);

  const existingStorePath = path.join(STORE_DIR, "current.json");
  let existingStore = {
    scheduler: {},
    mailDigest: {},
  };
  try {
    existingStore = JSON.parse(await fs.readFile(existingStorePath, "utf8"));
  } catch {}

  const files = await walk(ARCHIVE_DIR);
  const archiveFiles = files.filter((file) => getPlatformFromFile(file));
  const platformCollections = new Map();
  const platformLedgers = new Map();
  const archiveIndex = [];

  for (const file of archiveFiles) {
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      continue;
    }
    const platform = getPlatformFromFile(file);
    if (!platform) continue;
    const observedAt = getObservedAt(file, parsed);
    const source = getSource(parsed);
    const rawItems = getItems(parsed).map((item) => normalizeItem(item)).filter((item) => item.id && item.title);
    const itemMap = platformCollections.get(platform)?.itemMap || new Map();
    const noteSet = platformCollections.get(platform)?.noteSet || new Set();
    const latest = platformCollections.get(platform)?.latestCollectedAt || "";
    const sourceForPlatform = platformCollections.get(platform)?.source || source;
    const windowDays = Math.max(platformCollections.get(platform)?.windowDays || 0, Number(parsed?.windowDays || parsed?.collection?.windowDays || 0) || 0);
    const requestCount = Math.max(platformCollections.get(platform)?.requestCount || 0, Number(parsed?.stats?.requestCount || parsed?.collection?.stats?.requestCount || 0) || 0);
    const pageDepth = Math.max(platformCollections.get(platform)?.pageDepth || 0, Number(parsed?.stats?.pageDepth || parsed?.collection?.stats?.pageDepth || 0) || 0);
    const targetPerRun = Math.max(platformCollections.get(platform)?.targetPerRun || 0, Number(parsed?.stats?.targetPerRun || parsed?.collection?.stats?.targetPerRun || 0) || 0);
    const referenceMinItems = Math.max(platformCollections.get(platform)?.referenceMinItems || 0, Number(parsed?.stats?.referenceMinItems || parsed?.collection?.stats?.referenceMinItems || 0) || 0);
    const referenceMaxItems = Math.max(platformCollections.get(platform)?.referenceMaxItems || 0, Number(parsed?.stats?.referenceMaxItems || parsed?.collection?.stats?.referenceMaxItems || 0) || 0);
    for (const note of [...(parsed?.notes || []), ...(parsed?.collection?.notes || [])]) {
      const normalized = normalizeText(note);
      if (normalized) noteSet.add(normalized);
    }
    for (const item of rawItems) {
      const current = itemMap.get(item.id);
      if (!current) {
        itemMap.set(item.id, item);
        continue;
      }
      itemMap.set(item.id, {
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

    const ledger = platformLedgers.get(platform) || {};
    for (const raw of rawItems) {
      const entry = buildLedgerEntry(raw, observedAt);
      if (!entry) continue;
      const current = ledger[entry.key];
      if (!current) {
        ledger[entry.key] = entry;
      } else {
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
    }
    platformLedgers.set(platform, ledger);

    const uniqueWithinFile = new Set(rawItems.map((item) => item.id)).size;
    archiveIndex.push({
      platform,
      bucket: Object.keys(getBucketCounts(rawItems)).sort().join("+") || "default",
      bucketCounts: getBucketCounts(rawItems),
      industryCounts: parsed?.stats?.industryCounts || parsed?.collection?.stats?.industryCounts || {},
      ageCounts: parsed?.stats?.ageCounts || parsed?.collection?.stats?.ageCounts || {},
      contentCounts: parsed?.stats?.contentCounts || parsed?.collection?.stats?.contentCounts || {},
      archivedAt: observedAt,
      source,
      itemCount: rawItems.length,
      dedupedCount: uniqueWithinFile,
      requestCount: Number(parsed?.stats?.requestCount || parsed?.collection?.stats?.requestCount || 0) || undefined,
      pageDepth: Number(parsed?.stats?.pageDepth || parsed?.collection?.stats?.pageDepth || 0) || undefined,
      targetPerRun: Number(parsed?.stats?.targetPerRun || parsed?.collection?.stats?.targetPerRun || 0) || undefined,
      referenceMinItems: Number(parsed?.stats?.referenceMinItems || parsed?.collection?.stats?.referenceMinItems || 0) || undefined,
      referenceMaxItems: Number(parsed?.stats?.referenceMaxItems || parsed?.collection?.stats?.referenceMaxItems || 0) || undefined,
      file,
    });

    platformCollections.set(platform, {
      itemMap,
      noteSet,
      latestCollectedAt: !latest || observedAt > latest ? observedAt : latest,
      source: sourceForPlatform || source,
      windowDays,
      requestCount,
      pageDepth,
      targetPerRun,
      referenceMinItems,
      referenceMaxItems,
    });
  }

  const collections = {};
  const historyPlatforms = {};
  const backfillPlatforms = [];
  const updatedAt = new Date().toISOString();

  for (const platform of PLATFORM_ORDER) {
    const state = platformCollections.get(platform);
    if (!state) continue;
    const items = sortItems(Array.from(state.itemMap.values()));
    const uniqueAuthors = new Set(items.map((item) => normalizeText(item.author)).filter(Boolean)).size;
    const bucketCounts = getBucketCounts(items);
    const industryCounts = {};
    const ageCounts = {};
    const contentCounts = {};
    for (const item of items) {
      for (const label of normalizeLabels(item.industryLabels)) industryCounts[label] = (industryCounts[label] || 0) + 1;
      for (const label of normalizeLabels(item.ageLabels)) ageCounts[label] = (ageCounts[label] || 0) + 1;
      for (const label of normalizeLabels(item.contentLabels)) contentCounts[label] = (contentCounts[label] || 0) + 1;
    }

    collections[platform] = {
      platform,
      source: state.source || "archive-rebuild",
      collectedAt: state.latestCollectedAt || updatedAt,
      windowDays: state.windowDays || 365,
      notes: Array.from(state.noteSet).slice(-50),
      items,
      stats: {
        itemCount: items.length,
        currentTotal: items.length,
        archivedTotal: items.length,
        bucketCounts,
        industryCounts,
        ageCounts,
        contentCounts,
        uniqueAuthorCount: uniqueAuthors,
        requestCount: state.requestCount || items.length,
        pageDepth: state.pageDepth || 0,
        targetPerRun: state.targetPerRun || items.length,
        referenceMinItems: state.referenceMinItems || 0,
        referenceMaxItems: state.referenceMaxItems || items.length,
      },
    };

    const ledger = platformLedgers.get(platform) || {};
    historyPlatforms[platform] = summarizeLedger(platform, ledger);
    backfillPlatforms.push({
      platform,
      target: items.length,
      currentTotal: items.length,
      archivedTotal: items.length,
      addedCount: 0,
      mergedCount: 0,
      plateauCount: 0,
      status: "done",
    });
  }

  archiveIndex.sort((left, right) => new Date(right.archivedAt).getTime() - new Date(left.archivedAt).getTime());

  const nextStore = {
    updatedAt,
    collections,
    scheduler: existingStore.scheduler || {},
    archiveIndex,
    history: {
      updatedAt,
      source: "ledger",
      platforms: historyPlatforms,
    },
    backfill: {
      active: false,
      startedAt: existingStore.backfill?.startedAt,
      updatedAt,
      finishedAt: updatedAt,
      currentRound: existingStore.backfill?.currentRound || 0,
      maxRounds: existingStore.backfill?.maxRounds || 0,
      targetPerPlatform: 0,
      selectedWindowDays: existingStore.backfill?.selectedWindowDays || 365,
      status: "completed",
      platforms: backfillPlatforms,
      note: "Rebuilt from archive directory",
    },
    mailDigest: existingStore.mailDigest || {},
  };

  const currentPath = path.join(STORE_DIR, "current.json");
  const currentTmpPath = path.join(STORE_DIR, "current.json.rebuild");
  await fs.writeFile(currentTmpPath, JSON.stringify(nextStore, null, 2), "utf8");
  await fs.rename(currentTmpPath, currentPath);
  try {
    await fs.unlink(LEGACY_STORE_FILE);
  } catch {}
  await fs.link(currentPath, LEGACY_STORE_FILE);

  if (WRITE_PLATFORM_EXPORTS) {
    await ensureDir(PLATFORM_DIR);
    for (const [platform, collection] of Object.entries(collections)) {
      await fs.writeFile(
        path.join(PLATFORM_DIR, `${platform}.json`),
        JSON.stringify({ updatedAt, platform, collection }, null, 2),
        "utf8",
      );
      const bucketDir = path.join(PLATFORM_DIR, platform);
      await ensureDir(bucketDir);
      const grouped = {};
      for (const item of collection.items) {
        const bucket = normalizeText(item.bucket || item.contentType || "default") || "default";
        (grouped[bucket] ||= []).push(item);
      }
      for (const [bucket, items] of Object.entries(grouped)) {
        await fs.writeFile(
          path.join(bucketDir, `${bucket}.json`),
          JSON.stringify({ updatedAt, platform, bucket, source: collection.source, collectedAt: collection.collectedAt, items }, null, 2),
          "utf8",
        );
      }
    }
  }

  await ensureDir(HISTORY_LEDGER_DIR);
  for (const platform of PLATFORM_ORDER) {
    const ledger = platformLedgers.get(platform) || {};
    await fs.writeFile(path.join(HISTORY_LEDGER_DIR, `${platform}.json`), JSON.stringify(ledger, null, 2), "utf8");
  }

  const totals = Object.fromEntries(
    Object.entries(collections).map(([platform, collection]) => [platform, collection.items.length]),
  );
  console.log(JSON.stringify({ storeDir: STORE_DIR, archiveFiles: archiveIndex.length, totals }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
