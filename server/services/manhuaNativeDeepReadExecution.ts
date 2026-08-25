/**
 * 原生精读的**生产协调器**：runner 与入库之间那段一直缺的接线。
 *
 * 立此模块的原因（0824 审阅点破）：
 * runner 写完了、入库写完了，但 `runManhuaNativeDeepRead` 在全仓
 * **只被自己和它的测试引用** —— 没有任何生产调用点。
 * 也就是说 `MANHUA_NATIVE_DEEP_READ=1` 打开也不改变任何业务路径，
 * 更没有可执行的发车入口。「合并部署后按单发车」当时并不成立。
 *
 * 最小闭环：
 *   入口 → 列已入库集 → 逐集：解析真实媒体节点 → runner → 入库门禁 → 写卡
 *
 * 三条纪律写死在代码里，不靠调用方自觉：
 * 1. **开关不开就不跑**，避免误触发付费调用
 * 2. **已入库的集直接跳过**，重跑不重烧（断点续跑靠 #1295 的 GCS 列举）
 * 3. **中止立刻停**，且不把中止记成「这集失败了」
 */
import crypto from "node:crypto";
import {
  isManhuaNativeDeepReadEnabled,
  NATIVE_DEEP_READ_BATCH_VISION_TOKEN_BUDGET,
  NATIVE_DEEP_READ_MAX_FPS,
  NATIVE_DEEP_READ_MAX_VIDEOS_PER_REQUEST,
  NATIVE_DEEP_READ_TARGET_FRAMES,
  NATIVE_DEEP_READ_VIDEO_MIN_PIXELS,
  NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
  packNativeDeepReadEpisodes,
  runManhuaNativeDeepRead,
  runManhuaNativeDeepReadBatch,
  type NativeDeepReadMediaNode,
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
import { acquireNativeDeepReadEpisodeClaim } from "./manhuaNativeDeepReadClaim.js";
import {
  collectManhuaNativeAudioEvidence,
  finalizeManhuaNativeAudioAnalysis,
  type ManhuaNativeAudioDeepReadError,
  type ManhuaNativeAudioModelReceipt,
} from "./manhuaNativeAudioDeepRead.js";
import {
  MANHUA_NATIVE_AUDIO_ALIGNMENT,
  MANHUA_NATIVE_AUDIO_MODEL,
  splitManhuaNativeAudioChunks,
} from "../../shared/manhuaNativeAudioAnalysis.js";
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
  collectAudioEvidence: typeof collectManhuaNativeAudioEvidence;
  finalizeAudio: typeof finalizeManhuaNativeAudioAnalysis;
  aggregateSeries: typeof aggregateNativeDeepReadSeries;
};

