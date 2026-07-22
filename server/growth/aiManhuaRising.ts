import type { DouyinDramaKind, TrendItem } from "./trendCollector";
import {
  AI_MANHUA_RISING_BOARD_LIMIT,
  buildManhuaDramaDisplayTagsZh,
  isManhuaDramaMixCandidate,
  manhuaDramaCategoryLabelZh,
  type ManhuaDramaPlatform,
} from "../../shared/manhuaDramaClassify";

export type AiManhuaRisingEntry = {
  mixId: string;
  mixName: string;
  dramaKind: DouyinDramaKind;
  /** 前台类别：AI漫剧 / 短剧合集 / 待判定 */
  categoryLabelZh: string;
  /** 题材软标签 */
  tagLabelsZh: string[];
  platform: ManhuaDramaPlatform;
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
  platform: ManhuaDramaPlatform;
  windowDays: number;
  generatedAt: string;
  hasBaseline: boolean;
  /** 读库失败等运维说明（可空） */
  note: string;
  storeReadFailed?: boolean;
  entries: AiManhuaRisingEntry[];
};

export type AiManhuaRisingByPlatform = {
  douyin: AiManhuaRisingBoard;
  kuaishou: AiManhuaRisingBoard;
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

function isDramaMixCandidate(item: TrendItem, platform: ManhuaDramaPlatform): boolean {
  return isManhuaDramaMixCandidate({
    isDrama: item.isDrama,
    dramaKind: item.dramaKind,
    mixId: item.dramaInfo?.mixId,
    mixName: item.dramaInfo?.mixName,
    title: item.title,
    tags: item.tags,
    totalEpisodes: item.dramaInfo?.totalEpisodes,
    currentEpisode: item.dramaInfo?.currentEpisode,
    platform,
  });
}

function fallbackSearchUrl(platform: ManhuaDramaPlatform, mixName: string): string | undefined {
  const name = String(mixName || "").trim();
  if (!name) return undefined;
  if (platform === "douyin") {
    return `https://www.douyin.com/search/${encodeURIComponent(name)}`;
  }
  // 快手：有剧名可给搜索页；真正合集链优先用条目 url
  return `https://www.kuaishou.com/search/video?searchKey=${encodeURIComponent(name)}`;
}

function proxyPlayCount(item: TrendItem): number {
  const mixPlay = Number(item.dramaInfo?.mixPlayCount || 0);
  if (mixPlay > 0) return mixPlay;
  const views = Number(item.views || 0);
  const likes = Number(item.likes || 0);
  return Math.max(views, likes * 20, 0);
}

/** 按 mixId 聚合短剧/漫剧样本，产出飙升榜（有基线则算环比） */
export function buildAiManhuaRisingBoard(params: {
  items: TrendItem[];
  baselineItems?: TrendItem[];
  windowDays?: number;
  limit?: number;
  nowIso?: string;
  platform?: ManhuaDramaPlatform;
  /** 读库失败时透传给前端空态 */
  storeReadFailed?: boolean;
  noteOverride?: string;
}): AiManhuaRisingBoard {
  const platform = params.platform || "douyin";
  const windowDays = Math.max(3, Math.min(30, Number(params.windowDays) || 7));
  // 1–15 部均可展示（默认最多 15；不足亦展示）
  const limit = Math.max(
    1,
    Math.min(AI_MANHUA_RISING_BOARD_LIMIT, Number(params.limit) || AI_MANHUA_RISING_BOARD_LIMIT),
  );
  const now = params.nowIso ? new Date(params.nowIso) : new Date();
  const cutoffMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  if (params.storeReadFailed) {
    return {
      platform,
      windowDays,
      generatedAt: now.toISOString(),
      hasBaseline: false,
      storeReadFailed: true,
      note: params.noteOverride || "趋势库读取超时，暂未拿到合集样本，请稍后重试分析。",
      entries: [],
    };
  }

  const baselineByMix = new Map<string, number>();
  for (const item of params.baselineItems || []) {
    if (!isDramaMixCandidate(item, platform)) continue;
    const mixId = String(item.dramaInfo?.mixId || "").trim();
    if (!mixId) continue;
    const play = Number(item.dramaInfo?.mixPlayCount || 0);
    baselineByMix.set(mixId, Math.max(baselineByMix.get(mixId) || 0, play));
  }

  type Agg = {
    mixId: string;
    mixName: string;
    dramaKind: DouyinDramaKind;
    tagLabelsZh: string[];
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
    if (!isDramaMixCandidate(item, platform)) continue;
    const mixId = String(item.dramaInfo?.mixId || "").trim();
    // 剧名只用合集名，禁止用短视频文案标题冒充剧名
    const mixName = String(item.dramaInfo?.mixName || "").trim();
    if (!mixName) continue;
    const key = mixId || mixName;
    const publishedMs = item.publishedAt ? new Date(item.publishedAt).getTime() : NaN;
    const publishedWithin7d = Number.isFinite(publishedMs) && publishedMs >= cutoffMs;
    const prev = byMix.get(key);
    const mixPlayCount = Math.max(proxyPlayCount(item), prev?.mixPlayCount || 0);
    const nextKind =
      item.dramaKind === "ai_manhua" || prev?.dramaKind === "ai_manhua"
        ? "ai_manhua"
        : item.dramaKind === "short_drama" || prev?.dramaKind === "short_drama"
          ? "short_drama"
          : ((item.dramaKind || prev?.dramaKind || "unknown") as DouyinDramaKind);
    const tags = buildManhuaDramaDisplayTagsZh(
      nextKind,
      `${mixName} ${item.title || ""}`,
      item.tags || [],
    );
    const mergedTags = Array.from(new Set([...(prev?.tagLabelsZh || []), ...tags])).slice(0, 5);
    // 快手：优先保留已有样本链；无链不在此处硬编假合集页
    const nextUrl =
      platform === "kuaishou"
        ? (item.url || prev?.url || undefined)
        : (item.url || prev?.url);
    byMix.set(key, {
      mixId: key,
      mixName: mixName || prev?.mixName || key,
      dramaKind: nextKind,
      tagLabelsZh: mergedTags,
      mixPlayCount,
      episodeSample: item.dramaInfo?.currentEpisode ?? prev?.episodeSample,
      totalEpisodes:
        Math.max(item.dramaInfo?.totalEpisodes || 0, prev?.totalEpisodes || 0) || undefined,
      sampleTitle: item.title || prev?.sampleTitle,
      author: item.author || prev?.author,
      url: nextUrl,
      publishedWithin7d: Boolean(prev?.publishedWithin7d || publishedWithin7d),
    });
  }

  const hasBaseline = baselineByMix.size > 0;
  const entries: AiManhuaRisingEntry[] = Array.from(byMix.values())
    .map((agg) => {
      const baseline = baselineByMix.has(agg.mixId) ? baselineByMix.get(agg.mixId) || 0 : null;
      const delta7d = baseline == null ? null : Math.max(0, agg.mixPlayCount - baseline);
      const risingScore =
        delta7d != null
          ? delta7d * 10 + agg.mixPlayCount
          : agg.mixPlayCount +
            (agg.publishedWithin7d ? Math.max(10_000, agg.mixPlayCount * 0.05) : 0);
      // 抖音无样本链时用搜索页兜底；快手无链不硬编假链（UI 展示剧名/类别/标签）
      const url =
        agg.url
        || (platform === "douyin" ? fallbackSearchUrl("douyin", agg.mixName) : undefined);
      return {
        mixId: agg.mixId,
        mixName: agg.mixName,
        dramaKind: agg.dramaKind,
        categoryLabelZh: manhuaDramaCategoryLabelZh(agg.dramaKind),
        tagLabelsZh: agg.tagLabelsZh,
        platform,
        mixPlayCount: agg.mixPlayCount,
        delta7d,
        risingScore,
        episodeSample: agg.episodeSample,
        totalEpisodes: agg.totalEpisodes,
        sampleTitle: agg.sampleTitle,
        author: agg.author,
        url,
        status: pickStatus({
          delta7d,
          mixPlayCount: agg.mixPlayCount,
          publishedWithin7d: agg.publishedWithin7d,
        }),
      };
    })
    .sort((a, b) => b.risingScore - a.risingScore || b.mixPlayCount - a.mixPlayCount)
    .slice(0, limit);

  const defaultNote = hasBaseline
    ? `已对比约 ${windowDays} 天前档案合集播放量，按环比增量排序。`
    : platform === "kuaishou"
      ? `快手暂无合集基线；按近窗播放/互动代理排序。有样本链可点开；无链仍展示剧名、类别与标签。`
      : `暂无 ${windowDays} 天前档案基线；当前按合集总播放与近窗新集加权排序。连续抓取后可显示环比飙升。`;

  return {
    platform,
    windowDays,
    generatedAt: now.toISOString(),
    hasBaseline,
    note: params.noteOverride || defaultNote,
    entries,
  };
}

export function buildAiManhuaRisingByPlatform(params: {
  douyinItems: TrendItem[];
  kuaishouItems: TrendItem[];
  douyinBaselineItems?: TrendItem[];
  windowDays?: number;
  limit?: number;
  storeReadFailed?: boolean;
}): AiManhuaRisingByPlatform {
  const common = {
    windowDays: params.windowDays,
    limit: params.limit ?? AI_MANHUA_RISING_BOARD_LIMIT,
    storeReadFailed: params.storeReadFailed,
  };
  return {
    douyin: buildAiManhuaRisingBoard({
      ...common,
      platform: "douyin",
      items: params.douyinItems,
      baselineItems: params.douyinBaselineItems,
    }),
    kuaishou: buildAiManhuaRisingBoard({
      ...common,
      platform: "kuaishou",
      items: params.kuaishouItems,
      baselineItems: [],
    }),
  };
}
