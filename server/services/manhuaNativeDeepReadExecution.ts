/**
 * 原生精读的**生产协调器**：runner 与入库之间那段接线。
 *
 * 0826 换代后最小闭环：
 *   入口 → 列已入库集 → 逐集：解析真实媒体节点 → Vertex Gemini 分段精读
 *   （音轨同调直出）→ 直读音轨装配 → 入库门禁 → 写卡
 *
 * 三条纪律写死在代码里，不靠调用方自觉：
 * 1. **开关不开就不跑**，避免误触发付费调用
 * 2. **已入库的集直接跳过**，重跑不重烧（断点续跑靠 #1295 的 GCS 列举）
 * 3. **中止立刻停**，且不把中止记成「这集失败了」
 */
import crypto from "node:crypto";
import {
  isManhuaNativeDeepReadEnabled,
  NATIVE_DEEP_READ_AUDIO_CUE_FLOOR_INTERVAL_SEC,
  NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_INTERVAL_SEC,
  NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_MIN,
  NATIVE_DEEP_READ_MODEL,
  NATIVE_DEEP_READ_REQUEST_MEDIA_BUDGET_BYTES,
  NATIVE_DEEP_READ_ROUTE_EVOLINK,
  NATIVE_DEEP_READ_ROUTE_VERTEX,
  NATIVE_DEEP_READ_SHOT_FLOOR_INTERVAL_SEC,
  NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
  runManhuaNativeDeepRead,
  runManhuaNativeDeepReadBatch,
  type NativeDeepReadMediaNode,
  type NativeDeepReadRunResult,
  validateNativeDeepReadSegments,
  type NativeDeepReadRunError,
  type NativeDeepReadSegmentSpec,
} from "./manhuaNativeDeepReadRunner.js";
import {
  checkNativeDeepReadIngestable,
  ingestNativeDeepReadEpisode,
  listIngestedNativeDeepReadEpisodes,
  type NativeDeepReadIngestResult,
} from "./manhuaNativeDeepReadIngest.js";
import {
  acquireNativeDeepReadEpisodeClaim,
  recordNativeDeepReadClaimFailure,
} from "./manhuaNativeDeepReadClaim.js";
import { clearNativeDeepReadSegmentCacheForEpisode } from "./manhuaNativeDeepReadSegmentCache.js";
import {
  finalizeManhuaNativeDirectAudioAnalysis,
  noAudioManhuaNativeDirectAnalysis,
  type ManhuaNativeAudioAnalysis,
  type ManhuaNativeAudioDirectRoute,
  type ManhuaNativeAudioUsage,
} from "../../shared/manhuaNativeAudioAnalysis.js";
import type { ManhuaNativeModelReceipt } from "../../shared/manhuaNativeModelReceipt.js";
import {
  aggregateNativeDeepReadSeries,
  MANHUA_NATIVE_SERIES_AGGREGATION_MODEL,
  MANHUA_NATIVE_SERIES_AGGREGATION_ROUTE,
  MANHUA_NATIVE_SERIES_AGGREGATION_SCHEMA_VERSION,
  type NativeSeriesAggregationError,
  type NativeSeriesAggregationResult,
  type NativeSeriesAggregationUsage,
} from "./manhuaNativeSeriesAggregation.js";

export type NativeDeepReadEpisodeExecution = {
  seriesKey: string;
  episodeIndex: number;
  /**
   * 切片与预检实际用的地址（必须是 ffmpeg 能拉的 HTTPS）。
   *
   * ⚠️ 与下面的 `provenanceSourceRef` 分开，是因为**手动导入 GCS 素材**时
   * 主链会先把 `gs://` 换成 7 天签名 HTTPS —— 那种短链带 Signature/Expires，
   * 写进永久卡就是一条几天后必然失效、还泄露签名的溯源记录。
   */
  sourceUrl: string;
  /**
   * 落进卡片 `sourceRefs` 的**永久**来源标识。
   * 抖音来源与 `sourceUrl` 相同；GCS 导入必须是稳定的 `gs://`。
   * 缺省时回落 `sourceUrl`（保持既有行为）。
   */
  provenanceSourceRef?: string;
  durationSec: number;
  laneHintZh?: string;
  segments: readonly NativeDeepReadSegmentSpec[];
  /**
   * 该集当前可用的媒体节点（零成本，不下载）。
   *
   * 两种来源都走这里：batch 脚本传页面 URL 解析器，生产主链直接返回
   * 素材接入层已探测成功的直链（含它验证过的 Referer）——后者不能再解析一次。
   */
  resolveNodes: () => Promise<NativeDeepReadMediaNode[]>;
  abortSignal?: AbortSignal;
};

