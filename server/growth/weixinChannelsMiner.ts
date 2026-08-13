import { createHash } from "node:crypto";
import { z } from "zod";
import type { GrowthPlatform } from "@shared/growth";
import {
  normalizeWeixinChannelsText,
  qualifyWeixinChannelsObservationLocally,
  WEIXIN_CHANNELS_AGGREGATION_MAX_ITEMS,
  WEIXIN_CHANNELS_ACCUMULATION_TARGET,
  WEIXIN_CHANNELS_LUNA_BATCH_SIZE,
  WEIXIN_CHANNELS_TERRA_INPUT_TOKEN_BUDGET,
  WEIXIN_CHANNELS_TERRA_MAX_COMPLETION_TOKENS,
  type WeixinChannelsCommentSample,
} from "@shared/weixinChannelsRules";
import { extractFirstChoicePlainText, extractJsonString, invokeLLM, type InvokeResult } from "../_core/llm";
import type { PlatformTrendCollection, TrendItem } from "./trendCollector";
import { selectByGrowthPotential } from "./trendGrowthScoring";
import { nowShanghaiIso } from "./time";

export {
  qualifyWeixinChannelsObservationLocally,
  WEIXIN_CHANNELS_AGGREGATION_MAX_ITEMS,
  WEIXIN_CHANNELS_ACCUMULATION_TARGET,
  WEIXIN_CHANNELS_LUNA_BATCH_SIZE,
  WEIXIN_CHANNELS_TERRA_INPUT_TOKEN_BUDGET,
  WEIXIN_CHANNELS_TERRA_MAX_COMPLETION_TOKENS,
};

export const WEIXIN_CHANNELS_BATCH_MODEL = "gpt-5.6-luna" as const;
export const WEIXIN_CHANNELS_BATCH_REASONING = "low" as const;
export const WEIXIN_CHANNELS_FINAL_MODEL = "gpt-5.6-terra" as const;
export const WEIXIN_CHANNELS_FINAL_REASONING = "high" as const;

/** 只从仍在 Fly 采集的平台产生视频号搜索任务；历史快手/头条数据仍可读取。 */
const SOURCE_PLATFORMS: GrowthPlatform[] = ["douyin", "xiaohongshu", "bilibili"];

export type WeixinChannelsCandidate = {
  taskId: string;
  sourcePlatform: GrowthPlatform;
  sourceItemId: string;
  sourceTitle: string;
  sourceAuthor?: string;
  category: string;
  sourceGrowthScore: number;
  sourceGrowthPercentile: number;
  sourceMetrics: Pick<TrendItem, "likes" | "comments" | "shares" | "views">;
  searchQueries: string[];
  createdAt: string;
};

export type WeixinChannelsObservation = {
  observationId: string;
  taskId: string;
  query: string;
  resultRank: number;
  title: string;
  author?: string;
  url?: string;
  publishedAt?: string;
  observedAt: string;
  likes?: number;
  comments?: number;
  shares?: number;
  favorites?: number;
  views?: number;
  followers?: number;
  friendsFollowing?: number;
  commentSamples?: WeixinChannelsCommentSample[];
  /** 20%/50%/80% 等位置的本机 OCR 文本；只存真实识别结果。 */
  ocrTexts?: string[];
  videoDurationSec?: number;
  captureBudgetMs?: number;
  captureElapsedMs?: number;
  evidence: "capture" | "manual";
  /** probe 仍真实入库，但与正式 1,000–2,000 条累计隔离。 */
  runKind?: "formal" | "probe";
  scanned?: true;
  qualified?: boolean;
  invalid?: boolean;
  qualificationReason?: string;
  aggregationJobId?: string;
  consumedAt?: string;
  growthMergedAt?: string;
};

export type PersistedWeixinChannelsObservation = WeixinChannelsObservation & {
  scanned: true;
  qualified: boolean;
  invalid: boolean;
  qualificationReason: string;
};

export type LunaBatchResult = {
  clusters: unknown[];
  duplicates: string[];
  categories: unknown[];
  keywords: unknown[];
  commentTopics: unknown[];
};

