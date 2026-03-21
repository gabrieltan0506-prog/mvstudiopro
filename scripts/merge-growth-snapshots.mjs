import fs from "node:fs/promises";

function safeTags(tags) {
  return Array.isArray(tags) ? tags.map((tag) => String(tag || "").trim()).filter(Boolean) : [];
}

function normalizeItem(item) {
  return {
    ...item,
    id: String(item?.id || "").trim(),
    title: String(item?.title || "").trim(),
    bucket: item?.bucket ? String(item.bucket).trim() : undefined,
    author: item?.author ? String(item.author).trim() : undefined,
    url: item?.url ? String(item.url).trim() : undefined,
    tags: Array.from(new Set(safeTags(item?.tags))),
  };
}

function sortItems(items) {
  return [...items].sort((left, right) => {
    const rightWeight = right.hotValue || right.likes || right.views || 0;
    const leftWeight = left.hotValue || left.likes || left.views || 0;
    if (rightWeight !== leftWeight) return rightWeight - leftWeight;
    return new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime();
  });
}

function dedupeTrendItems(existing = [], incoming = []) {
  const bucket = new Map();
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
      tags: Array.from(new Set([...(safeTags(current.tags)), ...(safeTags(item.tags))])),
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

function mergeCollection(current, recovered) {
  if (!current && !recovered) return undefined;
  if (!current) {
    const items = dedupeTrendItems([], recovered?.items || []);
    return {
      ...recovered,
      items,
      stats: { ...(recovered?.stats || {}), currentTotal: items.length, itemCount: items.length },
    };
  }
  if (!recovered) return current;
  const items = dedupeTrendItems(current.items || [], recovered.items || []);
  return {
    ...current,
    ...recovered,
    platform: recovered.platform || current.platform,
    source: [current.source, recovered.source].filter(Boolean).join("+"),
    collectedAt: new Date().toISOString(),
    windowDays: Math.max(current.windowDays || 0, recovered.windowDays || 0) || current.windowDays || recovered.windowDays,
    notes: Array.from(
      new Set([
        ...(Array.isArray(current.notes) ? current.notes : []),
        ...(Array.isArray(recovered.notes) ? recovered.notes : []),
        "Merged in GitHub Actions via dedupe-union recovery",
      ]),
    ),
    items,
    stats: { ...(current.stats || {}), ...(recovered.stats || {}), currentTotal: items.length, itemCount: items.length },
  };
}

const [currentPath, recoveredPath, outputPath] = process.argv.slice(2);

if (!currentPath || !recoveredPath || !outputPath) {
  console.error("Usage: node scripts/merge-growth-snapshots.mjs <current.json> <recovered.json> <output.json>");
  process.exit(1);
}

const currentStore = JSON.parse(await fs.readFile(currentPath, "utf8"));
const recoveredStore = JSON.parse(await fs.readFile(recoveredPath, "utf8"));

const nextStore = {
  ...currentStore,
  updatedAt: new Date().toISOString(),
  collections: { ...(currentStore.collections || {}) },
};

const summary = {};
for (const platform of new Set([
  ...Object.keys(currentStore.collections || {}),
  ...Object.keys(recoveredStore.collections || {}),
])) {
  const current = currentStore.collections?.[platform];
  const recovered = recoveredStore.collections?.[platform];
  const merged = mergeCollection(current, recovered);
  if (!merged) continue;
  nextStore.collections[platform] = merged;
  summary[platform] = {
    current: current?.items?.length || 0,
    recovered: recovered?.items?.length || 0,
    merged: merged?.items?.length || 0,
  };
}

await fs.writeFile(outputPath, JSON.stringify(nextStore));
console.log(JSON.stringify({ ok: true, outputPath, summary }, null, 2));