/** 供测试注入假实现；生产走默认值，不额外开旁路 */
export type NativeDeepReadExecutionDeps = {
  run: typeof runManhuaNativeDeepRead;
  runBatch: typeof runManhuaNativeDeepReadBatch;
  ingest: typeof ingestNativeDeepReadEpisode;
  listIngested: typeof listIngestedNativeDeepReadEpisodes;
  isEnabled: typeof isManhuaNativeDeepReadEnabled;
  acquireClaim: typeof acquireNativeDeepReadEpisodeClaim;
  aggregateSeries: typeof aggregateNativeDeepReadSeries;
};

const defaultDeps: NativeDeepReadExecutionDeps = {
  run: runManhuaNativeDeepRead,
  runBatch: runManhuaNativeDeepReadBatch,
  ingest: ingestNativeDeepReadEpisode,
  listIngested: listIngestedNativeDeepReadEpisodes,
  isEnabled: isManhuaNativeDeepReadEnabled,
  acquireClaim: acquireNativeDeepReadEpisodeClaim,
  aggregateSeries: aggregateNativeDeepReadSeries,
};

/** 跑一集并入库。门禁不过直接抛，不写半截卡 */
export type NativeDeepReadEpisodeOutcomeCost = {
  /** 这一集实际发生的模型费用（门禁拒收也已经花掉了，必须记） */
  costCny: number;
  elapsedMs: number;
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    costCny: number;
    usingPlanQuota?: boolean;
    receiptComplete: boolean;
    visualInputTokens: number;
    visualOutputTokens: number;
    visualPriceEquivalentCny: number;
    audioInputTokens: number;
    audioOutputTokens: number;
    audioCostCny: number;
  };
};

/**
 * 视觉结果 → 新一代直读音轨装配。
 *
 * ⚠️ 双计防线：音轨 token 已计入视觉调用回执，这里的 usage 计费全部为 0，
 * 只带 AUDIO modality token 数（audioInputTokens）作「真听过」的证据。
 */
export function buildNativeDeepReadDirectAudioAnalysis(input: {
  durationSec: number;
  segments: readonly NativeDeepReadSegmentSpec[];
  visualResult: NativeDeepReadRunResult;
}): ManhuaNativeAudioAnalysis {
  const route: ManhuaNativeAudioDirectRoute =
    (input.visualResult.degradedFpsSegmentIndexes?.length ?? 0) > 0
      ? NATIVE_DEEP_READ_ROUTE_EVOLINK
      : NATIVE_DEEP_READ_ROUTE_VERTEX;
  if (input.visualResult.hasAudio !== true) {
    return noAudioManhuaNativeDirectAnalysis(input.durationSec, route);
  }
  const audioInputTokens = Math.max(0, Number(input.visualResult.audioInputTokens) || 0);
  const usage: ManhuaNativeAudioUsage = {
    inputTokens: 0,
    audioInputTokens,
    outputTokens: 0,
    costCny: 0,
    receiptComplete: true,
    geminiInputTokens: 0,
    geminiAudioInputTokens: audioInputTokens,
    geminiOutputTokens: 0,
    geminiCostCny: 0,
    geminiCalls: input.segments.length,
  };
  return finalizeManhuaNativeDirectAudioAnalysis({
    durationSec: input.durationSec,
    chunks: input.segments.map((segment, index) => ({
      index,
      startSec: segment.startSec,
      endSec: segment.endSec,
    })),
    resolvedChunks: input.visualResult.resolvedAudioChunks,
    usage,
    route,
  });
}

