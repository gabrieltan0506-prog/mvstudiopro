/** 新创作按本轮主题扫描真实库；内存只留有界候选，原库不改写。 */
import fs from "node:fs/promises";
import path from "node:path";
import { streamTrendCollection } from "./trendCollectionStream";
import { xhsRelevanceQuery, isUnrequestedFiction } from "../../shared/xhsContentStrategy";
import type { TrendItem } from "./trendCollector";

const cache = new Map<string, { at: number; value: QueryResult }>();
const pending = new Map<string, Promise<QueryResult>>();
let active = 0;
const waiting: Array<() => void> = [];
async function acquireReader(signal: AbortSignal) {
  signal.throwIfAborted();
  if (active < 2) { active++; return; }
  if (waiting.length >= 8) throw new Error("trend_query_busy");
  await new Promise<void>((resolve, reject) => {
    const abort = () => { const index = waiting.indexOf(start); if (index >= 0) waiting.splice(index, 1); reject(signal.reason); };
    const start = () => { signal.removeEventListener("abort", abort); active++; resolve(); };
    waiting.push(start); signal.addEventListener("abort", abort, {once:true});
  });
}
function releaseReader() { active--; waiting.shift()?.(); }
type QueryResult = { items: TrendItem[]; queryCoverage: { totalItems: number; matchedItems: number } };
const stamp = (row: TrendItem) => {
  const raw = row.publishedAt || row.observedAt;
  if (!raw) return NaN;
  const text = String(raw);
  if (/^\d{10}(?:\d{3})?$/.test(text)) return Number(text) * (text.length === 10 ? 1000 : 1);
  return /^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:?\d{2}))?$/.test(text) ? Date.parse(text) : NaN;
};
export async function queryTrendShortlist(root: string, platform: "xiaohongshu" | "douyin", context: string, windowDays = 30, now = Date.now()): Promise<QueryResult> {
  const { terms, focus } = xhsRelevanceQuery(context);
  const selectedTerms = Array.from(new Set([...Array.from(focus), ...terms])).slice(0, 100);
  if (!selectedTerms.length) return { items: [], queryCoverage: { totalItems: 0, matchedItems: 0 } };
  const base = path.join(root, "platform-current", `${platform}.current.json`);
  const file = await fs.stat(`${base}.gz`).then(() => `${base}.gz`).catch(() => base);
  const stat = await fs.stat(file);
  const days = Number.isFinite(windowDays) ? Math.max(1, Math.min(365, windowDays)) : 30;
  const key = JSON.stringify([file, stat.mtimeMs, stat.size, context, days, Math.floor(now / 60_000)]);
  const hit = cache.get(key);
  if (hit && now - hit.at < 60_000) return hit.value;
  const running = pending.get(key);
  if (running) return running;
  // 最多两路读盘；短队列共享同一个总截止时间，避免并发用户直接丢掉可用数据。
  const signal = AbortSignal.timeout(60_000);
  const work = (async () => {
    await acquireReader(signal);
    try {
      type Candidate = { row: TrendItem; score: number };
      const buckets = selectedTerms.map(() => [] as Candidate[]);
      let matchedItems = 0;
      const totalItems = await streamTrendCollection(file, header => {
        if (header.collection.platform !== platform || /recovered|archive|csv/i.test(header.collection.source)) throw new Error("选题来源不是实时采集库");
      }, row => {
        if (!row.id || !row.title) return;
        const at = stamp(row);
        if (!Number.isFinite(at) || at < now - days * 86400000 || at > now) return;
        const title = String(row.title).slice(0, 2000);
        const tags = Array.isArray(row.tags) ? row.tags.map(String).slice(0, 100).map(tag => tag.slice(0, 200)) : [];
        const source = [title, ...tags].join(" ").toLowerCase();
        if (isUnrequestedFiction(context, source)) return;
        const matches = selectedTerms.map((term, i) => source.includes(term) ? i : -1).filter(i => i >= 0);
        if (!matches.length || (focus.size && !matches.some(i => focus.has(selectedTerms[i])))) return;
        matchedItems++;
        const score = matches.reduce((sum, i) => sum + (focus.has(selectedTerms[i]) ? 3 : 1), 0) / (0.6 + 0.4 * Math.max(1, source.length / 120));
        const slim: TrendItem = { id: String(row.id), title, tags, url: row.url, publishedAt: row.publishedAt, observedAt: row.observedAt, likes: row.likes, comments: row.comments };
        const candidate = { row: slim, score };
        for (const i of matches) {
          const bucket = buckets[i];
          const prior = bucket.findIndex(entry => entry.row.id === String(row.id));
          if (prior >= 0) { if (bucket[prior].score >= score) continue; bucket.splice(prior, 1); }
          if (bucket.length === 24 && bucket[bucket.length - 1].score > score) continue;
          bucket.push(candidate);
          bucket.sort((a, b) => b.score - a.score || Number(b.row.likes || 0) - Number(a.row.likes || 0) || a.row.id.localeCompare(b.row.id));
          if (bucket.length > 24) bucket.pop();
        }
      }, signal);
      const unique = new Map<string, TrendItem>();
      let bytes = 0;
      // 轮流取每个查询词的候选，低频主题不会被高频主题挤空。
      for (let n = 0; n < 24; n++) for (const bucket of buckets) {
        const row = bucket[n]?.row;
        if (row && !unique.has(row.id) && unique.size < 600) {
          const size = Buffer.byteLength(JSON.stringify(row));
          if (bytes + size <= 4 * 1024 * 1024) { unique.set(row.id, row); bytes += size; }
        }
      }
      const value = { items: Array.from(unique.values()), queryCoverage: { totalItems, matchedItems } };
      if (cache.size >= 8) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: now, value });
      return value;
    } finally { releaseReader(); }
  })().finally(() => { pending.delete(key); });
  pending.set(key, work);
  return work;
}