export type LunaBatch = {
  batchId: string;
  jobId: string;
  observationIds: string[];
  status: "pending" | "running" | "completed" | "failed";
  attempt: number;
  provider?: "evolink" | "openai";
  model: typeof WEIXIN_CHANNELS_BATCH_MODEL;
  reasoningEffort: typeof WEIXIN_CHANNELS_BATCH_REASONING;
  result?: LunaBatchResult;
  usage?: { inputTokens?: number; outputTokens?: number };
  error?: string;
  updatedAt: string;
};

export type FinalAnalysisJob = {
  jobId: string;
  kind: "formal" | "probe";
  threshold: number;
  rawCount: number;
  locallyDedupedCount: number;
  observationIds: string[];
  /** 本地清洗去重并通过上下文预算后，真正发送给 Terra 的记录。 */
  analysisObservationIds?: string[];
  lunaBatchIds: string[];
  status: "pending" | "processing" | "paused" | "completed" | "failed";
  claimToken?: string;
  terraProvider?: "evolink" | "openai";
  terraModel: typeof WEIXIN_CHANNELS_FINAL_MODEL;
  reasoningEffort: typeof WEIXIN_CHANNELS_FINAL_REASONING;
  finalResult?: unknown;
  usage?: { inputTokens?: number; outputTokens?: number };
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

function stableId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function finiteMetric(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function cleanQuery(title: string) {
  return String(title || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[#＃@＠][^\s#＃@＠]+/g, " ")
    .replace(/[\s\u200b]+/g, " ")
    .trim()
    .slice(0, 80);
}

/** 从真实热点标题抽取垂类词并追加高意图后缀；不维护固定种子列表。 */
export function buildWeixinChannelsSearchQueries(title: string) {
  const base = cleanQuery(title);
  const queries = [base];
  const matches = base.match(/(?:AI|Ai|ai|人工智能)\s*(?:真人短剧|漫剧|动漫|视频|短剧)/g) || [];
  for (const raw of matches) {
    const term = raw.replace(/^人工智能/i, "AI").replace(/^ai/i, "AI").replace(/\s+/g, "");
    queries.push(term);
    if (/真人短剧$/.test(term)) queries.push(`${term}教程`, `${term}批量生成`);
    if (/漫剧$/.test(term)) queries.push(`${term}教程`, `${term}全流程`, `${term}变现`);
  }
  return Array.from(new Set(queries.filter(Boolean))).slice(0, 6);
}

export function buildWeixinChannelsCandidateQueue(
  collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>,
  options?: { perPlatform?: number; windowDays?: number; now?: string },
): WeixinChannelsCandidate[] {
  const createdAt = options?.now || nowShanghaiIso();
  const candidates: WeixinChannelsCandidate[] = [];
  for (const platform of SOURCE_PLATFORMS) {
    const collection = collections[platform];
    if (!collection?.items?.length) continue;
    const { selected } = selectByGrowthPotential(collection.items, {
      topN: options?.perPlatform ?? 8,
      windowDays: options?.windowDays ?? 18,
    });
    for (const scored of selected) {
      const query = cleanQuery(scored.item.title);
      if (!query) continue;
      candidates.push({
        taskId: stableId("wxct", `${platform}:${scored.item.id}:${query}`),
        sourcePlatform: platform,
        sourceItemId: scored.item.id,
        sourceTitle: scored.item.title,
        sourceAuthor: scored.item.author,
        category: scored.category,
        sourceGrowthScore: Number(scored.growthScore.toFixed(2)),
        sourceGrowthPercentile: scored.growthPercentile,
        sourceMetrics: {
          likes: finiteMetric(scored.item.likes),
          comments: finiteMetric(scored.item.comments),
          shares: finiteMetric(scored.item.shares),
          views: finiteMetric(scored.item.views),
        },
        searchQueries: buildWeixinChannelsSearchQueries(query),
        createdAt,
      });
    }
  }
  return candidates
    .sort((left, right) => right.sourceGrowthScore - left.sourceGrowthScore)
    .filter((candidate, index, all) => {
      const key = cleanQuery(candidate.sourceTitle).toLowerCase();
      return all.findIndex((item) => cleanQuery(item.sourceTitle).toLowerCase() === key) === index;
    });
}

export function persistableWeixinChannelsObservation(
  item: WeixinChannelsObservation,
): PersistedWeixinChannelsObservation {
  const qualification = qualifyWeixinChannelsObservationLocally(item);
  return {
    ...item,
    runKind: item.runKind === "probe" ? "probe" : "formal",
    scanned: true,
    qualified: qualification.qualified,
    invalid: qualification.invalid,
    qualificationReason: qualification.reason,
    commentSamples: qualification.requiresComments
      ? item.commentSamples?.filter((sample) => sample.text.trim()).slice(0, 20)
      : undefined,
  };
}

function nearSignature(item: WeixinChannelsObservation) {
  const title = normalizeWeixinChannelsText(item.title).replace(/\d+/g, "#");
  const author = normalizeWeixinChannelsText(item.author);
  const day = String(item.publishedAt || item.observedAt || "").slice(0, 10);
  return `${author}:${day}:${title.slice(0, 48)}`;
}

/** 先做确定性清洗；模型只接收这一步留下的数据。 */
export function cleanWeixinChannelsObservationsLocally(
  observations: readonly PersistedWeixinChannelsObservation[],
) {
  const exact = new Set<string>();
  const near = new Set<string>();
  const kept: PersistedWeixinChannelsObservation[] = [];
  const removed: Array<{ observationId: string; reason: string }> = [];
  for (const item of observations) {
    if (!item.qualified || item.invalid || !item.title.trim() || item.evidence !== "capture") {
      removed.push({ observationId: item.observationId, reason: "invalid_or_unqualified" });
      continue;
    }
    const exactKey = [normalizeWeixinChannelsText(item.title), normalizeWeixinChannelsText(item.author), item.url || ""].join(":");
    if (exact.has(exactKey)) {
      removed.push({ observationId: item.observationId, reason: "exact_duplicate" });
      continue;
    }
    const approximateKey = nearSignature(item);
    if (near.has(approximateKey)) {
      removed.push({ observationId: item.observationId, reason: "near_duplicate" });
      continue;
    }
    exact.add(exactKey);
    near.add(approximateKey);
    kept.push(item);
  }
  return { kept, removed };
}

/**
 * 不改写原始记录，只保守估算 JSON 输入 token：非 ASCII 字符按 1 token，
 * ASCII 按约 4 字符/token，再留 10% JSON/消息协议余量。
 */
export function estimateWeixinChannelsTerraInputTokens(value: unknown) {
  const json = JSON.stringify(value);
  let ascii = 0;
  let nonAscii = 0;
  for (const character of json) {
    if (character.codePointAt(0)! <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil((ascii / 4 + nonAscii) * 1.1);
}

/** 由 2,000 条上限向下取最大安全集合；不足 1,000 条时不允许发起正式调用。 */
export function selectWeixinChannelsTerraInput(
  observations: readonly PersistedWeixinChannelsObservation[],
  tokenBudget = WEIXIN_CHANNELS_TERRA_INPUT_TOKEN_BUDGET,
) {
  const selected: PersistedWeixinChannelsObservation[] = [];
  let estimatedInputTokens = estimateWeixinChannelsTerraInputTokens({ jobId: "wxc", observations: [] });
  for (const item of observations.slice(0, WEIXIN_CHANNELS_AGGREGATION_MAX_ITEMS)) {
    const itemTokens = estimateWeixinChannelsTerraInputTokens(item);
    if (estimatedInputTokens + itemTokens > tokenBudget) break;
    selected.push(item);
    estimatedInputTokens += itemTokens;
  }
  return { selected, estimatedInputTokens };
}

const terraDirectResultSchema = z.object({
  duplicates: z.unknown(),
  categories: z.unknown(),
  keywords: z.unknown(),
  commentTopics: z.unknown(),
  trends: z.unknown(),
  blueOceanKeywords: z.unknown(),
  topicIdeas: z.unknown(),
  weeklySummary: z.unknown(),
}).superRefine((result, context) => {
  for (const [field, value] of Object.entries(result)) {
    const populated = Array.isArray(value)
      ? value.length > 0
      : Boolean(value && typeof value === "object" ? Object.keys(value as object).length : value);
    if (!populated) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field}_empty` });
  }
});

function providerOf(result: InvokeResult): "evolink" | "openai" {
  return String(result.provider || "").toLowerCase().includes("evolink") ? "evolink" : "openai";
}

function usageOf(result: InvokeResult) {
  return {
    inputTokens: result.usage?.prompt_tokens,
    outputTokens: result.usage?.completion_tokens,
  };
}

/** 新正式链路：本地清洗去重后的原始记录一次性交给 Terra high，直接产出八项结果。 */
export async function invokeWeixinChannelsTerraDirect(params: {
  job: FinalAnalysisJob;
  observations: PersistedWeixinChannelsObservation[];
  invoke?: typeof invokeLLM;
}) {
  const call = params.invoke || invokeLLM;
  const response = await call({
    model: "pro",
    provider: "openai",
    modelName: WEIXIN_CHANNELS_FINAL_MODEL,
    reasoningEffort: WEIXIN_CHANNELS_FINAL_REASONING,
    openAiGateway: "evolink_primary",
    requestId: params.job.jobId,
    max_tokens: WEIXIN_CHANNELS_TERRA_MAX_COMPLETION_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "你是短视频增长数据分析师。直接基于原始记录一次完成语义去重、分类、关键词、评论话题聚类、趋势判断、蓝海词候选、选题建议和周报摘要。不得编造输入外数据；单平台样本不得伪造平台差异；缺失评论必须标记数据缺口。只输出合法 JSON，八个顶层字段必须全部非空：duplicates,categories,keywords,commentTopics,trends,blueOceanKeywords,topicIdeas,weeklySummary。每项结论附 observationId 或指标证据。",
      },
      {
        role: "user",
        content: JSON.stringify({ jobId: params.job.jobId, observations: params.observations }),
      },
    ],
  });
  const result = terraDirectResultSchema.parse(JSON.parse(extractJsonString(extractFirstChoicePlainText(response))));
  return { result, provider: providerOf(response), usage: usageOf(response) };
}

export function buildWeixinChannelsTrendCollection(params: {
  observations: PersistedWeixinChannelsObservation[];
  candidateByTaskId?: Map<string, WeixinChannelsCandidate>;
  collectedAt?: string;
}): PlatformTrendCollection {
  const items = params.observations.filter((item) => item.qualified && !item.invalid).map<TrendItem>((item) => {
    const candidate = params.candidateByTaskId?.get(item.taskId);
    return {
      id: stableId("wxc", item.url || `${item.author || ""}:${item.title}`),
      title: item.title,
      author: item.author,
      url: item.url,
      publishedAt: item.publishedAt,
      likes: item.likes,
      comments: item.comments,
      shares: item.shares,
      views: item.views,
      favorites: item.favorites,
      followers: item.followers,
      friendsFollowing: item.friendsFollowing,
      contentType: "video",
      bucket: "weixin_channels_feed",
      tags: [candidate?.category, "本机真实采集"].filter((value): value is string => Boolean(value)),
      sourceEvidence: {
        mode: item.evidence,
        observedAt: item.observedAt,
        query: item.query,
        resultRank: item.resultRank,
        sourcePlatform: candidate?.sourcePlatform,
        sourceItemId: candidate?.sourceItemId,
      },
      commentSamples: item.commentSamples?.map(({ author, text, likeCount }) => ({ author, text, likeCount })).slice(0, 20),
    };
  });
  const collectedAt = params.collectedAt || nowShanghaiIso();
  return {
    platform: "weixin_channels",
    source: "live",
    collectedAt,
    windowDays: 18,
    items,
    notes: ["视频号由本机已登录客户端公开页面采集；服务端不保存微信登录凭证。"],
    stats: {
      platform: "weixin_channels",
      itemCount: items.length,
      uniqueAuthorCount: new Set(items.map((item) => item.author).filter(Boolean)).size,
      bucketCounts: { weixin_channels_feed: items.length },
      requestCount: 0,
      pageDepth: 1,
      targetPerRun: params.observations.length,
      referenceMinItems: 5,
      referenceMaxItems: 10_000,
      collectorMode: "authenticated_feed",
      industryCounts: {},
      ageCounts: {},
      contentCounts: { video: items.length },
      rawFetchedCount: params.observations.length,
      afterDedupCount: items.length,
      afterWindowFilterCount: items.length,
    },
  };
}
