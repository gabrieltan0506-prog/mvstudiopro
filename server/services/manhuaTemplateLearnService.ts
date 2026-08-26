/**
 * 漫剧节奏模板 · 单集或合集学习。
 * 每轮按剧集顺序采（短合集有几集采几集；长合集约 8–10）→ 远程语音+高密度抽帧+读帧；
 * 学 1 集即可出草版提案并入库（2026-08-11 拍板；约 16 集更准）。
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildAdaptiveFramePlan,
  speechRegionsFromSilenceDetectLog,
} from "../../shared/manhuaTemplateLearnFramePlan.js";
import {
  applyFrameVisionToProposal,
  resolveManhuaTemplateLearnLlmProvider,
  selectFramesForVisionAnalysis,
  type ManhuaTemplateLearnLlmProvider,
} from "../../shared/manhuaTemplateLearnFrameVision.js";
import { isManhuaNativeDeepReadEnabled } from "./manhuaNativeDeepReadRunner.js";
import {
  runNativeDeepReadBatch,
  type NativeDeepReadEpisodeExecution,
} from "./manhuaNativeDeepReadExecution.js";
import {
  normalizeNativeDeepReadDurationSec,
  splitNativeDeepReadSegments,
  type NativeDeepReadPlanEpisode,
  type NativeDeepReadPlanPreview,
} from "./manhuaNativeDeepReadPlan.js";
import { MANHUA_NATIVE_DEEP_READ_MODEL } from "../../shared/manhuaNativeDeepReadJob.js";
import type { ManhuaNativeModelReceipt } from "../../shared/manhuaNativeModelReceipt.js";
import { listIngestedNativeDeepReadEpisodeRecords } from "./manhuaNativeDeepReadIngest.js";
import {
  aggregateNativeDeepReadSeries,
  type NativeSeriesAggregationResult,
} from "./manhuaNativeSeriesAggregation.js";
import {
  MANHUA_LEARN_ANALYSIS_DRAFT_MIN,
  MANHUA_LEARN_ANALYSIS_MIN,
  MANHUA_LEARN_ANALYSIS_TARGET,
  MANHUA_LEARN_BATCH_DEFAULT,
  MANHUA_LEARN_CHECKPOINT_SEC,
  MANHUA_LEARN_CONSECUTIVE_FAIL_STOP,
  MANHUA_LEARN_EPISODE_RETRY_MAX,
  MANHUA_LEARN_MAX_DURATION_SEC,
  canEmitManhuaLearnAnalysis,
  clampManhuaLearnBatchSize,
  isManhuaLearnListComplete,
  classifyManhuaLearnTitle,
  isManhuaLearnEpisodeComplete,
  mergeEpisodeDigestsIntoProposal,
  mergeManhuaLearnChunkIntoDigest,
  deriveManhuaLearnPaywallState,
  guessLane,
  nextManhuaLearnEpisodeFailureStreak,
  pickNextEpisodeIndexes,
  pickManhuaLearnEpisodeGapMs,
  pickRetrySkippedEpisodeIndexes,
  type ManhuaLearnEpisodeChunk,
  type ManhuaLearnEpisodeDigest,
  type ManhuaLearnSeriesProgress,
} from "../../shared/manhuaTemplateLearnSeries.js";
import {
  isManhuaCompilationDuration,
  normalizeManhuaSeriesTitle,
  placeSingleSourceInExistingSeries,
  type ManhuaLearnListedSource,
} from "../../shared/manhuaLearnSeriesIdentity.js";
import {
  MANHUA_LEARN_STAGE,
  formatManhuaLearnEpisodeDetail,
  manhuaLearnStageLabelZh,
} from "../../shared/manhuaTemplateLearnPipeline.js";
import {
  nextManhuaLearnVideoSegment,
} from "../../shared/manhuaLearnVideoSegments.js";
import {
  parseManhuaViralTemplateCard,
  type ManhuaViralTemplateCard,
  type ManhuaViralTemplateLane,
} from "../../shared/manhuaViralTemplateBank.js";
import {
  analyzeManhuaDramaAudioWithFallback,
  isManhuaAudioFailureRetryable,
  isManhuaDramaAudioAvailable,
  type ManhuaDramaAudioScanResult,
} from "../gemini-audio.js";
import { analyzeManhuaTemplateFrames } from "../manhuaTemplateFrameVision.js";
import { assertManhuaPreviewFramesHaveMotion } from "./manhuaFramePreviewGuard.js";
import {
  extractRemoteManhuaAudio,
  extractRemoteManhuaDenseFrames,
  probeRemoteManhuaMediaDecodability,
  type ManhuaRemoteMediaSource,
} from "./manhuaRemoteMediaSampler.js";
import {
  downloadGcsObject,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcs,
  signGsUriV4ReadUrl,
} from "./gcs.js";
import {
  buildDouyinMixCandidateUrls,
  isDouyinHostUrl,
  isDouyinSingleVideoUrl,
  isManhuaLearnExplicitPaywallHint,
  normalizeDouyinVideoUrl,
  listedSingleEpisodeFromUrl,
  mapManhuaLearnFetchError,
  MANHUA_LEARN_FETCH_ERR,
} from "../../shared/manhuaLearnYtdlp.js";
import {
  extractDouyinMixIdFromUrl,
  extractDouyinVideoIdFromUrl,
  isTrustedDouyinPlaybackUrl,
  type DouyinEpisodeAccess,
} from "../../shared/manhuaLearnDouyinWebApi.js";
import {
  fetchDouyinAwemeDetailViaWebApi,
  listDouyinAwemePlaybackUrlsViaWebApi,
  listDouyinMixEpisodesViaWebApi,
} from "./manhuaLearnDouyinWebApi.js";
import {
  assertYtdlpCookieReadyForUrl,
  execYtdlpJson,
  openYtdlpCookieSession,
  ytdlpCookieCandidateCount,
} from "./manhuaLearnYtdlpRuntime.js";

const execFileAsync = promisify(execFile);

export type ManhuaTemplateLearnInput = {
  url?: string;
  /** Platform 素材分析手动导入的本人 GCS 对象；入口和 worker 均校验归属。 */
  gcsUri?: string;
  fileName?: string;
  title?: string;
  mixId?: string;
  rank?: number;
  /** 本轮采几集：8–10 */
  batchSize?: number;
  /** 只从远程媒体流重抽代表静帧；不重跑语音、视觉模型或系列分析。 */
  refreshPreviewFrames?: boolean;
  /** 只重试此前因来源受限暂跳的集（列表已重新拉取，播放地址随之刷新）。 */
  retrySkippedEpisodes?: boolean;
  learnLlm?: ManhuaTemplateLearnLlmProvider;
  /**
   * 仅供 worker 内部传入：客户端只提交确认码，worker 重算成功后才把完整计划交给服务层。
   * 全局能力开关不等于单次任务已获确认。
   */
  nativeDeepReadConfirmed?: boolean;
  nativePlanPreview?: NativeDeepReadPlanPreview;
  onProgress?: (phase: string, detailZh: string) => void | Promise<void>;
  /** 每完成或中止一段付费精读即持久化累计回执，进程退出也不把已用额度显示成 0。 */
  onNativeUsage?: (receipt: ManhuaNativeDeepReadUsageReceipt) => void | Promise<void>;
  /** 每次模型外呼从 started 到 terminal 都写入 Job；失败正文不得再降成一行进度文案。 */
  onNativeModelReceipt?: (receipt: ManhuaNativeModelReceipt) => void | Promise<void>;
  /** 每个分片落盘后把该集摘要同步进 Job output，供网页即时甄别。 */
  onEpisodeCheckpoint?: (preview: ManhuaLearnDigestPreview) => void | Promise<void>;
  /** 服务端持久控制：停止整部剧或跳过当前集。 */
  checkControl?: () => Promise<"continue" | "cancel" | "skip">;
  abortSignal?: AbortSignal;
};

export type ManhuaLearnDigestPreview = {
  episodeIndex: number;
  title: string;
  hookNoteZh: string;
  transcriptPreview: string;
  durationSec: number;
  learnedThroughSec?: number;
  complete?: boolean;
  previewFrameUrls?: string[];
  categoryLabelZh?: string;
  tagLabelsZh?: string[];
};

export type ManhuaTemplateLearnResult = {
  seriesKey: string;
  analysisReady: boolean;
  learnedCount: number;
  analysisMin: number;
  analysisTarget: number;
  batchLearned: number;
  batchIndexes: number[];
  listedEpisodeCount: number;
  /** 因来源受限暂跳的集号（不计入已学；可用「重试暂跳集」在地址刷新后重试） */
  skippedEpisodeIndexes?: number[];
  /** 明确付费段，不进入技术失败重试。 */
  paywallEpisodeIndexes?: number[];
  paywallStartEpisodeIndex?: number;
  /** 已确认付费段中尚未学完的集数，供后续混剪补学提示。 */
  missingEpisodeCount?: number;
  /** 网页即时展示：已学分集摘要（不落视频，只留结构化结果和代表帧） */
  digestsPreview: ManhuaLearnDigestPreview[];
  /** 与飙升榜同源：类别 / 题材标签（前台中文） */
  categoryLabelZh?: string;
  tagLabelsZh?: string[];
  /** 仅 analysisReady 时有值 */
  proposal: ManhuaViralTemplateCard | null;
  proposalGcsUri: string | null;
  proposalReadUrl?: string;
  visionFilled: boolean;
  messageZh: string;
  workId: string;
  /** 旧任务输出可能没有该字段；所有新 native 结果必须明确写出。 */
  pipelineMode?: "native_deep_read" | "audio_dense_frames";
  nativeUsage?: ManhuaNativeDeepReadUsageReceipt;
};

export type ManhuaNativeDeepReadUsageReceipt = {
  model: string;
  billingMode: "plan_quota" | "payg" | "unknown";
  inputTokens: number;
  outputTokens: number;
  /** 套餐通道是等价用量，不表述为实际扣款。 */
  priceEquivalentCny: number;
  elapsedMs: number;
  receiptComplete: boolean;
  visualInputTokens?: number;
  visualOutputTokens?: number;
  visualPriceEquivalentCny?: number;
  audioInputTokens?: number;
  audioOutputTokens?: number;
  audioCostCny?: number;
  seriesAggregationInputTokens?: number;
  seriesAggregationOutputTokens?: number;
  seriesAggregationReasoningTokens?: number;
  seriesAggregationPriceEquivalentCny?: number;
};

type NativeUsageRow = {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costCny?: number;
  usingPlanQuota?: boolean;
  receiptComplete?: boolean;
  elapsedMs?: number;
  visualInputTokens?: number;
  visualOutputTokens?: number;
  visualPriceEquivalentCny?: number;
  audioInputTokens?: number;
  audioOutputTokens?: number;
  audioCostCny?: number;
  seriesAggregationInputTokens?: number;
  seriesAggregationOutputTokens?: number;
  seriesAggregationReasoningTokens?: number;
  seriesAggregationPriceEquivalentCny?: number;
};

export function mergeManhuaNativeDeepReadUsage(
  current: ManhuaNativeDeepReadUsageReceipt | undefined,
  row: NativeUsageRow | undefined,
): ManhuaNativeDeepReadUsageReceipt | undefined {
  if (!row) return current;
  const rowMode = row.usingPlanQuota === true
    ? "plan_quota"
    : row.usingPlanQuota === false
      ? "payg"
      : "unknown";
  const currentMode = current?.billingMode;
  const billingMode = !currentMode
    ? rowMode
    : currentMode === rowMode
      ? currentMode
      : "unknown";
  return {
    model: String(row.model || current?.model || MANHUA_NATIVE_DEEP_READ_MODEL),
    billingMode,
    inputTokens: (current?.inputTokens || 0) + (Number(row.inputTokens) || 0),
    outputTokens: (current?.outputTokens || 0) + (Number(row.outputTokens) || 0),
    priceEquivalentCny:
      (current?.priceEquivalentCny || 0) + (Number(row.costCny) || 0),
    elapsedMs: (current?.elapsedMs || 0) + (Number(row.elapsedMs) || 0),
    receiptComplete: (current?.receiptComplete ?? true) && row.receiptComplete === true,
    visualInputTokens:
      (current?.visualInputTokens || 0) + (Number(row.visualInputTokens) || 0),
    visualOutputTokens:
      (current?.visualOutputTokens || 0) + (Number(row.visualOutputTokens) || 0),
    visualPriceEquivalentCny:
      (current?.visualPriceEquivalentCny || 0)
      + (Number(row.visualPriceEquivalentCny) || 0),
    audioInputTokens:
      (current?.audioInputTokens || 0) + (Number(row.audioInputTokens) || 0),
    audioOutputTokens:
      (current?.audioOutputTokens || 0) + (Number(row.audioOutputTokens) || 0),
    audioCostCny:
      (current?.audioCostCny || 0) + (Number(row.audioCostCny) || 0),
    seriesAggregationInputTokens:
      (current?.seriesAggregationInputTokens || 0)
      + (Number(row.seriesAggregationInputTokens) || 0),
    seriesAggregationOutputTokens:
      (current?.seriesAggregationOutputTokens || 0)
      + (Number(row.seriesAggregationOutputTokens) || 0),
    seriesAggregationReasoningTokens:
      (current?.seriesAggregationReasoningTokens || 0)
      + (Number(row.seriesAggregationReasoningTokens) || 0),
    seriesAggregationPriceEquivalentCny:
      (current?.seriesAggregationPriceEquivalentCny || 0)
      + (Number(row.seriesAggregationPriceEquivalentCny) || 0),
  };
}

/** 读帧 provenance 跨集聚合（attempted/success 按块累计；model 取最近一集） */
function aggregateDigestFrameVision(
  digests: ManhuaLearnEpisodeDigest[],
): NonNullable<ManhuaViralTemplateCard["provenance"]>["frameVision"] {
  const rows = digests
    .map((d) => d.frameVision)
    .filter(Boolean) as NonNullable<ManhuaLearnEpisodeDigest["frameVision"]>[];
  if (!rows.length) return undefined;
  const last = rows[rows.length - 1];
  return {
    provider: last.provider,
    model: last.model,
    attemptedChunks: rows.reduce((a, r) => a + r.attemptedChunks, 0),
    successChunks: rows.reduce((a, r) => a + r.successChunks, 0),
  };
}

function paywallResultFields(prog: ManhuaLearnSeriesProgress): Pick<
  ManhuaTemplateLearnResult,
  "paywallEpisodeIndexes" | "paywallStartEpisodeIndex" | "missingEpisodeCount"
> {
  const learned = new Set(prog.learnedEpisodeIndexes || []);
  const paywallEpisodeIndexes = Array.from(new Set(prog.paywallEpisodeIndexes || []))
    .filter((index) => Number.isFinite(index) && index >= 1)
    .sort((a, b) => a - b);
  return {
    paywallEpisodeIndexes: paywallEpisodeIndexes.length ? paywallEpisodeIndexes : undefined,
    paywallStartEpisodeIndex: paywallEpisodeIndexes.length
      ? prog.paywallStartEpisodeIndex || paywallEpisodeIndexes[0]
      : undefined,
    missingEpisodeCount: paywallEpisodeIndexes.filter((index) => !learned.has(index)).length,
  };
}

function toDigestPreview(d: ManhuaLearnEpisodeDigest): ManhuaLearnDigestPreview {
  const previewFrameUrls = (d.previewFrameGcsUris || []).flatMap((uri) => {
    try {
      return [signGsUriV4ReadUrl(uri, 7 * 24 * 3600)];
    } catch {
      return [];
    }
  }).slice(0, 3);
  return {
    episodeIndex: d.episodeIndex,
    title: d.title,
    hookNoteZh: d.hookNoteZh,
    transcriptPreview: d.transcriptPreview.slice(0, 800),
    durationSec: d.durationSec,
    learnedThroughSec: d.learnedThroughSec,
    complete: isManhuaLearnEpisodeComplete(d),
    previewFrameUrls: previewFrameUrls.length ? previewFrameUrls : undefined,
    categoryLabelZh: d.categoryLabelZh,
    tagLabelsZh: d.tagLabelsZh,
  };
}

export type ManhuaLearnSnapshotMode = "native_deep_read" | "audio_dense_frames";

