import type { GrowthAnalysisScores } from "@shared/growth";
import { readTrendStoreForPlatforms } from "../growth/trendStore.js";
import {
  buildMergedTrendEngagementVisualBrief,
  resolveTrendCoverDecisionWindowDays,
} from "./trendEngagementVisualBrief.js";
import type { TrendItem } from "../growth/trendCollector.js";
import {
  OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE,
  runOptimizeCustomCopyLlm,
  type OptimizeCustomCopyResult,
} from "./platformOptimizeCustomCopy.js";

const DEFAULT_PLATFORMS = ["douyin", "xiaohongshu", "bilibili", "kuaishou"] as const;

export type OptimizeCustomCopyWithAssetsInput = {
  sourceText: string;
  optimizationBrief?: string;
  /** growth_analyze_images Job 输出的 analysis 对象 */
  visionAnalysis?: GrowthAnalysisScores | Record<string, unknown> | null;
  windowDays?: 7 | 15;
};

export type OptimizeCustomCopyWithAssetsResult = OptimizeCustomCopyResult & {
  visionAttached: boolean;
  trendBriefUsed: boolean;
  trendWindowDays: number;
  trendPlatforms: string[];
  trendSampleCount: number;
  debug: {
    trendFetchMs: number;
    trendBriefChars: number;
    visionFieldCount: number;
  };
};

const ASSETS_SYSTEM_PREFIX = `【素材绑定模式】
你已收到：(1) 用户上传封面/分镜的视觉分析 JSON；(2) 可选的近期平台热点样本（须标注来源窗口）。
硬性要求：
- 优化稿必须**绑定视觉分析**中的画面、主标、分镜节奏与人设，禁止替换成电竞/京剧/泛化爆款套话。
- 若提供了近期热点标题，仅作**结构参考**（钩子类型、信息密度），禁止照抄字面；须在 platformNotes 或 optimizedMarkdown 末尾注明「参考热点来源：平台名 + 近 N 天样本」。
- 若无近期样本，在 optimizedMarkdown 中写一句「暂无近期 live 样本，本次仅基于上传素材与用户原文优化」。
- 禁止调用或模拟 getGrowthSnapshot / titleExecutions 模板复读。

`;

function summarizeVisionAnalysis(raw: GrowthAnalysisScores | Record<string, unknown> | null | undefined): string {
  if (!raw || typeof raw !== "object") return "";
  const a = raw as Record<string, unknown>;
  const pick = {
    summary: a.summary,
    visualSummary: a.visualSummary,
    openingFrameAssessment: a.openingFrameAssessment,
    sceneConsistency: a.sceneConsistency,
    strengths: Array.isArray(a.strengths) ? (a.strengths as string[]).slice(0, 6) : [],
    improvements: Array.isArray(a.improvements) ? (a.improvements as string[]).slice(0, 6) : [],
    platforms: Array.isArray(a.platforms) ? (a.platforms as string[]).slice(0, 6) : [],
    titleSuggestions: Array.isArray(a.titleSuggestions) ? (a.titleSuggestions as string[]).slice(0, 6) : [],
    realityCheck: a.realityCheck,
    reverseEngineering: a.reverseEngineering,
    premiumContent: a.premiumContent,
  };
  try {
    return JSON.stringify(pick, null, 2);
  } catch {
    return String(a.summary || a.visualSummary || "").slice(0, 4000);
  }
}

function countVisionFields(raw: GrowthAnalysisScores | Record<string, unknown> | null | undefined): number {
  const text = summarizeVisionAnalysis(raw);
  if (!text) return 0;
  try {
    return Object.keys(JSON.parse(text) as object).length;
  } catch {
    return 1;
  }
}

function filterItemsByWindow(items: TrendItem[], platformKey: string, windowDays: number): TrendItem[] {
  const effectiveDays = Math.min(windowDays, resolveTrendCoverDecisionWindowDays(platformKey, windowDays));
  const cutoffMs = Date.now() - effectiveDays * 24 * 60 * 60 * 1000;
  return items.filter((item) => {
    const ts =
      item.collectedAt ??
      (item as Record<string, unknown>).publishedAt ??
      (item as Record<string, unknown>).createdAt;
    if (!ts) return true;
    const ms = new Date(String(ts)).getTime();
    return Number.isFinite(ms) ? ms >= cutoffMs : true;
  });
}