function combinedUsageFromVisual(
  visualResult: NativeDeepReadRunResult,
): NativeDeepReadEpisodeOutcomeCost["usage"] {
  const visualCostCny = Number(visualResult.usage?.costCny) || 0;
  const inputTokens = Math.max(0, Number(visualResult.usage?.inputTokens) || 0);
  const outputTokens = Math.max(0, Number(visualResult.usage?.outputTokens) || 0);
  return {
    model: NATIVE_DEEP_READ_MODEL,
    inputTokens,
    outputTokens,
    costCny: visualCostCny,
    // Vertex/EvoLink 均按量计费；不存在套餐额度
    usingPlanQuota: false,
    receiptComplete: true,
    visualInputTokens: inputTokens,
    visualOutputTokens: outputTokens,
    visualPriceEquivalentCny: visualCostCny,
    // 音轨已含在视觉调用里，独立音频通道为 0（双计防线）
    audioInputTokens: 0,
    audioOutputTokens: 0,
    audioCostCny: 0,
  };
}

function failedUsageFromError(error: unknown): NativeDeepReadEpisodeOutcomeCost["usage"] {
  const nativeError = error as NativeDeepReadRunError;
  const visualCost = Number(nativeError?.nativeDeepReadCostCny) || 0;
  return {
    model: NATIVE_DEEP_READ_MODEL,
    inputTokens: Number(nativeError?.nativeDeepReadUsage?.inputTokens) || 0,
    outputTokens: Number(nativeError?.nativeDeepReadUsage?.outputTokens) || 0,
    costCny: visualCost,
    usingPlanQuota: false,
    receiptComplete: nativeError?.nativeDeepReadUsage?.receiptComplete === true,
    visualInputTokens: Number(nativeError?.nativeDeepReadUsage?.inputTokens) || 0,
    visualOutputTokens: Number(nativeError?.nativeDeepReadUsage?.outputTokens) || 0,
    visualPriceEquivalentCny: visualCost,
    audioInputTokens: 0,
    audioOutputTokens: 0,
    audioCostCny: 0,
  };
}

export async function executeAndIngestNativeDeepReadEpisode(
  input: NativeDeepReadEpisodeExecution,
  deps: NativeDeepReadExecutionDeps = defaultDeps,
): Promise<NativeDeepReadIngestResult & NativeDeepReadEpisodeOutcomeCost> {
  if (!deps.isEnabled()) throw new Error("原生精读开关未开启");
  if (input.abortSignal?.aborted) throw new Error("用户已停止学习");

  // 单集入口也走同一份预检，不能只依赖批处理调用方。
  validateNativeDeepReadBatchPlan([input], { maxEpisodes: 1, seriesKey: input.seriesKey });

  // 原子占位必须在 runner 之前：#1295 的 ifGenerationMatch 在模型跑完之后，
  // 只能防卡片覆盖，防不了两个进程各付一次费
  const claim = await deps.acquireClaim(input.seriesKey, input.episodeIndex);
  const startedAt = Date.now();

  let visualResult: Awaited<ReturnType<typeof runManhuaNativeDeepRead>>;
  try {
    visualResult = await deps.run({
      resolveNodes: input.resolveNodes,
      segments: input.segments,
      sourceDurationSec: input.durationSec,
      hintZh: input.laneHintZh,
      abortSignal: input.abortSignal,
    });
  } catch (error) {
    const usage = failedUsageFromError(error);
    throw Object.assign(
      new Error(error instanceof Error ? error.message : String(error), { cause: error }),
      {
        costCny: usage.costCny,
        elapsedMs: Date.now() - startedAt,
        nativeUsage: usage,
      },
    );
  }

  const combinedUsage = combinedUsageFromVisual(visualResult);
  const costCny = combinedUsage.costCny;

  let audioAnalysis: ManhuaNativeAudioAnalysis;
  try {
    audioAnalysis = buildNativeDeepReadDirectAudioAnalysis({
      durationSec: input.durationSec,
      segments: input.segments,
      visualResult,
    });
  } catch (error) {
    throw Object.assign(
      new Error(error instanceof Error ? error.message : String(error), { cause: error }),
      { costCny, elapsedMs: Date.now() - startedAt, nativeUsage: combinedUsage },
    );
  }
  const result = { ...visualResult, audioAnalysis };
  if (input.abortSignal?.aborted) {
    throw Object.assign(new Error("用户已停止学习"), {
      costCny,
      elapsedMs: Date.now() - startedAt,
      nativeUsage: { ...combinedUsage },
    });
  }

  // 门禁在写之前：空卡、全段失败不进库。**钱已经花了，错误里要带上**
  const gate = checkNativeDeepReadIngestable(result);
  if (!gate.ok) {
    throw Object.assign(
      new Error(`第${input.episodeIndex}集未通过入库门禁：${gate.reasonZh}`),
      { costCny, elapsedMs: Date.now() - startedAt, nativeUsage: { ...combinedUsage } },
    );
  }

  let stored: NativeDeepReadIngestResult;
  try {
    stored = await deps.ingest({
      seriesKey: input.seriesKey,
      episodeIndex: input.episodeIndex,
      sourceUrl: input.provenanceSourceRef || input.sourceUrl,
      durationSec: input.durationSec,
      laneHintZh: input.laneHintZh,
      result,
    });
  } catch (error) {
    throw Object.assign(
      new Error(error instanceof Error ? error.message : String(error), { cause: error }),
      { costCny, elapsedMs: Date.now() - startedAt, nativeUsage: { ...combinedUsage } },
    );
  }

  // 卡已入库就是成功；占位清不掉不改判失败，下一轮会先被已入库卡跳过
  try {
    await claim.releaseAfterSuccess();
  } catch (e) {
    console.warn(
      "[nativeDeepRead] 成功卡已入库，占位清理待人工核对：",
      claim.objectName,
      e instanceof Error ? e.message : e,
    );
  }
  return {
    ...stored,
    costCny,
    elapsedMs: Date.now() - startedAt,
    usage: { ...combinedUsage },
  };
}

