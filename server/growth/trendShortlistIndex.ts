/** 选题只读取有上限的近期参考池，禁止在交互请求里展开数十万条完整采集记录。 */
import fs from "node:fs/promises";
import path from "node:path";
import { streamTrendCollection } from "./trendCollectionStream";
import type { GrowthPlatform } from "../../shared/growth";
import type { PlatformTrendCollection, TrendItem } from "./trendCollector";

export const SHORTLIST_INDEX_LIMIT = 12_000;
const MAX_BYTES = 12 * 1024 * 1024;
const VERSION = 2;
type Candidate = { row: TrendItem; at: number; hot: number; order: number };
type Coverage = { totalItems: number; indexedItems: number; selection: "recent-and-diverse" };
type CollectionMeta = Pick<PlatformTrendCollection, "platform" | "source" | "collectedAt" | "windowDays">;
export type ShortlistCollection = CollectionMeta & { items: TrendItem[]; notes: string[]; shortlistCoverage?: Coverage };
const rank = (a: Candidate, b: Candidate) => a.at - b.at || a.hot - b.hot || b.order - a.order;
const isRecovered = (source: string) => /recovered|archive|csv/i.test(source);

export function createTrendShortlistAccumulator(collection: CollectionMeta, updatedAt: string, limit = SHORTLIST_INDEX_LIMIT) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > SHORTLIST_INDEX_LIMIT) throw new Error("选题参考池容量无效");
  const heap: Candidate[] = [];
  const diverse: Candidate[] = [];
  // 一半近期热帖、一半按稳定ID散列取样；避免某天大批采集单一账号挤走其他领域。
  const recentLimit = Math.ceil(limit / 2), diverseLimit = Math.floor(limit / 2);
  const hash = (id: string) => { let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return h >>> 0; };
  const offer = (target: Candidate[], candidate: Candidate, cap: number, compare: typeof rank) => {
    if (!cap) return;
    if (target.length < cap) {
      target.push(candidate);
      let i = target.length - 1;
      while (i > 0) { const parent = (i - 1) >> 1; if (compare(target[parent], target[i]) <= 0) break; [target[parent], target[i]] = [target[i], target[parent]]; i = parent; }
    } else if (compare(candidate, target[0]) > 0) {
      target[0] = candidate;
      let i = 0;
      while (i * 2 + 1 < target.length) {
        let child = i * 2 + 1;
        if (child + 1 < target.length && compare(target[child + 1], target[child]) < 0) child++;
        if (compare(target[i], target[child]) <= 0) break;
        [target[i], target[child]] = [target[child], target[i]]; i = child;
      }
    }
  };
  let totalItems = 0;
  const add = (original: TrendItem) => {
    const order = totalItems++;
    if (!original?.title || !original.id) return;
    const row: TrendItem = { id: original.id, title: original.title, url: original.url, publishedAt: original.publishedAt, observedAt: original.observedAt,
      likes: original.likes, comments: original.comments, hotValue: original.hotValue, tags: original.tags };
    const raw = row.publishedAt || row.observedAt;
    const stamp = raw ? Date.parse(raw) : NaN;
    const candidate = { row, at: Number.isFinite(stamp) ? stamp : -Infinity, hot: Number(row.hotValue || row.likes || 0) || 0, order };
    offer(heap, candidate, limit, rank);
    // 多样样本仍按明确时间限定近一年；更短窗口由消费者严格筛选。
    const ceiling = Date.parse(updatedAt);
    if (candidate.at <= ceiling && candidate.at >= ceiling - 365 * 86400000)
      offer(diverse, { ...candidate, hot: hash(row.id) }, diverseLimit, (a, b) => a.hot - b.hot || rank(a, b));
  };
  const finish = () => {
  const items: TrendItem[] = [];
  let bytes = 4096;
  const recent = [...heap].sort((a, b) => rank(b, a));
  const unique = new Map([...recent.slice(0, recentLimit), ...diverse].map(candidate => [candidate.row.id, candidate]));
  for (const candidate of recent) { if (unique.size >= limit) break; if (!unique.has(candidate.row.id)) unique.set(candidate.row.id, candidate); }
  for (const { row } of Array.from(unique.values()).sort((a, b) => b.at - a.at || Number(b.row.likes || 0) - Number(a.row.likes || 0))) {
    const slim: TrendItem = { id: row.id, title: row.title, url: row.url, publishedAt: row.publishedAt, observedAt: row.observedAt,
      likes: row.likes, comments: row.comments, hotValue: row.hotValue, tags: row.tags };
    const size = Buffer.byteLength(JSON.stringify(slim)) + 1;
    if (bytes + size > MAX_BYTES) break;
    items.push(slim); bytes += size;
  }
  const shortlistCoverage: Coverage = { totalItems, indexedItems: items.length, selection: "recent-and-diverse" };
  const sampled: ShortlistCollection = { platform: collection.platform, source: collection.source, collectedAt: collection.collectedAt,
    windowDays: collection.windowDays, items, notes: ["选题参考池含近期样本与跨主题分散抽样，不代表平台全量。"],
    shortlistCoverage };
  return { version: VERSION, updatedAt, collection: sampled };
  };
  return { add, finish };
}