/**
 * 快照完成数必须按当前产物代际取值。
 *
 * 原生精读不产 digest；刷新后若仍只数 digest，会把已经落下的待审卡显示成 0 集。
 * `nativeDeepReadEpisodeIndexes` 由每轮有效卡集合覆盖式校准，是刷新恢复的持久真源。
 */
export function resolveManhuaLearnSnapshotCompletion(input: {
  progress: ManhuaLearnSeriesProgress | null;
  completedDigestCount: number;
}): { pipelineMode: ManhuaLearnSnapshotMode; completedCount: number } {
  const nativeIndexes = Array.from(new Set(
    (input.progress?.nativeDeepReadEpisodeIndexes || [])
      .map((value) => Math.floor(Number(value) || 0))
      .filter((value) => value >= 1 && value <= 999),
  )).sort((a, b) => a - b);
  if (nativeIndexes.length > 0) {
    return { pipelineMode: "native_deep_read", completedCount: nativeIndexes.length };
  }
  return {
    pipelineMode: "audio_dense_frames",
    completedCount: Math.max(0, Math.floor(Number(input.completedDigestCount) || 0)),
  };
}

/** 供网页查询合集学习进度与分集摘要 */
export async function getManhuaSeriesLearnSnapshot(seriesKey: string): Promise<{
  progress: ManhuaLearnSeriesProgress | null;
  digestsPreview: ManhuaLearnDigestPreview[];
  /** 已整集学完的数量（digestsPreview 含未学完的检查点，勿拿其长度当完成数） */
  completedCount: number;
  pipelineMode: ManhuaLearnSnapshotMode;
  analysisReady: boolean;
  proposal: ManhuaViralTemplateCard | null;
}> {
  const key = String(seriesKey || "").trim();
  if (!key) {
    return {
      progress: null,
      digestsPreview: [],
      completedCount: 0,
      pipelineMode: "audio_dense_frames",
      analysisReady: false,
      proposal: null,
    };
  }
  const progress = await loadSeriesProgress(key);
  if (progress) {
    // 存量被占位词写脏的 titleHint，读路径也洗（不等下次学习才修复面板显示）
    progress.titleHint = cleanManhuaLearnTitle(progress.titleHint) || "未命名合集";
  }
  const digestsAll = await loadAllDigests(key);
  const digests = digestsAll.filter(isManhuaLearnEpisodeComplete);
  const snapshotCompletion = resolveManhuaLearnSnapshotCompletion({
    progress,
    completedDigestCount: digests.length,
  });
  // native 的正式产物是一集一张卡；旧 digest 不能在刷新后冒充当前模式的分集结果。
  const digestsPreview = snapshotCompletion.pipelineMode === "native_deep_read"
    ? []
    : digestsAll.map(toDigestPreview);
  const completeIndexes = digests.map((d) => d.episodeIndex);
  // 集合包含判定（审查必须修11）：只认可靠索引集合。存量 progress 无
  // listedEpisodeIndexes 时不做总数比较——历史接口抖动曾把 count 缩成 1，
  // 「learned>=count」会把伪单集判成合集学完；旧数据只走 4/16 集门槛。
  const allListedComplete = progress
    ? isManhuaLearnListComplete(progress.listedEpisodeIndexes, completeIndexes)
    : false;
  const analysisReady = snapshotCompletion.pipelineMode === "native_deep_read"
    ? false
    : canEmitManhuaLearnAnalysis(digests.length, { allListedComplete });
  let proposal: ManhuaViralTemplateCard | null = null;
  if (analysisReady && progress) {
    // 审查收紧：快照只回真实落盘的 proposed 提案（seriesKey 已带 provider 命名空间）。
    // 不再返回内存重建的启发式卡——批准端也只认落盘，杜绝「凭 env 伪造版本」整条链。
    const fromGcs = await readJsonGcs<ManhuaViralTemplateCard>(
      `manhua-template-learn/proposals/tpl_series_${key}.json`,
    );
    if (fromGcs && fromGcs.status === "proposed") {
      proposal = parseManhuaViralTemplateCard(fromGcs);
    }
    // status=approved：已入库，不再给可批准的提案（防重复批准循环）
  }
  return {
    progress,
    digestsPreview,
    completedCount: snapshotCompletion.completedCount,
    pipelineMode: snapshotCompletion.pipelineMode,
    analysisReady,
    proposal,
  };
}

function gcsBucketHint(): string {
  return String(
    process.env.GCS_BUCKET_NAME
      || process.env.GROWTH_CAMP_GCS_BUCKET
      || process.env.VERTEX_GCS_BUCKET
      || process.env.GOOGLE_CLOUD_STORAGE_BUCKET
      || "mv-studio-pro-vertex-video-temp",
  ).trim();
}

/**
 * 前端占位词不算剧名：旧版贴链接路径把「贴链接学习」当 title 传上来，
 * 会把详情接口回填的真剧名压住，且已写进存量 progress——这里统一洗掉。
 */
const MANHUA_LEARN_TITLE_PLACEHOLDERS = new Set(["未命名合集", "贴链接学习"]);

function cleanManhuaLearnTitle(raw?: string | null): string {
  const t = String(raw || "").trim();
  return MANHUA_LEARN_TITLE_PLACEHOLDERS.has(t) ? "" : t;
}

/**
 * 剥外层书名号（mix_name 常自带《》，进度行再包一层会变《《》》）。
 * 只在整体被一对《》包裹且内部不再含书名号时才剥——单侧剥会把
 * 「XXX《动态漫画》」「《XX》第二季」这类高频命名剥坏并写脏进度。
 */
function stripBookTitleMarks(raw?: string | null): string {
  const t = String(raw || "").trim();
  const m = /^《(.*)》$/.exec(t);
  return m && !m[1].includes("《") && !m[1].includes("》") ? m[1].trim() : t;
}

/** 旧 Claude/DeepSeek 进度保留原命名空间；所有新任务在调用前已归一为 GPT 主命名空间。 */
function seriesKeyFrom(input: {
  url: string;
  mixId?: string;
  title?: string;
  learnLlm?: "gpt" | "claude" | "deepseek";
}): string {
  const ns =
    input.learnLlm === "claude" ? ":claude" : input.learnLlm === "deepseek" ? ":deepseek" : "";
  const mix = String(input.mixId || "").trim();
  if (mix) return createHash("sha1").update(`mix:${mix}${ns}`).digest("hex").slice(0, 12);
  return createHash("sha1")
    .update(`${String(input.url || input.title || "series")}${ns}`)
    .digest("hex")
    .slice(0, 12);
}

function seriesKeyFromProgressObjectName(name: string): string {
  const match = /^manhua-template-learn\/series\/([^/]+)\/progress\.json$/.exec(name);
  return String(match?.[1] || "").trim();
}

/**
 * 大合集和分集可能是不同 URL / mixId；先按真实剧名复用已有系列。
 * 列表或 progress 读取异常时 fail-closed，避免因一次 GCS 抖动建出重复剧。
 */
export async function resolveManhuaSeriesKey(input: {
  sourceIdentity: string;
  mixId?: string;
  title?: string;
  learnLlm: ManhuaTemplateLearnLlmProvider;
}): Promise<string> {
  const normalizedTitle = normalizeManhuaSeriesTitle(input.title);
  if (normalizedTitle) {
    const names = await listGcsObjectNamesByPrefix({
      prefix: "manhua-template-learn/series/",
      maxResults: 500,
    });
    for (const name of names) {
      const existingKey = seriesKeyFromProgressObjectName(name);
      if (!existingKey) continue;
      const read = await readJsonGcsDetailed<ManhuaLearnSeriesProgress>(name);
      if (read.status === "error") {
        throw new Error("无法核对已有同名剧进度，未创建重复剧，请稍后重试");
      }
      if (read.status !== "found") continue;
      const existingProvider = read.value.learnLlm || "gpt";
      if (existingProvider !== input.learnLlm) continue;
      if (normalizeManhuaSeriesTitle(read.value.titleHint) === normalizedTitle) {
        return read.value.seriesKey || existingKey;
      }
    }
    // 旧数据未匹配时，新剧改用「剧名+历史模型档」的确定 key：
    // 同名大合集/分集即使 URL、mixId 不同，并发首次学习也落在同一系列。
    const ns =
      input.learnLlm === "claude" ? ":claude" : input.learnLlm === "deepseek" ? ":deepseek" : "";
    return createHash("sha1")
      .update(`title:${normalizedTitle}${ns}`)
      .digest("hex")
      .slice(0, 12);
  }
  return seriesKeyFrom({
    url: input.sourceIdentity,
    mixId: input.mixId,
    title: input.title,
    learnLlm: input.learnLlm,
  });
}


function episodeObjectName(seriesKey: string, episodeIndex: number): string {
  return `manhua-template-learn/series/${seriesKey}/episodes/ep_${String(episodeIndex).padStart(4, "0")}.json`;
}

async function silenceDetectLog(audioPath: string): Promise<string> {
  try {
    const { stderr } = await execFileAsync("ffmpeg", [
      "-i",
      audioPath,
      "-af",
      "silencedetect=noise=-32dB:d=0.45",
      "-f",
      "null",
      "-",
    ]);
    return String(stderr || "");
  } catch (e: unknown) {
    const err = e as { stderr?: string };
    return String(err.stderr || "");
  }
}

async function withYtdlpCookieCandidates<T>(
  url: string,
  run: (cookieArgs: string[], candidateIndex: number) => Promise<T>,
): Promise<T> {
  const attemptCount = isDouyinHostUrl(url) ? ytdlpCookieCandidateCount() : 1;
  let lastError: unknown = new Error(MANHUA_LEARN_FETCH_ERR.downloadFailed);
  for (let candidateIndex = 0; candidateIndex < attemptCount; candidateIndex++) {
    const cookies = await openYtdlpCookieSession(candidateIndex);
    try {
      return await run(cookies.args, candidateIndex);
    } catch (error) {
      lastError = error;
      if (candidateIndex + 1 < attemptCount) {
        console.warn(
          "[manhuaTemplateLearn] yt-dlp cookie candidate failed, trying next:",
          `candidate=${candidateIndex + 1}/${attemptCount}`,
          mapManhuaLearnFetchError(error),
        );
      }
    } finally {
      await cookies.cleanup();
    }
  }
  throw lastError;
}

type ListedEpisode = ManhuaLearnListedSource;

/**
 * 分集远程媒体源状态：只消费官方播放地址或本人 GCS 签名地址；
 * Douyin 页面 URL 不当作视频流，避免抽到「请前往 App 观看」限制页。
 */
type EpisodeSourceState = {
  playbackUrl?: string;
  playbackDead?: boolean;
  playbackRefreshAttempted?: boolean;
  playbackRefreshUrls?: string[];
  ytdlpRefreshAttempted?: boolean;
  ytdlpRefreshUrls?: string[];
  resolvedStreamUrl?: string;
  triedStreamUrls?: string[];
};

export function readMuxedPlaybackUrlsFromYtdlpInfo(data: unknown): string[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const root = data as Record<string, unknown>;
  const candidates: string[] = [];
  const append = (raw: unknown) => {
    const url = typeof raw === "string" ? raw.trim() : "";
    if (url && isTrustedDouyinPlaybackUrl(url) && !candidates.includes(url)) candidates.push(url);
  };
  const formats = Array.isArray(root.formats) ? root.formats : [];
  const muxedFormats = formats.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const format = raw as Record<string, unknown>;
    const audioCodec = String(format.acodec || "").trim().toLowerCase();
    const videoCodec = String(format.vcodec || "").trim().toLowerCase();
    // 当前采样器要求同一地址同时具备语音与画面；分离轨不能冒充成功。
    if (!audioCodec || !videoCodec || audioCodec === "none" || videoCodec === "none") return [];
    return [{
      url: format.url,
      height: Number(format.height) || 0,
      bitrate: Number(format.tbr) || Number(format.vbr) || 0,
      index,
    }];
  }).sort((a, b) => b.height - a.height || b.bitrate - a.bitrate || a.index - b.index);
  for (const format of muxedFormats) {
    append(format.url);
  }
  // root.url 经常与 Web API 的受限默认流相同；放到明确的 muxed formats 之后。
  append(root.url);
  return candidates;
}

/** 媒体解码失败后优先换来源家族，避免三个 Web API 镜像耗尽整集重试。 */
export function orderEpisodeMediaFallbackUrls(
  webApiUrls: string[],
  ytdlpUrls: string[],
): string[] {
  return Array.from(new Set([...ytdlpUrls, ...webApiUrls]));
}

async function refreshEpisodePlaybackUrlsViaYtdlp(
  ep: ListedEpisode,
  state: EpisodeSourceState,
): Promise<string[]> {
  if (state.ytdlpRefreshAttempted) return state.ytdlpRefreshUrls || [];
  state.ytdlpRefreshAttempted = true;
  if (!isDouyinHostUrl(ep.url)) return [];
  try {
    assertYtdlpCookieReadyForUrl(ep.url);
    const urls = await withYtdlpCookieCandidates(ep.url, async (cookieArgs) => {
      const data = await execYtdlpJson([
        ...cookieArgs,
        "-J",
        "--no-playlist",
        "--no-warnings",
        ep.url,
      ]);
      const parsed = readMuxedPlaybackUrlsFromYtdlpInfo(data);
      if (!parsed.length) throw new Error("yt-dlp 未解析到同时含语音与画面的媒体流");
      return parsed;
    });
    state.ytdlpRefreshUrls = urls;
    return urls;
  } catch (error) {
    console.warn(
      "[manhuaTemplateLearn] yt-dlp direct stream fallback failed:",
      ep.index,
      mapManhuaLearnFetchError(error),
    );
    state.ytdlpRefreshUrls = [];
    return [];
  }
}

function episodeDownloadSource(
  ep: ListedEpisode,
  state: EpisodeSourceState,
): { url: string; viaPlayback: boolean } {
  const playbackUrl = state.playbackUrl || ep.playbackUrl;
  if (!state.playbackDead && playbackUrl) {
    return { url: playbackUrl, viaPlayback: true };
  }
  return { url: ep.url, viaPlayback: false };
}

const DOUYIN_PLAYBACK_REFERER = "https://www.douyin.com/";

/** 官方播放地址 / 本人 GCS 签名地址直连探测时长。 */
async function ffprobeRemoteDuration(url: string): Promise<number> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "ffprobe",
      [
      "-v",
      "error",
      "-user_agent",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "-headers",
      `Referer: ${DOUYIN_PLAYBACK_REFERER}\r\n`,
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        url,
      ],
      // 挂死一个坏 CDN 节点不能拖死整集：20s 拿不到就回退页面探测
      { timeout: 20_000 },
    ));
  } catch {
    // 审查必须修：execFile 失败的 Error.message 含完整命令行（即含签名播放地址），
    // 原样抛出会被上层 warn 打进 Fly 持久日志——收敛成固定文案，地址只留内存
    throw new Error("播放地址探测失败（超时或节点拒绝）");
  }
  const n = Number(String(stdout).trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error("播放地址无法读取时长");
  return n;
}

/** 时长可读不代表含音轨；学习前必须同时确认音频与视频流存在。 */
async function ffprobeRemoteMedia(url: string): Promise<number> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-user_agent",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "-headers",
        `Referer: ${DOUYIN_PLAYBACK_REFERER}\r\n`,
        "-show_entries",
        "format=duration:stream=codec_type",
        "-of",
        "json",
        url,
      ],
      { timeout: 20_000 },
    ));
  } catch {
    throw new Error("播放地址探测失败（超时或节点拒绝）");
  }
  let parsed: { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
  try {
    parsed = JSON.parse(String(stdout || "{}"));
  } catch {
    throw new Error("播放地址返回了无效媒体信息");
  }
  const durationSec = Number(parsed.format?.duration);
  const streamTypes = new Set((parsed.streams || []).map((stream) => stream.codec_type));
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("播放地址无法读取时长");
  if (!streamTypes.has("audio")) throw new Error("播放地址不含音轨");
  if (!streamTypes.has("video")) throw new Error("播放地址不含画面");
  await probeRemoteManhuaMediaDecodability({
    url,
    referer: DOUYIN_PLAYBACK_REFERER,
  });
  return durationSec;
}