export type NativeDeepReadBatchEpisode = Omit<
  NativeDeepReadEpisodeExecution,
  "seriesKey" | "abortSignal"
>;

/**
 * `--limit` 省略时的默认集数。**不是硬上限** —— 一趟跑多少由发车人指定。
 *
 * 真正拦住误发的是确认码 ＋ `--max-calls`：不原样回填总模型请求数就发不出去。
 * 集数只是「没指定时别把整份清单一口气跑了」的默认值。
 */
export const NATIVE_DEEP_READ_DEFAULT_BATCH_EPISODES = 20;

/** 失控保险：清单误写成几千集时兜底，正常发车碰不到 */
export const NATIVE_DEEP_READ_BATCH_HARD_CEILING = 200;
/** 单集仍遵守学习策略的两小时上限。 */
export const NATIVE_DEEP_READ_MAX_EPISODE_SEC = 120 * 60;
/** 视觉分片最多 6 分钟：360s×fps5=1800 帧恰好贴满单视频帧预算。 */
export const NATIVE_DEEP_READ_MAX_SEGMENT_SEC = 6 * 60;

export type NativeDeepReadBatchPlan = {
  totalEpisodes: number;
  /** 视觉分片数；换代后每段一次 Gemini 调用，两者数值一致。 */
  totalSegments: number;
  /** 视觉模型调用数 = 分片数（每段一次调用，不再多段合包）。 */
  totalVisualCalls: number;
  /** 0826 换代后音轨由视觉调用直出：独立音频调用恒为 0。 */
  totalAudioChunks: number;
  /** 发车确认与墙钟使用的总模型请求数。 */
  totalModelCalls: number;
  totalDurationSec: number;
  /** 计划指纹：真跑必须带上它，保证发的就是干跑时确认过的那份 */
  planHash: string;
};

/**
 * 批次预检。**必须在 GCS 列举与任何模型动作之前**。
 *
 * 之前只在入库时才校验，于是清单里写两次第 1 集会**真的跑两次模型**
 * （实测 runner calls=2），非法集号也是先调用再失败 —— 钱已经花掉了。
 */
