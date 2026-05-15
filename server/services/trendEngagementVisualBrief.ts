/**
 * 封面管線專用：從 trendStore 樣本壓一段「高互動／增長潛力」參考標題，供 {@link runPlatformTopicImagePipeline}
 * 與中文視覺提煉／英文化對齊縮略圖鉤子（非帳號實測 CTR）。
 */
import type { GrowthPlatform } from "@shared/growth";
import type { TrendItem } from "../growth/trendCollector.js";
import { readTrendStoreForPlatforms } from "../growth/trendStore.js";
import { selectByGrowthPotential } from "../growth/trendGrowthScoring.js";

const PLATFORM_LABEL_ZH: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "B 站",
  kuaishou: "快手",
  weixin_channels: "视频号",
  toutiao: "今日头条",
};

function readTrendItemTimestampMs(item: TrendItem | Record<string, unknown>): number | null {
  const it = item as Record<string, unknown>;
  const ts =
    it.collectedAt ??
    it.collected_at ??
    it.publishedAt ??
    it.published_at ??
    it.createdAt ??
    it.created_at ??
    it.date ??
    null;
  if (!ts) return null;
  const ms = new Date(String(ts)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function resolveTrendCoverDecisionWindowDays(platformKey: string, windowDaysFallback = 15): number {
  if (platformKey === "douyin" || platformKey === "kuaishou") return 5;
  if (platformKey === "bilibili" || platformKey === "xiaohongshu") return 15;
  return windowDaysFallback;
}

function engagementProxyScore(item: TrendItem): number {
  const c = Number(item.comments ?? 0) || 0;
  const s = Number(item.shares ?? 0) || 0;
  const l = Number(item.likes ?? 0) || 0;
  return c * 4 + s * 6 + l * 0.3;
}

/**
 * 僅将「有明确互动热量」的样本送入封面/对齐 prompt（可 `TREND_BRIEF_MIN_HEAT_SCORE` 覆寫，預設 18）。
 * 避免赞转评全接近零的条目混进「高互动参考」。
 */
function itemPassesEngagementFloor(item: TrendItem): boolean {
  const minScore = Math.max(
    0,
    Math.floor(Number(process.env.TREND_BRIEF_MIN_HEAT_SCORE) || 18),
  );
  const c = Number(item.comments ?? 0) || 0;
  const s = Number(item.shares ?? 0) || 0;
  const l = Number(item.likes ?? 0) || 0;
  if (engagementProxyScore(item) >= minScore) return true;
  if (c >= 2 || s >= 1) return true;
  if (l >= 80) return true;
  return false;
}

/** Stage2 / 校驗用：僅保留達互動閾值的樣本（與封面 {@link buildTrendEngagementVisualBriefForPlatform} 一致）。 */
export function filterTrendItemsWithEngagementFloor(items: TrendItem[]): TrendItem[] {
  return (items || []).filter(itemPassesEngagementFloor);
}

/** 單平台：高互動參考標題若干行（簡中），供拼入封面 Context。 */
export function buildTrendEngagementVisualBriefForPlatform(params: {
  platformKey: string;
  items: TrendItem[];
  windowDaysFallback?: number;
  linesMax?: number;
}): string {
  const decisionWindowDays = resolveTrendCoverDecisionWindowDays(params.platformKey, params.windowDaysFallback ?? 15);
  const linesMax = params.linesMax ?? 5;
  const items = params.items || [];
  const cutoffMs = Date.now() - decisionWindowDays * 24 * 60 * 60 * 1000;
  const filtered = items.filter((item) => {
    const ms = readTrendItemTimestampMs(item);
    if (!ms) return true;
    return ms >= cutoffMs;
  });
  const evidence = filtered.length > 0 ? filtered : items;
  const heatedEvidence = evidence.filter(itemPassesEngagementFloor);
  /** 互動全不達標則本平臺不輸出「高互動參考」，避免低熱樣本污染封面語境 */
  if (heatedEvidence.length === 0) return "";

  const { selected } = selectByGrowthPotential(heatedEvidence, {
    topN: Math.max(linesMax, 8),
    windowDays: decisionWindowDays,
  });

  type Line = { title: string; category?: string; isBreakout?: boolean; source: "ranked" | "proxy" };
  let lines: Line[] = [];
  if (selected.length > 0) {
    lines = selected
      .filter((s) => itemPassesEngagementFloor(s.item))
      .slice(0, linesMax)
      .map((s) => ({
        title: String(s.item.title || "").trim(),
        category: s.category,
        isBreakout: s.isBreakout,
        source: "ranked",
      }));
  }
  if (lines.length === 0) {
    lines = [...heatedEvidence]
      .filter((it) => String(it.title || "").trim())
      .sort((a, b) => engagementProxyScore(b) - engagementProxyScore(a))
      .slice(0, linesMax)
      .map((it) => ({
        title: String(it.title || "").trim(),
        source: "proxy" as const,
      }));
  }

  lines = lines.filter((l) => l.title);
  if (lines.length === 0) return "";

  const zh = PLATFORM_LABEL_ZH[params.platformKey] || params.platformKey;
  const body = lines
    .map((l, i) => {
      const bits: string[] = [];
      if (l.category) bits.push(l.category);
      if (l.isBreakout) bits.push("同账号爆发信号");
      if (l.source === "proxy") bits.push("互动粗排");
      const tail = bits.length ? ` · ${bits.join(" · ")}` : "";
      return `${i + 1}. ${l.title.slice(0, 88)}${tail}`;
    })
    .join("\n");

  return (
    `「${zh}」近${decisionWindowDays}天·高互动/增长潜力参考标题（trendStore 抓取样本，非账号实测 CTR；封面须对齐其「视觉好奇心与信息冲击」结构，禁止照抄字面）\n` +
    body
  );
}

export function buildMergedTrendEngagementVisualBrief(params: {
  collections: Record<string, { items?: TrendItem[] } | undefined>;
  platformsKeyCsv: string;
  maxPlatforms?: number;
  linesPerPlatform?: number;
  maxTotalChars?: number;
}): string {
  const maxPlatforms = params.maxPlatforms ?? 2;
  const linesPerPlatform = params.linesPerPlatform ?? 4;
  const maxTotalChars = params.maxTotalChars ?? 2400;
  const cols = params.collections || {};

  const keysFromCsv = String(params.platformsKeyCsv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const uniq: string[] = [];
  for (const k of keysFromCsv) {
    if (!uniq.includes(k)) uniq.push(k);
  }

  let useKeys = uniq.slice(0, maxPlatforms);
  if (useKeys.length === 0) {
    const hot = ["douyin", "xiaohongshu", "bilibili", "kuaishou"].filter((k) => (cols[k]?.items?.length || 0) > 0);
    useKeys = hot.slice(0, maxPlatforms);
  }

  const chunks: string[] = [];
  for (const pk of useKeys) {
    const items = cols[pk]?.items;
    if (!items?.length) continue;
    const chunk = buildTrendEngagementVisualBriefForPlatform({
      platformKey: pk,
      items,
      linesMax: linesPerPlatform,
    });
    if (chunk) chunks.push(chunk);
  }

  if (chunks.length === 0) {
    const all = Object.keys(cols).filter((k) => (cols[k]?.items?.length || 0) > 0);
    for (const pk of all.slice(0, maxPlatforms)) {
      const items = cols[pk]?.items;
      if (!items?.length) continue;
      const chunk = buildTrendEngagementVisualBriefForPlatform({
        platformKey: pk,
        items,
        linesMax: linesPerPlatform,
      });
      if (chunk) chunks.push(chunk);
    }
  }

  if (chunks.length === 0) return "";

  const header =
    "【高互动样本·封面视觉钩子对齐（抓取数据）】\n以下从用户 Stage2 所选平台的 trendStore 样本抽取；请借鉴缩略图「对立/具体/悬念/单主体冲击」之张力；须服从本题 Hook 与人设。\n\n";
  let out = header + chunks.join("\n\n");
  if (out.length > maxTotalChars) out = `${out.slice(0, maxTotalChars)}…`;
  return out;
}

/** 讀取 trendStore 並按快照 platformsKey 合併簡短摘要（失敗返回空字串）。 */
export async function loadMergedTrendEngagementVisualBriefForUserSnapshot(params: {
  platformsKeyCsv: string;
  preferFlyLive?: boolean;
}): Promise<string> {
  const csv = String(params.platformsKeyCsv || "").trim();
  const keysFromCsv = csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const uniq: string[] = [];
  for (const k of keysFromCsv) {
    if (!uniq.includes(k)) uniq.push(k);
  }
  const want = (
    uniq.length > 0 ? uniq : ["douyin", "xiaohongshu", "bilibili", "kuaishou"]
  ) as GrowthPlatform[];

  try {
    const store = await readTrendStoreForPlatforms(want, {
      preferDerivedFiles: true,
      preferFlyLive: Boolean(params.preferFlyLive),
    });
    const cols = (store?.collections || {}) as Record<string, { items?: TrendItem[] } | undefined>;
    return buildMergedTrendEngagementVisualBrief({
      collections: cols,
      platformsKeyCsv: csv || want.join(","),
      maxPlatforms: 2,
      linesPerPlatform: 4,
    });
  } catch {
    return "";
  }
}
