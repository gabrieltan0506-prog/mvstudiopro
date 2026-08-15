import { createHash } from "node:crypto";
import { z } from "zod";
import type { GrowthPlatform } from "@shared/growth";
import {
  deriveWeixinChannelsSearchQueries,
  normalizeWeixinChannelsText,
  qualifyWeixinChannelsObservationLocally,
  WEIXIN_CHANNELS_AGGREGATION_MAX_ITEMS,
  WEIXIN_CHANNELS_ACCUMULATION_TARGET,
  WEIXIN_CHANNELS_DEEPSEEK_MAX_COMPLETION_TOKENS,
  WEIXIN_CHANNELS_LUNA_BATCH_SIZE,
  WEIXIN_CHANNELS_TERRA_CLEANUP_BATCH_COUNT,
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
  WEIXIN_CHANNELS_DEEPSEEK_MAX_COMPLETION_TOKENS,
  WEIXIN_CHANNELS_LUNA_BATCH_SIZE,
  WEIXIN_CHANNELS_TERRA_CLEANUP_BATCH_COUNT,
  WEIXIN_CHANNELS_TERRA_INPUT_TOKEN_BUDGET,
  WEIXIN_CHANNELS_TERRA_MAX_COMPLETION_TOKENS,
};

export const WEIXIN_CHANNELS_BATCH_MODEL = "gpt-5.6-luna" as const;
export const WEIXIN_CHANNELS_BATCH_REASONING = "low" as const;
export const WEIXIN_CHANNELS_FINAL_MODEL = "gpt-5.6-terra" as const;
export const WEIXIN_CHANNELS_FINAL_REASONING = "high" as const;
export const WEIXIN_CHANNELS_BATCH_MODEL_V2 = "deepseek/deepseek-v4-pro-0813" as const;
export const WEIXIN_CHANNELS_BATCH_REASONING_V2 = "medium" as const;
/** 视频号量级小于来源平台，搜索候选按用户确认放宽到最近十五天。 */
export const WEIXIN_CHANNELS_SEARCH_WINDOW_DAYS = 15;