async function loadLiveTrendBrief(windowDays: 7 | 15): Promise<{
  brief: string;
  trendBriefUsed: boolean;
  trendPlatforms: string[];
  trendSampleCount: number;
  trendFetchMs: number;
}> {
  const t0 = Date.now();
  const platforms = [...DEFAULT_PLATFORMS];
  const storeNull = { collections: {} } as Awaited<ReturnType<typeof readTrendStoreForPlatforms>>;
  const store = await Promise.race([
    readTrendStoreForPlatforms(platforms, { preferDerivedFiles: true, preferFlyLive: true }),
    new Promise<Awaited<ReturnType<typeof readTrendStoreForPlatforms>>>((resolve) =>
      setTimeout(() => resolve(storeNull), 20_000),
    ),
  ]).catch(() => storeNull);

  const cols = (store?.collections || {}) as Record<string, { items?: TrendItem[] } | undefined>;
  const windowedCols: Record<string, { items?: TrendItem[] }> = {};
  let trendSampleCount = 0;
  for (const pk of platforms) {
    const items = cols[pk]?.items || [];
    const filtered = filterItemsByWindow(items, pk, windowDays);
    if (filtered.length) {
      windowedCols[pk] = { items: filtered };
      trendSampleCount += filtered.length;
    }
  }

  const brief = buildMergedTrendEngagementVisualBrief({
    collections: windowedCols,
    platformsKeyCsv: platforms.join(","),
    maxPlatforms: 4,
    linesPerPlatform: 3,
    maxTotalChars: 2200,
  });

  const trendFetchMs = Date.now() - t0;
  if (!brief.trim()) {
    return {
      brief: `【近期热点】暂无近 ${windowDays} 天 live 样本（trendStore 为空或样本未达互动阈值），请仅基于上传素材视觉分析与用户原文优化，并在稿末注明。`,
      trendBriefUsed: false,
      trendPlatforms: platforms,
      trendSampleCount: 0,
      trendFetchMs,
    };
  }

  return {
    brief: `【近期热点 · 近 ${windowDays} 天 live 样本（trendStore，非套话模板）】\n${brief}`,
    trendBriefUsed: true,
    trendPlatforms: platforms,
    trendSampleCount,
    trendFetchMs,
  };
}

function buildWithAssetsUserBlock(
  input: OptimizeCustomCopyWithAssetsInput,
  visionJson: string,
  trendBrief: string,
): string {
  const sourceText = String(input.sourceText || "").trim();
  const brief = String(input.optimizationBrief || "").trim();
  const parts = [
    ASSETS_SYSTEM_PREFIX.trim(),
    "",
    "【待优化原文】",
    sourceText,
  ];
  if (brief) {
    parts.push("", "【用户优化要求】", brief);
  }
  if (visionJson) {
    parts.push("", "【上传素材 · GPT-5.5 视觉分析 JSON】", visionJson);
  }
  if (trendBrief) {
    parts.push("", trendBrief);
  }
  return parts.join("\n");
}

export async function optimizeCustomCopyWithAssets(
  input: OptimizeCustomCopyWithAssetsInput,
): Promise<OptimizeCustomCopyWithAssetsResult> {
  const sourceText = String(input.sourceText || "").trim();
  if (sourceText.length < 10) {
    throw new Error("请至少提供 10 字以上的待优化文案");
  }

  const windowDays = input.windowDays === 15 ? 15 : 7;
  const visionJson = summarizeVisionAnalysis(input.visionAnalysis);
  const visionAttached = Boolean(visionJson.trim());

  if (!visionAttached) {
    throw new Error("请先完成素材视觉分析，或提供 visionAnalysis");
  }

  const trend = await loadLiveTrendBrief(windowDays);
  const userBlock = buildWithAssetsUserBlock(input, visionJson, trend.brief);

  try {
    const result = await runOptimizeCustomCopyLlm(userBlock);
    return {
      ...result,
      visionAttached,
      trendBriefUsed: trend.trendBriefUsed,
      trendWindowDays: windowDays,
      trendPlatforms: trend.trendPlatforms,
      trendSampleCount: trend.trendSampleCount,
      debug: {
        trendFetchMs: trend.trendFetchMs,
        trendBriefChars: trend.brief.length,
        visionFieldCount: countVisionFields(input.visionAnalysis),
      },
    };
  } catch (err) {
    if (err instanceof Error && err.message === OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE) {
      throw err;
    }
    throw new Error(OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE);
  }
}
