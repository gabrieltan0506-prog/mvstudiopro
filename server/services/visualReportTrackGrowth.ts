/**
 * Visual report「赛道热度」：有前窗對照時為樣本增速（>+100% 僅顯示「高热」）；前窗為 0 時用排序刻度 +12%～+98%，避免假峰值。
 */

import { getShanghaiVisualReportWindows } from "../growth/time.js";
import { normalizeStringList } from "../growth/trendNormalize";
import type { TrendItem } from "../growth/trendCollector";
import { inferTrendTrackBucketForVisualReport } from "../growth/trendGrowthScoring";

export type TrackGrowthRow = { name: string; growth: string; isHot?: boolean };

function itemTimeMs(item: any): number | null {
  const ts = item?.collectedAt || item?.publishedAt || item?.date || null;
  if (!ts) return null;
  const ms = new Date(String(ts)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** 与 generateVisualReport 一致：时间窗为 Asia/Shanghai（UTC+8）日界；无有效时间戳的样本不参与对照（避免归因错误） */
function collectIndustryWindowCounts(
  items: any[],
  bounds: {
    currentStart: number;
    currentEndExclusive: number;
    priorStart: number;
    priorEndExclusive: number;
  },
): { current: Map<string, number>; prior: Map<string, number> } {
  const current = new Map<string, number>();
  const prior = new Map<string, number>();

  for (const item of items) {
    const ms = itemTimeMs(item);
    if (ms == null) continue;

    let target: Map<string, number> | null = null;
    if (ms >= bounds.currentStart && ms < bounds.currentEndExclusive) target = current;
    else if (ms >= bounds.priorStart && ms < bounds.priorEndExclusive) target = prior;
    else continue;

    const keys = collectItemLabelKeys(item);
    for (const k of keys) {
      target.set(k, (target.get(k) || 0) + 1);
    }
  }

  return { current, prior };
}

/** 樣本推算增速 >100% 時的唯一展示文案（不出具體百分比或倍數） */
export const TRACK_GROWTH_HIGH_HEAT_LABEL = "高热";

/** 解析排序用：將「高热」視為略高於 +100%，僅供 filter / sort */
const HIGH_HEAT_SORT_VALUE = 101;

/** 垃圾桶占位：不在此做標題/評論斷詞，避免「熱詞碎片」混入賽道 Y 軸 */
const PLACEHOLDER_BUCKET = "其他/综合";

function isWeakTaxonomyLabel(s: string): boolean {
  return /待(判定|定)|未分类|^通用$|^其他$|^其他[／/]综合$/.test(String(s || "").trim());
}

/**
 * 單條樣本對統計桶的貢獻：**僅**使用入庫時已寫好的行業/內容分類（與 {@link trendTaxonomy} 一致）；
 * 若皆無，再退回到與增長評分共用的 {@link inferTrendTrackBucketForVisualReport}（規則化大類，仍非標題碎詞）。
 */
function collectItemLabelKeys(item: any): string[] {
  const out: string[] = [];

  for (const x of normalizeStringList(item?.industryLabels)) {
    const t = String(x || "").trim();
    if (t && !isWeakTaxonomyLabel(t)) out.push(t);
  }
  for (const x of normalizeStringList(item?.contentLabels)) {
    const t = String(x || "").trim();
    if (t && !isWeakTaxonomyLabel(t)) out.push(t);
  }

  const seen = new Set<string>();
  const dedup: string[] = [];
  for (const k of out) {
    const t = String(k || "").trim();
    if (!t) continue;
    const sig = t.replace(/\s+/g, "").toLowerCase();
    if (seen.has(sig)) continue;
    seen.add(sig);
    dedup.push(t);
  }

  if (dedup.length > 0) return dedup;

  try {
    const inferred = inferTrendTrackBucketForVisualReport(item as TrendItem).trim();
    if (inferred && !isWeakTaxonomyLabel(inferred)) return [inferred];
  } catch {
    /* ignore */
  }
  return [PLACEHOLDER_BUCKET];
}

function formatGrowthPct(pct: number): string {
  const rounded = Math.round(pct);
  if (rounded < 0) return `${rounded}%`;
  if (rounded === 0) return "+0%";
  if (rounded > 100) return TRACK_GROWTH_HIGH_HEAT_LABEL;
  return `+${rounded}%`;
}

/**
 * 由抓取样本推算展示用文案：
 * - 前窗 p>0：增速 (c-p)/p×100；**>100% 只显示「高热」**
 * - 前窗 p=0：多条时用 +12%～+98% 递减刻度；单条用 c/maxC 映射到约 +10%～+98%（与旧版一致）
 */
export function buildIndustryGrowthHintMap(
  store: { collections?: Partial<Record<string, { items?: any[] }>> },
  platforms: string[],
  windowDays: number,
  anchorMs?: number,
): Map<string, string> {
  const bounds = getShanghaiVisualReportWindows(windowDays, anchorMs ?? Date.now());
  const mergedCurrent = new Map<string, number>();
  const mergedPrior = new Map<string, number>();

  for (const platform of platforms) {
    const col = store.collections?.[platform];
    const items: any[] = col?.items || [];
    const { current, prior } = collectIndustryWindowCounts(items, bounds);
    for (const [k, v] of Array.from(current.entries())) mergedCurrent.set(k, (mergedCurrent.get(k) || 0) + v);
    for (const [k, v] of Array.from(prior.entries())) mergedPrior.set(k, (mergedPrior.get(k) || 0) + v);
  }

  const labels = new Set<string>([
    ...Array.from(mergedCurrent.keys()),
    ...Array.from(mergedPrior.keys()),
  ]);

  type Row = { label: string; c: number; p: number };
  const rows: Row[] = [];
  for (const label of Array.from(labels)) {
    const c = mergedCurrent.get(label) || 0;
    const p = mergedPrior.get(label) || 0;
    if (c <= 0 && p <= 0) continue;
    rows.push({ label, c, p });
  }

  const maxC = Math.max(...rows.map((r) => r.c), 0);

  const hintMap = new Map<string, string>();

  for (const { label, c, p } of rows) {
    if (p <= 0) continue;
    let pct = Math.round(((c - p) / p) * 100);
    pct = Math.max(-99, pct);
    hintMap.set(label, formatGrowthPct(pct));
  }

  const zeroPrior = rows.filter((r) => r.p <= 0 && r.c > 0);
  zeroPrior.sort((a, b) => b.c - a.c || a.label.localeCompare(b.label, "zh-Hans-CN"));

  if (zeroPrior.length === 1) {
    const { label, c } = zeroPrior[0];
    let pct = maxC > 0 ? Math.round(10 + 88 * (c / maxC)) : 88;
    pct = Math.max(-99, Math.min(400, pct));
    hintMap.set(label, formatGrowthPct(pct));
  } else if (zeroPrior.length > 1) {
    const m = zeroPrior.length;
    for (let i = 0; i < m; i++) {
      const pct = Math.round(12 + 86 * ((m - 1 - i) / Math.max(m - 1, 1)));
      const clamped = Math.max(-99, Math.min(400, pct));
      hintMap.set(zeroPrior[i].label, formatGrowthPct(clamped));
    }
  }

  return hintMap;
}

/** 賽道名無法對應到趨勢樣本 industryLabels 時的展示文案（非百分比，不編造數字） */
export const TRACK_GROWTH_NO_MATCH_LABEL = "无匹配样本";

function normCompact(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function bestHintForTrackName(name: string, hintMap: Map<string, string>): string | null {
  const n = normCompact(name);
  if (!n) return null;

  let bestScore = -1;
  let bestVal: string | null = null;
  const consider = (a: string, b: string, val: string) => {
    if (!a || !b) return;
    if (a.includes(b) || b.includes(a)) {
      const score = Math.min(a.length, b.length);
      if (score > bestScore) {
        bestScore = score;
        bestVal = val;
      }
    }
  };

  for (const [label, val] of Array.from(hintMap.entries())) {
    const ln = normCompact(label);
    consider(n, ln, val);

    const segments = name
      .split(/[/／·•、，,\|｜]+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2);
    for (const seg of segments) {
      const sn = normCompact(seg);
      consider(sn, ln, val);
    }
  }

  return bestVal;
}

/** 是否为可展示的短统计（+N%、高热、旧版倍数字符串；禁止 N/A、漏数据说明等） */
export function isValidGrowthString(g: string): boolean {
  const s = g.trim();
  if (!s) return false;
  if (/^n\/?a\b/i.test(s)) return false;
  if (/漏掉|缺失|无法计算|暂无|不明|未知|对比.*前\s*\d+|本[^\n]{0,6}数据/i.test(s)) return false;

  if (s === TRACK_GROWTH_HIGH_HEAT_LABEL) return true;
  const compact = s.replace(/\s/g, "");
  if (/^增长\d+(\.\d+)?倍$/.test(compact)) return true;
  return /^[+-]?\d+(\.\d+)?%?$/.test(compact);
}

export function normalizeGrowthDisplay(g: string): string {
  const compact = g.trim().replace(/\s/g, "").replace(/%$/g, "");
  const m = compact.match(/^([+-]?)(\d+(?:\.\d+)?)$/);
  if (!m) return g.trim();
  const sign = m[1] === "-" ? -1 : 1;
  const num = sign * Number(m[2]);
  if (!Number.isFinite(num)) return g.trim();
  const rounded = Math.round(num);
  return rounded >= 0 ? `+${rounded}%` : `${rounded}%`;
}

/** 解析趨勢排行中的百分比為帶符號整數（無效則 null）；"高热" 固定為 101 供排序 */
export function parseGrowthPercentToSignedInt(g: string): number | null {
  const raw = String(g || "").trim();
  if (raw === TRACK_GROWTH_HIGH_HEAT_LABEL) return HIGH_HEAT_SORT_VALUE;
  const times = raw.replace(/\s/g, "").match(/^增长(\d+(?:\.\d+)?)倍$/);
  if (times) {
    const mult = Number(times[1]);
    if (Number.isFinite(mult)) return Math.round(mult * 100);
  }
  const s = normalizeGrowthDisplay(raw);
  const compact = s.replace(/\s/g, "").replace(/%$/g, "");
  const m = compact.match(/^([+-]?)(\d+)$/);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const n = sign * Number(m[2]);
  return Number.isFinite(n) ? n : null;
}

function trackLabelOverlapsNegative(a: string, negCompact: string): boolean {
  const tn = normCompact(a);
  if (!tn || !negCompact) return false;
  if (tn.includes(negCompact) || negCompact.includes(tn)) return true;
  const segments = String(a)
    .split(/[/／·•、，,\|｜]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
  for (const seg of segments) {
    const sn = normCompact(seg);
    if (sn.includes(negCompact) || negCompact.includes(sn)) return true;
  }
  return false;
}

function passesHotTopicSampleHint(name: string, hintMap?: Map<string, string>): boolean {
  if (!hintMap || hintMap.size === 0) return true;
  const hintVal = bestHintForTrackName(name.trim(), hintMap);
  if (!hintVal) return true;
  const g = parseGrowthPercentToSignedInt(hintVal);
  return g == null || g >= 0;
}

/**
 * 全局「熱門賽道」展示：僅保留樣本統計為非負增長/熱度的列（剔除負增長與無匹配）。
 */
export function filterTrackGrowthHotOnly(rows: TrackGrowthRow[]): TrackGrowthRow[] {
  return rows
    .map((row) => ({
      row,
      g: parseGrowthPercentToSignedInt(String(row.growth || "").trim()),
    }))
    .filter((x) => x.g != null && x.g >= 0)
    .sort((a, b) => (b.g ?? 0) - (a.g ?? 0))
    .map((x) => x.row);
}

/**
 * 各平台「熱門賽道」不得與**全局** trackGrowth 中已標示為**負增長**的賽道語義重合；
 * 若提供 hintMap，另按樣本統計剔除名稱命中的**負向**桶。
 * 若過濾後條目過少，從全局正增長排行補齊。
 */
export function reconcilePlatformHotTopicsWithGlobalTrackGrowth(
  hotTopicsRaw: string[],
  globalTrackGrowth: TrackGrowthRow[],
  hintMap?: Map<string, string>,
): string[] {
  const base = hotTopicsRaw
    .map((raw) => String(raw || "").trim())
    .filter((t) => t.length > 0 && passesHotTopicSampleHint(t, hintMap));

  const negatives = globalTrackGrowth
    .map((r) => ({ name: String(r.name || "").trim(), growth: parseGrowthPercentToSignedInt(String(r.growth || "")) }))
    .filter((r) => r.name && r.growth != null && r.growth < 0);
  if (negatives.length === 0) return base.slice(0, 12);

  const negCompacts = negatives.map((r) => normCompact(r.name)).filter((s) => s.length >= 2);
  const filtered = base.filter((t) => !negCompacts.some((nc) => trackLabelOverlapsNegative(t, nc)));

  if (filtered.length >= 3) return filtered.slice(0, 12);

  const positives = globalTrackGrowth
    .map((r) => ({ name: String(r.name || "").trim(), growth: parseGrowthPercentToSignedInt(String(r.growth || "")) }))
    .filter((r) => r.name && r.growth != null && r.growth > 0);
  const merged: string[] = [...filtered];
  const seen = new Set(merged.map((x) => normCompact(x)));
  for (const p of positives) {
    if (merged.length >= 8) break;
    const nc = normCompact(p.name);
    if (!nc || seen.has(nc)) continue;
    if (negCompacts.some((neg) => trackLabelOverlapsNegative(p.name, neg))) continue;
    merged.push(p.name);
    seen.add(nc);
  }
  for (const h of base) {
    if (merged.length >= 8) break;
    const t = String(h || "").trim();
    if (!t) continue;
    const nc = normCompact(t);
    if (seen.has(nc)) continue;
    if (negCompacts.some((neg) => trackLabelOverlapsNegative(t, neg))) continue;
    merged.push(t);
    seen.add(nc);
  }
  return merged.slice(0, 12);
}

/**
 * 報表展示用：>+100% 一律收斂為「高热」（兼容舊緩存「增长X倍」）。
 * repairTrackGrowthRows 仅以趋势库样本统计表对齐；此函数再统一展示口径。
 */
export function finalizeTrackGrowthDisplayString(growth: string): string {
  const s = String(growth || "").trim();
  if (!s || s === TRACK_GROWTH_NO_MATCH_LABEL) return s;
  if (s === TRACK_GROWTH_HIGH_HEAT_LABEL) return s;
  const n = parseGrowthPercentToSignedInt(s);
  if (n == null) return s;
  if (n > 100) return TRACK_GROWTH_HIGH_HEAT_LABEL;
  return formatGrowthPct(n);
}

export function repairTrackGrowthRows(rows: TrackGrowthRow[], hintMap: Map<string, string>): TrackGrowthRow[] {
  return rows.map((row) => {
    const name = String(row.name || "").trim();
    const fromHint = name ? bestHintForTrackName(name, hintMap) : null;
    const growth =
      fromHint != null ? finalizeTrackGrowthDisplayString(fromHint) : TRACK_GROWTH_NO_MATCH_LABEL;
    return { ...row, growth };
  });
}