export function validateNativeDeepReadBatchPlan(
  episodes: readonly NativeDeepReadBatchEpisode[],
  opts: { maxEpisodes?: number; seriesKey?: string } = {},
): NativeDeepReadBatchPlan {
  if (!episodes.length) throw new Error("发车清单为空");
  const ceiling = Math.max(
    1,
    Math.floor(Number(opts.maxEpisodes) || NATIVE_DEEP_READ_BATCH_HARD_CEILING),
  );
  if (episodes.length > ceiling) {
    throw new Error(`本批 ${episodes.length} 集超过上限 ${ceiling} 集`);
  }
  if (episodes.length > NATIVE_DEEP_READ_BATCH_HARD_CEILING) {
    throw new Error(`单批最多 ${NATIVE_DEEP_READ_BATCH_HARD_CEILING} 集（失控保险）`);
  }
  const seen = new Set<number>();
  let totalSegments = 0;
  let totalDurationSec = 0;
  for (let index = 0; index < episodes.length; index += 1) {
    const episode = episodes[index]!;
    const ep = Number(episode.episodeIndex);
    if (!Number.isInteger(ep) || ep < 1 || ep > 999) {
      throw new Error(`第${index + 1}项 episodeIndex 必须是 1–999 整数`);
    }
    if (seen.has(ep)) throw new Error(`发车清单重复第${ep}集`);
    seen.add(ep);
    let source: URL;
    try {
      source = new URL(String(episode.sourceUrl || ""));
    } catch {
      throw new Error(`第${ep}集来源地址无效`);
    }
    if (source.protocol !== "https:") throw new Error(`第${ep}集来源必须是 HTTPS`);
    const duration = Number(episode.durationSec);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`第${ep}集时长无效`);
    if (duration > NATIVE_DEEP_READ_MAX_EPISODE_SEC) {
      throw new Error(`第${ep}集超过 ${Math.round(NATIVE_DEEP_READ_MAX_EPISODE_SEC / 60)} 分钟学习上限`);
    }
    const segments = validateNativeDeepReadSegments(episode.segments);
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex]!;
      if (segment.endSec > duration + 0.5) throw new Error(`第${ep}集切片超出片长`);
      const len = segment.endSec - segment.startSec;
      if (len > NATIVE_DEEP_READ_MAX_SEGMENT_SEC) {
        throw new Error(
          `第${ep}集单片 ${Math.round(len)}s 超过 ${NATIVE_DEEP_READ_MAX_SEGMENT_SEC}s，模型看不完整，请拆段`,
        );
      }
      if (
        segmentIndex > 0
        && Math.abs(segment.startSec - segments[segmentIndex - 1]!.endSec) > 0.01
      ) {
        throw new Error(`第${ep}集分片存在空档或重叠，未发出模型请求`);
      }
    }
    if (segments[0]!.startSec > 0.5 || Math.abs(segments[segments.length - 1]!.endSec - duration) > 0.5) {
      throw new Error(`第${ep}集分片未完整覆盖全片，未发出模型请求`);
    }
    totalSegments += segments.length;
    totalDurationSec += duration;
  }
  /**
   * 计划确认码 canonical：`NATIVE_DEEP_READ_VISUAL_PLAN_VERSION` 改值即旧确认码
   * 全废（0826 换代必须如此）。采样、通道、门禁地板、媒体预算全部入 canonical。
   */
  const canonical = JSON.stringify({
    seriesKey: String(opts.seriesKey || ""),
    visual: {
      version: NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
      model: NATIVE_DEEP_READ_MODEL,
      routes: [NATIVE_DEEP_READ_ROUTE_VERTEX, NATIVE_DEEP_READ_ROUTE_EVOLINK],
      fpsTiers: { shortMaxSec: 180, shortFps: 10, longFps: 5 },
      maxSegmentSec: NATIVE_DEEP_READ_MAX_SEGMENT_SEC,
      mediaBudgetBytes: NATIVE_DEEP_READ_REQUEST_MEDIA_BUDGET_BYTES,
      densityFloors: {
        shotIntervalSec: NATIVE_DEEP_READ_SHOT_FLOOR_INTERVAL_SEC,
        audioTrackMin: NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_MIN,
        audioTrackIntervalSec: NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_INTERVAL_SEC,
        audioCueIntervalSec: NATIVE_DEEP_READ_AUDIO_CUE_FLOOR_INTERVAL_SEC,
      },
    },
    audio: { mode: "gemini_native_video_direct_v1" },
    seriesAggregation: {
      model: MANHUA_NATIVE_SERIES_AGGREGATION_MODEL,
      route: MANHUA_NATIVE_SERIES_AGGREGATION_ROUTE,
      schemaVersion: MANHUA_NATIVE_SERIES_AGGREGATION_SCHEMA_VERSION,
    },
    episodes: episodes.map(({ resolveNodes: _drop, ...rest }) => rest),
  });
  const totalVisualCalls = totalSegments;
  return {
    totalEpisodes: episodes.length,
    totalSegments,
    totalVisualCalls,
    totalAudioChunks: 0,
    // 只要本批有分集卡，落盘后再做一次系列全量聚合（纯文本）；快照相同会直接复用。
    totalModelCalls: totalVisualCalls + 1,
    totalDurationSec,
    planHash: crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16),
  };
}