const defaultDeps: NativeDeepReadExecutionDeps = {
  run: runManhuaNativeDeepRead,
  runBatch: runManhuaNativeDeepReadBatch,
  ingest: ingestNativeDeepReadEpisode,
  listIngested: listIngestedNativeDeepReadEpisodes,
  isEnabled: isManhuaNativeDeepReadEnabled,
  acquireClaim: acquireNativeDeepReadEpisodeClaim,
  collectAudioEvidence: collectManhuaNativeAudioEvidence,
  finalizeAudio: finalizeManhuaNativeAudioAnalysis,
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

  let audioEvidence: Awaited<ReturnType<typeof collectManhuaNativeAudioEvidence>>;
  try {
    // 先取双路声音证据；随后交给同一次新加坡视频精读对照画面自动裁决。
    audioEvidence = await deps.collectAudioEvidence({
      durationSec: input.durationSec,
      resolveNodes: input.resolveNodes,
      abortSignal: input.abortSignal,
    });
  } catch (error) {
    const audioError = error as ManhuaNativeAudioDeepReadError;
    const audioUsage = audioError.nativeAudioUsage;
    throw Object.assign(
      new Error(error instanceof Error ? error.message : String(error), { cause: error }),
      {
        costCny: Number(audioUsage?.costCny) || 0,
        elapsedMs: Date.now() - startedAt,
        nativeUsage: {
          model: "gemini-3.6-flash",
          inputTokens: Number(audioUsage?.inputTokens) || 0,
          outputTokens: Number(audioUsage?.outputTokens) || 0,
          costCny: Number(audioUsage?.costCny) || 0,
          usingPlanQuota: false,
          receiptComplete: audioUsage?.receiptComplete === true,
          visualInputTokens: 0,
          visualOutputTokens: 0,
          visualPriceEquivalentCny: 0,
          audioInputTokens: Number(audioUsage?.inputTokens) || 0,
          audioOutputTokens: Number(audioUsage?.outputTokens) || 0,
          audioCostCny: Number(audioUsage?.costCny) || 0,
        },
      },
    );
  }

  let visualResult: Awaited<ReturnType<typeof runManhuaNativeDeepRead>>;
  try {
    // 音频分析期间 CDN 地址可能过期；视觉 runner 会通过 resolveNodes 再取一次新地址。
    visualResult = await deps.run({
      resolveNodes: input.resolveNodes,
      segments: input.segments,
      sourceDurationSec: input.durationSec,
      audioEvidence,
      abortSignal: input.abortSignal,
    });
  } catch (error) {
    const nativeError = error as NativeDeepReadRunError;
    const visualCost = Number(nativeError?.nativeDeepReadCostCny) || 0;
    const audioCost = Number(audioEvidence.usage.costCny) || 0;
    throw Object.assign(
      new Error(error instanceof Error ? error.message : String(error), { cause: error }),
      {
        costCny: visualCost + audioCost,
        elapsedMs: Date.now() - startedAt,
        nativeUsage: {
          model: "qwen3.8-max+gemini-3.6-flash",
          inputTokens:
            (Number(nativeError?.nativeDeepReadUsage?.inputTokens) || 0)
            + audioEvidence.usage.inputTokens,
          outputTokens:
            (Number(nativeError?.nativeDeepReadUsage?.outputTokens) || 0)
            + audioEvidence.usage.outputTokens,
          costCny: visualCost + audioCost,
          usingPlanQuota: undefined,
          receiptComplete: false,
          visualInputTokens: Number(nativeError?.nativeDeepReadUsage?.inputTokens) || 0,
          visualOutputTokens: Number(nativeError?.nativeDeepReadUsage?.outputTokens) || 0,
          visualPriceEquivalentCny: visualCost,
          audioInputTokens: audioEvidence.usage.inputTokens,
          audioOutputTokens: audioEvidence.usage.outputTokens,
          audioCostCny: audioCost,
        },
      },
    );
  }
  let audioAnalysis: Awaited<ReturnType<typeof finalizeManhuaNativeAudioAnalysis>>;
  try {
    audioAnalysis = await deps.finalizeAudio({
      evidence: audioEvidence,
      singaporeResolvedChunks: visualResult.resolvedAudioChunks,
    });
  } catch (error) {
    const visualCost = Number(visualResult.usage?.costCny) || 0;
    const audioCost = Number(audioEvidence.usage.costCny) || 0;
    throw Object.assign(new Error(error instanceof Error ? error.message : String(error), { cause: error }), {
      costCny: visualCost + audioCost,
      elapsedMs: Date.now() - startedAt,
      nativeUsage: {
        model: "qwen3.8-max+gemini-3.6-flash×2",
        inputTokens: visualResult.usage.inputTokens + audioEvidence.usage.inputTokens,
        outputTokens: visualResult.usage.outputTokens + audioEvidence.usage.outputTokens,
        costCny: visualCost + audioCost,
        usingPlanQuota: undefined,
        receiptComplete: true,
        visualInputTokens: visualResult.usage.inputTokens,
        visualOutputTokens: visualResult.usage.outputTokens,
        visualPriceEquivalentCny: visualCost,
        audioInputTokens: audioEvidence.usage.inputTokens,
        audioOutputTokens: audioEvidence.usage.outputTokens,
        audioCostCny: audioCost,
      },
    });
  }
  const result = { ...visualResult, audioAnalysis };
  const visualCostCny = Number(visualResult.usage?.costCny) || 0;
  const audioCostCny = Number(audioAnalysis.usage.costCny) || 0;
  const costCny = visualCostCny + audioCostCny;
  const combinedUsage = {
    model: audioAnalysis.hasAudio
      ? "qwen3.8-max+gemini-3.6-flash×2"
      : "qwen3.8-max",
    inputTokens: visualResult.usage.inputTokens + audioAnalysis.usage.inputTokens,
    outputTokens: visualResult.usage.outputTokens + audioAnalysis.usage.outputTokens,
    costCny,
    // 有音轨时是「Qwen 套餐额度 + Gemini 按量」混合，不能标成纯套餐或纯按量。
    usingPlanQuota: audioAnalysis.hasAudio ? undefined : visualResult.usingPlanQuota,
    receiptComplete: audioAnalysis.usage.receiptComplete,
    visualInputTokens: visualResult.usage.inputTokens,
    visualOutputTokens: visualResult.usage.outputTokens,
    visualPriceEquivalentCny: visualCostCny,
    audioInputTokens: audioAnalysis.usage.inputTokens,
    audioOutputTokens: audioAnalysis.usage.outputTokens,
    audioCostCny,
  };
  if (input.abortSignal?.aborted) {
    throw Object.assign(new Error("用户已停止学习"), {
      costCny,
      elapsedMs: Date.now() - startedAt,
      nativeUsage: {
        ...combinedUsage,
      },
    });
  }

  // 门禁在写之前：空卡、全段失败不进库。**钱已经花了，错误里要带上**
  const gate = checkNativeDeepReadIngestable(result);
  if (!gate.ok) {
    throw Object.assign(
      new Error(`第${input.episodeIndex}集未通过入库门禁：${gate.reasonZh}`),
      {
        costCny,
        elapsedMs: Date.now() - startedAt,
        nativeUsage: {
          ...combinedUsage,
        },
      },
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
      {
        costCny,
        elapsedMs: Date.now() - startedAt,
        nativeUsage: {
          ...combinedUsage,
        },
      },
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
    usage: {
      ...combinedUsage,
    },
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
/** 视觉分片最多 6 分钟，确保自适应采样至少达到 5fps。 */
export const NATIVE_DEEP_READ_MAX_SEGMENT_SEC = 6 * 60;

export type NativeDeepReadBatchPlan = {
  totalEpisodes: number;
  /** 送进 Qwen 的视频分片数，不等于 API 请求数。 */
  totalSegments: number;
  /** 装箱后的新加坡 Qwen 多视频请求数；10×90秒应为 1。 */
  totalVisualCalls: number;
  /** 音频分片数；每片固定两次 Gemini（单声道＋立体声）。 */
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
  let totalAudioChunks = 0;
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
    totalAudioChunks += splitManhuaNativeAudioChunks(duration).length;
    totalDurationSec += duration;
  }
  const canonical = JSON.stringify({
    seriesKey: String(opts.seriesKey || ""),
    visual: {
      version: NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
      targetFrames: NATIVE_DEEP_READ_TARGET_FRAMES,
      maxFps: NATIVE_DEEP_READ_MAX_FPS,
      minPixels: NATIVE_DEEP_READ_VIDEO_MIN_PIXELS,
      tokenBudget: NATIVE_DEEP_READ_BATCH_VISION_TOKEN_BUDGET,
      maxVideos: NATIVE_DEEP_READ_MAX_VIDEOS_PER_REQUEST,
      maxSegmentSec: NATIVE_DEEP_READ_MAX_SEGMENT_SEC,
    },
    audio: {
      model: MANHUA_NATIVE_AUDIO_MODEL,
      alignment: MANHUA_NATIVE_AUDIO_ALIGNMENT,
    },
    seriesAggregation: {
      model: MANHUA_NATIVE_SERIES_AGGREGATION_MODEL,
      route: MANHUA_NATIVE_SERIES_AGGREGATION_ROUTE,
      schemaVersion: MANHUA_NATIVE_SERIES_AGGREGATION_SCHEMA_VERSION,
    },
    episodes: episodes.map(({ resolveNodes: _drop, ...rest }) => rest),
  });
  const totalVisualCalls = packNativeDeepReadEpisodes(episodes).length;
  return {
    totalEpisodes: episodes.length,
    totalSegments,
    totalVisualCalls,
    totalAudioChunks,
    // 只要本批有分集卡，落盘后再做一次 OpenRouter GLM 系列全量聚合；快照相同会直接复用。
    totalModelCalls: totalVisualCalls + totalAudioChunks * 2 + 1,
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

export type NativeDeepReadModelCheckpoint = {
  stage: "audio_model" | "visual_model" | "visual_parse" | "series_aggregation_model";
  status: "started" | "completed" | "failed";
  episodeIndexes: number[];
  chunkIndex?: number;
  variant?: "mono_16k" | "stereo_32k";
  batchRequestId?: string;
  videoCount?: number;
  elapsedMs?: number;
  inputTokens?: number;
  audioInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  priceEquivalentCny?: number;
  finishReason?: string;
  errorZh?: string;
};

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
 * 单集失败不拖垮整批（前面已付费入库的集都留着），但中止立刻停。
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
   * 整批 claim 必须在第一个 Gemini/Qwen 调用前拿齐。
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

  const packs = packNativeDeepReadEpisodes(pending);
  const releaseUnpaidPacks = async (startIndex: number) => {
    const episodeIndexes = packs.slice(startIndex).flat().map((episode) => episode.episodeIndex);
    await Promise.allSettled(episodeIndexes.flatMap((episodeIndex) => {
      const claim = claims.get(episodeIndex);
      return claim ? [claim.releaseBeforePaidCall()] : [];
    }));
  };
  const allocateFloat = (total: number, weights: readonly number[]): number[] => {
    const safeTotal = Math.max(0, Number(total) || 0);
    const denominator = weights.reduce((sum, value) => sum + Math.max(0, value), 0) || weights.length || 1;
    return weights.map((value) => safeTotal * (Math.max(0, value) || 1) / denominator);
  };

  for (let packIndex = 0; packIndex < packs.length; packIndex += 1) {
    const pack = packs[packIndex]!;
    if (input.abortSignal?.aborted) {
      aborted = true;
      await releaseUnpaidPacks(packIndex);
      break;
    }
    const packStartedAt = Date.now();
    const audioEvidenceByEpisode = new Map<number, Awaited<ReturnType<typeof collectManhuaNativeAudioEvidence>>>();
    let activeAudioEpisodeIndex: number | undefined;
    const paidEpisodeIndexes = new Set<number>();
    try {
      // 声音证据仍逐集计量；全部准备好后，这一包只发出一次新加坡 Qwen 多视频请求。
      for (const episode of pack) {
        activeAudioEpisodeIndex = episode.episodeIndex;
        audioEvidenceByEpisode.set(episode.episodeIndex, await deps.collectAudioEvidence({
          durationSec: episode.durationSec,
          resolveNodes: episode.resolveNodes,
          abortSignal: input.abortSignal,
          onModelReceipt: async (receipt: ManhuaNativeAudioModelReceipt) => {
            if (receipt.status === "started") paidEpisodeIndexes.add(episode.episodeIndex);
            await input.onModelCheckpoint?.({
              ...receipt,
              episodeIndexes: [episode.episodeIndex],
            });
          },
        }));
      }
      activeAudioEpisodeIndex = undefined;
      const visualBatch = await deps.runBatch({
        episodes: pack.map((episode) => ({
          episodeIndex: episode.episodeIndex,
          resolveNodes: episode.resolveNodes,
          segments: episode.segments,
          sourceDurationSec: episode.durationSec,
          hintZh: episode.laneHintZh,
          audioEvidence: audioEvidenceByEpisode.get(episode.episodeIndex),
        })),
        abortSignal: input.abortSignal,
        onModelReceipt: async (receipt) => {
          if (receipt.status === "started") {
            for (const episodeIndex of receipt.episodeIndexes) paidEpisodeIndexes.add(episodeIndex);
          }
          await input.onModelCheckpoint?.(receipt);
        },
      });
      const visualByEpisode = new Map(
        visualBatch.episodes.map((episode) => [episode.episodeIndex, episode.result]),
      );
      let packHasFailure = false;
      for (const episode of pack) {
        const visualResult = visualByEpisode.get(episode.episodeIndex);
        const audioEvidence = audioEvidenceByEpisode.get(episode.episodeIndex);
        if (!visualResult || !audioEvidence) {
          throw new Error(`第${episode.episodeIndex}集批次结果缺失，停止入库`);
        }
        const episodeStartedAt = Date.now();
        try {
          const audioAnalysis = await deps.finalizeAudio({
            evidence: audioEvidence,
            singaporeResolvedChunks: visualResult.resolvedAudioChunks,
          });
          const result = { ...visualResult, audioAnalysis };
          const visualCostCny = Number(visualResult.usage.costCny) || 0;
          const audioCostCny = Number(audioAnalysis.usage.costCny) || 0;
          const costCny = visualCostCny + audioCostCny;
          const combinedUsage: NativeDeepReadEpisodeOutcomeCost["usage"] = {
            model: audioAnalysis.hasAudio
              ? "qwen3.8-max(batch)+gemini-3.6-flash×2"
              : "qwen3.8-max(batch)",
            inputTokens: visualResult.usage.inputTokens + audioAnalysis.usage.inputTokens,
            outputTokens: visualResult.usage.outputTokens + audioAnalysis.usage.outputTokens,
            costCny,
            usingPlanQuota: audioAnalysis.hasAudio ? undefined : visualResult.usingPlanQuota,
            receiptComplete: audioAnalysis.usage.receiptComplete,
            visualInputTokens: visualResult.usage.inputTokens,
            visualOutputTokens: visualResult.usage.outputTokens,
            visualPriceEquivalentCny: visualCostCny,
            audioInputTokens: audioAnalysis.usage.inputTokens,
            audioOutputTokens: audioAnalysis.usage.outputTokens,
            audioCostCny,
          };
          const gate = checkNativeDeepReadIngestable(result);
          if (!gate.ok) throw new Error(`第${episode.episodeIndex}集未通过入库门禁：${gate.reasonZh}`);
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
          packHasFailure = true;
          const visualCostCny = Number(visualResult.usage.costCny) || 0;
          const audioCostCny = Number(audioEvidence.usage.costCny) || 0;
          const failed: NativeDeepReadBatchOutcome = {
            episodeIndex: episode.episodeIndex,
            status: input.abortSignal?.aborted ? "aborted" : "failed",
            errorZh: input.abortSignal?.aborted
              ? "用户已停止学习"
              : (error instanceof Error ? error.message : String(error)).slice(0, 200),
            costCny: visualCostCny + audioCostCny,
            elapsedMs: Date.now() - episodeStartedAt,
            usage: {
              model: "qwen3.8-max(batch)+gemini-3.6-flash×2",
              inputTokens: visualResult.usage.inputTokens + audioEvidence.usage.inputTokens,
              outputTokens: visualResult.usage.outputTokens + audioEvidence.usage.outputTokens,
              costCny: visualCostCny + audioCostCny,
              usingPlanQuota: undefined,
              receiptComplete: true,
              visualInputTokens: visualResult.usage.inputTokens,
              visualOutputTokens: visualResult.usage.outputTokens,
              visualPriceEquivalentCny: visualCostCny,
              audioInputTokens: audioEvidence.usage.inputTokens,
              audioOutputTokens: audioEvidence.usage.outputTokens,
              audioCostCny,
            },
          };
          outcomes.push(failed);
          await emitProgress(failed);
          if (input.abortSignal?.aborted) aborted = true;
        }
      }
      // 请求已经返回的整包结果仍全部入库，避免把已付费结构丢掉；但中止后不再发下一包或做系列聚合。
      if (input.abortSignal?.aborted) aborted = true;
      if (packHasFailure || aborted) {
        await releaseUnpaidPacks(packIndex + 1);
        break;
      }
    } catch (error) {
      const nativeError = error as NativeDeepReadRunError & ManhuaNativeAudioDeepReadError;
      const visualUsage = nativeError.nativeDeepReadUsage;
      const visualCost = Number(visualUsage?.costCny) || 0;
      const visualCosts = allocateFloat(visualCost, pack.map((episode) => episode.durationSec));
      const visualInputs = allocateFloat(
        Number(visualUsage?.inputTokens) || 0,
        pack.map((episode) => episode.durationSec),
      ).map(Math.round);
      const visualOutputs = allocateFloat(
        Number(visualUsage?.outputTokens) || 0,
        pack.map((episode) => episode.durationSec),
      ).map(Math.round);
      const elapsedAllocations = allocateFloat(
        Date.now() - packStartedAt,
        pack.map((episode) => episode.durationSec),
      );
      for (let index = 0; index < pack.length; index += 1) {
        const episode = pack[index]!;
        const evidence = audioEvidenceByEpisode.get(episode.episodeIndex);
        const carriedAudio = episode.episodeIndex === activeAudioEpisodeIndex
          ? nativeError.nativeAudioUsage
          : undefined;
        const audioUsage = evidence?.usage || carriedAudio;
        const audioCost = Number(audioUsage?.costCny) || 0;
        const costCny = (visualCosts[index] || 0) + audioCost;
        const failed: NativeDeepReadBatchOutcome = {
          episodeIndex: episode.episodeIndex,
          status: input.abortSignal?.aborted ? "aborted" : "failed",
          errorZh: input.abortSignal?.aborted
            ? "用户已停止学习"
            : (error instanceof Error ? error.message : String(error)).slice(0, 200),
          costCny,
          elapsedMs: Math.round(elapsedAllocations[index] || 0),
          usage: {
            model: "qwen3.8-max(batch)+gemini-3.6-flash×2",
            inputTokens: (visualInputs[index] || 0) + (Number(audioUsage?.inputTokens) || 0),
            outputTokens: (visualOutputs[index] || 0) + (Number(audioUsage?.outputTokens) || 0),
            costCny,
            usingPlanQuota: undefined,
            receiptComplete: visualUsage?.receiptComplete === true && audioUsage?.receiptComplete === true,
            visualInputTokens: visualInputs[index] || 0,
            visualOutputTokens: visualOutputs[index] || 0,
            visualPriceEquivalentCny: visualCosts[index] || 0,
            audioInputTokens: Number(audioUsage?.inputTokens) || 0,
            audioOutputTokens: Number(audioUsage?.outputTokens) || 0,
            audioCostCny: audioCost,
          },
        };
        outcomes.push(failed);
        await emitProgress(failed);
      }
      aborted = Boolean(input.abortSignal?.aborted);
      await Promise.allSettled(pack.flatMap((episode) => {
        if (paidEpisodeIndexes.has(episode.episodeIndex)) return [];
        const claim = claims.get(episode.episodeIndex);
        return claim ? [claim.releaseBeforePaidCall()] : [];
      }));
      await releaseUnpaidPacks(packIndex + 1);
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