async function refreshEpisodePlaybackUrls(
  ep: ListedEpisode,
  state: EpisodeSourceState,
): Promise<string[]> {
  if (state.playbackRefreshAttempted) return state.playbackRefreshUrls || [];
  state.playbackRefreshAttempted = true;
  const awemeId = extractDouyinVideoIdFromUrl(ep.url);
  if (!awemeId) return [];
  // 合集列表通常从主 Cookie 开始；故障刷新从备用候选开始，再回到主候选。
  const fresh = await listDouyinAwemePlaybackUrlsViaWebApi(awemeId, 1).catch(() => []);
  state.playbackRefreshUrls = Array.from(new Set([
    ...(ep.playbackUrls || []),
    ...fresh,
  ]));
  return state.playbackRefreshUrls;
}

async function probeEpisodeDurationWithSourceFailover(
  ep: ListedEpisode,
  state: EpisodeSourceState,
): Promise<number> {
  const source = episodeDownloadSource(ep, state);
  if (!source.viaPlayback) {
    if (!isDouyinHostUrl(ep.url)) {
      const durationSec = await ffprobeRemoteMedia(ep.url);
      state.resolvedStreamUrl = ep.url;
      state.triedStreamUrls = [ep.url];
      return durationSec;
    }
    // Douyin 页面 URL 不是媒体流；不用 ffprobe 白等超时，直接刷新官方播放地址。
  } else {
    try {
      const durationSec = await ffprobeRemoteMedia(source.url);
      state.resolvedStreamUrl = source.url;
      state.triedStreamUrls = [source.url];
      return durationSec;
    } catch (error) {
      console.warn(
        "[manhuaTemplateLearn] playback probe failed, refreshing detail:",
        ep.index,
        error instanceof Error ? error.message : error,
      );
    }
  }
  const refreshedUrls = await refreshEpisodePlaybackUrls(ep, state);
  const ytdlpUrls = await refreshEpisodePlaybackUrlsViaYtdlp(ep, state);
  const fallbackUrls = orderEpisodeMediaFallbackUrls(refreshedUrls, ytdlpUrls);
  for (let index = 0; index < fallbackUrls.length; index++) {
    try {
      state.playbackUrl = fallbackUrls[index];
      const durationSec = await ffprobeRemoteMedia(fallbackUrls[index]!);
      state.resolvedStreamUrl = fallbackUrls[index];
      state.triedStreamUrls = Array.from(new Set([
        ...(state.triedStreamUrls || []),
        fallbackUrls[index]!,
      ]));
      return durationSec;
    } catch {
      console.warn(
        "[manhuaTemplateLearn] refreshed playback probe failed, trying next:",
        ep.index,
        `candidate=${index + 1}/${fallbackUrls.length}`,
      );
    }
  }
  state.playbackDead = true;
  throw new Error("官方媒体流不可用，未启动语音与高密度抽帧；已暂跳该集");
}

function currentEpisodeMediaSource(
  ep: ListedEpisode,
  state: EpisodeSourceState,
): ManhuaRemoteMediaSource {
  const url = String(state.resolvedStreamUrl || "").trim();
  if (!url) throw new Error("尚未取得可读取的媒体流，不能开始学习");
  return {
    url,
    referer: isDouyinHostUrl(ep.url) ? DOUYIN_PLAYBACK_REFERER : undefined,
  };
}

async function advanceEpisodeMediaSource(
  ep: ListedEpisode,
  state: EpisodeSourceState,
): Promise<boolean> {
  if (!isDouyinHostUrl(ep.url)) return false;
  const webApiUrls = await refreshEpisodePlaybackUrls(ep, state);
  const ytdlpUrls = await refreshEpisodePlaybackUrlsViaYtdlp(ep, state);
  const urls = orderEpisodeMediaFallbackUrls(webApiUrls, ytdlpUrls);
  const tried = new Set<string>(
    [...(state.triedStreamUrls || []), state.resolvedStreamUrl]
      .filter((url): url is string => Boolean(url)),
  );
  for (const next of urls) {
    if (tried.has(next)) continue;
    tried.add(next);
    state.triedStreamUrls = Array.from(tried);
    try {
      await ffprobeRemoteMedia(next);
      state.playbackUrl = next;
      state.resolvedStreamUrl = next;
      return true;
    } catch {
      console.warn("[manhuaTemplateLearn] alternate stream probe failed:", ep.index);
    }
  }
  return false;
}