export type NativeDeepReadBatchOutcome = {
  episodeIndex: number;
  status: "ingested" | "skipped" | "failed" | "aborted";
  gcsUri?: string;
  errorZh?: string;
  /** 实际发生的模型费用；**门禁拒收也要记**，钱已经花了 */
  costCny: number;
  elapsedMs: number;
  usage?: NativeDeepReadEpisodeOutcomeCost["usage"];
};

export type NativeDeepReadModelCheckpoint = ManhuaNativeModelReceipt;

export type NativeDeepReadBatchResult = {
  outcomes: NativeDeepReadBatchOutcome[];
  ingestedCount: number;
  skippedCount: number;
  failedCount: number;
  /** 只统计成功卡就会把「花了钱但没入库」那部分算漏 */
  totalCostCny: number;
  totalElapsedMs: number;
  plan: NativeDeepReadBatchPlan;
  /** true = 中途被用户停掉，后面的集没跑 */
  aborted: boolean;
  /** 仅本轮至少新增一集时执行一次；使用当前系列全部分集卡重算。 */
  seriesAggregation?: NativeSeriesAggregationResult;
  seriesAggregationUsage?: NativeSeriesAggregationUsage;
  /** 分集卡已成功时，系列整理失败只降级记录；重跑会再次聚合，不重烧分集。 */
  seriesAggregationErrorZh?: string;
};

/**
 * 批量发车（20 集就走这里）。
 *
 * **先列已入库集再决定跑哪些** —— 这是不重烧的唯一依据；
 * 列不动时 `listIngestedNativeDeepReadEpisodes` 会抛错停手，
 * 不会把「未知」当成「没跑过」。
 *
 * 换代后逐集执行（每段一次 Gemini 调用）；单集失败停止后续集
 * （已入库的集保留），中止立刻停。
 */