export function buildTrendShortlistIndex(collection: PlatformTrendCollection, updatedAt: string, limit = SHORTLIST_INDEX_LIMIT) {
  const accumulator = createTrendShortlistAccumulator(collection, updatedAt, limit);
  for (const item of collection.items) accumulator.add(item);
  return accumulator.finish();
}

async function saveIndex(root: string, index: ReturnType<typeof buildTrendShortlistIndex>) {
  const dir = path.join(root, "shortlist");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${index.collection.platform}.json`);
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.next`;
  try {
    const payload = JSON.stringify(index);
    if (Buffer.byteLength(payload) > MAX_BYTES) throw new Error("选题参考池文件超出容量");
    await fs.writeFile(temp, payload, { flag: "wx" });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}

export async function writeTrendShortlistIndex(root: string, collection: PlatformTrendCollection, updatedAt: string) {
  const dir = path.join(root, "shortlist");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${collection.platform}.json`);
  if (isRecovered(collection.source)) { await fs.rm(file, { force: true }); return; }
  await saveIndex(root, buildTrendShortlistIndex(collection, updatedAt));
}

export async function readTrendShortlistIndex(root: string, platform: GrowthPlatform): Promise<ShortlistCollection> {
  const file = path.join(root, "shortlist", `${platform}.json`);
  let size: number;
  try { size = (await fs.stat(file)).size; } catch { throw new Error("shortlist_index_not_ready"); }
  if (size > MAX_BYTES || size < 2) throw new Error("shortlist_index_invalid");
  const payload = JSON.parse(await fs.readFile(file, "utf8")) as ReturnType<typeof buildTrendShortlistIndex>;
  if (payload.version !== VERSION || payload.collection?.platform !== platform || !Array.isArray(payload.collection.items) ||
      payload.collection.items.length > SHORTLIST_INDEX_LIMIT || isRecovered(payload.collection.source)) throw new Error("shortlist_index_invalid");
  return payload.collection;
}

const warming = new Map<string, Promise<void>>();
/** 旧库首次启动逐条初始化；同一平台只跑一次，原库字节不修改。 */
export function ensureTrendShortlistIndex(root: string, platform: GrowthPlatform, outputRoot = root): Promise<void> {
  const key = `${root}:${outputRoot}:${platform}`;
  const existing = warming.get(key);
  if (existing) return existing;
  const work = (async () => {
    try { await readTrendShortlistIndex(outputRoot, platform); return; } catch { /* 缺失/损坏时只从真实采集库重建。 */ }
    const base = path.join(root, "platform-current", `${platform}.current.json`);
    const file = await fs.stat(`${base}.gz`).then(() => `${base}.gz`).catch(() => base);
    let accumulator: ReturnType<typeof createTrendShortlistAccumulator> | undefined;
    await streamTrendCollection(file, header => {
      if (header.collection.platform !== platform || isRecovered(header.collection.source)) throw new Error("选题来源不是实时采集库");
      accumulator = createTrendShortlistAccumulator(header.collection, header.updatedAt);
    }, item => accumulator!.add(item), AbortSignal.timeout(5 * 60_000));
    if (!accumulator) throw new Error("选题参考池初始化失败");
    // 若采集期间已写入新索引，旧快照不能倒灌覆盖。
    try { await readTrendShortlistIndex(outputRoot, platform); return; } catch {}
    await saveIndex(outputRoot, accumulator.finish());
  })().finally(() => warming.delete(key));
  warming.set(key, work);
  return work;
}
