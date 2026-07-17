import type { DouyinDramaKind, TrendItem } from "./trendCollector";

export type AiManhuaRisingEntry = {
  mixId: string;
  mixName: string;
  dramaKind: DouyinDramaKind;
  mixPlayCount: number;
  /** 相对基线（约 7 天前）的合集播放增量；无基线时为 null */
  delta7d: number | null;
  /** 用于排序的综合分：优先环比增量，否则用当前合集播放 */
  risingScore: number;
  episodeSample?: number;
  totalEpisodes?: number;
  sampleTitle?: string;
  author?: string;
  url?: string;
  status: "surging" | "hot" | "new" | "steady";
};

export type AiManhuaRisingBoard = {
  windowDays: number;
  generatedAt: string;
  hasBaseline: boolean;
  note: string;
  entries: AiManhuaRisingEntry[];
};

function pickStatus(entry: {
  delta7d: number | null;
  mixPlayCount: number;
  publishedWithin7d: boolean;
}): AiManhuaRisingEntry["status"] {
  if (entry.delta7d != null) {
    if (entry.delta7d >= Math.max(50_000, entry.mixPlayCount * 0.15)) return "surging";
    if (entry.delta7d > 0) return "hot";
    return "steady";
  }
  if (entry.publishedWithin7d) return "new";
  if (entry.mixPlayCount >= 1_000_000) return "hot";
  return "steady";
}

function isAiManhuaCandidate(item: TrendItem): boolean {
  if (!item.isDrama && !item.dramaInfo) return false;
  if (item.dramaKind === "ai_manhua") return true;
  if (item.dramaKind === "short_drama") return false;
  // unknown：标题/合集名再扫一遍，避免漏掉搜索词命中但未写 kind 的样本
  const hay = `${item.dramaInfo?.mixName || ""} ${item.title || ""} ${(item.tags || []).join(" ")}`;
  return /AI\s*漫剧|AI漫|动态漫|漫剧|AI\s*短剧/i.test(hay);
}

/** 按 mixId 聚合抖音短剧/漫剧样本，产出 7 天飙升榜（有基线则算环比） */
export function buildAiManhuaRisingBoard(params: {
  items: TrendItem[];
  baselineItems?: TrendItem[];
  windowDays?: number;
  limit?: number;
  nowIso?: string;
}): AiManhuaRisingBoard {
  const windowDays = Math.max(3, Math.min(30, Number(params.windowDays) || 7));
  const limit = Math.max(3, Math.min(30, Number(params.limit) || 10));
  const now = params.nowIso ? new Date(params.nowIso) : new Date();
  const cutoffMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  const baselineByMix = new Map<string, number>();
  for (const item of params.baselineItems || []) {
    if (!isAiManhuaCandidate(item)) continue;
    const mixId = String(item.dramaInfo?.mixId || "").trim();
    if (!mixId) continue;
    const play = Number(item.dramaInfo?.mixPlayCount || 0);
    baselineByMix.set(mixId, Math.max(baselineByMix.get(mixId) || 0, play));
  }

  type Agg = {
    mixId: string;
    mixName: string;
    dramaKind: DouyinDramaKind;
    mixPlayCount: number;
    episodeSample?: number;
    totalEpisodes?: number;
    sampleTitle?: string;
    author?: string;
    url?: string;
    publishedWithin7d: boolean;
  };

  const byMix = new Map<string, Agg>();
  for (const item of params.items) {
    if (!isAiManhuaCandidate(item)) continue;
    const mixId = String(item.dramaInfo?.mixId || "").trim();
    const mixName = String(item.dramaInfo?.mixName || item.title || "").trim();
    if (!mixId && !mixName) continue;
    const key = mixId || mixName;
    const publishedMs = item.publishedAt ? new Date(item.publishedAt).getTime() : NaN;
    const publishedWithin7d = Number.isFinite(publishedMs) && publishedMs >= cutoffMs;
    const prev = byMix.get(key);
    const mixPlayCount = Math.max(
      Number(item.dramaInfo?.mixPlayCount || 0),
      prev?.mixPlayCount || 0,
    );
    byMix.set(key, {
      mixId: key,
      mixName: mixName || prev?.mixName || key,
      dramaKind: item.dramaKind === "ai_manhua" || prev?.dramaKind === "ai_manhua"
        ? "ai_manhua"
        : (item.dramaKind || prev?.dramaKind || "unknown"),
      mixPlayCount,
      episodeSample: item.dramaInfo?.currentEpisode ?? prev?.episodeSample,
      totalEpisodes: Math.max(
        item.dramaInfo?.totalEpisodes || 0,
        prev?.totalEpisodes || 0,
      ) || undefined,
      sampleTitle: item.title || prev?.sampleTitle,
      author: item.author || prev?.author,
      url: item.url || prev?.url,
      publishedWithin7d: Boolean(prev?.publishedWithin7d || publishedWithin7d),
    });
  }

  const hasBaseline = baselineByMix.size > 0;
  const entries: AiManhuaRisingEntry[] = Array.from(byMix.values())
    .map((agg) => {
      const baseline = baselineByMix.has(agg.mixId) ? (baselineByMix.get(agg.mixId) || 0) : null;
      const delta7d = baseline == null ? null : Math.max(0, agg.mixPlayCount - baseline);
      const risingScore = delta7d != null
        ? delta7d * 10 + agg.mixPlayCount
        : agg.mixPlayCount + (agg.publishedWithin7d ? Math.max(10_000, agg.mixPlayCount * 0.05) : 0);
      return {
        mixId: agg.mixId,
        mixName: agg.mixName,
        dramaKind: agg.dramaKind,
        mixPlayCount: agg.mixPlayCount,
        delta7d,
        risingScore,
        episodeSample: agg.episodeSample,
        totalEpisodes: agg.totalEpisodes,
        sampleTitle: agg.sampleTitle,
        author: agg.author,
        url: agg.url
          || (agg.mixName
            ? `https://www.douyin.com/search/${encodeURIComponent(agg.mixName)}`
            : undefined),
        status: pickStatus({ delta7d, mixPlayCount: agg.mixPlayCount, publishedWithin7d: agg.publishedWithin7d }),
      };
    })
    .sort((a, b) => b.risingScore - a.risingScore || b.mixPlayCount - a.mixPlayCount)
    .slice(0, limit);

  return {
    windowDays,
    generatedAt: now.toISOString(),
    hasBaseline,
    note: hasBaseline
      ? `已对比约 ${windowDays} 天前档案合集播放量，按环比增量排序。`
      : `暂无 ${windowDays} 天前档案基线；当前按合集总播放与近窗新集加权排序。连续抓取后可显示环比飙升。`,
    entries,
  };
}