/** 用户确认：视频号搜索词只取抖音和小红书，B 站候选不得进入任务。 */
const SOURCE_PLATFORMS: GrowthPlatform[] = ["douyin", "xiaohongshu"];

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
  /** 本机由稳定互动指标、标题和作者生成；字幕与播放画面变化不会改变它。 */
  videoIdentity?: string;
  taskId: string;
  query: string;
  resultRank: number;
  title: string;
  author?: string;
  url?: string;
  /** 本机裁出的低清封面，仅在上传请求内存在，服务端会镜像后剥离。 */
  coverImageBase64?: string;
  visualImageBase64?: string;
  visualUrl?: string;
  visualCapturedAt?: string;
  coverUrl?: string;
  coverCapturedAt?: string;
  visualAssetKind?: "platform_cover" | "representative_frame";
  visualFrameProgress?: number;
  publishedAt?: string;
  observedAt: string;
  /** Fly 首次确认写入持久卷的时间；重复 ingest 不得覆盖。 */
  persistedAt?: string;
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
  /** probe 仍真实入库，但与正式千条批次累计隔离。 */
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
  stage?: "deepseek_batch" | "terra_cleanup" | "legacy_terra";
  threshold: number;
  rawCount: number;
  locallyDedupedCount: number;
  observationIds: string[];
  /** 本地清洗去重并通过上下文预算后，真正发送给 Terra 的记录。 */
  analysisObservationIds?: string[];
  lunaBatchIds: string[];
  sourceJobIds?: string[];
  cleanedByJobId?: string;
  status: "pending" | "processing" | "paused" | "completed" | "failed" | "discarded";
  claimToken?: string;
  terraProvider?: "evolink" | "openai" | "openrouter";
  terraModel: typeof WEIXIN_CHANNELS_FINAL_MODEL | typeof WEIXIN_CHANNELS_BATCH_MODEL_V2;
  reasoningEffort: "medium" | "high";
  finalResult?: unknown;
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; costUsd?: number };
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
    .replace(/(?:^|[\s()（）_-])_?[0-9a-f]{8,}(?=$|[\s()（）_-])/gi, " ")
    .replace(/[#＃@＠]/g, " ")
    .replace(/[\s\u200b]+/g, " ")
    .trim()
    .slice(0, 80);
}

/** 从真实热点标题抽取垂类词并追加高意图后缀；不维护固定种子列表。 */
export function buildWeixinChannelsSearchQueries(title: string) {
  return deriveWeixinChannelsSearchQueries(cleanQuery(title)).slice(0, 6);
}

export function buildWeixinChannelsCandidateQueue(
  collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>,
  options?: { perPlatform?: number; now?: string },
): WeixinChannelsCandidate[] {
  const createdAt = options?.now || nowShanghaiIso();
  const candidates: WeixinChannelsCandidate[] = [];
  for (const platform of SOURCE_PLATFORMS) {
    const collection = collections[platform];
    if (!collection?.items?.length) continue;
    const { selected } = selectByGrowthPotential(collection.items, {
      topN: options?.perPlatform ?? 8,
      windowDays: WEIXIN_CHANNELS_SEARCH_WINDOW_DAYS,
    });
    for (const scored of selected) {
      const query = cleanQuery(scored.item.title);
      const searchQueries = buildWeixinChannelsSearchQueries(query);
      if (!query || !searchQueries.length) continue;
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
        searchQueries,
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
  const { coverImageBase64: _transientCover, visualImageBase64: _transientVisual, ...persisted } = item;
  return {
    ...persisted,
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

/** 旧 Terra 直读状态迁移使用；新正式链路的 DeepSeek 批次固定最多 1,000 条。 */
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

export const WEIXIN_CHANNELS_DEEPSEEK_CATEGORY_VALUES = [
  "AI与科技",
  "商业与职场",
  "社会民生",
  "知识教育",
  "生活消费",
  "健康运动",
  "情感家庭",
  "文化娱乐",
  "时事热点",
  "其他",
  "unknown",
] as const;

const deepSeekEvidenceItemSchema = z.object({
  label: z.string().trim().min(1).max(40),
  category: z.enum(WEIXIN_CHANNELS_DEEPSEEK_CATEGORY_VALUES),
  evidence: z.string().trim().min(1).max(40),
  observationIds: z.array(z.string().trim().min(1).max(160)).min(1).max(50),
}).strict();

/**
 * 千条分类的公开契约：八个顶层字段及每条结论的四个字段均为白名单。
 * 无证据的分组允许空数组，禁止为了“非空”而编造；分类和批次摘要必须存在。
 */
const terraDirectResultSchema = z.object({
  duplicates: z.array(deepSeekEvidenceItemSchema).max(200),
  categories: z.array(deepSeekEvidenceItemSchema).min(1).max(200),
  keywords: z.array(deepSeekEvidenceItemSchema).max(200),
  commentTopics: z.array(deepSeekEvidenceItemSchema).max(200),
  trends: z.array(deepSeekEvidenceItemSchema).max(200),
  blueOceanKeywords: z.array(deepSeekEvidenceItemSchema).max(200),
  topicIdeas: z.array(deepSeekEvidenceItemSchema).max(200),
  weeklySummary: z.array(deepSeekEvidenceItemSchema).min(1).max(50),
}).strict();

const terraCleanupResultSchema = terraDirectResultSchema.safeExtend({
  cleaningReport: z.object({
    removedNoise: z.array(z.unknown()).min(1),
    downgradedClaims: z.array(z.unknown()),
    preservedEvidence: z.array(z.unknown()).min(1),
  }),
});

function providerOf(result: InvokeResult): "evolink" | "openai" | "openrouter" {
  const provider = String(result.provider || "").toLowerCase();
  if (provider.includes("evolink")) return "evolink";
  if (provider.includes("openrouter") || provider.includes("deepseek")) return "openrouter";
  return "openai";
}

function usageOf(result: InvokeResult) {
  return {
    inputTokens: result.usage?.prompt_tokens,
    outputTokens: result.usage?.completion_tokens,
    reasoningTokens: result.usage?.completion_tokens_details?.reasoning_tokens,
    costUsd: result.usage?.cost,
  };
}

function deepSeekBatchSystemPrompt() {
  return `你是短视频增长数据的客观分类与清洗器。基于当前不超过1,000条正式有效记录，完成语义去重、分类、关键词、评论话题、趋势、蓝海词、选题和批次摘要。

Schema锁：只输出八个顶层字段 duplicates,categories,keywords,commentTopics,trends,blueOceanKeywords,topicIdeas,weeklySummary。每个字段只能是数组；数组元素只能包含 label,category,evidence,observationIds 四个字段。category 只能取：${WEIXIN_CHANNELS_DEEPSEEK_CATEGORY_VALUES.join("、")}。禁止新增字段或类目；不确定时用 unknown。没有可验证结论的字段输出空数组，categories 与 weeklySummary 至少一项。
文风锁：label 和 evidence 各不超过40字，只写可验证的客观事实。禁止形容词、副词堆叠、比喻、排比、感叹号及“非常、极其、爆炸式、惊人”等程度词。
证据锁：每条结论必须在 observationIds 中列出对应输入记录；输入没有的信息不得输出。UI、OCR疑似噪音不能当作用户观点；缺失评论只能标记为数据缺口。
终检锁：输出前删除主观修饰词，确认字段和枚举合法。只输出JSON，首字符为{，尾字符为}。`;
}

function addUsage(
  total: ReturnType<typeof usageOf>,
  current: ReturnType<typeof usageOf>,
) {
  return {
    inputTokens: (total.inputTokens || 0) + (current.inputTokens || 0),
    outputTokens: (total.outputTokens || 0) + (current.outputTokens || 0),
    reasoningTokens: (total.reasoningTokens || 0) + (current.reasoningTokens || 0),
    costUsd: (total.costUsd || 0) + (current.costUsd || 0),
  };
}

/**
 * 千条请求只发送分类所需证据，明确剥离图片、采集内部状态和长篇 OCR。
 * 保留全部 1,000 个 observationId，同时把最坏输入控制在模型上下文预算内。
 */
export function toWeixinChannelsDeepSeekInputObservation(
  item: PersistedWeixinChannelsObservation,
) {
  const clip = (value: unknown, limit: number) => String(value || "").trim().slice(0, limit);
  return {
    observationId: item.observationId,
    query: clip(item.query, 40),
    title: clip(item.title, 120),
    author: item.author ? clip(item.author, 40) : undefined,
    likes: item.likes,
    shares: item.shares,
    favorites: item.favorites,
    comments: item.comments,
    commentSamples: item.commentSamples?.slice(0, 2).map((sample) => ({
      text: clip(sample.text, 80),
      likeCount: sample.likeCount,
      signals: sample.signals,
    })),
    ocrTexts: item.ocrTexts?.slice(0, 2).map((text) => clip(text, 80)),
  };
}

/** 每 1,000 条调用一次；Medium 推理、严格 JSON 与一次校验重试均显式固定。 */
export async function invokeWeixinChannelsDeepSeekBatch(params: {
  job: FinalAnalysisJob;
  observations: PersistedWeixinChannelsObservation[];
  invoke?: typeof invokeLLM;
}) {
  const call = params.invoke || invokeLLM;
  const observations = params.observations.map(toWeixinChannelsDeepSeekInputObservation);
  const estimatedInputTokens = estimateWeixinChannelsTerraInputTokens({
    jobId: params.job.jobId,
    observations,
  });
  if (estimatedInputTokens > WEIXIN_CHANNELS_TERRA_INPUT_TOKEN_BUDGET) {
    throw new Error(`weixin_channels_deepseek_input_budget_exceeded:${estimatedInputTokens}`);
  }
  let totalUsage: ReturnType<typeof usageOf> = {
    inputTokens: undefined,
    outputTokens: undefined,
    reasoningTokens: undefined,
    costUsd: undefined,
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await call({
      model: "pro",
      provider: "openai",
      modelName: WEIXIN_CHANNELS_BATCH_MODEL_V2,
      reasoningEffort: WEIXIN_CHANNELS_BATCH_REASONING_V2,
      requestId: attempt === 0 ? params.job.jobId : `${params.job.jobId}:validation-retry`,
      max_tokens: WEIXIN_CHANNELS_DEEPSEEK_MAX_COMPLETION_TOKENS,
      response_format: { type: "json_object" },
      openRouterProviderPreferences: {
        require_parameters: true,
      },
      messages: [
        { role: "system", content: deepSeekBatchSystemPrompt() },
        { role: "user", content: JSON.stringify({ jobId: params.job.jobId, observations }) },
      ],
    });
    totalUsage = addUsage(totalUsage, usageOf(response));
    try {
      if (response.choices.some((choice) => choice.finish_reason === "length")) {
        throw new Error("weixin_channels_deepseek_output_truncated");
      }
      const plain = extractFirstChoicePlainText(response).trim();
      if (plain.length < 20) throw new Error("weixin_channels_deepseek_output_empty");
      if (!plain.startsWith("{") || !plain.endsWith("}")) {
        throw new Error("weixin_channels_deepseek_output_not_bare_json");
      }
      const result = terraDirectResultSchema.parse(JSON.parse(extractJsonString(plain)));
      const sourceIds = new Set(params.observations.map((item) => item.observationId));
      for (const values of Object.values(result)) {
        for (const item of values) {
          if (item.observationIds.some((observationId) => !sourceIds.has(observationId))) {
            throw new Error("weixin_channels_deepseek_evidence_id_not_in_input");
          }
        }
      }
      return { result, provider: providerOf(response), usage: totalUsage };
    } catch (error) {
      lastError = error;
      if (attempt === 0) continue;
    }
  }
  const finalError = new Error(`weixin_channels_deepseek_validation_failed:${
    lastError instanceof Error ? lastError.message : String(lastError)
  }`) as Error & { usage?: ReturnType<typeof usageOf> };
  finalError.usage = totalUsage;
  throw finalError;
}

/** 只读取 8 个 DeepSeek 千条批次结果，不重新上传 8,000 条完整 OCR。 */
export async function invokeWeixinChannelsTerraCleanup(params: {
  job: FinalAnalysisJob;
  batchResults: Array<{ jobId: string; rawCount: number; result: unknown }>;
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
        content: `你是最终数据质量审计与清洗器。输入是8个DeepSeek千条批次的结构化结果。删除评论UI、作者信息、地区日期、按钮、标题回显、OCR错字等噪音；删除或降级证据不足的蓝海词和趋势；合并重复分类、关键词与选题；保留observationId和指标证据。

输出必须保留八个顶层数组：duplicates,categories,keywords,commentTopics,trends,blueOceanKeywords,topicIdeas,weeklySummary。每个数组元素只能包含 label,category,evidence,observationIds；category 只能取：${WEIXIN_CHANNELS_DEEPSEEK_CATEGORY_VALUES.join("、")}；label 与 evidence 各不超过40字。另增加 cleaningReport={removedNoise,downgradedClaims,preservedEvidence}。不得新增其他顶层字段或结论字段，不确定时用 unknown，只输出合法JSON。`,
      },
      { role: "user", content: JSON.stringify({ jobId: params.job.jobId, batchResults: params.batchResults }) },
    ],
  });
  const result = terraCleanupResultSchema.parse(JSON.parse(extractJsonString(extractFirstChoicePlainText(response))));
  return { result, provider: providerOf(response), usage: usageOf(response) };
}

/** 仅用于恢复旧状态；新正式链路不再每千条直接调用 Terra。 */
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
        content: `你是短视频增长数据分析师。直接基于原始记录一次完成语义去重、分类、关键词、评论话题聚类、趋势判断、蓝海词候选、选题建议和周报摘要。不得编造输入外数据；单平台样本不得伪造平台差异；缺失评论必须标记数据缺口。

只输出八个顶层数组：duplicates,categories,keywords,commentTopics,trends,blueOceanKeywords,topicIdeas,weeklySummary。每个数组元素只能包含 label,category,evidence,observationIds；category 只能取：${WEIXIN_CHANNELS_DEEPSEEK_CATEGORY_VALUES.join("、")}；label 与 evidence 各不超过40字。不得新增字段，不确定时用 unknown，只输出合法JSON。`,
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
      coverUrl: item.visualUrl || item.coverUrl,
      coverCapturedAt: item.visualCapturedAt || item.coverCapturedAt,
      visualAssetKind: item.visualUrl ? "representative_frame" : "platform_cover",
      visualFrameProgress: item.visualFrameProgress,
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