function parseFlatPlaylistEntries(
  data: {
    title?: string;
    entries?: Array<{
      playlist_index?: number;
      title?: string;
      url?: string;
      webpage_url?: string;
      id?: string;
    } | null>;
  },
  fallbackUrl: string,
  titleHint?: string,
): ListedEpisode[] {
  const entries = Array.isArray(data.entries) ? data.entries.filter(Boolean) : [];
  if (entries.length > 0) {
    const out: ListedEpisode[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      const index = Math.max(1, Math.floor(Number(e.playlist_index) || i + 1));
      let epUrl = String(e.webpage_url || e.url || "").trim();
      if (!epUrl && e.id) {
        const id = String(e.id).trim();
        epUrl = /^https?:\/\//i.test(id)
          ? id
          : /^\d+$/.test(id)
            ? `https://www.douyin.com/video/${id}`
            : String(e.url || "").trim();
      }
      if (!epUrl || !/^https?:\/\//i.test(epUrl)) continue;
      out.push({
        index,
        url: epUrl,
        title: String(e.title || `第${index}集`).trim() || `第${index}集`,
      });
    }
    out.sort((a, b) => a.index - b.index);
    const seen = new Set<number>();
    return out.filter((e) => {
      if (seen.has(e.index)) return false;
      seen.add(e.index);
      return true;
    });
  }
  return listedSingleEpisodeFromUrl(
    fallbackUrl,
    String(data.title || titleHint || "第1集").trim() || "第1集",
  );
}

async function listPlaylistViaYtdlp(
  playlistUrl: string,
  titleHint?: string,
): Promise<{ listed: ListedEpisode[]; fromEntries: boolean }> {
  assertYtdlpCookieReadyForUrl(playlistUrl);
  return withYtdlpCookieCandidates(playlistUrl, async (cookieArgs) => {
    const data = (await execYtdlpJson([
      ...cookieArgs,
      "--flat-playlist",
      "-J",
      "--no-warnings",
      playlistUrl,
    ])) as {
      title?: string;
      entries?: Array<{
        playlist_index?: number;
        title?: string;
        url?: string;
        webpage_url?: string;
        id?: string;
      } | null>;
    };
    const fromEntries = Array.isArray(data.entries) && data.entries.filter(Boolean).length > 0;
    return { listed: parseFlatPlaylistEntries(data, playlistUrl, titleHint), fromEntries };
  });
}

type ListedEpisodesResult = {
  listed: ListedEpisode[];
  mixNameZh?: string;
  /**
   * 列表是否可靠：合集成功展开=可靠；**有 mixId 却展开失败回退单集=不可靠**
   * （接口抖动降级，不许参与「合集全学完」判定，也不许并进 progress 的可靠集合）
   */
  reliable: boolean;
};

/**
 * 有数字 mixId 时优先展开合集多集；失败再回退成片/单集 URL。
 * 展开首选趋势采集器同款抖音 web API——collection/mix 页改版后
 * yt-dlp flat-playlist 解析已死（生产日志实锤），老路只留作兜底。
 */
async function listOrderedEpisodes(
  sourceUrl: string,
  titleHint?: string,
  mixId?: string,
  single?: {
    titleZh?: string;
    episodeIndex?: number;
    playbackUrl?: string;
    playbackUrls?: string[];
    access?: DouyinEpisodeAccess;
  },
): Promise<ListedEpisodesResult> {
  const id = String(mixId || "").trim();
  if (/^\d{6,}$/.test(id)) {
    try {
      const viaApi = await listDouyinMixEpisodesViaWebApi(id);
      if (viaApi && viaApi.episodes.length > 0) {
        console.info(
          `[manhuaTemplateLearn] mix expand via web api: entries=${viaApi.episodes.length} mixId=${id} complete=${viaApi.complete}`,
        );
        // 残缺列表只用于本批学习，不算可靠全集（第五轮复审 P1·11）：
        // 否则前几十集会被当全集、提前判「合集学完」出草案
        return { listed: viaApi.episodes, mixNameZh: viaApi.mixNameZh, reliable: viaApi.complete };
      }
    } catch (e) {
      console.warn(
        "[manhuaTemplateLearn] mix web api expand failed:",
        id,
        e instanceof Error ? e.message : e,
      );
    }
  }
  const mixCandidates = buildDouyinMixCandidateUrls(id);
  for (const mixUrl of mixCandidates) {
    try {
      const { listed } = await listPlaylistViaYtdlp(mixUrl, titleHint);
      if (listed.length > 1) {
        console.info(
          `[manhuaTemplateLearn] mix expand ok: mixId entries=${listed.length} via ${mixUrl.slice(0, 60)}`,
        );
        return { listed, reliable: true };
      }
    } catch (e) {
      console.warn(
        "[manhuaTemplateLearn] mix expand failed:",
        mixUrl.slice(0, 80),
        e instanceof Error ? e.message : e,
      );
    }
  }

  // 单集成片页：不必 --flat-playlist（抖音常因此先撞登录态）。
  // modal_id 弹层链接归一化成 /video/ 标准形态——yt-dlp 只稳定认后者。
  // 详情接口给过真实集号/标题时带上，避免同剧多条单集链接都占第 1 集互相覆盖
  if (isDouyinSingleVideoUrl(sourceUrl)) {
    return {
      listed: listedSingleEpisodeFromUrl(
        normalizeDouyinVideoUrl(sourceUrl),
        single?.titleZh || titleHint,
        single?.episodeIndex,
      ).map((e) => ({
        ...e,
        playbackUrl: single?.playbackUrl,
        playbackUrls: single?.playbackUrls,
        access: single?.access,
      })),
      // 有 mixId 却走到单集回退 = 合集展开失败的降级列表，不可靠
      reliable: !/^\d{6,}$/.test(id),
    };
  }

  try {
    const { listed, fromEntries } = await listPlaylistViaYtdlp(sourceUrl, titleHint);
    // 审查必须修11：collection/mix 页没解出 entries 时 parse 会伪造「第1集」——
    // 那是降级列表，不许标可靠（否则学完 1 集就被判「合集全学完」提早出草案）
    return { listed, reliable: fromEntries };
  } catch (e) {
    throw new Error(mapManhuaLearnFetchError(e));
  }
}

async function readJsonGcs<T>(objectName: string): Promise<T | null> {
  const res = await readJsonGcsDetailed<T>(objectName);
  return res.status === "found" ? res.value : null;
}

/**
 * 三态读取（审查必须修12）：把 404 与「GCS 抖动/鉴权失败/坏 JSON」分开——
 * 只有确认不存在才允许补写，瞬时读取失败不许当「文件不存在」去覆盖落盘提案。
 */
async function readJsonGcsDetailed<T>(
  objectName: string,
): Promise<
  | { status: "found"; value: T }
  | { status: "not_found" }
  | { status: "error"; errorNote: string }
> {
  let buffer: Buffer;
  try {
    ({ buffer } = await downloadGcsObject({
      gcsUri: `gs://${gcsBucketHint()}/${objectName}`,
    }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = (e as { code?: number | string })?.code;
    if (code === 404 || /No such object|does not exist|notFound|404/i.test(msg)) {
      return { status: "not_found" };
    }
    return { status: "error", errorNote: msg.slice(0, 200) };
  }
  try {
    return { status: "found", value: JSON.parse(buffer.toString("utf8")) as T };
  } catch (e) {
    // 坏 JSON = 存在但读不出：按 error 处理，不许覆盖
    return {
      status: "error",
      errorNote: `bad_json:${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`,
    };
  }
}

async function writeJsonGcs(objectName: string, value: unknown): Promise<string> {
  const uploaded = await uploadBufferToGcs({
    objectName,
    buffer: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
    contentType: "application/json",
  });
  return uploaded.gcsUri;
}

async function loadSeriesProgress(seriesKey: string): Promise<ManhuaLearnSeriesProgress | null> {
  return readJsonGcs<ManhuaLearnSeriesProgress>(
    `manhua-template-learn/series/${seriesKey}/progress.json`,
  );
}

async function loadAllDigests(seriesKey: string): Promise<ManhuaLearnEpisodeDigest[]> {
  const prefix = `manhua-template-learn/series/${seriesKey}/episodes/`;
  let names: string[] = [];
  try {
    names = await listGcsObjectNamesByPrefix({ prefix, maxResults: 80 });
  } catch {
    return [];
  }
  const digests: ManhuaLearnEpisodeDigest[] = [];
  for (const name of names) {
    if (!/\.json$/i.test(name)) continue;
    const d = await readJsonGcs<ManhuaLearnEpisodeDigest>(name);
    if (d && d.episodeIndex >= 1) digests.push(d);
  }
  return digests.sort((a, b) => a.episodeIndex - b.episodeIndex);
}

async function rmrf(dir: string) {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

function manhuaLearnControlError(kind: "cancel" | "skip"): Error {
  const error = new Error(kind === "cancel" ? "用户已停止学习" : "用户已跳过当前集");
  error.name = kind === "cancel" ? "ManhuaLearnCancelledError" : "ManhuaLearnSkipEpisodeError";
  return error;
}

async function assertManhuaLearnControl(
  input: Pick<ManhuaTemplateLearnInput, "checkControl" | "abortSignal">,
): Promise<void> {
  if (input.abortSignal?.aborted) throw manhuaLearnControlError("cancel");
  const state = await input.checkControl?.();
  if (state === "cancel" || state === "skip") throw manhuaLearnControlError(state);
}

async function persistEpisodePreviewFrames(input: {
  seriesKey: string;
  episodeIndex: number;
  framePaths: string[];
}): Promise<string[]> {
  if (!input.seriesKey || !input.framePaths.length) return [];
  const indexes = Array.from(new Set([
    0,
    Math.floor((input.framePaths.length - 1) / 2),
    input.framePaths.length - 1,
  ])).filter((i) => i >= 0 && i < input.framePaths.length).slice(0, 3);
  const uris: string[] = [];
  for (let slot = 0; slot < indexes.length; slot++) {
    const framePath = input.framePaths[indexes[slot]!]!;
    const uploaded = await uploadBufferToGcs({
      objectName: `manhua-template-learn/series/${input.seriesKey}/episodes/${input.episodeIndex}/preview-${slot + 1}.jpg`,
      buffer: await fs.readFile(framePath),
      contentType: "image/jpeg",
    });
    uris.push(uploaded.gcsUri);
  }
  return uris;
}

async function learnOneEpisodeChunk(input: {
  seriesKey: string;
  ep: ListedEpisode;
  titleHint: string;
  learnLlm: ManhuaTemplateLearnLlmProvider;
  mediaSource: ManhuaRemoteMediaSource;
  startSec: number;
  endSec: number;
  chunkDir: string;
  onProgress?: ManhuaTemplateLearnInput["onProgress"];
  checkControl?: ManhuaTemplateLearnInput["checkControl"];
  abortSignal?: AbortSignal;
  capturePreviewFrames?: boolean;
}): Promise<ManhuaLearnEpisodeChunk> {
  const chunkLen = Math.max(1, input.endSec - input.startSec);
  const rangeZh = `${Math.floor(input.startSec / 60)}–${Math.ceil(input.endSec / 60)} 分`;

  await assertManhuaLearnControl(input);

  await input.onProgress?.(
    MANHUA_LEARN_STAGE.audio,
    formatManhuaLearnEpisodeDetail(
      MANHUA_LEARN_STAGE.audio,
      input.ep.index,
      rangeZh,
    ),
  );
  const audioPath = path.join(input.chunkDir, "audio.mp3");
  await extractRemoteManhuaAudio({
    source: input.mediaSource,
    startSec: input.startSec,
    durationSec: chunkLen,
    outputPath: audioPath,
  });

  if (!isManhuaDramaAudioAvailable()) throw new Error("语音分析服务未配置，本分片未计入已学");
  const audioBuf = await fs.readFile(audioPath);
  if (audioBuf.length > 18 * 1024 * 1024) {
    throw new Error("语音分片超过分析上限，本分片未计入已学");
  }
  await assertManhuaLearnControl(input);
  let geminiScan: ManhuaDramaAudioScanResult;
  try {
    geminiScan = await analyzeManhuaDramaAudioWithFallback({
      audioBase64: audioBuf.toString("base64"),
      mimeType: "audio/mpeg",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "语音分析失败";
    throw new Error(`${reason}，本分片未计入已学`);
  }
  if (!String(geminiScan.transcriptSummary || "").trim() && !geminiScan.sections?.length) {
    throw new Error("语音分析没有产出可用内容，本分片未计入已学");
  }
  const audioAnalysis: NonNullable<ManhuaLearnEpisodeChunk["audioAnalysis"]> = {
    model: String(geminiScan.model || ""),
    attempted: true,
    success: true,
  };

  const silenceLog = await silenceDetectLog(audioPath);
  const speechRegions = speechRegionsFromSilenceDetectLog(silenceLog, chunkLen);
  const plan = buildAdaptiveFramePlan({
    durationSec: chunkLen,
    geminiSections: geminiScan?.sections,
    speechRegions,
  });
  await assertManhuaLearnControl(input);
  await input.onProgress?.(
    MANHUA_LEARN_STAGE.frames,
    formatManhuaLearnEpisodeDetail(
      MANHUA_LEARN_STAGE.frames,
      input.ep.index,
      `${rangeZh} · 基线每 3 秒，高能段每 0.5 秒`,
    ),
  );
  const framesDir = path.join(input.chunkDir, "frames");
  const denseSample = await extractRemoteManhuaDenseFrames({
    source: input.mediaSource,
    segmentStartSec: input.startSec,
    durationSec: chunkLen,
    framesDir,
    baseTimestamps: plan.baseTimestamps,
    climaxWindows: plan.climaxWindows,
  });
  if (!denseSample.success) {
    throw new Error(
      `高密度抽帧不足（计划 ${denseSample.requestedCount} 张，实际 ${denseSample.extractedCount} 张），本分片未计入已学`,
    );
  }
  const framePaths = denseSample.frames.map((frame) => frame.path);
  const timestamps = denseSample.frames.map((frame) => frame.atSec);
  await assertManhuaLearnControl(input);
  // 所有来源都验帧：限制页、黑屏、静止页不能靠换域名绕过。
  await assertManhuaPreviewFramesHaveMotion(framePaths);
  const denseFrames: NonNullable<ManhuaLearnEpisodeChunk["denseFrames"]> = {
    requestedCount: denseSample.requestedCount,
    extractedCount: denseSample.extractedCount,
    validMotion: true,
    success: true,
  };
  const previewFrameGcsUris = input.capturePreviewFrames
    ? await persistEpisodePreviewFrames({
        seriesKey: input.seriesKey,
        episodeIndex: input.ep.index,
        framePaths,
      })
    : [];

  const transcriptPreview = String(geminiScan?.transcriptSummary || "")
    .replace(/\s+/g, " ")
    .slice(0, 400);

  let hookNoteZh = "待补钩子";
  let beatHints = timestamps.slice(0, 8).map((t) => ({
    atSec: Math.round(t),
    conflictZh: "待视觉读帧补全",
    visualZh: `关键帧 @${t.toFixed(1)}s`,
  }));
  const sceneHints: string[] = [];
  let seriesDraftEvidence: ManhuaLearnEpisodeChunk["seriesDraftEvidence"];

  await input.onProgress?.(
    MANHUA_LEARN_STAGE.vision,
    formatManhuaLearnEpisodeDetail(
      MANHUA_LEARN_STAGE.vision,
      input.ep.index,
      rangeZh,
    ),
  );
  // 读帧 provenance（审查必须修13）：真实尝试/成功分别记账，异常不再被吞成「像成功」
  const { MANHUA_TEMPLATE_FRAME_VISION_MODEL } = await import(
    "../../shared/manhuaTemplateLearnFrameVision.js"
  );
  const visionProvider = "openai";
  const visionProvenance: NonNullable<ManhuaLearnEpisodeChunk["vision"]> = {
    provider: visionProvider,
    model: MANHUA_TEMPLATE_FRAME_VISION_MODEL,
    attempted: false,
    success: false,
  };
  try {
    const paired = framePaths.map((p, i) => ({
      path: p,
      atSec: Number(timestamps[i]) || 0,
    }));
    const selected = selectFramesForVisionAnalysis(paired, 16);
    const frames = [];
    for (const item of selected) {
      const buf = await fs.readFile(item.path);
      frames.push({
        atSec: item.atSec,
        dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`,
        mimeType: "image/jpeg",
      });
    }
    if (frames.length) {
      const draft = {
        id: `ep_tmp_${input.ep.index}_${Math.floor(input.startSec)}`,
        nameZh: "分集草案",
        laneZh: guessLane(`${input.titleHint} ${transcriptPreview}`) as ManhuaViralTemplateLane,
        summaryZh: "分集",
        hook3sZh: "待补",
        beatGrid: beatHints,
        scenePoolHints: [] as string[],
        castShape: { leadDesireZh: "待补", pressureZh: "待补" },
        densityHints: {
          minBodyChars: 280,
          minDialogueLines: 8,
          minLocationHits: 2,
        },
        sourceRefs: [{ url: input.ep.url, fetchedAt: new Date().toISOString().slice(0, 10) }],
        status: "proposed" as const,
      };
      visionProvenance.attempted = true;
      await assertManhuaLearnControl(input);
      const vision = await analyzeManhuaTemplateFrames({
        frames,
        titleHint: `${input.titleHint} · ${input.ep.title} · ${rangeZh}`,
        durationSec: chunkLen,
        transcriptPreview,
        climaxNotes: plan.climaxWindows.map((w) => w.reasonZh),
        fallbackLane: draft.laneZh,
        learnProvider: input.learnLlm,
        requestId: `manhua-frame-${input.seriesKey}-${input.ep.index}-${Math.round(input.startSec)}-${Math.round(input.endSec)}`,
        abortSignal: input.abortSignal,
      });
      await assertManhuaLearnControl(input);
      visionProvenance.success = true;
      visionProvenance.model = String(vision.model || visionProvenance.model);
      const filled = applyFrameVisionToProposal(draft, vision);
      if (filled) {
        hookNoteZh = filled.hook3sZh;
        seriesDraftEvidence = {
          laneZh: filled.laneZh,
          summaryZh: filled.summaryZh,
          castShape: {
            leadDesireZh: filled.castShape.leadDesireZh,
            pressureZh: filled.castShape.pressureZh,
            foilZh: filled.castShape.foilZh,
          },
        };
        beatHints = filled.beatGrid.map((b) => ({
          ...b,
          // 读帧若返回相对秒，叠回绝对时间；已是绝对则保持
          atSec:
            Number(b.atSec) <= chunkLen + 1
              ? Math.round(Number(b.atSec) + input.startSec)
              : Math.round(Number(b.atSec) || 0),
        }));
        sceneHints.push(...(filled.scenePoolHints || []));
      } else {
        throw new Error("关键帧结果未能生成可聚合的系列底稿结构");
      }
    } else {
      throw new Error("高密度抽帧没有可供视觉分析的画面");
    }
  } catch (e) {
    await assertManhuaLearnControl(input);
    if (e instanceof Error && /ManhuaLearn(Cancelled|SkipEpisode)Error/.test(e.name)) throw e;
    visionProvenance.errorNote = (e instanceof Error ? e.message : String(e)).slice(0, 160);
    console.warn(
      "[manhuaTemplateLearn] chunk vision failed:",
      input.ep.index,
      rangeZh,
      e instanceof Error ? e.message : e,
    );
    throw new Error("高密度画面分析失败，本分片未计入已学");
  }

  return {
    startSec: input.startSec,
    endSec: input.endSec,
    transcriptPreview,
    hookNoteZh,
    beatHints,
    climaxNotes: plan.climaxWindows.map((w) => w.reasonZh).slice(0, 6),
    sceneHints: sceneHints.slice(0, 8),
    seriesDraftEvidence,
    learnedAt: new Date().toISOString(),
    previewFrameGcsUris: previewFrameGcsUris.length ? previewFrameGcsUris : undefined,
    audioAnalysis,
    denseFrames,
    vision: visionProvenance,
  };
}

/** 已学分集的补救：从媒体流重抽首分钟代表帧，不落视频、不重复烧语音/视觉模型成本。 */
async function refreshEpisodePreviewFrames(input: {
  seriesKey: string;
  ep: ListedEpisode;
  digest: ManhuaLearnEpisodeDigest;
  rootTmp: string;
  onProgress?: ManhuaTemplateLearnInput["onProgress"];
  checkControl?: ManhuaTemplateLearnInput["checkControl"];
  abortSignal?: AbortSignal;
}): Promise<ManhuaLearnEpisodeDigest> {
  const workDir = path.join(input.rootTmp, `repair-preview-${input.ep.index}`);
  const durationSec = Math.max(1, Number(input.digest.durationSec) || 60);
  const endSec = Math.min(durationSec, 60);
  try {
    await assertManhuaLearnControl(input);
    await input.onProgress?.(
      MANHUA_LEARN_STAGE.download,
      `正在补抽第 ${input.ep.index} 集静帧 0–${Math.ceil(endSec / 60)} 分（不重跑模型）…`,
    );
    const sourceState: EpisodeSourceState = { playbackUrl: input.ep.playbackUrl };
    await probeEpisodeDurationWithSourceFailover(input.ep, sourceState);
    const plan = buildAdaptiveFramePlan({ durationSec: endSec });
    const sample = await extractRemoteManhuaDenseFrames({
      source: currentEpisodeMediaSource(input.ep, sourceState),
      segmentStartSec: 0,
      durationSec: endSec,
      framesDir: path.join(workDir, "frames"),
      baseTimestamps: plan.baseTimestamps,
      climaxWindows: [],
    });
    if (!sample.success) throw new Error("静帧补抽密度不足");
    const framePaths = sample.frames.map((frame) => frame.path);
    await assertManhuaPreviewFramesHaveMotion(framePaths);
    const previewFrameGcsUris = await persistEpisodePreviewFrames({
      seriesKey: input.seriesKey,
      episodeIndex: input.ep.index,
      framePaths,
    });
    if (!previewFrameGcsUris.length) throw new Error("静帧补抽未生成可展示图片");
    await input.onProgress?.(MANHUA_LEARN_STAGE.persist, `第 ${input.ep.index} 集静帧已补齐（未重跑模型）`);
    return { ...input.digest, previewFrameGcsUris };
  } finally {
    await rmrf(workDir);
  }
}

/**
 * 整集分段学：先探测总时长，再按约 10 分钟从远程媒体流提取语音与高密度静帧；
 * 不落 MP4。每段只有语音、密集帧和视觉理解三路同时成功才推进检查点。
 */
/**
 * 把素材接入层的产出，组装成原生精读的**逐集执行计划**。
 *
 * 这里是新旧两条链路的接缝：
 *   旧链负责 —— 剧名解析／合集展开／付费边界识别／免费集筛选／cookie 轮换／
 *               **真实媒体流探测**／停止与跳过控制；
 *   新链负责 —— claim → 模型直读 → 入库成一集一张待审卡。
 *
 * 🔴 `resolveNodes` **不走 yt-dlp format 解析**。
 * 那条路只认 `format_id` 以 `bytevc1_540p` 开头的页面 formats，
 * 而这里拿到的是素材接入层**已经探测成功的媒体直链**——直链没有那种 format_id，
 * 再解析一次必然返回 null。改为每次回调都用同一套探测逻辑重新取地址：
 * 抖音地址约 8 分钟失效，runner 跨段时正是靠这个回调刷新。
 * Referer 一并带出，切片时要用（旧抽帧链路一路带着它）。
 */
/**
 * 这一集算不算「已经学过、可以跳过」。
 *
 * **两代各认各的凭证，绝不互相冒充**：
 *   · 抽帧模式认 digest 的 completionPolicy（"audio_dense_frames_v1"）；
 *   · 原生精读模式只认已入库的 native 卡。
 *
 * 反过来两条都要成立：
 *   · 旧 digest 不能让 native 模式判「已完成」——否则给一部学过的剧打开 flag，
 *     一集都不会重学，等于开关没生效；
 *   · native 卡也不能让抽帧模式判「已完成」——两者产出结构不同，
 *     抽帧链路的下游（seriesDraftEvidence 聚合）拿不到 native 卡的内容。
 */
export function isManhuaLearnEpisodeAlreadyLearned(input: {
  nativeDeepReadMode: boolean;
  nativeIngestedEpisodes?: ReadonlySet<number> | null;
  episodeIndex: number;
  existingDigest?: ManhuaLearnEpisodeDigest | null;
}): boolean {
  if (input.nativeDeepReadMode) {
    return Boolean(input.nativeIngestedEpisodes?.has(input.episodeIndex));
  }
  return Boolean(input.existingDigest && isManhuaLearnEpisodeComplete(input.existingDigest));
}

/**
 * 原生精读模式的学习结果。
 *
 * 分集卡是不可变证据与断点；系列聚合卡才是审批、编剧增强实际消费的模板。
 *
 * 抽成纯函数有两个原因：主流程里两处收尾都要用同一套口径；
 * 以及主流程依赖 GCS/yt-dlp 无法直接测，这层契约必须可单独断言。
 */
export function buildNativeDeepReadLearnResult(input: {
  seriesKey: string;
  workId: string;
  nativeCardCount: number;
  batchLearned: number;
  batchIndexes: number[];
  listedEpisodeCount: number;
  skippedEpisodeIndexes?: number[];
  paywallFields: Partial<ManhuaTemplateLearnResult>;
  categoryLabelZh?: string;
  tagLabelsZh?: string[];
  /** 追加在文案末尾的暂跳提示（非 native 特有，沿用主流程口径） */
  skippedHintZh?: string;
  nativeUsage?: ManhuaNativeDeepReadUsageReceipt;
  seriesAggregation?: NativeSeriesAggregationResult;
}): ManhuaTemplateLearnResult {
  const tail = input.skippedHintZh || "";
  return {
    seriesKey: input.seriesKey,
    analysisReady: Boolean(input.seriesAggregation?.card),
    learnedCount: input.nativeCardCount,
    analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
    analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
    batchLearned: input.batchLearned,
    batchIndexes: input.batchIndexes,
    listedEpisodeCount: input.listedEpisodeCount,
    skippedEpisodeIndexes: input.skippedEpisodeIndexes?.length
      ? input.skippedEpisodeIndexes
      : undefined,
    ...input.paywallFields,
    // native 不产 digest，不拿旧 digest 充数
    digestsPreview: [],
    categoryLabelZh: input.categoryLabelZh,
    tagLabelsZh: input.tagLabelsZh,
    proposal: input.seriesAggregation?.card || null,
    proposalGcsUri: input.seriesAggregation?.gcsUri || null,
    visionFilled: Boolean(input.seriesAggregation?.card),
    messageZh: input.batchLearned
      ? input.seriesAggregation
        ? `本轮新增 ${input.batchLearned} 集原生精读证据，已用累计 ${input.seriesAggregation.sourceEpisodeCount} 集重新生成系列待审模板。${tail}`
        : `本轮生成 ${input.batchLearned} 张原生精读证据卡，当前累计 ${input.nativeCardCount} 张；系列聚合尚未完成。${tail}`
      : input.seriesAggregation
        ? `本轮没有重烧分集，已用累计 ${input.seriesAggregation.sourceEpisodeCount} 集重新生成系列待审模板。${tail}`
        : input.nativeCardCount
          ? `当前已有 ${input.nativeCardCount} 张原生精读待审卡，本轮没有新增；系列聚合尚未完成。${tail}`
        : `当前没有可处理的原生精读集，尚未生成待审卡。${tail}`,
    workId: input.workId,
    pipelineMode: "native_deep_read",
    nativeUsage: input.nativeUsage,
  };
}

/**
 * 批次选择用哪一份「已完成集」。
 *
 * `prog.learnedEpisodeIndexes` 里合并了**旧 digest** 的完成集。native 模式若读它，
 * 某集只要在旧 digest 里出现过——哪怕一张 native 卡都没有——也会在**选批次这一步**
 * 被排除，根本进不到循环内的 native 判定。只修循环里的判据是修了一半。
 */
export function pickLearnedIndexesForBatchSelection(input: {
  nativeDeepReadMode: boolean;
  nativeIngestedEpisodes: ReadonlySet<number>;
  progLearnedEpisodeIndexes: number[];
}): number[] {
  return input.nativeDeepReadMode
    ? Array.from(input.nativeIngestedEpisodes).sort((a, b) => a - b)
    : input.progLearnedEpisodeIndexes;
}

/**
 * 用 GCS 上的**有效卡**校准进度副本。
 *
 * 有效卡是 native 完成状态的唯一真源：卡被删/被归档时，进度里的集号要跟着掉，
 * 所以每轮覆盖而不是增量累加。顺带清掉已完成集的暂跳标记——
 * 并发任务会留下「已入库却还挂着受限暂跳」的自相矛盾状态。
 */
export function reconcileManhuaLearnProgressWithNativeCards(
  progress: ManhuaLearnSeriesProgress,
  nativeIngestedEpisodes: ReadonlySet<number>,
  updatedAt = new Date().toISOString(),
): ManhuaLearnSeriesProgress {
  return {
    ...progress,
    nativeDeepReadEpisodeIndexes: Array.from(nativeIngestedEpisodes).sort((a, b) => a - b),
    skippedEpisodeIndexes: (progress.skippedEpisodeIndexes || []).filter(
      (episodeIndex) => !nativeIngestedEpisodes.has(episodeIndex),
    ),
    updatedAt,
  };
}

export type NativeDeepReadEpisodeSourceDeps = {
  probeDuration: (ep: ListedEpisode, state: EpisodeSourceState) => Promise<number>;
  mediaSource: (ep: ListedEpisode, state: EpisodeSourceState) => ManhuaRemoteMediaSource;
};

const defaultNativeDeepReadSourceDeps: NativeDeepReadEpisodeSourceDeps = {
  probeDuration: probeEpisodeDurationWithSourceFailover,
  mediaSource: currentEpisodeMediaSource,
};

export async function buildNativeDeepReadEpisodeExecution(
  input: {
    seriesKey: string;
    ep: ListedEpisode;
    laneHintZh?: string;
    /** 永久溯源标识：GCS 导入传稳定 gs://，抖音来源留空即用 ep.url */
    provenanceSourceRef?: string;
    abortSignal?: AbortSignal;
    /** worker 已复核的本集计划；在 claim 与模型调用前再次核对时长和分段。 */
    confirmedPlanEpisode?: NativeDeepReadPlanEpisode;
  },
  deps: NativeDeepReadEpisodeSourceDeps = defaultNativeDeepReadSourceDeps,
): Promise<NativeDeepReadEpisodeExecution> {
  const probeState: EpisodeSourceState = { playbackUrl: input.ep.playbackUrl };
  const durationSec = await deps.probeDuration(input.ep, probeState);
  if (!(durationSec > 0)) throw new Error(`第 ${input.ep.index} 集未取得可用时长`);
  if (durationSec > MANHUA_LEARN_MAX_DURATION_SEC) {
    throw new Error(
      `第 ${input.ep.index} 集超过 ${Math.round(MANHUA_LEARN_MAX_DURATION_SEC / 60)} 分钟，已跳过策略外片`,
    );
  }
  // 先探一次确认这一集真的可读；读不到就别建 claim、别进付费流程
  deps.mediaSource(input.ep, probeState);

  const total = normalizeNativeDeepReadDurationSec(durationSec);
  const segments = splitNativeDeepReadSegments(total);
  if (input.confirmedPlanEpisode) {
    const expected = input.confirmedPlanEpisode;
    if (
      expected.episodeIndex !== input.ep.index
      || expected.sourceUrl !== input.ep.url
      || normalizeNativeDeepReadDurationSec(expected.durationSec) !== total
      || JSON.stringify(expected.segments) !== JSON.stringify(segments)
    ) {
      throw new Error(`第 ${input.ep.index} 集时长或分段与确认计划不一致，未发出模型请求`);
    }
  }

  return {
    seriesKey: input.seriesKey,
    episodeIndex: input.ep.index,
    sourceUrl: input.ep.url,
    // 卡片里存永久引用；GCS 导入的 7 天签名短链不进永久卡
    provenanceSourceRef: input.provenanceSourceRef,
    durationSec: total,
    laneHintZh: input.laneHintZh,
    segments,
    abortSignal: input.abortSignal,
    resolveNodes: async () => {
      const fresh: EpisodeSourceState = { playbackUrl: input.ep.playbackUrl };
      await deps.probeDuration(input.ep, fresh);
      const media = deps.mediaSource(input.ep, fresh);
      return [{ url: media.url, referer: media.referer }];
    },
  };
}

async function learnOneEpisode(input: {
  seriesKey: string;
  ep: ListedEpisode;
  titleHint: string;
  learnLlm: ManhuaTemplateLearnLlmProvider;
  rootTmp: string;
  existing?: ManhuaLearnEpisodeDigest | null;
  onProgress?: ManhuaTemplateLearnInput["onProgress"];
  onCheckpoint?: (digest: ManhuaLearnEpisodeDigest) => void | Promise<void>;
  checkControl?: ManhuaTemplateLearnInput["checkControl"];
  abortSignal?: AbortSignal;
}): Promise<ManhuaLearnEpisodeDigest> {
  const epDir = path.join(input.rootTmp, `ep_${input.ep.index}`);
  await fs.mkdir(epDir, { recursive: true });
  try {
    if (input.existing && isManhuaLearnEpisodeComplete(input.existing)) {
      return input.existing;
    }

    await assertManhuaLearnControl(input);
    await input.onProgress?.(MANHUA_LEARN_STAGE.download, `正在读取第 ${input.ep.index} 集时长…`);
    const srcState: EpisodeSourceState = { playbackUrl: input.ep.playbackUrl };
    const durationSec = await probeEpisodeDurationWithSourceFailover(input.ep, srcState);
    if (durationSec > MANHUA_LEARN_MAX_DURATION_SEC) {
      throw new Error(
        `第 ${input.ep.index} 集超过 ${Math.round(MANHUA_LEARN_MAX_DURATION_SEC / 60)} 分钟，已跳过策略外片`,
      );
    }

    const classify = classifyManhuaLearnTitle(input.titleHint, input.ep.title);
    // 旧版未完成分片没有语音/高密度画面成功凭证，不与新口径混用。
    // 已完成的旧 digest 在函数开头已直接返回，这里只对旧未完成数据从头重学。
    const resumableExisting = input.existing?.completionPolicy === "audio_dense_frames_v1"
      ? input.existing
      : null;
    let digest: ManhuaLearnEpisodeDigest | null = resumableExisting
      ? {
          ...resumableExisting,
          durationSec: Math.max(resumableExisting.durationSec || 0, durationSec),
          url: input.ep.url,
          title: input.ep.title || resumableExisting.title,
        }
      : null;

    let cursor = Math.max(0, Number(digest?.learnedThroughSec) || 0);
    // 若已有完整 chunks 覆盖，从末尾续
    if (Array.isArray(digest?.chunks) && digest!.chunks!.length) {
      cursor = Math.max(
        cursor,
        ...digest!.chunks!.map((c) => Number(c.endSec) || 0),
      );
    }

    const checkpoint = Math.max(60, MANHUA_LEARN_CHECKPOINT_SEC);
    const retryMax = Math.max(1, MANHUA_LEARN_EPISODE_RETRY_MAX);
    while (cursor < durationSec - 0.5) {
      await assertManhuaLearnControl(input);
      const segment = nextManhuaLearnVideoSegment({
        cursorSec: cursor,
        durationSec,
        segmentSec: checkpoint,
      });
      if (!segment) break;
      const { startSec, endSec } = segment;
      const chunkDir = path.join(
        epDir,
        `chunk_${String(Math.floor(startSec)).padStart(5, "0")}`,
      );
      let chunk: ManhuaLearnEpisodeChunk | null = null;
      let lastErrZh = "";
      for (let attempt = 1; attempt <= retryMax; attempt++) {
        await rmrf(chunkDir);
        await fs.mkdir(chunkDir, { recursive: true });
        try {
          await assertManhuaLearnControl(input);
          await input.onProgress?.(
            MANHUA_LEARN_STAGE.download,
            `正在流式读取第 ${input.ep.index} 集 ${Math.floor(startSec / 60)}–${Math.ceil(endSec / 60)} 分${attempt > 1 ? `（重试 ${attempt}/${retryMax}）` : ""}…`,
          );
          const mediaSource = currentEpisodeMediaSource(input.ep, srcState);
          chunk = await learnOneEpisodeChunk({
            seriesKey: input.seriesKey,
            ep: input.ep,
            titleHint: input.titleHint,
            learnLlm: input.learnLlm,
            mediaSource,
            startSec,
            endSec,
            chunkDir,
            onProgress: input.onProgress,
            checkControl: input.checkControl,
            abortSignal: input.abortSignal,
            capturePreviewFrames: !(digest?.previewFrameGcsUris?.length),
          });
          break;
        } catch (e) {
          if (e instanceof Error && /ManhuaLearn(Cancelled|SkipEpisode)Error/.test(e.name)) throw e;
          lastErrZh = mapManhuaLearnFetchError(e);
          if (
            /媒体流|语音流|抽帧|画面不可解码|数据体|不可解码|节点拒绝|地址已失效|读取超时|连接中断/.test(lastErrZh)
            && attempt < retryMax
          ) {
            const advanced = await advanceEpisodeMediaSource(input.ep, srcState).catch(() => false);
            if (!advanced) {
              lastErrZh = `${lastErrZh}；所有候选媒体流均不可用`;
            }
          }
          await input.onProgress?.(
            MANHUA_LEARN_STAGE.failed,
            `第 ${input.ep.index} 集分片失败（${attempt}/${retryMax}）：${lastErrZh}`,
          );
          if (!isManhuaAudioFailureRetryable(lastErrZh)) break;
        }
      }
      if (!chunk) {
        // 已写入的检查点保留在 GCS；停止本轮避免空跑
        throw new Error(
          `第 ${input.ep.index} 集 ${Math.floor(startSec / 60)}–${Math.ceil(endSec / 60)} 分连续 ${retryMax} 次失败：${lastErrZh || "未知错误"}。已保留此前检查点，可稍后续学。`,
        );
      }

      digest = mergeManhuaLearnChunkIntoDigest({
        prev: digest,
        chunk,
        episodeIndex: input.ep.index,
        url: input.ep.url,
        title: input.ep.title,
        durationSec,
        dramaKind: classify.dramaKind,
        categoryLabelZh: classify.categoryLabelZh,
        tagLabelsZh: classify.tagLabelsZh,
      });

      await input.onCheckpoint?.(digest);
      await input.onProgress?.(
        MANHUA_LEARN_STAGE.persist,
        `第 ${input.ep.index} 集检查点 ${Math.round(endSec / 60)}/${Math.round(durationSec / 60)} 分已写入（语音+高密度画面均通过）`,
      );

      cursor = endSec;
      await rmrf(chunkDir);
    }

    if (!digest) {
      throw new Error(`第 ${input.ep.index} 集未能生成任何学习摘要`);
    }

    digest = {
      ...digest,
      complete: true,
      learnedThroughSec: Math.max(digest.learnedThroughSec || 0, durationSec),
      durationSec,
    };
    await input.onCheckpoint?.(digest);

    await input.onProgress?.(
      MANHUA_LEARN_STAGE.cleanup,
      `第 ${input.ep.index} 集全部片段已学完（未落本地视频）`,
    );
    return digest;
  } finally {
    await rmrf(epDir);
  }
}

function isManhuaProposalSeriesAggregationReady(
  proposal: ManhuaViralTemplateCard,
): boolean {
  return proposal.provenance?.seriesAggregation?.success === true
    // 旧提案兼容：迁移前只有 proposalPolish 标记，读取时不强制重跑模型。
    || proposal.provenance?.proposalPolish?.success === true;
}

/** 关键帧 API 已同时产出底稿结构；系列结束只做确定性聚合与落盘，不再调用第二次模型。 */
async function aggregateAndPersistManhuaProposal(input: {
  seriesKey: string;
  prog: ManhuaLearnSeriesProgress;
  digests: ManhuaLearnEpisodeDigest[];
}): Promise<{
  proposal: ManhuaViralTemplateCard;
  proposalGcsUri: string;
  aggregationOk: boolean;
  visionOk: boolean;
}> {
  const { seriesKey, prog, digests } = input;
  const proposalBase = mergeEpisodeDigestsIntoProposal({
    seriesKey,
    titleHint: prog.titleHint,
    sourceUrl: prog.sourceUrl,
    digests,
  });
  if (!proposalBase) throw new Error("合成提案失败");
  const frameVisionAgg = aggregateDigestFrameVision(digests);
  const sourceChunks = digests.reduce(
    (count, digest) => count + (digest.chunks || []).filter((chunk) => chunk.seriesDraftEvidence).length,
    0,
  );
  const aggregationOk = sourceChunks > 0 && (frameVisionAgg?.successChunks ?? 0) > 0;
  const proposal = {
    ...proposalBase,
    provenance: {
      frameVision: frameVisionAgg,
      seriesAggregation: {
        mode: "frame_vision_deterministic" as const,
        sourceChunks,
        success: aggregationOk,
      },
    },
  };
  const proposalGcsUri = await writeJsonGcs(
    `manhua-template-learn/proposals/${proposal.id}.json`,
    proposal,
  );
  return {
    proposal,
    proposalGcsUri,
    aggregationOk,
    visionOk: (frameVisionAgg?.successChunks ?? 0) > 0,
  };
}

export async function runManhuaTemplateLearn(
  input: ManhuaTemplateLearnInput,
): Promise<ManhuaTemplateLearnResult> {
  const title = stripBookTitleMarks(cleanManhuaLearnTitle(input.title));
  const sourceGcsUri = String(input.gcsUri || "").trim();
  const sourceUrl = String(input.url || "").trim();
  if (!sourceUrl && !sourceGcsUri) {
    throw new Error("缺少合集、成片链接或手动导入视频");
  }
  if (sourceGcsUri && !sourceGcsUri.startsWith("gs://")) {
    throw new Error("手动导入视频地址无效");
  }
  if (/douyin\.com\/search\//i.test(sourceUrl)) {
    throw new Error("当前是搜索页链接，请改用合集/成片页地址");
  }
  // yt-dlp/ffmpeg 只消费短时效 HTTPS；seriesKey 与 GCS 进度始终绑定稳定 gs://。
  const url = sourceGcsUri
    ? signGsUriV4ReadUrl(sourceGcsUri, 7 * 24 * 3600)
    : sourceUrl;
  const sourceIdentity = sourceGcsUri || sourceUrl;

  // —— 抖音上下文解析：合集页 URL 直接提 mixId（榜单行有时只给链接不带 mixId）；
  //    单集（含 modal_id 弹层）查详情回填剧名；发现所属合集则升级为合集学习
  //    （榜单单集链接一次学一批的入口）——
  let mixId = String(input.mixId || "").trim();
  let dramaNameZh = "";
  let single: {
    titleZh?: string;
    episodeIndex?: number;
    playbackUrl?: string;
    playbackUrls?: string[];
    access?: DouyinEpisodeAccess;
  } | undefined;
  if (!sourceGcsUri && isDouyinHostUrl(url)) {
    if (!/^\d{6,}$/.test(mixId)) {
      const fromUrl = extractDouyinMixIdFromUrl(url);
      if (fromUrl) mixId = fromUrl;
    }
    const videoId = extractDouyinVideoIdFromUrl(url);
    if (videoId) {
      const detail = await fetchDouyinAwemeDetailViaWebApi(videoId).catch(() => null);
      if (detail) {
        single = {
          titleZh: detail.titleZh,
          episodeIndex: detail.episodeIndex,
          playbackUrl: detail.playbackUrl,
          playbackUrls: detail.playbackUrls,
          access: detail.access,
        };
        if (!/^\d{6,}$/.test(mixId) && detail.mixId && /^\d{6,}$/.test(detail.mixId)) {
          mixId = detail.mixId;
        }
        dramaNameZh = stripBookTitleMarks(detail.mixNameZh);
      }
    }
  }
  // 直接视频若本身已是≥60分钟的大合集，即使详情里携带 mixId，
  // 也保留为单个长学习源，之后按剧名并入已有剧。
  if (mixId && single?.playbackUrl) {
    const directDurationSec = await ffprobeRemoteDuration(single.playbackUrl).catch(() => 0);
    if (isManhuaCompilationDuration(directDurationSec)) {
      mixId = "";
      single = { ...single, episodeIndex: 1 };
    }
  }
  if (mixId && !String(input.mixId || "").trim()) {
    // 单集/裸链接升级为合集学习：留双 key 日志，排查「旧进度去哪了」用
    console.info(
      `[manhuaTemplateLearn] series upgraded to mix: mixKey=${seriesKeyFrom({ url: sourceIdentity, mixId, title, learnLlm: resolveManhuaTemplateLearnLlmProvider(process.env.MANHUA_TEMPLATE_LEARN_LLM_PROVIDER) })} urlKey=${seriesKeyFrom({ url: sourceIdentity, title })}`,
    );
  }

  const batchSize = clampManhuaLearnBatchSize(input.batchSize ?? MANHUA_LEARN_BATCH_DEFAULT);
  const learnLlm = resolveManhuaTemplateLearnLlmProvider(
    input.learnLlm || process.env.MANHUA_TEMPLATE_LEARN_LLM_PROVIDER,
  );
  /**
   * 提到函数顶部：**单源集号安放**（在批次选择之前）就要按模式取不同的已占用集。
   * native 不产 digest，那一步不能读 digest。
   */
  const nativeCapabilityEnabled = isManhuaNativeDeepReadEnabled();
  if (input.nativeDeepReadConfirmed && !nativeCapabilityEnabled) {
    throw new Error("原生精读能力未开启，已停止执行");
  }
  if (input.nativeDeepReadConfirmed && !input.nativePlanPreview) {
    throw new Error("原生精读任务缺少 worker 复核后的执行计划，已停止执行");
  }
  // 环境变量只代表“能力可用”；单次任务还必须经过 owner 确认与 worker 重算。
  // 旧任务没有确认字段时继续走旧链，不能因开 flag 就静默切成付费原生精读。
  const nativeDeepReadMode = nativeCapabilityEnabled && input.nativeDeepReadConfirmed === true;
  // 列表接口可能才能回填真剧名；先用临时 key 建工作目录，
  // 取到 titleHint 后再按剧名核对已有系列。
  let seriesKey = seriesKeyFrom({ url: sourceIdentity, mixId, title, learnLlm });
  let workId = `tpl_series_${seriesKey}`;
  const rootTmp = await fs.mkdtemp(path.join(os.tmpdir(), `manhua-learn-pending-`));
  const progress = async (phase: string, detailZh: string) => {
    try {
      await input.onProgress?.(phase, detailZh);
    } catch {
      /* ignore */
    }
  };

  try {
    await progress(
      MANHUA_LEARN_STAGE.list,
      manhuaLearnStageLabelZh(MANHUA_LEARN_STAGE.list),
    );
    const listedRes: ListedEpisodesResult = sourceGcsUri
      ? {
          listed: listedSingleEpisodeFromUrl(
            url,
            title || String(input.fileName || "").replace(/\.[^.]+$/, "") || "手动导入视频",
            1,
          ),
          reliable: true,
        }
      : await listOrderedEpisodes(url, title || dramaNameZh, mixId, single);
    let listed = listedRes.listed;
    if (!listed.length) {
      throw new Error("无法解析任何可学剧集，请换合集页或成片链接重试");
    }
    if (!dramaNameZh && listedRes.mixNameZh) {
      dramaNameZh = stripBookTitleMarks(listedRes.mixNameZh);
    }
    // 剧名口径：用户手填 > 详情/合集接口回填的剧名（后者是单集路径「剧名恒空」的修复）
    const titleHint = title || dramaNameZh;
    seriesKey = await resolveManhuaSeriesKey({
      sourceIdentity,
      mixId,
      title: titleHint,
      learnLlm,
    });
    workId = `tpl_series_${seriesKey}`;
    const confirmedNativePlan = nativeDeepReadMode ? input.nativePlanPreview : undefined;
    let nativeUsage: ManhuaNativeDeepReadUsageReceipt | undefined;
    if (confirmedNativePlan && confirmedNativePlan.seriesKey !== seriesKey) {
      throw new Error(
        `原生精读计划所属系列已变化（确认 ${confirmedNativePlan.seriesKey}，当前 ${seriesKey}），未发出模型请求`,
      );
    }

    // 同名剧已有分集时，单条大合集作为新的学习源追加；
    // 同一条源重跑则回到原集号，从断点续学。
    const existingDigests = await loadAllDigests(seriesKey);
    /**
     * native **不产 digest** —— 只按 digest 排集号时，同名剧第二次手动导入另一个视频
     * 会再落回 ep001，然后被已入库的 ep001 判成「已完成」，新素材一集都学不到。
     * 所以 native 模式改用逐集卡的记录（带稳定来源）。
     */
    const nativeIngestedRecords = nativeDeepReadMode
      ? await listIngestedNativeDeepReadEpisodeRecords(seriesKey)
      : [];
    const nativeIngestedEpisodes = new Set(
      nativeIngestedRecords.map((record) => record.episodeIndex),
    );
    const placementSources = nativeDeepReadMode
      ? nativeIngestedRecords.map((record) => ({
          episodeIndex: record.episodeIndex,
          url: record.sourceUrl,
        }))
      : existingDigests;
    /**
     * `sourceIdentity` 是稳定标识（GCS 导入是 gs://，不是每次都变的签名链）——
     * 拿签名链比对永远不相等，同一素材重跑会被当成新素材追加。
     */
    listed = placeSingleSourceInExistingSeries(listed, placementSources, { sourceIdentity });
    await progress(
      MANHUA_LEARN_STAGE.list,
      `已解析 ${listed.length} 个学习源${mixId && listed.length > 1 ? "（合集展开）" : ""}${dramaNameZh ? ` · 《${dramaNameZh}》` : ""}${placementSources.length ? " · 已并入同名剧" : ""}`,
    );

    const seriesClassify = classifyManhuaLearnTitle(titleHint || "未命名合集");
    let prog =
      (await loadSeriesProgress(seriesKey)) ||
      ({
        seriesKey,
        sourceUrl: sourceIdentity,
        titleHint: titleHint || "未命名合集",
        learnLlm,
        mixId: mixId || undefined,
        listedEpisodeCount: listed.length,
        listedEpisodeIndexes: listedRes.reliable
          ? listed.map((e) => e.index).sort((a, b) => a - b)
          : undefined,
        learnedEpisodeIndexes: [],
        skippedEpisodeIndexes: [],
        paywallEpisodeIndexes: [],
        updatedAt: new Date().toISOString(),
        dramaKind: seriesClassify.dramaKind,
        categoryLabelZh: seriesClassify.categoryLabelZh,
        tagLabelsZh: seriesClassify.tagLabelsZh,
      } satisfies ManhuaLearnSeriesProgress);

    // 与 GCS 已完成 digest 对齐，避免同链接重复下片撑爆容量/触发限流
    const completeIndexes = existingDigests
      .filter(isManhuaLearnEpisodeComplete)
      .map((d) => d.episodeIndex);
    prog = {
      ...prog,
      sourceUrl: sourceIdentity,
      // 旧进度若还挂着占位（未命名合集/贴链接学习），回填到手的真剧名
      titleHint: titleHint || cleanManhuaLearnTitle(prog.titleHint) || "未命名合集",
      // 只有可靠列表才并进可靠集合；降级列表不缩写也不污染历史
      listedEpisodeIndexes: listedRes.reliable
        ? Array.from(
            new Set([...(prog.listedEpisodeIndexes || []), ...listed.map((e) => e.index)]),
          ).sort((a, b) => a - b)
        : prog.listedEpisodeIndexes,
      listedEpisodeCount: listedRes.reliable
        ? Math.max(
            prog.listedEpisodeCount || 0,
            new Set([...(prog.listedEpisodeIndexes || []), ...listed.map((e) => e.index)]).size,
          )
        : prog.listedEpisodeCount || listed.length,
      mixId: mixId || prog.mixId || undefined,
      dramaKind: seriesClassify.dramaKind,
      categoryLabelZh: seriesClassify.categoryLabelZh,
      tagLabelsZh: seriesClassify.tagLabelsZh,
      learnedEpisodeIndexes: Array.from(
        new Set([...prog.learnedEpisodeIndexes, ...completeIndexes]),
      ).sort((a, b) => a - b),
      skippedEpisodeIndexes: (prog.skippedEpisodeIndexes || [])
        .filter((index) => !completeIndexes.includes(index)),
      updatedAt: new Date().toISOString(),
    };
    const paywallState = deriveManhuaLearnPaywallState({
      listed,
      reliable: listedRes.reliable,
      previousIndexes: prog.paywallEpisodeIndexes,
      previousStartIndex: prog.paywallStartEpisodeIndex,
    });
    prog.paywallEpisodeIndexes = paywallState.paywallEpisodeIndexes;
    prog.paywallStartEpisodeIndex = paywallState.paywallStartEpisodeIndex;
    const paywallIndexSet = new Set(paywallState.paywallEpisodeIndexes);
    // 旧版本曾把付费页混入“来源受限暂跳”；迁移时摘出，避免重试按钮再次撞付费页。
    prog.skippedEpisodeIndexes = (prog.skippedEpisodeIndexes || []).filter(
      (index) => !paywallIndexSet.has(index),
    );
    if (paywallState.paywallStartEpisodeIndex) {
      await progress(
        MANHUA_LEARN_STAGE.list,
        `已识别付费边界：免费可学至第 ${paywallState.paywallStartEpisodeIndex - 1} 集；第 ${paywallState.paywallStartEpisodeIndex} 集起共 ${paywallState.paywallEpisodeIndexes.length} 集标记为付费缺集，不再尝试`,
      );
    }
    if (nativeDeepReadMode) {
      /**
       * 校准必须在写盘**之前**：本轮没有新批次时会直接从 native 返回，
       * 校准结果留在内存里，progress.json 上还是旧集号 —— 下次进来又从头算。
       */
      prog = reconcileManhuaLearnProgressWithNativeCards(prog, nativeIngestedEpisodes);
    }
    await writeJsonGcs(
      `manhua-template-learn/series/${seriesKey}/progress.json`,
      prog,
    );

    /**
     * 原生精读模式：**逐集执行层**在这里分岔，而且必须在**批次选择之前**定下来。
     *
     * 分岔点不放在 learnOneEpisode 内部，是因为那个函数的返回契约要求交出一份
     * 「已完成」的 digest —— 而 digest 的完成语义
     * (`completionPolicy: "audio_dense_frames_v1"`) 描述的正是本模式替换掉的
     * 语音＋高密度抽帧。在它内部分岔就得伪造那个凭证，两代数据会互相冒充。
     *
     * 更早一层的坑：`prog.learnedEpisodeIndexes` 里合并了**旧 digest** 的完成集
     * （见上面 completeIndexes 那段）。批次选择读的就是它——所以某集只要在旧
     * digest 里出现过，即使一张 native 卡都没有，也会在**选批次这一步**被排除，
     * 根本进不到循环内的 native 判定。只修循环里的判据是修了一半。
     *
     * 所以 native 模式的完成集合只认已入库的 native 卡
     * （一集一张 `tpl_native_<seriesKey>_epNNN.json`），旧 digest 只读不写。
     */
    // nativeDeepReadMode / nativeIngestedEpisodes 已在上面（集号安放那步）算好，
    // 校准也已在写盘之前完成 —— 这里直接用，不再重复列举一次 GCS

    /** 批次选择用的「已完成集」：两代各认各的凭证，不许互相冒充 */
    const learnedEpisodeIndexesForSelection = pickLearnedIndexesForBatchSelection({
      nativeDeepReadMode,
      nativeIngestedEpisodes,
      progLearnedEpisodeIndexes: prog.learnedEpisodeIndexes,
    });

    const listedIndexes = listed.map((e) => e.index);
    // 旗标优先级（固化语义）：refreshPreviewFrames > retrySkippedEpisodes > 常规续学；
    // 前端不会同传，两 true 时按补帧处理
    const batchIndexes = confirmedNativePlan
      ? confirmedNativePlan.episodes.map((episode) => episode.episodeIndex)
      : input.refreshPreviewFrames
      ? existingDigests
          .filter(isManhuaLearnEpisodeComplete)
          .map((digest) => digest.episodeIndex)
          .sort((a, b) => a - b)
          .slice(0, batchSize)
      : input.retrySkippedEpisodes
        ? pickRetrySkippedEpisodeIndexes({
            listedIndexes,
            skippedIndexes: prog.skippedEpisodeIndexes,
            learnedIndexes: learnedEpisodeIndexesForSelection,
            batchSize,
          })
        : pickNextEpisodeIndexes({
            listedIndexes,
            learnedIndexes: learnedEpisodeIndexesForSelection,
            skippedIndexes: [
              ...(prog.skippedEpisodeIndexes || []),
              ...(prog.paywallEpisodeIndexes || []),
            ],
            batchSize,
          });
    if (confirmedNativePlan) {
      if (input.refreshPreviewFrames || input.retrySkippedEpisodes) {
        throw new Error("原生精读确认任务不能同时执行补帧或重试旧暂跳集");
      }
      const listedByIndex = new Map(listed.map((episode) => [episode.index, episode]));
      for (const confirmedEpisode of confirmedNativePlan.episodes) {
        const current = listedByIndex.get(confirmedEpisode.episodeIndex);
        if (!current) {
          throw new Error(`确认计划中的第${confirmedEpisode.episodeIndex}集已不在当前合集，未发出模型请求`);
        }
        if (current.access !== "free") {
          throw new Error(`第${confirmedEpisode.episodeIndex}集当前没有明确免费信号，未发出模型请求`);
        }
        if (current.url !== confirmedEpisode.sourceUrl) {
          throw new Error(`第${confirmedEpisode.episodeIndex}集来源已变化，未发出模型请求`);
        }
      }
    }
    if (input.retrySkippedEpisodes && !batchIndexes.length) {
      /**
       * native 模式的空重试也必须走 native 口径：
       * 原来这里在 native 专用返回之前，会吐出旧 digest 的数量与 digestsPreview，
       * 用户看到的是「已学 N 集」而那 N 集根本不是原生精读产出的。
       */
      if (nativeDeepReadMode) {
        return buildNativeDeepReadLearnResult({
          seriesKey,
          workId,
          nativeCardCount: nativeIngestedEpisodes.size,
          batchLearned: 0,
          batchIndexes: [],
          listedEpisodeCount: prog.listedEpisodeCount || listed.length,
          skippedEpisodeIndexes: prog.skippedEpisodeIndexes,
          paywallFields: paywallResultFields(prog),
          categoryLabelZh: prog.categoryLabelZh,
          tagLabelsZh: prog.tagLabelsZh,
          nativeUsage,
          skippedHintZh: prog.skippedEpisodeIndexes?.length
            ? " 暂跳集这次没有出现在合集列表里（或已入库），本轮未消耗任何模型成本。"
            : " 当前没有暂跳集需要重试。",
        });
      }
      // 重试暂跳专属空批次：不落通用「已学完」文案（用户刚点了重试，得说清为什么没跑）
      return {
        seriesKey,
        analysisReady: false,
        learnedCount: prog.learnedEpisodeIndexes.length,
        analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
        analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
        batchLearned: 0,
        batchIndexes: [],
        listedEpisodeCount: prog.listedEpisodeCount || listed.length,
        skippedEpisodeIndexes: prog.skippedEpisodeIndexes?.length
          ? prog.skippedEpisodeIndexes
          : undefined,
        ...paywallResultFields(prog),
        digestsPreview: existingDigests.map(toDigestPreview),
        categoryLabelZh: prog.categoryLabelZh,
        tagLabelsZh: prog.tagLabelsZh,
        proposal: null,
        proposalGcsUri: null,
        visionFilled: false,
        messageZh: prog.skippedEpisodeIndexes?.length
          ? "暂跳集这次没有出现在合集列表里（或已学成），本轮未消耗任何模型成本；稍后再点「重试暂跳集」。"
          : "当前没有暂跳集需要重试。",
        workId,
      };
    }
    if (!batchIndexes.length) {
      /**
       * 原生精读模式的正式产物是**一集一张待审卡**（`tpl_native_<key>_epNNN.json`），
       * 没有系列卡这回事。这里必须在 `loadAllDigests` 与
       * `aggregateAndPersistManhuaProposal` **之前**返回：
       *
       * 旧聚合读的是 digest，而 native 全程不产 digest —— 让它跑下去只会落一张
       * `seriesAggregation.success=false` 的启发式 `tpl_series` 卡，
       * 页面上照样可批准，审批人会把「旧 digest 的汇总」误当成原生精读结果。
       *
       * 既有 tpl_series 文件不删不改，只是完全绕开。
       */
      if (nativeDeepReadMode) {
        return buildNativeDeepReadLearnResult({
          seriesKey,
          workId,
          nativeCardCount: nativeIngestedEpisodes.size,
          batchLearned: 0,
          batchIndexes: [],
          listedEpisodeCount: prog.listedEpisodeCount || listed.length,
          skippedEpisodeIndexes: prog.skippedEpisodeIndexes,
          paywallFields: paywallResultFields(prog),
          categoryLabelZh: prog.categoryLabelZh,
          tagLabelsZh: prog.tagLabelsZh,
          nativeUsage,
        });
      }
      const digestsAll = await loadAllDigests(seriesKey);
      const digests = digestsAll.filter(isManhuaLearnEpisodeComplete);
      if (
        canEmitManhuaLearnAnalysis(digests.length, {
          allListedComplete: isManhuaLearnListComplete(
            prog.listedEpisodeIndexes,
            digests.map((d) => d.episodeIndex),
          ),
        })
      ) {
        // 审查必须修12：三态读取——瞬时读取失败（GCS 抖动/鉴权/坏 JSON）不许当
        // 「文件不存在」去用启发式稿覆盖已批准/已润色的落盘提案；只有确认 404 才补写。
        const proposalObjectName = `manhua-template-learn/proposals/tpl_series_${seriesKey}.json`;
        const existingRead = await readJsonGcsDetailed<ManhuaViralTemplateCard>(proposalObjectName);
        if (existingRead.status === "error") {
          throw new Error(`提案读取暂时失败，请稍后重试（未覆盖已有提案）：${existingRead.errorNote}`);
        }
        if (existingRead.status === "found" && !parseManhuaViralTemplateCard(existingRead.value)) {
          // found-invalid（第五轮复审 P1·12）：落盘卡损坏不等于 404，
          // 用启发式稿覆盖会把已批准/已润色内容洗掉——报错等人工/下轮处理
          throw new Error("落盘提案存在但解析失败，已保留原文件未覆盖，请稍后重试或人工检查");
        }
        const existingParsed =
          existingRead.status === "found"
            ? parseManhuaViralTemplateCard(existingRead.value)
            : null;
        let proposal: ManhuaViralTemplateCard | null = null;
        let proposalGcsUri: string;
        let visionFilled = false;
        let noBatchMessage: string;
        if (existingParsed && existingParsed.status !== "proposed") {
          // 已批准/已拒绝：不再返回可批准的提案卡（客户端会显示死按钮、服务端必拒二次批准）
          proposalGcsUri = `gs://${gcsBucketHint()}/${proposalObjectName}`;
          proposal = null;
          visionFilled =
            isManhuaProposalSeriesAggregationReady(existingParsed) &&
            (existingParsed.provenance?.frameVision?.successChunks ?? 0) > 0;
          noBatchMessage =
            existingParsed.status === "approved"
              ? `该系列模板已批准进库（累计 ${digests.length} 集），无需重复批准。`
              : `该系列提案此前已被拒绝（累计 ${digests.length} 集）；如需重出提案请继续学新集。`;
        } else if (existingParsed && isManhuaProposalSeriesAggregationReady(existingParsed)) {
          proposal = existingParsed;
          proposalGcsUri = `gs://${gcsBucketHint()}/${proposalObjectName}`;
          // provenance 诚实化：落盘卡说了算；关键帧结构须已成功聚合。
          visionFilled =
            (existingParsed.provenance?.frameVision?.successChunks ?? 0) > 0;
          noBatchMessage = `已累计 ${digests.length} 集，分析提案已就绪（网页可预览后再决定是否进库）。`;
        } else {
          // 无卡或历史卡尚未聚合：用已落盘关键帧字段确定性生成系列底稿，零额外模型调用。
          const aggregated = await aggregateAndPersistManhuaProposal({
            seriesKey,
            prog,
            digests,
          });
          proposal = aggregated.proposal;
          proposalGcsUri = aggregated.proposalGcsUri;
          visionFilled = aggregated.aggregationOk && aggregated.visionOk;
          noBatchMessage = aggregated.aggregationOk
            ? `已累计 ${digests.length} 集，关键帧结构已聚合为系列底稿，可预览后决定是否进库。`
            : `已累计 ${digests.length} 集，但旧分集缺少可聚合的关键帧结构；已保留启发式底稿。`;
        }
        let proposalReadUrl: string | undefined;
        try {
          proposalReadUrl = signGsUriV4ReadUrl(proposalGcsUri, 7 * 24 * 3600);
        } catch {
          proposalReadUrl = undefined;
        }
        return {
          seriesKey,
          analysisReady: true,
          learnedCount: digests.length,
          analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
          analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
          batchLearned: 0,
          batchIndexes: [],
          listedEpisodeCount: listedRes.reliable ? Math.max(prog.listedEpisodeCount || 0, listed.length) : (prog.listedEpisodeCount || 0),
          skippedEpisodeIndexes: prog.skippedEpisodeIndexes?.length ? prog.skippedEpisodeIndexes : undefined,
          ...paywallResultFields(prog),
          digestsPreview: digestsAll.map(toDigestPreview),
          categoryLabelZh: prog.categoryLabelZh,
          tagLabelsZh: prog.tagLabelsZh,
          proposal,
          proposalGcsUri,
          proposalReadUrl,
          visionFilled,
          messageZh: noBatchMessage,
          workId,
        };
      }
      // 单集/短合集：可学剧集已吃完仍不足总分析门槛 → 成功回显分集结果，不抛错
      return {
        seriesKey,
        analysisReady: false,
        learnedCount: digests.length,
        analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
        analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
        batchLearned: 0,
        batchIndexes: [],
        listedEpisodeCount: listedRes.reliable ? Math.max(prog.listedEpisodeCount || 0, listed.length) : (prog.listedEpisodeCount || 0),
        skippedEpisodeIndexes: prog.skippedEpisodeIndexes?.length ? prog.skippedEpisodeIndexes : undefined,
        ...paywallResultFields(prog),
        digestsPreview: digestsAll.map(toDigestPreview),
        categoryLabelZh: prog.categoryLabelZh,
        tagLabelsZh: prog.tagLabelsZh,
        proposal: null,
        proposalGcsUri: null,
        visionFilled: false,
        messageZh:
          digests.length > 0
            ? `该链接可学剧集已学完（累计 ${digests.length} 集，列表共 ${listed.length} 集）。分集结果见下方。`
            : `该链接暂无可再学剧集（列表 ${listed.length} 集）。请换合集/成片链接重试。`,
        workId,
      };
    }

    const byIndex = new Map(listed.map((e) => [e.index, e]));
    const batchLearnedIndexes: number[] = [];
    const episodeFailNotes: string[] = [];
    // 手动叫停/abort：跳出学习循环但仍用已落盘关键帧字段聚合系列底稿。
    let cancelledMidRun = false;
    let consecutiveEpisodeFailures = 0;
    // 本轮真实开下的集数（用于集间礼貌间隔：第一集不等，跳过/已学过不计）
    let downloadedThisRun = 0;

    /**
     * 原生精读必须在「批次层」分岔：N 集先组成一个多视频请求包，再按 episodeIndex
     * 拆回 N 张卡。若落回下面逐集循环，就会把「学十集」重新做成十次 Qwen。
     */
    if (nativeDeepReadMode) {
      const executionPlans: NativeDeepReadEpisodeExecution[] = [];
      for (const idx of batchIndexes) {
        await assertManhuaLearnControl(input);
        const ep = byIndex.get(idx);
        if (!ep || (prog.paywallEpisodeIndexes || []).includes(idx)) continue;
        executionPlans.push(await buildNativeDeepReadEpisodeExecution({
          seriesKey,
          ep,
          confirmedPlanEpisode: confirmedNativePlan?.episodes.find(
            (episode) => episode.episodeIndex === idx,
          ),
          provenanceSourceRef: sourceGcsUri || undefined,
          abortSignal: input.abortSignal,
        }));
      }
      if (!executionPlans.length) {
        throw new Error("原生精读批次没有可执行剧集，未发出模型请求");
      }
      await progress(
        MANHUA_LEARN_STAGE.vision,
        `正在逐段精读 ${executionPlans.length} 集（共 ${executionPlans.reduce((sum, plan) => sum + plan.segments.length, 0)} 个视频分片，每段一次调用，音轨同调直出）…`,
      );
      const batchResult = await runNativeDeepReadBatch({
        seriesKey,
        episodes: executionPlans.map(({ seriesKey: _seriesKey, abortSignal: _abortSignal, ...plan }) => plan),
        abortSignal: input.abortSignal,
        onModelCheckpoint: async (checkpoint) => {
          try {
            await input.onNativeModelReceipt?.(checkpoint);
          } catch (error) {
            // 回执旁路写入异常不能令模型链重跑；worker 终态还会再带一次本地累计数组。
            console.warn(
              "[manhua-learn] 单次模型回执写入未完成：",
              error instanceof Error ? error.message : error,
            );
          }
          const episodeLabel = checkpoint.episodeIndexes.length === 1
            ? `第 ${checkpoint.episodeIndexes[0]} 集`
            : `第 ${checkpoint.episodeIndexes[0]}–${checkpoint.episodeIndexes.at(-1)} 集`;
          // 0826 换代：音轨由视觉调用直出，主链不再产生 audio_model 阶段回执。
          if (checkpoint.stage === "series_aggregation_model") {
            await progress(
              checkpoint.status === "failed" ? MANHUA_LEARN_STAGE.failed : MANHUA_LEARN_STAGE.analysis,
              checkpoint.status === "started"
                ? "开始整理全系列结构…"
                : checkpoint.status === "completed"
                  ? "全系列结构整理完成"
                  : `全系列结构整理未完成：${checkpoint.errorZh || "上游未返回完整回执"}`,
            );
          } else {
            const stageZh = checkpoint.stage === "visual_parse"
              ? checkpoint.route === "openrouter_glm_structuring"
                ? "GLM 结构化整形"
                : "结构校验"
              : checkpoint.degraded
                ? "画面与声音联合精读（EvoLink 兜底 1fps 降级）"
                : "画面与声音联合精读";
            const segmentZh = typeof checkpoint.chunkIndex === "number" && checkpoint.segmentCount
              ? ` · 分片 ${checkpoint.chunkIndex + 1}/${checkpoint.segmentCount}`
              : "";
            await progress(
              checkpoint.status === "failed" ? MANHUA_LEARN_STAGE.failed : MANHUA_LEARN_STAGE.vision,
              `${episodeLabel}${segmentZh} · ${stageZh}${checkpoint.status === "started"
                ? "开始"
                : checkpoint.status === "completed"
                  ? "完成"
                  : `未完成：${checkpoint.errorZh || "上游未返回完整回执"}`}`,
            );
          }
        },
        onProgress: async (outcome) => {
          if (outcome.usage) {
            nativeUsage = mergeManhuaNativeDeepReadUsage(nativeUsage, {
              ...outcome.usage,
              elapsedMs: outcome.elapsedMs,
            });
            if (nativeUsage) await input.onNativeUsage?.(nativeUsage);
          }
          if (outcome.status === "ingested") {
            batchLearnedIndexes.push(outcome.episodeIndex);
            nativeIngestedEpisodes.add(outcome.episodeIndex);
            prog.nativeDeepReadEpisodeIndexes = Array.from(nativeIngestedEpisodes).sort((a, b) => a - b);
            prog.skippedEpisodeIndexes = (prog.skippedEpisodeIndexes || [])
              .filter((episodeIndex) => episodeIndex !== outcome.episodeIndex);
            prog.updatedAt = new Date().toISOString();
            await writeJsonGcs(`manhua-template-learn/series/${seriesKey}/progress.json`, prog);
            await progress(
              MANHUA_LEARN_STAGE.persist,
              `第 ${outcome.episodeIndex} 集已生成独立待审卡 · 本轮新增 ${batchLearnedIndexes.length}/${executionPlans.length}`,
            );
          } else if (outcome.status === "failed") {
            episodeFailNotes.push(`第 ${outcome.episodeIndex} 集未入库：${outcome.errorZh || "结构门禁未通过"}`);
            await progress(
              MANHUA_LEARN_STAGE.failed,
              `第 ${outcome.episodeIndex} 集未入库；已停止后续请求并保留占位待核对`,
            );
          } else if (outcome.status === "aborted") {
            cancelledMidRun = true;
          }
        },
      });

      const seriesAggregation = batchResult.seriesAggregation;
      const seriesAggregationUsage = seriesAggregation?.usage || batchResult.seriesAggregationUsage;
      if (seriesAggregationUsage) {
        nativeUsage = mergeManhuaNativeDeepReadUsage(nativeUsage, {
          model: `${MANHUA_NATIVE_DEEP_READ_MODEL}+z-ai/glm-5.3(series)`,
          usingPlanQuota: false,
          inputTokens: seriesAggregationUsage.inputTokens,
          outputTokens: seriesAggregationUsage.outputTokens,
          costCny: seriesAggregationUsage.priceEquivalentCny,
          receiptComplete: seriesAggregationUsage.receiptComplete,
          seriesAggregationInputTokens: seriesAggregationUsage.inputTokens,
          seriesAggregationOutputTokens: seriesAggregationUsage.outputTokens,
          seriesAggregationReasoningTokens: seriesAggregationUsage.reasoningTokens,
          seriesAggregationPriceEquivalentCny: seriesAggregationUsage.priceEquivalentCny,
        });
        if (nativeUsage) await input.onNativeUsage?.(nativeUsage);
      }
      if (batchResult.seriesAggregationErrorZh) {
        episodeFailNotes.push(`系列结构整理未完成：${batchResult.seriesAggregationErrorZh}`);
      }
      if (batchResult.failedCount > 0 || batchResult.aborted) {
        throw Object.assign(
          new Error(
            batchResult.aborted
              ? "原生精读已停止；成功卡保留，未完成集不自动重跑"
              : `原生精读有 ${batchResult.failedCount} 集未通过，成功卡保留，后续请求已停止`,
          ),
          { nativeUsage },
        );
      }
      return buildNativeDeepReadLearnResult({
        seriesKey,
        workId,
        nativeCardCount: nativeIngestedEpisodes.size,
        batchLearned: batchLearnedIndexes.length,
        batchIndexes: batchLearnedIndexes,
        listedEpisodeCount: prog.listedEpisodeCount || listed.length,
        skippedEpisodeIndexes: prog.skippedEpisodeIndexes,
        paywallFields: paywallResultFields(prog),
        categoryLabelZh: prog.categoryLabelZh,
        tagLabelsZh: prog.tagLabelsZh,
        nativeUsage,
        seriesAggregation,
        skippedHintZh: episodeFailNotes.length
          ? ` ${episodeFailNotes.join("；")}。`
          : undefined,
      });
    }

    for (const idx of batchIndexes) {
      const ep = byIndex.get(idx);
      if (!ep) continue;
      if ((prog.paywallEpisodeIndexes || []).includes(idx)) {
        await progress(MANHUA_LEARN_STAGE.persist, `第 ${idx} 集位于已知付费段，已跳过且不计失败`);
        continue;
      }
      const existing = await readJsonGcs<ManhuaLearnEpisodeDigest>(
        episodeObjectName(seriesKey, idx),
      );

      // 补帧是独立低成本路径：已学完成也要按用户请求补展示图；正常学习仍跳过。
      if (input.refreshPreviewFrames && existing && isManhuaLearnEpisodeComplete(existing)) {
        try {
          const repaired = await refreshEpisodePreviewFrames({
            seriesKey,
            ep,
            digest: existing,
            rootTmp,
            onProgress: input.onProgress,
            checkControl: input.checkControl,
            abortSignal: input.abortSignal,
          });
          await writeJsonGcs(episodeObjectName(seriesKey, idx), repaired);
          await input.onEpisodeCheckpoint?.(toDigestPreview(repaired));
          batchLearnedIndexes.push(idx);
          consecutiveEpisodeFailures = nextManhuaLearnEpisodeFailureStreak(
            consecutiveEpisodeFailures,
            "success",
          ).count;
          continue;
        } catch (e) {
          if (e instanceof Error && e.name === "ManhuaLearnCancelledError") {
            cancelledMidRun = true;
            break;
          }
          if (e instanceof Error && e.name === "ManhuaLearnSkipEpisodeError") throw e;
          const errZh = mapManhuaLearnFetchError(e);
          episodeFailNotes.push(`第 ${idx} 集静帧补抽失败：${errZh}`);
          await progress(MANHUA_LEARN_STAGE.failed, `第 ${idx} 集静帧补抽失败：${errZh}`);
          const failureState = nextManhuaLearnEpisodeFailureStreak(
            consecutiveEpisodeFailures,
            "failure",
          );
          consecutiveEpisodeFailures = failureState.count;
          if (failureState.shouldStop) {
            await progress(
              MANHUA_LEARN_STAGE.failed,
              `连续 ${MANHUA_LEARN_CONSECUTIVE_FAIL_STOP} 集失败，本轮已自动停止`,
            );
            break;
          }
          continue;
        }
      }
      /**
       * 已学完：跳过，不重下（防容量/限流）。
       *
       * 两代各认各的凭证：native 模式只认已入库的 native 卡，
       * **旧 audio_dense_frames digest 不能冒充 native 已完成**——
       * 否则给一部学过的剧打开 flag，会一集都不重学，等于开关没生效。
       */
      const episodeAlreadyDone = isManhuaLearnEpisodeAlreadyLearned({
        nativeDeepReadMode,
        nativeIngestedEpisodes,
        episodeIndex: idx,
        existingDigest: existing,
      });
      if (episodeAlreadyDone) {
        // 同上：native 已入库集只落 native 字段
        const doneIndexList = nativeDeepReadMode
          ? (prog.nativeDeepReadEpisodeIndexes || [])
          : prog.learnedEpisodeIndexes;
        if (!doneIndexList.includes(idx)) {
          if (nativeDeepReadMode) {
            prog.nativeDeepReadEpisodeIndexes = Array.from(
              new Set([...(prog.nativeDeepReadEpisodeIndexes || []), idx]),
            ).sort((a, b) => a - b);
          } else {
            prog.learnedEpisodeIndexes = Array.from(
              new Set([...prog.learnedEpisodeIndexes, idx]),
            ).sort((a, b) => a - b);
          }
          prog.updatedAt = new Date().toISOString();
          await writeJsonGcs(
            `manhua-template-learn/series/${seriesKey}/progress.json`,
            prog,
          );
        }
        await progress(
          MANHUA_LEARN_STAGE.persist,
          `第 ${idx} 集已学过，跳过重复学习`,
        );
        continue;
      }

      try {
        await assertManhuaLearnControl(input);
        // 集间礼貌间隔：只隔真实读取媒体流的相邻两集（跳过/已学过的不算）；
        // 期间每秒响应停止/跳过指令，不做任何伪装
        if (downloadedThisRun > 0) {
          const gapMs = pickManhuaLearnEpisodeGapMs(Math.random());
          await progress(
            MANHUA_LEARN_STAGE.download,
            `第 ${idx} 集将在 ${Math.round(gapMs / 1000)} 秒后开始（减轻来源压力）…`,
          );
          const gapEndAt = Date.now() + gapMs;
          while (Date.now() < gapEndAt) {
            await assertManhuaLearnControl(input);
            await new Promise((resolve) => setTimeout(resolve, Math.min(1000, gapEndAt - Date.now())));
          }
        }
        downloadedThisRun += 1;

        const digest = await learnOneEpisode({
          seriesKey,
          ep,
          titleHint: prog.titleHint,
          learnLlm,
          rootTmp,
          existing,
          onProgress: input.onProgress,
          checkControl: input.checkControl,
          abortSignal: input.abortSignal,
          onCheckpoint: async (partial) => {
            await writeJsonGcs(episodeObjectName(seriesKey, idx), partial);
            await input.onEpisodeCheckpoint?.(toDigestPreview(partial));
          },
        });
        await writeJsonGcs(episodeObjectName(seriesKey, idx), digest);
        if (!isManhuaLearnEpisodeComplete(digest)) {
          throw new Error(`第 ${idx} 集未学完（检查点已保留，可续学）`);
        }
        const episodeDoneNoteZh = `第 ${idx} 集整集学完（约 ${Math.round((digest.durationSec || 0) / 60)} 分钟`;
        batchLearnedIndexes.push(idx);
        consecutiveEpisodeFailures = nextManhuaLearnEpisodeFailureStreak(
          consecutiveEpisodeFailures,
          "success",
        ).count;
        prog.learnedEpisodeIndexes = Array.from(
          new Set([...prog.learnedEpisodeIndexes, idx]),
        ).sort((a, b) => a - b);
        // 暂跳集重试成功 → 摘掉暂跳标记，别让它挂着「受限」误导续学口径
        prog.skippedEpisodeIndexes = (prog.skippedEpisodeIndexes || []).filter(
          (skipped) => skipped !== idx,
        );
        prog.updatedAt = new Date().toISOString();
        await writeJsonGcs(
          `manhua-template-learn/series/${seriesKey}/progress.json`,
          prog,
        );
        await progress(
          MANHUA_LEARN_STAGE.persist,
          `${episodeDoneNoteZh} · 本轮新增 ${batchLearnedIndexes.length} · 累计 ${prog.learnedEpisodeIndexes.length} 集）`,
        );
      } catch (e) {
        /**
         * 中止判定必须**优先看 abortSignal**，不能只认 error.name。
         *
         * 中止优先看 signal，避免包装后的错误名丢失。
         */
        const isCancelled =
          Boolean(input.abortSignal?.aborted)
          || (e instanceof Error && e.name === "ManhuaLearnCancelledError");
        if (isCancelled) {
          // 停止≠报废：不再学新集；已入库的逐集卡保留。
          cancelledMidRun = true;
          await progress(
            MANHUA_LEARN_STAGE.persist,
            "已收到停止指令：不再学新集，正在对已学内容出总分析…",
          );
          break;
        }
        if (e instanceof Error && e.name === "ManhuaLearnSkipEpisodeError") {
          await progress(MANHUA_LEARN_STAGE.persist, `第 ${idx} 集已按要求跳过，继续下一集`);
          continue;
        }
        const errZh = mapManhuaLearnFetchError(e);
        const isExplicitPaywall = ep.access === "paid_locked"
          || isManhuaLearnExplicitPaywallHint(e);
        if (isExplicitPaywall) {
          const start = Math.min(prog.paywallStartEpisodeIndex || idx, idx);
          const paywallEpisodeIndexes = listedIndexes
            .filter((episodeIndex) => episodeIndex >= start)
            .sort((a, b) => a - b);
          prog.paywallStartEpisodeIndex = start;
          prog.paywallEpisodeIndexes = paywallEpisodeIndexes;
          const paywallSet = new Set(paywallEpisodeIndexes);
          prog.skippedEpisodeIndexes = (prog.skippedEpisodeIndexes || []).filter(
            (episodeIndex) => !paywallSet.has(episodeIndex),
          );
          prog.updatedAt = new Date().toISOString();
          await writeJsonGcs(
            `manhua-template-learn/series/${seriesKey}/progress.json`,
            prog,
          );
          const note = `第 ${idx} 集确认需要购买；已将第 ${start} 集起 ${paywallEpisodeIndexes.length} 集标记为付费缺集，后续不再尝试且不计入连续失败`;
          episodeFailNotes.push(note);
          await progress(MANHUA_LEARN_STAGE.persist, note);
          continue;
        }
        const note = `第 ${idx} 集失败已跳过：${errZh}`;
        episodeFailNotes.push(note);
        prog.skippedEpisodeIndexes = Array.from(
          new Set([...(prog.skippedEpisodeIndexes || []), idx]),
        ).sort((a, b) => a - b);
        prog.updatedAt = new Date().toISOString();
        await writeJsonGcs(
          `manhua-template-learn/series/${seriesKey}/progress.json`,
          prog,
        );
        console.warn(
          "[manhuaTemplateLearn] source unavailable → persist skip and continue:",
          idx,
          errZh,
        );
        await progress(MANHUA_LEARN_STAGE.failed, note);
        const failureState = nextManhuaLearnEpisodeFailureStreak(
          consecutiveEpisodeFailures,
          "failure",
        );
        consecutiveEpisodeFailures = failureState.count;
        if (failureState.shouldStop) {
          await progress(
            MANHUA_LEARN_STAGE.failed,
            `连续 ${MANHUA_LEARN_CONSECUTIVE_FAIL_STOP} 集失败，本轮已自动停止`,
          );
          break;
        }
      }
    }

    const skippedCount = prog.skippedEpisodeIndexes?.length || 0;
    const skippedHint = skippedCount > 0
      ? ` 当前有 ${skippedCount} 集因来源受限暂跳，不计入已学；续学将从后续集继续。`
      : "";
    const digestsAll = await loadAllDigests(seriesKey);
    const digests = digestsAll.filter(isManhuaLearnEpisodeComplete);
    const learnedCount = digests.length;
    const ready = canEmitManhuaLearnAnalysis(learnedCount, {
      allListedComplete: isManhuaLearnListComplete(
        prog.listedEpisodeIndexes,
        digests.map((d) => d.episodeIndex),
      ),
    });

    if (!ready) {
      const singleOrShort =
        listed.length < MANHUA_LEARN_ANALYSIS_MIN
          ? `当前链接共 ${listed.length} 集（单集也可学）。`
          : "";
      const failHint =
        episodeFailNotes.length > 0
          ? ` 另有 ${episodeFailNotes.length} 集未成功（见进度日志）。`
          : "";
      return {
        seriesKey,
        analysisReady: false,
        learnedCount,
        analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
        analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
        batchLearned: batchLearnedIndexes.length,
        batchIndexes: batchLearnedIndexes,
        listedEpisodeCount: listedRes.reliable ? Math.max(prog.listedEpisodeCount || 0, listed.length) : (prog.listedEpisodeCount || 0),
        skippedEpisodeIndexes: prog.skippedEpisodeIndexes?.length ? prog.skippedEpisodeIndexes : undefined,
        ...paywallResultFields(prog),
        digestsPreview: digestsAll.map(toDigestPreview),
        categoryLabelZh: prog.categoryLabelZh,
        tagLabelsZh: prog.tagLabelsZh,
        proposal: null,
        proposalGcsUri: null,
        visionFilled: false,
        messageZh:
          `${cancelledMidRun ? "已按停止指令收尾：" : ""}本轮学了 ${batchLearnedIndexes.length} 集（未落视频文件），累计 ${learnedCount} 集。${singleOrShort}${failHint}${skippedHint}分集结果见下方；每学 1 集即可出草版总分析并入库（约 ${MANHUA_LEARN_ANALYSIS_MIN} 集更准），是否进库由你决定。`,
        workId,
      };
    }

    if (!cancelledMidRun) await assertManhuaLearnControl(input);
    await progress(
      MANHUA_LEARN_STAGE.analysis,
      manhuaLearnStageLabelZh(MANHUA_LEARN_STAGE.analysis),
    );
    // 三态读取：已批准/已拒绝不覆盖；无新集且已有聚合卡零成本沿用；
    // 有新集时只重新做程序聚合，不发第二次模型请求。
    const proposalObjectName = `manhua-template-learn/proposals/tpl_series_${seriesKey}.json`;
    const existingRead = await readJsonGcsDetailed<ManhuaViralTemplateCard>(proposalObjectName);
    if (existingRead.status === "error") {
      throw new Error(`提案读取暂时失败，请稍后重试（未覆盖已有提案）：${existingRead.errorNote}`);
    }
    if (existingRead.status === "found" && !parseManhuaViralTemplateCard(existingRead.value)) {
      throw new Error("落盘提案存在但解析失败，已保留原文件未覆盖，请稍后重试或人工检查");
    }
    const existingParsed =
      existingRead.status === "found" ? parseManhuaViralTemplateCard(existingRead.value) : null;
    const stoppedHint = cancelledMidRun ? "已按停止指令收尾：" : "";
    const baseResult = {
      seriesKey,
      analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
      analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
      learnedCount,
      batchLearned: batchLearnedIndexes.length,
      batchIndexes: batchLearnedIndexes,
      listedEpisodeCount: listedRes.reliable ? Math.max(prog.listedEpisodeCount || 0, listed.length) : (prog.listedEpisodeCount || 0),
      skippedEpisodeIndexes: prog.skippedEpisodeIndexes?.length ? prog.skippedEpisodeIndexes : undefined,
      ...paywallResultFields(prog),
      digestsPreview: digestsAll.map(toDigestPreview),
      categoryLabelZh: prog.categoryLabelZh,
      tagLabelsZh: prog.tagLabelsZh,
      workId,
    };
    if (existingParsed && existingParsed.status !== "proposed") {
      // 已批准/已拒绝：不返回可批准卡（防死按钮/二次批准），也绝不覆盖
      return {
        ...baseResult,
        analysisReady: true,
        proposal: null,
        proposalGcsUri: `gs://${gcsBucketHint()}/${proposalObjectName}`,
        visionFilled:
          isManhuaProposalSeriesAggregationReady(existingParsed)
          && (existingParsed.provenance?.frameVision?.successChunks ?? 0) > 0,
        messageZh: existingParsed.status === "approved"
          ? `${stoppedHint}本轮 +${batchLearnedIndexes.length} 集，该系列模板已批准进库，无需重复批准。${skippedHint}`
          : `${stoppedHint}本轮 +${batchLearnedIndexes.length} 集，该系列提案此前已被拒绝；如需重出请继续学新集。${skippedHint}`,
      };
    }
    let proposal: ManhuaViralTemplateCard;
    let proposalGcsUri: string;
    let aggregationOk: boolean;
    let visionOk: boolean;
    if (
      existingParsed
      && isManhuaProposalSeriesAggregationReady(existingParsed)
      && batchLearnedIndexes.length === 0
    ) {
      // 无新集且已有系列底稿：沿用，零模型成本。
      proposal = existingParsed;
      proposalGcsUri = `gs://${gcsBucketHint()}/${proposalObjectName}`;
      aggregationOk = true;
      visionOk = (existingParsed.provenance?.frameVision?.successChunks ?? 0) > 0;
    } else {
      const aggregated = await aggregateAndPersistManhuaProposal({
        seriesKey,
        prog,
        digests,
      });
      proposal = aggregated.proposal;
      proposalGcsUri = aggregated.proposalGcsUri;
      aggregationOk = aggregated.aggregationOk;
      visionOk = aggregated.visionOk;
    }
    let proposalReadUrl: string | undefined;
    try {
      proposalReadUrl = signGsUriV4ReadUrl(proposalGcsUri, 7 * 24 * 3600);
    } catch {
      proposalReadUrl = undefined;
    }

    return {
      ...baseResult,
      analysisReady: true,
      proposal,
      proposalGcsUri,
      proposalReadUrl,
      // 「模型已填」= 关键帧读取成功，且同次产出的底稿字段已由程序聚合。
      visionFilled: aggregationOk && visionOk,
      messageZh: `${stoppedHint}本轮 +${batchLearnedIndexes.length} 集（未落视频文件），累计 ${learnedCount} 集，系列分析已可在网页预览${
        aggregationOk ? "" : "（旧分集缺少可聚合的关键帧结构，保留启发式底稿）"
      }${visionOk ? "" : "（视觉读帧未成功，节奏点为启发式）"}${skippedHint}，是否进库由你决定。`,
    };
  } finally {
    await rmrf(rootTmp);
  }
}