export async function runNativeDeepReadBatch(input: {
  seriesKey: string;
  episodes: readonly NativeDeepReadBatchEpisode[];
  abortSignal?: AbortSignal;
  onProgress?: (outcome: NativeDeepReadBatchOutcome) => void | Promise<void>;
  onModelCheckpoint?: (checkpoint: NativeDeepReadModelCheckpoint) => void | Promise<void>;
}, deps: NativeDeepReadExecutionDeps = defaultDeps): Promise<NativeDeepReadBatchResult> {
  if (!deps.isEnabled()) throw new Error("原生精读开关未开启");

  // 预检在 GCS 列举与任何模型动作之前：清单里写两次第 1 集会真的跑两次模型
  const plan = validateNativeDeepReadBatchPlan(input.episodes, { seriesKey: input.seriesKey });
  const alreadyIngested = await deps.listIngested(input.seriesKey);
  const outcomes: NativeDeepReadBatchOutcome[] = [];
  const batchStartedAt = Date.now();
  let aborted = false;
  const emitProgress = async (outcome: NativeDeepReadBatchOutcome): Promise<void> => {
    try {
      await input.onProgress?.(outcome);
    } catch (error) {
      // UI/任务进度写入属于旁路；失败不得把已入库结果重新归类成失败或重复追加 outcome。
      console.warn(
        `[nativeDeepRead] 第${outcome.episodeIndex}集进度写入未完成：`,
        error instanceof Error ? error.message : error,
      );
    }
  };
  const pending: NativeDeepReadBatchEpisode[] = [];
  for (const episode of input.episodes) {
    if (alreadyIngested.has(episode.episodeIndex)) {
      const skipped: NativeDeepReadBatchOutcome = {
        episodeIndex: episode.episodeIndex,
        status: "skipped",
        costCny: 0,
        elapsedMs: 0,
      };
      outcomes.push(skipped);
      await emitProgress(skipped);
    } else {
      pending.push(episode);
    }
  }

  /**
   * 整批 claim 必须在第一个模型调用前拿齐。
   * 中途抢不到时撤回本轮尚未付费的自有占位，整批不发车。
   */
  const claims = new Map<number, Awaited<ReturnType<typeof acquireNativeDeepReadEpisodeClaim>>>();
  try {
    for (const episode of pending) {
      claims.set(episode.episodeIndex, await deps.acquireClaim(input.seriesKey, episode.episodeIndex));
    }
  } catch (error) {
    await Promise.allSettled(Array.from(claims.values()).map((claim) => claim.releaseBeforePaidCall()));
    throw error;
  }

  const releaseUnpaidFrom = async (startIndex: number, paid: ReadonlySet<number>) => {
    await Promise.allSettled(pending.slice(startIndex).flatMap((episode) => {
      if (paid.has(episode.episodeIndex)) return [];
      const claim = claims.get(episode.episodeIndex);
      return claim ? [claim.releaseBeforePaidCall()] : [];
    }));
  };
  const paidEpisodeIndexes = new Set<number>();

  for (let episodeCursor = 0; episodeCursor < pending.length; episodeCursor += 1) {
    const episode = pending[episodeCursor]!;
    if (input.abortSignal?.aborted) {
      aborted = true;
      await releaseUnpaidFrom(episodeCursor, paidEpisodeIndexes);
      break;
    }
    const episodeStartedAt = Date.now();
    /** 视觉调用成功后即锁定的已付费用量；门禁/装配/入库失败都必须原样带出。 */
    let paidUsage: NativeDeepReadEpisodeOutcomeCost["usage"] | undefined;
    try {
      const visualBatch = await deps.runBatch({
        episodes: [{
          episodeIndex: episode.episodeIndex,
          resolveNodes: episode.resolveNodes,
          segments: episode.segments,
          sourceDurationSec: episode.durationSec,
          hintZh: episode.laneHintZh,
        }],
        // 段级产物缓存（0826 拍板）：失败集重跑只买没成的段
        segmentCacheSeriesKey: input.seriesKey,
        abortSignal: input.abortSignal,
        onModelReceipt: async (receipt) => {
          if (receipt.status === "started") paidEpisodeIndexes.add(episode.episodeIndex);
          await input.onModelCheckpoint?.(receipt);
        },
      });
      const visualResult = visualBatch.episodes[0]?.result;
      if (!visualResult) throw new Error(`第${episode.episodeIndex}集批次结果缺失，停止入库`);
      paidUsage = combinedUsageFromVisual(visualResult);
      const audioAnalysis = buildNativeDeepReadDirectAudioAnalysis({
        durationSec: episode.durationSec,
        segments: episode.segments,
        visualResult,
      });
      const result = { ...visualResult, audioAnalysis };
      const combinedUsage = paidUsage;
      const costCny = combinedUsage.costCny;
      const gate = checkNativeDeepReadIngestable(result);
      if (!gate.ok) {
        throw new Error(`第${episode.episodeIndex}集未通过入库门禁：${gate.reasonZh}`);
      }
      const stored = await deps.ingest({
        seriesKey: input.seriesKey,
        episodeIndex: episode.episodeIndex,
        sourceUrl: episode.provenanceSourceRef || episode.sourceUrl,
        durationSec: episode.durationSec,
        laneHintZh: episode.laneHintZh,
        result,
      });
      try {
        await claims.get(episode.episodeIndex)?.releaseAfterSuccess();
      } catch (error) {
        console.warn(
          `[nativeDeepRead] 第${episode.episodeIndex}集已入库，占位清理待核对：`,
          error instanceof Error ? error.message : error,
        );
      }
      // 集卡已是真源：清掉段缓存，防过期缓存日后误导（旁路，失败不影响结果）
      try {
        await clearNativeDeepReadSegmentCacheForEpisode({
          seriesKey: input.seriesKey,
          episodeIndex: episode.episodeIndex,
          segmentCount: episode.segments.length,
        });
      } catch (cacheError) {
        console.warn(
          `[nativeDeepRead] 第${episode.episodeIndex}集段缓存清理待核对：`,
          cacheError instanceof Error ? cacheError.message : cacheError,
        );
      }
      alreadyIngested.add(episode.episodeIndex);
      const ok: NativeDeepReadBatchOutcome = {
        episodeIndex: episode.episodeIndex,
        status: "ingested",
        gcsUri: stored.gcsUri,
        costCny,
        elapsedMs: Date.now() - episodeStartedAt,
        usage: combinedUsage,
      };
      outcomes.push(ok);
      await emitProgress(ok);
    } catch (error) {
      const usage = paidUsage || failedUsageFromError(error);
      const failed: NativeDeepReadBatchOutcome = {
        episodeIndex: episode.episodeIndex,
        status: input.abortSignal?.aborted ? "aborted" : "failed",
        errorZh: input.abortSignal?.aborted
          ? "用户已停止学习"
          : (error instanceof Error ? error.message : String(error)).slice(0, 200),
        costCny: usage.costCny,
        elapsedMs: Date.now() - episodeStartedAt,
        usage,
      };
      outcomes.push(failed);
      await emitProgress(failed);
      aborted = Boolean(input.abortSignal?.aborted);
      // 已付费失败会保留占位：把最终拒因补写进占位文件，占位管理 UI 才答得出「卡在哪」。
      // 旁路写入，失败只 warn——不能因为补写失败把集结果改判。
      if (failed.status === "failed" && paidEpisodeIndexes.has(episode.episodeIndex)) {
        try {
          await recordNativeDeepReadClaimFailure(
            input.seriesKey,
            episode.episodeIndex,
            failed.errorZh || "未回传具体拒因",
          );
        } catch (recordError) {
          console.warn(
            `[nativeDeepRead] 第${episode.episodeIndex}集占位拒因补写未完成：`,
            recordError instanceof Error ? recordError.message : recordError,
          );
        }
      }
      if (!paidEpisodeIndexes.has(episode.episodeIndex)) {
        const claim = claims.get(episode.episodeIndex);
        if (claim) await Promise.allSettled([claim.releaseBeforePaidCall()]);
      }
      await releaseUnpaidFrom(episodeCursor + 1, paidEpisodeIndexes);
      break;
    }
  }

  const ingestedCount = outcomes.filter((o) => o.status === "ingested").length;
  const failedCount = outcomes.filter((o) => o.status === "failed").length;
  let seriesAggregation: NativeSeriesAggregationResult | undefined;
  let seriesAggregationUsage: NativeSeriesAggregationUsage | undefined;
  let seriesAggregationErrorZh: string | undefined;
  if (outcomes.length > 0 && !aborted && failedCount === 0) {
    try {
      seriesAggregation = await deps.aggregateSeries({
        seriesKey: input.seriesKey,
        abortSignal: input.abortSignal,
        onModelReceipt: async (receipt) => input.onModelCheckpoint?.({
          ...receipt,
          episodeIndexes: outcomes
            .filter((outcome) => outcome.status === "ingested")
            .map((outcome) => outcome.episodeIndex),
        }),
      });
    } catch (error) {
      seriesAggregationUsage = (error as NativeSeriesAggregationError).nativeSeriesAggregationUsage;
      seriesAggregationErrorZh = (error instanceof Error ? error.message : String(error)).slice(0, 200);
      console.warn(`[nativeDeepRead] 分集卡已保留，系列结构整理待重试：${seriesAggregationErrorZh}`);
    }
  }
  return {
    outcomes,
    ingestedCount,
    skippedCount: outcomes.filter((o) => o.status === "skipped").length,
    failedCount,
    totalCostCny: outcomes.reduce((sum, o) => sum + (o.costCny || 0), 0),
    totalElapsedMs: Date.now() - batchStartedAt,
    plan,
    aborted,
    seriesAggregation,
    seriesAggregationUsage,
    seriesAggregationErrorZh,
  };
}
