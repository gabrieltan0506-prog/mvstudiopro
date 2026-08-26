import {
  buildI2VRequest,
  buildImageRequest,
  buildLipSyncWithAudio,
  buildMotionControlRequest,
  buildStoryboardRequest,
  buildT2VRequest,
  configureKlingClient,
  createImageTask,
  createLipSyncTask,
  createMotionControlTask,
  createOmniVideoTask,
  getImageTask,
  getLipSyncTask,
  getMotionControlTask,
  getOmniVideoTask,
  parseKeysFromEnv,
  type CreateOmniVideoRequest,
} from "../kling";
import {
  convertLipSyncToFal,
  convertMotionControlToFal,
  convertOmniVideoToFal,
  falKlingQueue,
  falKlingStatus,
  getOmniVideoEndpoint,
  type FalKlingEndpoint,
} from "../kling/fal-proxy";
import { generateGeminiImage, isGeminiImageAvailable, type ImageQuality } from "../gemini-image";
import { normalizeOpenAiImageLane } from "../../shared/openaiImageLane.js";
import { normalizePlatformTopicExpandEngine } from "../../shared/platformTopicShortlist.js";
import { appRouter, buildPlatformContent, slimBuildPlatformContentDiagnosticsForJob } from "../routers";
import { invokeLLM, extractJsonString, type FileContent } from "../_core/llm";
import { deleteGcsObject, getGcsBucketName } from "../services/gcs";
import { isOwnedManhuaLearnImportGcsUri } from "../../shared/manhuaLearnVideoSegments.js";
import { resolveWatermark } from "../services/tier-provider-routing.js";
import { buildStage1StrategicHandoffForStage2 } from "../services/stage1StrategicHandoff.js";
import { getDb } from "../db";
import { users, type User } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { deductCredits, deductCreditsAmount, getCredits, getUserPlan } from "../credits";
import { CREDIT_COSTS } from "../plans";
import { flatAnalysisCost, flatImageAnalysisCost, MAX_DURATION_SECONDS } from "../utils/costCalculator";
import {
  createProducerTask,
  getProducerTaskStatus,
  type ProducerModel,
  type ProducerQuality,
} from "../services/aimusic-producer";
import { analyzeVideo as analyzeGrowthCampVideo } from "../growth/analyzeVideo";
import { analyzeGrowthCampImages } from "../growth/analyzeGrowthCampImages";
import { enrichPlatformAssetAnalysisContext } from "../growth/platformAssetTrendContext";
import { resolveGrowthCampExtractorModel } from "../growth/extractorPipeline";
import { normalizePlatforms } from "../growth/growthSchema";
import { readTrendStore, readTrendStoreForPlatforms } from "../growth/trendStore";
import {
  claimNextGrowthCampAnalyzeJob,
  claimNextManhuaTemplateLearnJob,
  claimNextQueuedJob,
  claimNextPdfExportJob,
  claimNextPostProdJob,
  consumeManhuaTemplateLearnEpisodeSkip,
  getJobById,
  isManhuaTemplateLearnJobCancelRequested,
  markJobFailed,
  markJobSucceededWithRetry,
  markManhuaLearnJobFailedWithOutputRetry,
  markManhuaLearnJobSucceededWithRetry,
  markJobSucceeded,
  patchJobRunningProgress,
  requeueJob,
  upsertManhuaNativeModelReceiptForJob,
  type JobType,
} from "./repository";
import { processPdfExportJob } from "./pdfExportJob";
import {
  invokePlatformAnalysisChat,
  PLATFORM_ANALYSIS_FALLBACK_MODEL,
  PLATFORM_ANALYSIS_PRIMARY_MODEL,
} from "../services/platformAnalysisLlm.js";
import { resolveGrowthCampJobServerTimeoutMs } from "../../shared/growthCampJobTiming.js";
import {
  hasNativeDeepReadJobFields,
  NATIVE_DEEP_READ_JOB_MAX_CALLS,
  parseNativeDeepReadJobConfirmation,
  resolveNativeDeepReadJobTimeoutMs,
} from "../../shared/manhuaNativeDeepReadJob.js";
import {
  appendManhuaNativeModelReceipt,
  type ManhuaNativeModelReceipt,
} from "../../shared/manhuaNativeModelReceipt.js";
import {
  beginGrowthInteractiveWorkload,
  isAuthenticatedRunningPlatformJob,
} from "../growth/growthWorkloadPriority";
import {
  CREATIVE_NANO_IMAGE_CREDITS,
  CREATIVE_NANO_IMAGE_QUALITY,
  CREATIVE_NANO_IMAGE_TASK_TYPE,
  isCreativeNanoImageJob,
  normalizeCreativeNanoImageAspectRatio,
} from "../../shared/creativeNanoImageJobInput.js";

const JOB_TIMEOUT_MS: Record<JobType, number> = {
  image: 12_000,
  audio: 8 * 60_000,
  video: 30_000,
  // platform：預設 12 min；platform_topic_image 預設 10 min；platform_build_content / 套裝由 resolveJobTimeoutMs 加長
  platform: 12 * 60_000,
  /** 与 Cloud Run pdf-worker + 跨云回传对齐；独占队列不阻塞别的任务 */
  pdf_export: 55 * 60_000,
  /** 后期工坊纯 ffmpeg：拼接最重(≤12 段下载+转码+上传)，10 分钟封顶 */
  post_prod: 10 * 60_000,
};



/** 八审 P1-6:canvas 出图墙钟安全下限/默认值(env 只能上调,不可降到下限以下) */
export const CANVAS_GPT_IMAGE2_MIN_TIMEOUT_MS = 12 * 60_000;
export const CANVAS_GPT_IMAGE2_DEFAULT_TIMEOUT_MS = 15 * 60_000;
export const CREATIVE_NANO_IMAGE_TIMEOUT_MS = 8 * 60_000;

/** 七审 P0-2:判定 canvas 出图任务(付费上游,专属超时/不重排/幂等退款) */
export function isCanvasGptImage2Job(input: unknown): boolean {
  return Boolean(
    input &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      (input as { action?: unknown }).action === "canvas_gpt_image2",
  );
}

export function paidImageLedgerTaskType(input: unknown): string | null {
  if (isCreativeNanoImageJob(input)) return CREATIVE_NANO_IMAGE_TASK_TYPE;
  if (!isCanvasGptImage2Job(input)) return null;
  const params = (input as { params?: unknown }).params;
  if (
    params &&
    typeof params === "object" &&
    !Array.isArray(params) &&
    ((params as { assetStandardizeQuality?: unknown }).assetStandardizeQuality === "medium" ||
      (params as { assetStandardizeQuality?: unknown }).assetStandardizeQuality === "high")
  ) {
    return "manhuaAssetStandardize";
  }
  return "canvasGptImage2";
}

/** 七审 P0-2:canvas 出图退款的 DB 幂等键——同 job 多次进入退款路径余额只回一次 */
export function canvasGptImage2RefundKey(jobId: string | undefined): string {
  return `refund:canvasGptImage2/${jobId || "unknown"}`.slice(0, 120);
}

/**
 * 七审 P0-2:失败任务处置纯函数。canvas_gpt_image2 绝不整单重排——
 * 重排=第二次调用付费图片上游(chargeKey 只能防第二次扣积分,防不了第二次烧上游),
 * 直接退款+终态失败;其余任务维持 attempts<2 重排的旧策略。
 */
export function resolveFailedJobDisposition(job: {
  type: string;
  input: unknown;
  attempts?: number | null;
}): "refund_and_fail_paid_image" | "requeue" | "fail" {
  if (job.type === "image" && paidImageLedgerTaskType(job.input)) {
    return "refund_and_fail_paid_image";
  }
  return (job.attempts ?? 0) < 2 ? "requeue" : "fail";
}

const PLATFORM_LLM_TIMEOUT_MS = 8 * 60_000;
const POLL_INTERVAL_MS = 2_000;

let klingInitialized = false;
let workerStarted = false;
let processing = false;
let timer: NodeJS.Timeout | null = null;
let pdfProcessing = false;
let pdfTimer: NodeJS.Timeout | null = null;
let postProdProcessing = false;
let postProdTimer: NodeJS.Timeout | null = null;
/** 成长营素材分析专用 worker 并发（与平台长 Job 分池，默认 2） */
const GROWTH_CAMP_JOB_WORKER_CONCURRENCY = Math.max(
  1,
  Math.min(4, Number(process.env.GROWTH_CAMP_JOB_WORKER_CONCURRENCY || 2) || 2),
);
let growthAnalyzeJobsActive = 0;
let growthAnalyzeTimer: NodeJS.Timeout | null = null;
/**
 * 漫剧学习并发池：默认 **1（串行）**——生产是单机双核，一个 learn job 已经会
 * 拉起 yt-dlp+ffmpeg+ffprobe 多进程，双开会打满 CPU 拖垮健康检查（2026-08-11 用户拍板）。
 * 升级机器后可用 env MANHUA_LEARN_JOB_WORKER_CONCURRENCY 调高（上限 2）。
 * 任务已在 Neon jobs 持久化，关页/刷新不影响。
 */
export const MANHUA_LEARN_JOB_WORKER_CONCURRENCY = Math.max(
  1,
  Math.min(2, Number(process.env.MANHUA_LEARN_JOB_WORKER_CONCURRENCY || 1) || 1),
);
let manhuaLearnJobsActive = 0;
let manhuaLearnTimer: NodeJS.Timeout | null = null;
const manhuaLearnAbortControllers = new Map<string, AbortController>();

/** HTTP 停止按钮先中止本进程里的模型请求；DB 标记负责跨进程/重启兜底。 */
export function abortRunningManhuaLearnJob(jobId: string): boolean {
  const controller = manhuaLearnAbortControllers.get(jobId);
  if (!controller) return false;
  controller.abort();
  return true;
}

type JobEnvelope = {
  action: string;
  params?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePersistedNativeModelReceipts(raw: unknown): ManhuaNativeModelReceipt[] {
  if (!Array.isArray(raw)) return [];
  let parsed: ManhuaNativeModelReceipt[] = [];
  for (const value of raw) {
    if (!isRecord(value) || Array.isArray(value)) continue;
    if (
      typeof value.callId !== "string"
      || typeof value.model !== "string"
      || typeof value.route !== "string"
      || ![
        "audio_model",
        "visual_model",
        "visual_parse",
        "series_aggregation_model",
      ].includes(String(value.stage || ""))
      || !["started", "completed", "failed"].includes(String(value.status || ""))
      || !Array.isArray(value.episodeIndexes)
    ) continue;
    parsed = appendManhuaNativeModelReceipt(
      parsed,
      value as unknown as ManhuaNativeModelReceipt,
      typeof value.atIso === "string" && value.atIso ? value.atIso : new Date(0).toISOString(),
    );
  }
  return parsed;
}

function asEnvelope(value: unknown): JobEnvelope {
  if (!isRecord(value) || typeof value.action !== "string") {
    throw new Error("Invalid job input payload");
  }
  return {
    action: value.action,
    params: isRecord(value.params) ? value.params : {},
  };
}

function ensureKlingInitialized() {
  if (klingInitialized) return;
  const keys = parseKeysFromEnv();
  if (keys.length === 0) {
    throw new Error("Kling API is not configured: Missing KLING_CN_VIDEO_ACCESS_KEY and KLING_CN_VIDEO_SECRET_KEY");
  }
  configureKlingClient(keys, "cn");
  klingInitialized = true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type JobTimeoutErrorWithPartial<T> = Error & { partialResult?: T };

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  opts: {
    onTimeout?: () => void | Promise<void>;
    cleanupGraceMs?: number;
  } = {},
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  let timeoutTriggered = false;
  let timeoutHook: Promise<void> = Promise.resolve();
  const settled = promise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason) => ({ status: "rejected" as const, reason }),
  );
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timeoutTriggered = true;
      // 先把墙钟结果锁成失败，再通知底层中止。若 onTimeout 同步令原任务
      // resolve，而这里后 reject，Promise.race 会把已超时任务误报为成功。
      reject(new Error(message));
      try {
        timeoutHook = Promise.resolve(opts.onTimeout?.()).then(() => undefined);
      } catch (error) {
        timeoutHook = Promise.reject(error);
      }
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } catch (error) {
    if (!timeoutTriggered) throw error;
    await timeoutHook.catch(() => undefined);
    const cleanupGraceMs = Math.max(0, opts.cleanupGraceMs ?? 30_000);
    const cleanupResult = await Promise.race([
      settled,
      new Promise<{ status: "grace_expired" }>((resolve) => {
        const handle = setTimeout(() => resolve({ status: "grace_expired" }), cleanupGraceMs);
        handle.unref?.();
      }),
    ]);
    const timeoutError = (error instanceof Error ? error : new Error(message)) as JobTimeoutErrorWithPartial<T>;
    if (cleanupResult.status === "fulfilled") timeoutError.partialResult = cleanupResult.value;
    if (cleanupResult.status === "rejected" && isRecord(cleanupResult.reason)) {
      const receipts = parsePersistedNativeModelReceipts(cleanupResult.reason.nativeModelReceipts);
      if (receipts.length > 0) Object.assign(timeoutError, { nativeModelReceipts: receipts });
      if (isRecord(cleanupResult.reason.nativeUsage)) {
        Object.assign(timeoutError, { nativeUsage: cleanupResult.reason.nativeUsage });
      }
    }
    throw timeoutError;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function isPlatformTimeoutError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error || "");
  const lower = `${name} ${message}`.toLowerCase();
  return (
    name === "AbortError" ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("abort") ||
    lower.includes("aborted") ||
    // withLlmTimeout throws Chinese messages — must also match these:
    message.includes("超时") ||   // "LLM 请求超时，已等待 Xms"
    message.includes("已取消")    // "LLM 请求已取消（客户端已断开）"
  );
}

function getPlatformJobErrorMessage(error: unknown): string {
  if (isPlatformTimeoutError(error)) {
    return "AI 深度思考时间过长导致连接超时。请尝试缩减提示词范围，或重新提交分析。";
  }
  return "任务执行失败，请稍后重试。";
}

/** Preserve the original error message inside the thrown error so job.error field is diagnostic. */
function buildPlatformJobError(error: unknown): Error {
  const originalMsg = error instanceof Error ? error.message : String(error ?? "unknown");
  const userMsg = getPlatformJobErrorMessage(error);
  // Embed original message (≤400 chars) so operators can see actual cause in job.error
  const enriched = new Error(`${userMsg} [原始错误: ${originalMsg.slice(0, 400)}]`);
  // Preserve timeout classification in the name so downstream getJobFailureMessage() works correctly
  if (isPlatformTimeoutError(error)) {
    enriched.name = "TimeoutError";
  }
  return enriched;
}

function getJobFailureMessage(jobType: JobType, error: unknown): string {
  if (jobType === "platform") {
    return getPlatformJobErrorMessage(error);
  }
  if (jobType === "pdf_export") {
    const m = error instanceof Error ? error.message : "PDF 导出失败";
    return `PDF 导出失败：${m}`;
  }
  return error instanceof Error ? error.message : "未知任务错误";
}

async function pollKlingTask<T extends { task_status?: string; task_status_msg?: string }>(
  fetchStatus: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const startedAt = Date.now();
  let last: T | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    last = await fetchStatus();
    if (last.task_status === "succeed" || last.task_status === "failed") {
      return last;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (last?.task_status === "succeed" || last?.task_status === "failed") {
    return last;
  }
  throw new Error("Provider polling timeout");
}

async function pollFalTask(
  endpoint: FalKlingEndpoint,
  requestId: string,
  timeoutMs: number
): Promise<Record<string, any>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = await falKlingStatus(endpoint, requestId);
    if (status.status === "completed") {
      return (status.result ?? {}) as Record<string, any>;
    }
    if (status.status === "failed" || status.status === "error") {
      throw new Error(`fal.ai task failed (${status.status})`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("fal.ai polling timeout");
}

async function runFalOmniFallback(
  request: CreateOmniVideoRequest,
  timeoutMs: number
): Promise<{ output: Record<string, unknown>; provider: string }> {
  const hasImage = Boolean(request.image_list?.length);
  const endpoint = getOmniVideoEndpoint(
    request.model_name ?? "kling-v3-omni",
    request.mode ?? "std",
    hasImage
  );
  const falInput = convertOmniVideoToFal(request as any);
  const queued = await falKlingQueue(endpoint, falInput);
  const result = await pollFalTask(endpoint, queued.request_id, timeoutMs);
  const videoUrl = result.video?.url;
  if (typeof videoUrl !== "string" || videoUrl.length === 0) {
    throw new Error("fal.ai completed without video URL");
  }
  return {
    provider: "fal.ai",
    output: {
      requestId: queued.request_id,
      videoUrl,
      raw: result,
    },
  };
}

async function processVideoJob(input: JobEnvelope, timeoutMs: number, userId?: string, jobId?: string): Promise<{ output: unknown; provider?: string }> {
  const params = input.params ?? {};
  const { createAssetAnalysisProgressReporter } = await import("../growth/assetAnalysisJobProgress");
  const progress = createAssetAnalysisProgressReporter(jobId);

  if (input.action === "manhua_assemble_final") {
    const { runManhuaAssembleFinal } = await import("../services/manhuaAssembleFinalService");
    const result = await runManhuaAssembleFinal({
      ...(isRecord(params) ? params : {}),
      clips: Array.isArray(params.clips) ? (params.clips as any) : undefined,
      sceneVideos: Array.isArray(params.sceneVideos) ? (params.sceneVideos as any) : undefined,
      episodeIndexes: Array.isArray(params.episodeIndexes)
        ? (params.episodeIndexes as number[])
        : undefined,
      musicUrl: typeof params.musicUrl === "string" ? params.musicUrl : undefined,
      musicPrompt: typeof params.musicPrompt === "string" ? params.musicPrompt : undefined,
      topic: typeof params.topic === "string" ? params.topic : undefined,
      seriesTitle: typeof params.seriesTitle === "string" ? params.seriesTitle : undefined,
      logline: typeof params.logline === "string" ? params.logline : undefined,
      musicDuration: typeof params.musicDuration === "number" ? params.musicDuration : undefined,
      musicProvider: typeof params.musicProvider === "string" ? params.musicProvider : undefined,
      musicVolume: typeof params.musicVolume === "number" ? params.musicVolume : undefined,
      musicFadeInSec: typeof params.musicFadeInSec === "number" ? params.musicFadeInSec : undefined,
      musicFadeOutSec: typeof params.musicFadeOutSec === "number" ? params.musicFadeOutSec : undefined,
      transition: typeof params.transition === "string" ? params.transition : undefined,
      resolution: typeof params.resolution === "string" ? params.resolution : undefined,
    });
    return {
      provider: "manhua-assemble",
      output: {
        ...result,
        finalVideoUrl: result.finalVideoUrl,
        videoUrl: result.finalVideoUrl,
      },
    };
  }

  if (input.action === "manhua_template_learn") {
    const { runManhuaTemplateLearn } = await import("../services/manhuaTemplateLearnService");
    const {
      MANHUA_LEARN_STAGE,
      appendManhuaLearnProgressLine,
      manhuaLearnStageLabelZh,
    } = await import("../../shared/manhuaTemplateLearnPipeline.js");
    let manhuaProgressWriteQueue: Promise<void> = Promise.resolve();
    const enqueueManhuaProgressWrite = <T>(writer: () => T | Promise<T>): Promise<T> => {
      const current = manhuaProgressWriteQueue
        .catch(() => undefined)
        .then(writer);
      manhuaProgressWriteQueue = current.then(() => undefined, () => undefined);
      return current;
    };
    let nativeModelReceipts: ManhuaNativeModelReceipt[] = [];
    if (jobId) {
      try {
        const current = await getJobById(jobId);
        const output = current?.output && typeof current.output === "object" && !Array.isArray(current.output)
          ? current.output as Record<string, unknown>
          : {};
        nativeModelReceipts = parsePersistedNativeModelReceipts(output.nativeModelReceipts);
      } catch {
        // 首次读取失败不阻断模型任务；本轮回调仍会先在内存累计并随终态再落一次。
      }
    }
    const reportLearnProgressNow = async (phase: string, detailZh: string) => {
      const label = manhuaLearnStageLabelZh(phase, detailZh);
      const parsedBatch = Number(/本轮新增\s*(\d+)/.exec(label)?.[1] || 0);
      const parsedLearned = Number(/累计\s*(\d+)\s*集/.exec(label)?.[1] || 0);
      const parsedListed = Number(/已解析\s*(\d+)\s*集/.exec(label)?.[1] || 0);
      const parsedEpisode = Number(/第\s*(\d+)\s*集/.exec(label)?.[1] || 0);
      let learnProgressLog = appendManhuaLearnProgressLine(undefined, phase, label);
      if (jobId) {
        try {
          const job = await getJobById(jobId);
          const prevOut =
            job?.output && typeof job.output === "object" && !Array.isArray(job.output)
              ? (job.output as Record<string, unknown>)
              : {};
          const prevLog = Array.isArray(prevOut.learnProgressLog)
            ? (prevOut.learnProgressLog as Parameters<typeof appendManhuaLearnProgressLine>[0])
            : undefined;
          learnProgressLog = appendManhuaLearnProgressLine(prevLog, phase, label);
          await patchJobRunningProgress(jobId, {
            analysisStage: `manhua_learn_${phase}`,
            analysisStageLabel: label,
            learnChannel: "cloud",
            ...(params.nativeDeepReadConfirmed === true
              ? { pipelineMode: "native_deep_read" }
              : {}),
            learnProgressLog,
            ...(parsedBatch > 0
              ? { batchLearned: Math.max(Number(prevOut.batchLearned) || 0, parsedBatch) }
              : {}),
            ...(parsedLearned > 0
              ? { learnedCount: Math.max(Number(prevOut.learnedCount) || 0, parsedLearned) }
              : {}),
            ...(parsedListed > 0
              ? { listedEpisodeCount: Math.max(Number(prevOut.listedEpisodeCount) || 0, parsedListed) }
              : {}),
            ...(parsedEpisode > 0 ? { currentEpisodeIndex: parsedEpisode } : {}),
          });
          return;
        } catch {
          /* fall through */
        }
      }
      await progress?.patch({
        analysisStage: `manhua_learn_${phase}`,
        analysisStageLabel: label,
        learnChannel: "cloud",
        ...(params.nativeDeepReadConfirmed === true
          ? { pipelineMode: "native_deep_read" }
          : {}),
        learnProgressLog,
        ...(parsedBatch > 0 ? { batchLearned: parsedBatch } : {}),
        ...(parsedLearned > 0 ? { learnedCount: parsedLearned } : {}),
        ...(parsedListed > 0 ? { listedEpisodeCount: parsedListed } : {}),
      } as any);
    };
    // 多条模型回执可能并发到达。若两条回执同时读同一份旧 job.output 再 patch，
    // 后写会覆盖先写，面板就少一条秒级记录。这里只串行化“进度落库”，模型请求仍并行。
    const reportLearnProgress = (phase: string, detailZh: string) =>
      enqueueManhuaProgressWrite(() => reportLearnProgressNow(phase, detailZh));
    await reportLearnProgress(MANHUA_LEARN_STAGE.queued, "云端学节奏已入队，正在启动…");
    const importedGcsUri = typeof params.gcsUri === "string" ? params.gcsUri.trim() : "";
    if (importedGcsUri && !isOwnedManhuaLearnImportGcsUri({
      gcsUri: importedGcsUri,
      bucket: getGcsBucketName(),
      userId: userId || "",
    })) {
      throw new Error("手动导入视频不属于当前用户或配置存储桶");
    }
    const abortController = new AbortController();
    if (jobId) manhuaLearnAbortControllers.set(jobId, abortController);
    let result: Awaited<ReturnType<typeof runManhuaTemplateLearn>>;
    const nativeConfirmed = params.nativeDeepReadConfirmed === true;
    try {
      let nativePlanPreview: Awaited<ReturnType<
        typeof import("../services/manhuaNativeDeepReadPlanRuntime.js")["buildNativeDeepReadPlanPreviewFromServices"]
      >> | undefined;
      if (nativeConfirmed) {
        const confirmation = parseNativeDeepReadJobConfirmation(params);
        const { buildNativeDeepReadPlanPreviewFromServices } = await import(
          "../services/manhuaNativeDeepReadPlanRuntime.js"
        );
        const { assertNativeDeepReadPlanConfirmation } = await import(
          "../services/manhuaNativeDeepReadPlan.js"
        );
        nativePlanPreview = await buildNativeDeepReadPlanPreviewFromServices({
          url: confirmation.url,
          limit: confirmation.planLimit,
          learnLlm: confirmation.learnLlm,
          abortSignal: abortController.signal,
        });
        assertNativeDeepReadPlanConfirmation(
          confirmation,
          nativePlanPreview,
        );
        const quarantinedClaims = nativePlanPreview.pendingClaimEpisodeIndexes.length
          ? ` · 已隔离占位第${nativePlanPreview.pendingClaimEpisodeIndexes.join("、")}集`
          : "";
        await reportLearnProgress(
          MANHUA_LEARN_STAGE.list,
          `执行计划复核通过：${nativePlanPreview.executableEpisodeCount} 集 · ${nativePlanPreview.totalModelCalls} 次模型请求（画面 ${nativePlanPreview.totalSegments} 个视频分片每段一次调用共 ${nativePlanPreview.totalVisualCalls} 次、音轨随调直出 + 系列整理 1 次） · 确认码 ${nativePlanPreview.planHash}${quarantinedClaims}`,
        );
      } else if (hasNativeDeepReadJobFields(params)) {
        throw new Error("原生精读计划未获明确确认，未发出模型请求");
      }
      result = await runManhuaTemplateLearn({
      url: typeof params.url === "string" ? params.url : undefined,
      gcsUri: importedGcsUri || undefined,
      fileName: typeof params.fileName === "string" ? params.fileName : undefined,
      title: typeof params.title === "string" ? params.title : undefined,
      mixId: typeof params.mixId === "string" ? params.mixId : undefined,
      rank: typeof params.rank === "number" ? params.rank : undefined,
      batchSize: typeof params.batchSize === "number" ? params.batchSize : undefined,
      refreshPreviewFrames: params.refreshPreviewFrames === true,
      retrySkippedEpisodes: params.retrySkippedEpisodes === true,
      learnLlm:
        params.learnLlm === "claude" || params.learnLlm === "deepseek" ? params.learnLlm : undefined,
      nativeDeepReadConfirmed: nativeConfirmed,
      nativePlanPreview,
      onProgress: reportLearnProgress,
      onNativeUsage: async (nativeUsage) => {
        if (!jobId) return;
        try {
          await enqueueManhuaProgressWrite(() => patchJobRunningProgress(jobId, {
              pipelineMode: "native_deep_read",
              nativeUsage,
            }));
        } catch (error) {
          // 卡片已经入库后，进度回执的一次写入异常不能把该集改判失败并触发重跑。
          // 完整回执仍会随最终 result 再写一次；这里仅记录服务端异常。
          console.warn("[manhua-learn] native usage progress persistence failed", error);
        }
      },
      onNativeModelReceipt: async (receipt) => {
        nativeModelReceipts = appendManhuaNativeModelReceipt(nativeModelReceipts, receipt);
        if (!jobId) return;
        await enqueueManhuaProgressWrite(async () => {
          const persisted = await upsertManhuaNativeModelReceiptForJob(jobId, receipt);
          if (!persisted) {
            console.warn(`[manhua-learn] native receipt persistence exhausted: jobId=${jobId}`);
          }
        });
      },
      abortSignal: abortController.signal,
      checkControl: async () => {
        if (abortController.signal.aborted) return "cancel";
        if (jobId && await isManhuaTemplateLearnJobCancelRequested(jobId)) return "cancel";
        if (jobId && await consumeManhuaTemplateLearnEpisodeSkip(jobId)) return "skip";
        return "continue";
      },
      onEpisodeCheckpoint: async (preview) => {
        if (!jobId) return;
        await enqueueManhuaProgressWrite(async () => {
          const current = await getJobById(jobId);
          const prevOut = current?.output && typeof current.output === "object" && !Array.isArray(current.output)
            ? current.output as Record<string, unknown>
            : {};
          const previews = Array.isArray(prevOut.digestsPreview)
            ? [...prevOut.digestsPreview as Array<Record<string, unknown>>]
            : [];
          const withoutCurrent = previews.filter((row) => Number(row.episodeIndex) !== preview.episodeIndex);
          const nextPreviews = [...withoutCurrent, preview].sort(
            (a, b) => Number(a.episodeIndex) - Number(b.episodeIndex),
          );
          await patchJobRunningProgress(jobId, {
            digestsPreview: nextPreviews,
            currentEpisodeIndex: preview.episodeIndex,
            learnedCount: nextPreviews.filter((row) => row.complete === true).length,
          });
        });
      },
      });
    } catch (error) {
      const wrapped = error instanceof Error ? error : new Error(String(error));
      if (nativeConfirmed || nativeModelReceipts.length > 0) {
        Object.assign(wrapped, { nativeModelReceipts });
      }
      throw wrapped;
    } finally {
      if (jobId) manhuaLearnAbortControllers.delete(jobId);
    }
    let learnProgressLog: ReturnType<typeof appendManhuaLearnProgressLine> | undefined;
    if (jobId) {
      try {
        const job = await getJobById(jobId);
        const prevOut =
          job?.output && typeof job.output === "object" && !Array.isArray(job.output)
            ? (job.output as Record<string, unknown>)
            : {};
        if (Array.isArray(prevOut.learnProgressLog)) {
          learnProgressLog = appendManhuaLearnProgressLine(
            prevOut.learnProgressLog as Parameters<typeof appendManhuaLearnProgressLine>[0],
            MANHUA_LEARN_STAGE.done,
            manhuaLearnStageLabelZh(MANHUA_LEARN_STAGE.done),
          );
        }
      } catch {
        /* ignore */
      }
    }
    if (!learnProgressLog) {
      learnProgressLog = appendManhuaLearnProgressLine(
        undefined,
        MANHUA_LEARN_STAGE.done,
        manhuaLearnStageLabelZh(MANHUA_LEARN_STAGE.done),
      );
    }
    const terminalOutput = {
      ...result,
      proposalId: result.proposal?.id || null,
      nameZh: result.proposal?.nameZh || null,
      status: result.proposal?.status || null,
      learnChannel: "cloud",
      analysisStage: `manhua_learn_${MANHUA_LEARN_STAGE.done}`,
      analysisStageLabel: manhuaLearnStageLabelZh(MANHUA_LEARN_STAGE.done),
      learnProgressLog,
      ...(nativeModelReceipts.length > 0 ? { nativeModelReceipts } : {}),
    };
    // 先保存完整终态 payload，再由 runClaimedJob 把 status 原子推进到 succeeded。
    // 部署若刚好切在两次写入之间，启动恢复会认出 done，而不是重跑整条学习链。
    if (jobId) await patchJobRunningProgress(jobId, terminalOutput);
    return {
      provider: "manhua-template-learn",
      output: terminalOutput,
    };
  }

  if (input.action === "growth_analyze_video") {
    const numericUserId = userId ? Number(userId) : NaN;
    // 审查必须修（P0·租户边界）：worker 是终闸——历史队列/旁路入队的 job 也在这里拦。
    // 匿名 "public"/非数字 userId 不跑（NaN 还会免扣费）；gcsUri 只认本人上传前缀。
    if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
      throw new Error("请先登录后再提交分析");
    }
    if (typeof params.gcsUri === "string" && params.gcsUri.trim()) {
      const { getGcsBucketName } = await import("../services/gcs.js");
      const allowedPrefix = `gs://${getGcsBucketName()}/uploads/u${numericUserId}/`;
      if (!String(params.gcsUri).startsWith(allowedPrefix)) {
        throw new Error("只能分析本人上传的文件");
      }
    }
    // 第五轮复审 P0·5：fileKey/fileUrl 是 gcsUri 的旁路——
    // fileKey 可读任意已知对象键、fileUrl 可让服务器去拉内网/元数据地址（SSRF）。
    // fileKey 只认本人上传前缀；fileUrl 只认 GCS 签名直链且路径归属本人。
    if (typeof params.fileKey === "string" && params.fileKey.trim()) {
      if (!String(params.fileKey).startsWith(`uploads/u${numericUserId}/`)) {
        throw new Error("只能分析本人上传的文件");
      }
    }
    if (typeof params.fileUrl === "string" && params.fileUrl.trim()) {
      let allowed = false;
      try {
        const { getGcsBucketName } = await import("../services/gcs.js");
        const u = new URL(String(params.fileUrl));
        // 前缀校验（第七轮 P1·3）：includes 会放过「任意外部桶但路径里带 /uploads/u<id>/」
        allowed =
          u.protocol === "https:" &&
          u.hostname === "storage.googleapis.com" &&
          u.pathname.startsWith(`/${getGcsBucketName()}/uploads/u${numericUserId}/`);
      } catch {
        allowed = false;
      }
      if (!allowed) {
        throw new Error("只能分析本人上传的文件");
      }
    }
    const growthMode = params.mode === "REMIX" ? "REMIX" : "GROWTH";
    const creditAction = growthMode === "REMIX" ? "growthCampRemix" : "growthCampGrowth";

    // 前端可传入 durationSeconds（本地文档上传时可获取），URL 类视频无法提前获取则为 0
    const durationSeconds = typeof params.durationSeconds === "number" ? params.durationSeconds : 0;

    // 硬限制：超过 60 分钟直接拒绝
    if (durationSeconds > MAX_DURATION_SECONDS) {
      throw new Error("系统暂不支持超过 60 分钟的超长视频，请剪辑后再试");
    }

    // 固定单次计费（不按时长阶梯）；supervisor/admin 由 deductCreditsAmount 内部免扣
    const cost = flatAnalysisCost(growthMode);
    let creditDeducted = 0;

    if (Number.isFinite(numericUserId)) {
      const deductResult = await deductCreditsAmount(
        numericUserId,
        cost,
        creditAction,
        `创作者成长营 ${growthMode} 分析（单次 ${cost} 积分）`,
      );
      creditDeducted = deductResult.cost;
    }

    try {
      const isPlatformAsset =
        params.platformAssetLite === true || params.platformAssetAnalysis === true;
      let analysisContext = typeof params.context === "string" ? params.context : undefined;
      let trendMeta: string | undefined;
      if (isPlatformAsset) {
        const enriched = await enrichPlatformAssetAnalysisContext(analysisContext);
        analysisContext = enriched.context;
        trendMeta = enriched.trendMeta;
      }

      const result = await analyzeGrowthCampVideo({
        gcsUri: typeof params.gcsUri === "string" ? params.gcsUri : undefined,
        fileUrl: typeof params.fileUrl === "string" ? params.fileUrl : undefined,
        fileKey: typeof params.fileKey === "string" ? params.fileKey : undefined,
        mimeType: String(params.mimeType ?? "video/mp4"),
        fileName: typeof params.fileName === "string" ? params.fileName : undefined,
        context: analysisContext,
        modelName: typeof params.modelName === "string" ? params.modelName : undefined,
        mode: params.mode === "REMIX" ? "REMIX" : "GROWTH",
        analysisProfile: params.analysisProfile === "extract_only" ? "extract_only" : "full",
        extractPrompt: typeof params.extractPrompt === "string" ? params.extractPrompt : undefined,
        platformAssetLite: params.platformAssetLite === true,
        progress,
      });

      return {
        provider: result.videoMeta.provider,
        output: {
          analysis: result.analysis,
          videoUrl: result.videoMeta.videoUrl,
          audioUrl: result.videoMeta.audioUrl,
          transcript: result.videoMeta.transcript,
          videoDuration: result.videoMeta.videoDuration,
          debug: {
            route: "analyzeVideoJob",
            provider: result.videoMeta.provider,
            model: result.videoMeta.model,
            pipeline: result.videoMeta.pipeline,
            stageOneModel: result.videoMeta.stageOneModel,
            stageTwoModel: result.videoMeta.stageTwoModel,
            sparseFrameCount: result.videoMeta.sparseFrameCount,
            visualPassModel: resolveGrowthCampExtractorModel(),
            estimatedCostProfile: result.videoMeta.estimatedCostProfile,
            fallback: result.videoMeta.fallback,
            transcriptChars: result.videoMeta.transcript.length,
            videoDuration: result.videoMeta.videoDuration,
            failureStage: result.videoMeta.failureStage || null,
            failureReason: result.videoMeta.failureReason || null,
            trendStoreMeta: trendMeta || null,
          },
        },
      };
    } catch (err) {
      // 分析失败时退还已扣除的积分
      if (creditDeducted > 0 && Number.isFinite(numericUserId)) {
        const { refundCredits } = await import("../credits");
        await refundCredits(
          numericUserId,
          creditDeducted,
          `创作者成长营 ${growthMode}·分析失败·退回已扣积分`,
        ).catch((e) => console.error("[Credits] restore credits failed:", e));
      }
      throw err;
    }
  }

  if (input.action === "growth_analyze_images") {
    const numericUserId = userId ? Number(userId) : NaN;
    // 同 growth_analyze_video：worker 终闸，拒匿名/非数字 userId，gcsUri 只认本人前缀
    if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
      throw new Error("请先登录后再提交分析");
    }
    const growthMode = params.mode === "REMIX" ? "REMIX" : "GROWTH";
    const creditAction = growthMode === "REMIX" ? "growthCampRemix" : "growthCampGrowth";

    const rawImages = Array.isArray(params.images) ? params.images : [];
    const images = rawImages
      .map((item: unknown) => {
        const row = item as Record<string, unknown>;
        return {
          gcsUri: typeof row.gcsUri === "string" ? row.gcsUri : undefined,
          fileBase64: typeof row.fileBase64 === "string" ? row.fileBase64 : undefined,
          mimeType: String(row.mimeType ?? ""),
          fileName: typeof row.fileName === "string" ? row.fileName : undefined,
        };
      })
      .filter((item) => String(item.gcsUri || "").trim() || String(item.fileBase64 || "").trim());

    if (!images.length) {
      throw new Error("请至少上传一张 PNG 或 JPG 图片");
    }
    if (images.some((img) => img.gcsUri)) {
      const { getGcsBucketName } = await import("../services/gcs.js");
      const allowedPrefix = `gs://${getGcsBucketName()}/uploads/u${numericUserId}/`;
      for (const img of images) {
        if (img.gcsUri && !String(img.gcsUri).startsWith(allowedPrefix)) {
          throw new Error("只能分析本人上传的文件");
        }
      }
    }

    const unitCost = flatAnalysisCost(growthMode);
    const cost = flatImageAnalysisCost(growthMode, images.length);
    let creditDeducted = 0;

    if (Number.isFinite(numericUserId)) {
      const deductResult = await deductCreditsAmount(
        numericUserId,
        cost,
        creditAction,
        `创作者成长营 ${growthMode} 图片分析（${images.length} 张 × ${unitCost} 积分）`,
      );
      creditDeducted = deductResult.cost;
    }

    try {
      const isPlatformAsset = params.platformAssetAnalysis === true;
      let analysisContext = typeof params.context === "string" ? params.context : undefined;
      let trendMeta: string | undefined;
      if (isPlatformAsset) {
        const enriched = await enrichPlatformAssetAnalysisContext(analysisContext);
        analysisContext = enriched.context;
        trendMeta = enriched.trendMeta;
      }

      const result = await analyzeGrowthCampImages({
        images,
        context: analysisContext,
        modelName: typeof params.modelName === "string" ? params.modelName : undefined,
        mode: growthMode,
        progress,
      });

      return {
        provider: result.imageMeta.provider,
        output: {
          analysis: result.analysis,
          fileUrls: result.imageMeta.fileUrls,
          imageCount: result.imageMeta.imageCount,
          debug: {
            route: "analyzeGrowthCampImagesJob",
            provider: result.imageMeta.provider,
            model: result.imageMeta.model,
            fallback: result.imageMeta.fallback,
            primaryError: result.imageMeta.primaryError || null,
            imageCount: result.imageMeta.imageCount,
            trendStoreMeta: trendMeta || null,
          },
        },
      };
    } catch (err) {
      if (creditDeducted > 0 && Number.isFinite(numericUserId)) {
        const { refundCredits } = await import("../credits");
        await refundCredits(
          numericUserId,
          creditDeducted,
          `创作者成长营 ${growthMode}·图片分析失败·退回已扣积分`,
        ).catch((e) => console.error("[Credits] restore credits failed:", e));
      }
      throw err;
    }
  }

  /*
   * 这里原本无条件调 ensureKlingInitialized()，缺密钥直接抛错。
   *
   * 但它下面只有 omni_* / motion_control / lip_sync / kling_image 这几个可灵分支真需要
   * 初始化，而 nano_image、virtual_idol、canvas_gpt_image2 也排在后面——画布关键静帧走
   * 的正是 canvas_gpt_image2，等于漫剧出静帧要先过一道可灵密钥门。可灵已下线、密钥已过期，
   * 一删 secrets 静帧就会全挂。改成由真正用到可灵的分支各自初始化（kling_image 已自带一次，
   * 其余分支无前端生产者、不可达）。
   */
  if (input.action === "omni_t2v") {
    ensureKlingInitialized();
    const request = buildT2VRequest({
      prompt: String(params.prompt ?? ""),
      negativePrompt: typeof params.negativePrompt === "string" ? params.negativePrompt : undefined,
      mode: (params.mode as any) ?? "std",
      aspectRatio: (params.aspectRatio as any) ?? "16:9",
      duration: (params.duration as any) ?? "5",
      cfgScale: typeof params.cfgScale === "number" ? params.cfgScale : 0.5,
    });
    try {
      const created = await createOmniVideoTask(request, "cn");
      const final = await pollKlingTask(() => getOmniVideoTask(created.task_id, "cn"), timeoutMs);
      if (final.task_status !== "succeed") {
        throw new Error(final.task_status_msg || "Kling video generation failed");
      }
      const videoUrl = final.task_result?.videos?.[0]?.url;
      if (!videoUrl) throw new Error("Kling completed without video URL");
      return { provider: "kling-cn", output: { taskId: created.task_id, videoUrl, raw: final } };
    } catch {
      return runFalOmniFallback(request, timeoutMs);
    }
  }

  if (input.action === "omni_i2v") {
    ensureKlingInitialized();
    const request = buildI2VRequest({
      prompt: String(params.prompt ?? ""),
      imageUrl: String(params.imageUrl ?? ""),
      imageType: (params.imageType as any) ?? "first_frame",
      negativePrompt: typeof params.negativePrompt === "string" ? params.negativePrompt : undefined,
      mode: (params.mode as any) ?? "std",
      aspectRatio: (params.aspectRatio as any) ?? "16:9",
      duration: (params.duration as any) ?? "5",
      cfgScale: typeof params.cfgScale === "number" ? params.cfgScale : 0.5,
    });
    try {
      const created = await createOmniVideoTask(request, "cn");
      const final = await pollKlingTask(() => getOmniVideoTask(created.task_id, "cn"), timeoutMs);
      if (final.task_status !== "succeed") {
        throw new Error(final.task_status_msg || "Kling image-to-video failed");
      }
      const videoUrl = final.task_result?.videos?.[0]?.url;
      if (!videoUrl) throw new Error("Kling completed without video URL");
      return { provider: "kling-cn", output: { taskId: created.task_id, videoUrl, raw: final } };
    } catch {
      return runFalOmniFallback(request, timeoutMs);
    }
  }

  if (input.action === "omni_storyboard") {
    ensureKlingInitialized();
    const shotsInput = Array.isArray(params.shots) ? params.shots : [];
    const shots = shotsInput
      .map((shot) => (isRecord(shot) ? shot : null))
      .filter((shot): shot is Record<string, unknown> => Boolean(shot))
      .map((shot) => ({
        prompt: String(shot.prompt ?? ""),
        duration: String(shot.duration ?? "5"),
      }))
      .filter((shot) => shot.prompt.length > 0);

    const request = buildStoryboardRequest({
      shots,
      mode: (params.mode as any) ?? "std",
      aspectRatio: (params.aspectRatio as any) ?? "16:9",
      elementIds: Array.isArray(params.elementIds) ? (params.elementIds as number[]) : undefined,
      imageUrl: typeof params.imageUrl === "string" ? params.imageUrl : undefined,
    });

    const created = await createOmniVideoTask(request, "cn");
    const final = await pollKlingTask(() => getOmniVideoTask(created.task_id, "cn"), timeoutMs);
    if (final.task_status !== "succeed") {
      throw new Error(final.task_status_msg || "Kling storyboard generation failed");
    }
    const videoUrl = final.task_result?.videos?.[0]?.url;
    if (!videoUrl) throw new Error("Kling completed without video URL");
    return { provider: "kling-cn", output: { taskId: created.task_id, videoUrl, raw: final } };
  }

  if (input.action === "motion_control") {
    ensureKlingInitialized();
    const request = buildMotionControlRequest({
      imageUrl: String(params.imageUrl ?? ""),
      videoUrl: String(params.videoUrl ?? ""),
      orientation: (params.orientation as any) ?? "video",
      mode: (params.mode as any) ?? "std",
      prompt: typeof params.prompt === "string" ? params.prompt : undefined,
      keepOriginalSound: Boolean(params.keepOriginalSound),
    });
    try {
      const created = await createMotionControlTask(request, "cn");
      const final = await pollKlingTask(() => getMotionControlTask(created.task_id, "cn"), timeoutMs);
      if (final.task_status !== "succeed") {
        throw new Error(final.task_status_msg || "Kling motion-control failed");
      }
      const videoUrl = final.task_result?.videos?.[0]?.url;
      if (!videoUrl) throw new Error("Kling completed without video URL");
      return { provider: "kling-cn", output: { taskId: created.task_id, videoUrl, raw: final } };
    } catch {
      const falInput = convertMotionControlToFal(request as any);
      const queued = await falKlingQueue("motion-control", falInput);
      const result = await pollFalTask("motion-control", queued.request_id, timeoutMs);
      const videoUrl = result.video?.url;
      if (typeof videoUrl !== "string" || videoUrl.length === 0) {
        throw new Error("fal.ai motion-control completed without video URL");
      }
      return {
        provider: "fal.ai",
        output: {
          requestId: queued.request_id,
          videoUrl,
          raw: result,
        },
      };
    }
  }

  if (input.action === "lip_sync") {
    ensureKlingInitialized();
    const request = buildLipSyncWithAudio({
      sessionId: String(params.sessionId ?? ""),
      faceId: String(params.faceId ?? ""),
      audioUrl: String(params.audioUrl ?? ""),
      audioStartTime: typeof params.audioStartTime === "number" ? params.audioStartTime : undefined,
      audioEndTime: typeof params.audioEndTime === "number" ? params.audioEndTime : undefined,
      insertTime: typeof params.insertTime === "number" ? params.insertTime : 0,
      soundVolume: typeof params.soundVolume === "number" ? params.soundVolume : 1,
      originalAudioVolume: typeof params.originalAudioVolume === "number" ? params.originalAudioVolume : 0,
    });
    try {
      const created = await createLipSyncTask(request, "cn");
      const final = await pollKlingTask(() => getLipSyncTask(created.task_id, "cn"), timeoutMs);
      if (final.task_status !== "succeed") {
        throw new Error(final.task_status_msg || "Kling lip-sync failed");
      }
      const videoUrl = final.task_result?.videos?.[0]?.url;
      if (!videoUrl) throw new Error("Kling completed without video URL");
      return { provider: "kling-cn", output: { taskId: created.task_id, videoUrl, raw: final } };
    } catch {
      const falInput = convertLipSyncToFal({
        video_url: String(params.videoUrl ?? ""),
        audio_url: String(params.audioUrl ?? ""),
      });
      if (!falInput.video_url) {
        throw new Error("Lip-sync fallback requires videoUrl");
      }
      const queued = await falKlingQueue("lip-sync", falInput);
      const result = await pollFalTask("lip-sync", queued.request_id, timeoutMs);
      const videoUrl = result.video?.url;
      if (typeof videoUrl !== "string" || videoUrl.length === 0) {
        throw new Error("fal.ai lip-sync completed without video URL");
      }
      return {
        provider: "fal.ai",
        output: {
          requestId: queued.request_id,
          videoUrl,
          raw: result,
        },
      };
    }
  }

  throw new Error(`Unsupported video action: ${input.action}`);
}

async function resolveUserForJob(userId: string): Promise<User> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available for user-scoped job");
  }

  const numericId = Number(userId);
  const rows = Number.isFinite(numericId)
    ? await db.select().from(users).where(eq(users.id, numericId)).limit(1)
    : await db.select().from(users).where(eq(users.openId, userId)).limit(1);

  if (rows.length === 0) {
    throw new Error("User not found for job execution");
  }
  return rows[0];
}

async function processImageJob(input: JobEnvelope, timeoutMs: number, jobUserId: string, jobId?: string): Promise<{ output: unknown; provider?: string }> {
  const params = input.params ?? {};

  if (isCreativeNanoImageJob(input)) {
    const prompt = String(params.prompt || "").trim();
    if (!prompt) throw new Error("creative_nano_image_missing_prompt");
    const numericUserId = Number(jobUserId);
    if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
      throw new Error("Creative Nano 需要有效登录用户，已拒绝调用上游");
    }
    if (!jobId) throw new Error("creative_nano_image 缺少 jobId，无法建立幂等计费");

    const chargeKey = `${CREATIVE_NANO_IMAGE_TASK_TYPE}/${jobId}`;
    const deducted = await deductCreditsAmount(
      numericUserId,
      CREATIVE_NANO_IMAGE_CREDITS,
      CREATIVE_NANO_IMAGE_TASK_TYPE,
      `Creative 生图 · Nano Banana 2 Flash（${CREATIVE_NANO_IMAGE_CREDITS} 积分/张）`,
      { chargeKey },
    );
    const { registerActiveJob, refundCreditsOnFailure } = await import(
      "../services/paidJobLedger.js"
    );
    try {
      await registerActiveJob({
        jobId,
        taskType: CREATIVE_NANO_IMAGE_TASK_TYPE,
        userId: numericUserId,
        creditsBilled: deducted.cost,
        action: `Creative 生图 · Nano Banana 2 Flash（${deducted.cost} 积分/张）`,
        deduct: deducted,
        metadata: {
          modelTier: "flash",
          quality: CREATIVE_NANO_IMAGE_QUALITY,
          aspectRatio: normalizeCreativeNanoImageAspectRatio(params.aspectRatio),
        },
      });
    } catch (error) {
      const { refundCreditsForDeductAmount } = await import("../credits.js");
      await refundCreditsForDeductAmount(
        numericUserId,
        "Creative Nano 账本登记失败·退回积分",
        deducted,
        "creativeNanoImageRefund",
        { refundKey: `refund:${CREATIVE_NANO_IMAGE_TASK_TYPE}/register/${jobId}`.slice(0, 120) },
      );
      throw error;
    }

    try {
      if (!isGeminiImageAvailable()) {
        throw new Error("Nano image generation unavailable: Vertex AI credentials not configured");
      }
      const result = await generateGeminiImage({
        prompt,
        quality: CREATIVE_NANO_IMAGE_QUALITY,
        modelTier: "flash",
        aspectRatio: normalizeCreativeNanoImageAspectRatio(params.aspectRatio),
        maxRetries: 2,
        requestTimeoutMs: 120_000,
      });
      if (!String(result.imageUrl || "").trim()) {
        throw new Error("creative_nano_image_empty");
      }
      return {
        provider: "vertex-nano-banana-2",
        output: {
          imageUrl: result.imageUrl,
          imageUrls: result.imageUrls?.length ? result.imageUrls : [result.imageUrl],
          quality: CREATIVE_NANO_IMAGE_QUALITY,
          model: result.model,
        },
      };
    } catch (error) {
      await refundCreditsOnFailure(
        jobId,
        CREATIVE_NANO_IMAGE_TASK_TYPE,
        "external_api_error",
        "Creative Nano 生成失败·退回积分",
      );
      throw error;
    }
  }

  if (input.action === "kling_image") {
    ensureKlingInitialized();
    const request = buildImageRequest({
      prompt: String(params.prompt ?? ""),
      negativePrompt: typeof params.negativePrompt === "string" ? params.negativePrompt : undefined,
      model: (params.model as any) ?? "kling-image-o1",
      resolution: (params.resolution as any) ?? "1k",
      aspectRatio: typeof params.aspectRatio === "string" ? params.aspectRatio : "1:1",
      referenceImageUrl: typeof params.referenceImageUrl === "string" ? params.referenceImageUrl : undefined,
      imageFidelity: typeof params.imageFidelity === "number" ? params.imageFidelity : undefined,
      humanFidelity: typeof params.humanFidelity === "number" ? params.humanFidelity : undefined,
      count: typeof params.count === "number" ? params.count : 1,
    });

    const created = await createImageTask(request, "cn");
    const final = await pollKlingTask(() => getImageTask(created.task_id, "cn"), timeoutMs);
    if (final.task_status !== "succeed") {
      throw new Error(final.task_status_msg || "Kling image generation failed");
    }
    const images = final.task_result?.images?.map((img) => img.url) ?? [];
    if (images.length === 0) {
      throw new Error("Kling image generation completed without output");
    }
    return {
      provider: "kling-cn",
      output: {
        taskId: created.task_id,
        images,
        imageUrl: images[0],
        raw: final,
      },
    };
  }

  if (input.action === "nano_image") {
    const quality = ((params.quality as string) === "4k" ? "4k" : "2k") as ImageQuality;
    const prompt = String(params.prompt ?? "");
    const referenceImageUrl = typeof params.referenceImageUrl === "string" ? params.referenceImageUrl : undefined;

    if (isGeminiImageAvailable()) {
      const result = await withTimeout(
        generateGeminiImage({
          prompt,
          quality,
          referenceImageUrl,
        }),
        timeoutMs,
        `Image job timed out after ${timeoutMs}ms`
      );
      return {
        provider: "nano",
        output: {
          imageUrl: result.imageUrl,
          quality: result.quality,
        },
      };
    }

    throw new Error("Nano image generation unavailable: Vertex AI credentials not configured");
  }

  if (input.action === "virtual_idol") {
    const user = await resolveUserForJob(jobUserId);
    const caller = appRouter.createCaller({
      req: {} as any,
      res: {} as any,
      user,
      clientDisconnected: new AbortController().signal,
    });

    const result = await withTimeout(
      caller.virtualIdol.generate({
        style: (params.style as any) ?? "anime",
        gender: (params.gender as any) ?? "female",
        description: typeof params.description === "string" ? params.description : undefined,
        referenceImageUrl: typeof params.referenceImageUrl === "string" ? params.referenceImageUrl : undefined,
        quality: (params.quality as any) ?? "free",
      }),
      timeoutMs,
      `Image job timed out after ${timeoutMs}ms`
    );

    if ((result as any)?.success === false) {
      throw new Error((result as any)?.error || "Virtual idol generation failed");
    }

    const imageUrl = (result as any)?.imageUrl;
    if (!imageUrl) {
      throw new Error("Virtual idol generation completed without image URL");
    }

    const quality = String((params as any).quality || "free");
    return {
      provider: quality.startsWith("kling") ? "kling-cn" : quality === "free" ? "nano-banana-flash" : "nano",
      output: result as any,
    };
  }

  /** Canvas 关键静帧 / 封面：与 sync op=canvasGptImage2 同核，供短入队+轮询 */
  if (input.action === "canvas_gpt_image2") {
    const prompt = String(params.prompt ?? "").trim();
    if (!prompt) throw new Error("missing prompt");
    const aspectRatio = String(params.aspectRatio || "9:16") === "16:9" ? "16:9" : "9:16";
    const referenceImageUrls = Array.isArray(params.referenceImageUrls)
      ? (params.referenceImageUrls as unknown[])
          .map((u) => String(u || "").trim())
          .filter(Boolean)
          .slice(0, 16)
      : [];
    const maskUrl = typeof params.maskUrl === "string" ? params.maskUrl.trim() : "";
    const providerRaw = String(params.providerOverride || "")
      .trim()
      .toLowerCase();
    let providerOverride =
      providerRaw === "openai" || providerRaw === "openrouter" || providerRaw === "auto"
        ? (providerRaw as "openai" | "openrouter" | "auto")
        : undefined;
    const assetStandardizeQuality =
      params.assetStandardizeQuality === "high" || params.assetStandardizeQuality === "medium"
        ? params.assetStandardizeQuality
        : null;
    if (assetStandardizeQuality) {
      if (referenceImageUrls.length !== 1) throw new Error("资产标准化必须且只能提交一张原图");
      providerOverride = "openai";
    }
    const generalImageEdit =
      Boolean(params.generalImageEdit) || referenceImageUrls.length > 0;
    const gcsSubdir =
      typeof params.gcsSubdir === "string" && params.gcsSubdir.trim()
        ? params.gcsSubdir.trim()
        : "canvas-gpt-image2";
    // 设定图 / 静帧分走两把官方密钥（画布出图都从这条长任务走，勿只接同步 op）
    const imageLane = normalizeOpenAiImageLane(params.imageLane) ?? undefined;

    /**
     * 画布出图收费 v3(六审第2条):**全部调用方统一由 worker 服务端计费**——
     * Canvas / Creative / Platform 都走这里扣;客户端任何字段(chargeOnServer、
     * 收据、重试引用)都不再参与收费决策,伪造/省略一律无效。
     * 幂等靠 job 级 chargeKey:同 job 重跑撞 DB 唯一索引,不会二次扣款;
     * 客户端超时也只继续轮询同一 job,不再第二次入队(canvasRunBlock 同步改)。
     * supervisor/admin 由 `deductCreditsAmount` 内部免扣,失败/空图/登记失败按原来源退回。
     */
    const numericUserId = Number(jobUserId);
    if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
      // 入口已强制登录;这里兜底拒绝 public/NaN,绝不免费打上游
      throw new Error("画布出图需要有效登录用户，已拒绝调用上游");
    }
    if (!jobId) {
      throw new Error("canvas_gpt_image2 缺少 jobId，无法建立幂等计费");
    }
    const { canvasImageCredits } = await import("../../shared/canvasGenerationPricing.js");
    const { manhuaAssetStandardizeCredits } = await import("../../shared/manhuaAssetStandardize.js");
    const cost = assetStandardizeQuality
      ? manhuaAssetStandardizeCredits(assetStandardizeQuality)
      : canvasImageCredits(typeof params.batchIndex === "number" ? params.batchIndex : 0);
    const chargeKey = assetStandardizeQuality
      ? `manhuaAssetStandardize/${jobId}`
      : `canvasGptImage2/${jobId}`;
    const deducted = await deductCreditsAmount(
      numericUserId,
      cost,
      assetStandardizeQuality ? "manhuaAssetStandardize" : "canvasGptImage2",
      assetStandardizeQuality ? `导入资产 AI 标准化（${cost} 积分/张）` : `画布出图（${cost} 积分/张）`,
      { chargeKey },
    );
    const creditDeducted = deducted.cost;
    /**
     * 八审 P0-4:普通 canvas 出图也接 paidJobLedger——之前只有 assetStandardize 登记账本,
     * 普通出图的退款只是"打一次日志",DB 短暂不可用时退款被吞、积分永久不退。
     * 现在两条都 registerActiveJob:失败走 refundCreditsOnFailure(落 refund_pending,
     * reaper 补退)、成功走 unregisterActiveJob("settled")、登记失败即退款并中止。
     */
    {
      const { registerActiveJob } = await import("../services/paidJobLedger.js");
      const ledgerTaskType = assetStandardizeQuality ? "manhuaAssetStandardize" : "canvasGptImage2";
      try {
        await registerActiveJob({
          jobId,
          taskType: ledgerTaskType,
          userId: numericUserId,
          creditsBilled: deducted.cost,
          action: assetStandardizeQuality
            ? `导入资产 AI 标准化 · ${assetStandardizeQuality}`
            : `画布出图 GPT-Image-2（${deducted.cost} 积分/张）`,
          deduct: deducted,
          metadata: assetStandardizeQuality
            ? { assetRefId: String(params.assetRefId || "").slice(0, 100) }
            : { batchIndex: typeof params.batchIndex === "number" ? params.batchIndex : 0 },
        });
      } catch (error) {
        const { refundCreditsForDeductAmount } = await import("../credits.js");
        await refundCreditsForDeductAmount(
          numericUserId,
          "画布出图登记失败·退回积分",
          deducted,
          `${ledgerTaskType}Refund`,
          { refundKey: `refund:${ledgerTaskType}/register/${jobId}`.slice(0, 120) },
        );
        throw error;
      }
    }

    const { generateGptImage2FromRawEnglishPrompt } = await import("../services/proxyImageService.js");
    const captureError: {
      message?: string;
      moderationBlocked?: boolean;
      openaiConfigured?: boolean;
      openrouterConfigured?: boolean;
      openaiError?: string;
      openrouterError?: string;
    } = {};
    const refundCanvasImage = async (reason: string) => {
      if (creditDeducted <= 0) return;
      // 八审 P0-4:两条路径都走账本 refundCreditsOnFailure——退款失败落 refund_pending,
      // 由 ledger reaper 补退,不再是"打个日志就丢"。
      const { refundCreditsOnFailure } = await import("../services/paidJobLedger.js");
      await refundCreditsOnFailure(
        jobId,
        assetStandardizeQuality ? "manhuaAssetStandardize" : "canvasGptImage2",
        "external_api_error",
        reason,
      );
    };
    let imageUrl: string | null | undefined;
    try {
      imageUrl = await generateGptImage2FromRawEnglishPrompt({
        englishPrompt: prompt,
        aspectRatio,
        gcsSubdir,
        referenceImageUrls: referenceImageUrls.length ? referenceImageUrls : undefined,
        maskUrl: maskUrl || undefined,
        generalImageEdit: referenceImageUrls.length > 0 || generalImageEdit,
        /**
         * 画布画面一律禁字。此前只有「有垫图」才绕开版式修饰，于是首次生成的
         * 定妆卡 / 场景图 / 道具图落在 16:9 的 `multi-panel graphic layout,
         * high legibility` 上被烧上海报标题，再传给图生视频就整段字都在动。
         */
        onImageText: "forbid",
        providerOverride,
        imageLane,
        qualityOverride: assetStandardizeQuality || undefined,
        captureError,
      });
    } catch (err) {
      await refundCanvasImage("画布出图·生成失败·退回已扣积分");
      throw err;
    }
    if (!imageUrl) {
      await refundCanvasImage("画布出图·未出图·退回已扣积分");
      throw new Error(captureError.message || "gpt_image2_empty");
    }
    /**
     * 五审 P0-1/P1-1:所有权登记进成功契约——这里是画布出图的真实主链
     * (短入队 worker,同步 op=canvasGptImage2 已弃用),不登记则 /api/canvas-media
     * 与 Wan 参考校验都会拒绝这张新图。登记失败(含冲突/提取失败/存储故障重试尽)
     * 不得报 succeeded:退回已扣积分后抛错,绝不交付"看得到一次、恢复后 403"的半成品。
     */
    try {
      const { registerCanvasImageDeliveryOrThrow } = await import(
        "../services/canvasMediaOwnership.js"
      );
      await registerCanvasImageDeliveryOrThrow({
        imageUrl,
        ownerUserId: numericUserId,
        source: "canvasgptimage2-runner",
      });
    } catch (err) {
      await refundCanvasImage("画布出图·所有权登记失败·退回已扣积分");
      throw err;
    }
    return {
      provider: providerOverride === "openrouter" ? "openrouter-gpt-image-2" : "openai-gpt-image-2",
      output: {
        imageUrl,
        imageUrls: [imageUrl],
      },
    };
  }

  throw new Error(`Unsupported image action: ${input.action}`);
}

type AudioBillingPolicy = "free" | "single_purchase" | "package";

function mapAudioModel(model: unknown): ProducerModel {
  if (model === "udio" || model === "V5") return "udio";
  return "suno";
}

function getAudioPolicy(plan: string, mode: "bgm" | "theme_song", duration: number): AudioBillingPolicy {
  if (plan === "pro" || plan === "enterprise") return "package";
  if (mode === "bgm" && duration <= 120) return "free";
  return "single_purchase";
}

function normalizeAudioStatus(status: string): "PENDING" | "SUCCESS" | "FAILED" {
  const s = status.toUpperCase();
  if (s.includes("FAIL")) return "FAILED";
  if (s.includes("SUCCESS") || s.includes("DONE") || s.includes("COMPLETED")) return "SUCCESS";
  return "PENDING";
}

export function resolveJobTimeoutMs(type: JobType, inputRaw: unknown) {
  const defaultTimeout = JOB_TIMEOUT_MS[type];
  if (type === "image" && isCreativeNanoImageJob(inputRaw)) {
    return CREATIVE_NANO_IMAGE_TIMEOUT_MS;
  }
  if (type === "image" && isCanvasGptImage2Job(inputRaw)) {
    /**
     * 七审 P0-2 / 八审 P1-6:image 默认 12 秒墙钟是给轻任务的;GPT-Image-2 单供应商 fetch
     * 允许 6 分钟、客户端按 12 分钟轮询——12 秒必超时,还会触发整单重排双烧上游。
     * env 只能上调不能下调:设成低于 12 分钟的值会让外层先超时退款而上游仍在跑收钱,
     * 故用 Math.max 钉死 12 分钟安全下限。
     */
    const raw = Number(process.env.CANVAS_GPT_IMAGE2_JOB_TIMEOUT_MS);
    if (Number.isFinite(raw)) {
      return Math.max(CANVAS_GPT_IMAGE2_MIN_TIMEOUT_MS, Math.floor(raw));
    }
    return CANVAS_GPT_IMAGE2_DEFAULT_TIMEOUT_MS;
  }
  if (type === "platform") {
    try {
      const input = asEnvelope(inputRaw);
      if (input.action === "platform_build_content") {
        const raw = Number(process.env.PLATFORM_BUILD_CONTENT_JOB_TIMEOUT_MS);
        if (Number.isFinite(raw) && raw >= 120_000) return raw;
        // Stage 2：冷數據讀取 + 大 JSON LLM（預設 20min，可用 PLATFORM_BUILD_CONTENT_JOB_TIMEOUT_MS 覆蓋）
        return 20 * 60_000;
      }
      if (input.action === "platform_visual_report") {
        const raw = Number(process.env.PLATFORM_VISUAL_REPORT_JOB_TIMEOUT_MS);
        if (Number.isFinite(raw) && raw >= 120_000) return raw;
        // 报表通常 30–40 秒；给冷数据读取、三次模型重试和 Fly 短抖动留足墙钟。
        return 15 * 60_000;
      }
      if (input.action === "platform_topic_image") {
        const raw = Number(process.env.PLATFORM_TOPIC_IMAGE_JOB_TIMEOUT_MS);
        if (Number.isFinite(raw) && raw >= 60_000) return raw;
        return 10 * 60_000;
      }
      if (input.action === "platform_topic_cover_composite_bundle") {
        const raw = Number(process.env.PLATFORM_TOPIC_COVER_COMPOSITE_BUNDLE_JOB_TIMEOUT_MS);
        if (Number.isFinite(raw) && raw >= 120_000) return raw;
        return 28 * 60_000;
      }
      if (input.action === "platform_html_ppt_outline") {
        const raw = Number(process.env.PLATFORM_HTML_PPT_OUTLINE_JOB_TIMEOUT_MS);
        if (Number.isFinite(raw) && raw >= 120_000) return raw;
        // 13 页双段 Sol（含 reasoning 重试）默认 22min，避免墙钟砍半稿
        return 22 * 60_000;
      }
      if (input.action === "knowledge_card_distill") {
        const raw = Number(process.env.KNOWLEDGE_CARD_DISTILL_JOB_TIMEOUT_MS);
        if (Number.isFinite(raw) && raw >= 300_000) return raw;
        // 整本约 10 万字：十余段 × 中档推理 + 段级重试 + 顶档统稿，默认 40min
        return 40 * 60_000;
      }
      if (input.action === "platform_topic_expand") {
        const raw = Number(process.env.PLATFORM_TOPIC_EXPAND_JOB_TIMEOUT_MS);
        if (Number.isFinite(raw) && raw >= 300_000) return raw;
        // 串行单条实测约 3–4 分钟（Kimi K3 medium），按条数给墙钟，封顶 75min
        const count = Array.isArray((input.params as Record<string, unknown>)?.picks)
          ? ((input.params as Record<string, unknown>).picks as unknown[]).length
          : 7;
        return Math.min(75, Math.max(15, count * 6)) * 60_000;
      }
    } catch {
      /* fall through */
    }
    return defaultTimeout;
  }
  if (type === "image") {
    try {
      const input = asEnvelope(inputRaw);
      if (input.action === "canvas_gpt_image2") {
        const raw = Number(process.env.CANVAS_GPT_IMAGE2_JOB_TIMEOUT_MS);
        // worker 墙钟：须覆盖官方 Image-2 high 竖屏（常 >3min）+ 偶发排队
        if (Number.isFinite(raw) && raw >= 180_000) return raw;
        return 10 * 60_000;
      }
    } catch {
      /* fall through */
    }
    return defaultTimeout;
  }
  if (type !== "video") return defaultTimeout;
  try {
    const input = asEnvelope(inputRaw);
    if (input.action === "manhua_assemble_final") {
      const raw = Number(process.env.MANHUA_ASSEMBLE_JOB_TIMEOUT_MS);
      if (Number.isFinite(raw) && raw >= 120_000) return raw;
      // 配乐轮询 + 多集拼接，默认 18 分钟
      return 18 * 60_000;
    }
    if (input.action === "manhua_template_learn") {
      const params = input.params ?? {};
      if (params.nativeDeepReadConfirmed === true) {
        const calls = Number(params.nativeMaxCalls);
        // 入队端与执行端都会拒绝非法值；这里仍给一个有界墙钟，避免历史脏任务
        // 因解析异常退回 90 分钟后把正在进行的原生请求提前砍掉。
        if (Number.isInteger(calls) && calls >= 1 && calls <= NATIVE_DEEP_READ_JOB_MAX_CALLS) {
          return resolveNativeDeepReadJobTimeoutMs(calls);
        }
        return resolveNativeDeepReadJobTimeoutMs(1);
      }
      const raw = Number(process.env.MANHUA_TEMPLATE_LEARN_JOB_TIMEOUT_MS);
      if (Number.isFinite(raw) && raw >= 180_000) return raw;
      // 每轮 8–10 集：下片+语音+读帧+删视频，默认 90 分钟
      return 90 * 60_000;
    }
    if (input.action === "growth_analyze_video" || input.action === "growth_analyze_images") {
      const params = input.params ?? {};
      const durationSeconds =
        typeof params.durationSeconds === "number" && Number.isFinite(params.durationSeconds)
          ? params.durationSeconds
          : 0;
      return resolveGrowthCampJobServerTimeoutMs({
        durationSeconds,
        platformAssetLite: params.platformAssetLite === true,
        assetKind: input.action === "growth_analyze_images" ? "image" : "video",
      });
    }
  } catch {
    return defaultTimeout;
  }
  return defaultTimeout;
}

async function processAudioJob(input: JobEnvelope, timeoutMs: number, userId: string): Promise<{ output: unknown; provider?: string }> {
  if (input.action !== "suno_music") {
    throw new Error(`Unsupported audio action: ${input.action}`);
  }

  const params = input.params ?? {};
  const mode = params.mode === "bgm" ? "bgm" : "theme_song";
  const producerModel = mapAudioModel(params.model);
  const title = String(params.title ?? "AI Generated Song");
  const directPrompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
  const lyrics = typeof params.lyrics === "string" ? params.lyrics : undefined;
  const customStyle = typeof params.customStyle === "string" ? params.customStyle : undefined;
  const mood = typeof params.mood === "string" ? params.mood : undefined;
  const duration =
    typeof params.duration === "number" && Number.isFinite(params.duration)
      ? Math.max(30, Math.min(600, Math.floor(params.duration)))
      : mode === "bgm"
      ? 60
      : 120;

  const numericUserId = Number(userId);
  const plan = Number.isFinite(numericUserId) ? await getUserPlan(numericUserId) : "free";
  const billingPolicy = getAudioPolicy(plan, mode, duration);
  const quality: ProducerQuality = billingPolicy === "package" ? "high" : "normal";
  const retentionDays = billingPolicy === "package" ? 30 : 3;
  const allowDownload = billingPolicy !== "free";

  const creditCost =
    billingPolicy === "free"
      ? 0
      : billingPolicy === "single_purchase"
      ? CREDIT_COSTS.audioSinglePurchase
      : CREDIT_COSTS.audioPackageGeneration;

  if (creditCost > 0 && Number.isFinite(numericUserId)) {
    const credits = await getCredits(numericUserId);
    if (credits.totalAvailable < creditCost) {
      throw new Error(`Credits 不足，本次音乐生成需要 ${creditCost} Credits`);
    }
    await deductCredits(
      numericUserId,
      billingPolicy === "single_purchase" ? "audioSinglePurchase" : "audioPackageGeneration",
      billingPolicy === "single_purchase" ? "音乐单次购买生成" : "音乐套餐生成"
    );
  }

  let prompt = "";
  if (mode === "theme_song") {
    if (!lyrics || lyrics.length === 0) {
      throw new Error("Theme song mode requires lyrics");
    }
    prompt = lyrics;
  } else {
    prompt = directPrompt || customStyle || mood || "Cinematic, Emotional, Instrumental";
  }

  const created = await createProducerTask({
    model: producerModel,
    prompt,
    duration,
    quality,
  });

  const taskId = created.taskId;

  const startedAt = Date.now();
  let lastStatus: Awaited<ReturnType<typeof getProducerTaskStatus>> | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    const status = await getProducerTaskStatus(taskId);
    lastStatus = status;
    const state = normalizeAudioStatus(status.status);
    if (state === "SUCCESS") {
      const songs = status.songs.map((song) => ({
        id: song.id,
        audioUrl: allowDownload ? song.downloadUrl ?? song.audioUrl ?? song.streamUrl : undefined,
        streamUrl: song.streamUrl ?? song.audioUrl,
        imageUrl: song.imageUrl,
        title: song.title,
        tags: song.tags,
        duration: song.duration,
      }));

      return {
        provider: "aimusicapi",
        output: {
          taskId,
          status: "SUCCESS",
          songs,
          model: producerModel,
          mode,
          quality,
          creditCost,
          retentionDays,
          allowDownload,
          billingPolicy,
        },
      };
    }
    if (state === "FAILED" || status.errorMessage) {
      throw new Error(String(status.errorMessage || "Music generation failed"));
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (lastStatus && normalizeAudioStatus(lastStatus.status) === "SUCCESS") {
    return { provider: "aimusicapi", output: lastStatus };
  }
  throw new Error("Music generation timeout");
}

/**
 * 平台异步任务处理器。
 *
 * platform_analysis：
 *   第 1 阶段：vertex / gemini-3.1-pro-preview，生成深度内容蓝图
 *   第 2 阶段：vertex / gemini-3.1-pro-preview，校准趋势信号与平台看板
 *
 * platform_qa：
 *   **OpenAI GPT‑5.5**（与深度追问同步路径）；纯文本 JSON。有 fileUri 时暂保留 Gemini 多模态读附件。
 *   finally：始终清理 GCS 临时文件
 */
async function processPlatformJob(
  input: JobEnvelope,
  platformJobId?: string,
  jobUserId?: string,
): Promise<{ output: unknown; provider?: string }> {
  const params = input.params ?? {};
  try {
    if (input.action === "platform_composite_sheet_progress") {
      throw new Error(
        "[jobs] platform_composite_sheet_progress 僅為寬幅合成 TRPC 旁路進度占位（插入時即 running），不應進入 worker；請檢查 jobs 是否被誤改為 queued。",
      );
    }
    // ── platform_visual_report ────────────────────────────────────────────────
    // 通过内部 caller 复用唯一报告实现；prepaidPlatformTrendJobId 仅存在于
    // worker context，表示扣费与持久账本已在 enqueueVisualReport 完成。
    if (input.action === "platform_visual_report") {
      if (!platformJobId || !jobUserId) {
        throw new Error("趋势报告任务缺少 jobId 或 userId");
      }
      const user = await resolveUserForJob(jobUserId);
      const controller = new AbortController();
      const hardAbort = setTimeout(() => controller.abort(), 14 * 60_000);
      const caller = appRouter.createCaller({
        req: {} as any,
        res: {} as any,
        user,
        clientDisconnected: controller.signal,
        prepaidPlatformTrendJobId: platformJobId,
      });
      const { heartbeatActiveJob } = await import("../services/paidJobLedger.js");
      const heartbeat = platformJobId
        ? setInterval(() => {
            void heartbeatActiveJob(platformJobId, "platformAnalysis");
          }, 30_000)
        : null;
      try {
        const result = await caller.mvAnalysis.generateVisualReport({
          windowDays: params.windowDays as "3" | "7" | "15" | "30",
          theme: params.theme as "light" | "dark",
          platforms: params.platforms as Array<"douyin" | "xiaohongshu" | "bilibili" | "weixin_channels">,
          personaContext: typeof params.personaContext === "string" ? params.personaContext : undefined,
          billingRequestId: String(params.billingRequestId || ""),
        });
        if (!result.success || !result.report) {
          throw new Error(result.error || "趋势报告生成失败");
        }
        const routeMeta = (result as { routeMeta?: { gateway?: string | null; modelName?: string; engine?: string } }).routeMeta;
        return {
          // 复审三轮 P1-4:provider 写真实交卷路由,不再硬编码 openrouter
          provider: routeMeta?.gateway
            ? `${routeMeta.gateway}:${routeMeta.modelName ?? ""}`
            : routeMeta?.engine || "visual_report_router",
          output: result,
        };
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        clearTimeout(hardAbort);
        controller.abort();
      }
    }
    // ── platform_analysis ────────────────────────────────────────────────────────
    if (input.action === "platform_analysis") {
      const context = String(params.context || "");
      const windowDays = Number(params.windowDays || 15);
      const snapshotSummary = (params.snapshotSummary || {}) as Record<string, unknown>;

    // Stage 1: GPT-5.6 sol(reasoning high) — deep original content blueprint (director mode, no trend data)
    // 2026-08-21 用户拍板:双段由 Gemini 3.1 Pro 切 GPT-5.6 sol high(主力)/Kimi K3(兜底),治论文腔。
    // Strict: no outlines. Must output verbatim copy, precise shooting scripts, emotional direction.
    const stage1SystemInstruction = `你是一位顶级内容创作导演兼文案大师，你的产出标准绝对不接受大纲、空洞建议或模糊描述。

【铁律】——违反任何一条即视为失败，必须重写：
1. detailedScript：短视频用精确时间轴，成片约 **1分半～2分钟**（建议落在 00:00–01:30～00:00–02:00），口播勿为凑字注水；每段格式「[00:00-00:05] 画面：…口播：…情绪：…」。图文用「[封面]…[图N]…」**8–12页丰富大纲**。图文总信息要密；短视频不要强行 ≥400 字灌水。
2. copywriting 必须是可直接使用的完整正文，包含开头段落全文（≥60字）+中段内容展开（≥100字）+结尾引导行动（≥40字），总字数不得少于200字。
3. executionDetails.environmentAndWardrobe 必须说明：拍摄地点+背景布置+创作者服装要求+必备道具（≥50字）。
4. executionDetails.lightingAndCamera 必须说明：使用哪种光源+布光方式+机位角度+焦距建议+是否手持（≥50字）。
5. executionDetails.stepByStepScript 必须是至少5个步骤的数组，每步格式「[第X步 时间段] 具体动作描述」。
6. hook 必须是能让陌生用户在0.5秒内停下来的具体一句话，不得是泛泛描述，不得超过40字。
7. highlightKeywords 必须指出应借势的当前热点关键词，格式「[高亮:关键词]」。

你的产出是创作者的「施工图纸」，拿到就能立刻开拍，没有任何理解成本。`;

      const stage1Response = await invokePlatformAnalysisChat({
      response_format: { type: "json_object" },
      // 長篇 contentBlueprints（多選題 + 長腳本）極易觸及預設輸出上限導致 JSON 截斷 → parse 失敗後變 {}，前端全空
      max_tokens: 65536,
      messages: [
        { role: "system", content: stage1SystemInstruction },
        {
          role: "user",
          content: JSON.stringify({
            context,
            windowDays,
            snapshotData: snapshotSummary,
            task: "必须严格输出纯 JSON 格式，不要包含任何 markdown 代码块标记或前后缀说明文字。在 contentBlueprints 数组中，务必精确生成 5 个深度内容方案/选题，切勿少于 5 个；须严格结合用户 context 所描述的真实人设（职业、身份、兴趣、爱好、专长等），从以下 5 个维度各出 1 个独特选题：①核心专业洞察 ②跨界结合与价值观 ③目标受众痛点暴击 ④个人经历与人设魅力 ⑤多场景热点与生动选题（结合趋势与热点改写适配本人设，场景宜多元，避免无依据时扎堆书房客厅）。输出严格合法 JSON，必须包含以下字段：contentBlueprints（必须恰好 5 条内容方案数组，每项含：title（选题标题）/format（「短视频」或「图文」）/hook（≥30字开场钩子，必须是让用户停下来的具体一句话）/copywriting（≥200字逐字文案，包含完整开头段落/中段展开/结尾引导行动）/suitablePlatforms（适合平台数组）/actionableSteps（至少3个落地步骤，字符串数组）/detailedScript（精确时间轴拍摄脚本：短视频格式用「[00:00-00:05] 画面：...口播：...情绪：...」，成片约1.5–2分钟勿注水；图文格式用「[封面] 设计：... [图2] 文案：...」8–12页丰富大纲）/publishingAdvice（发布时机与平台设置，包含具体hashtag）/executionDetails（对象，必须包含environmentAndWardrobe（拍摄环境+服装道具，≥50字）/lightingAndCamera（灯光+机位设置，≥50字）/stepByStepScript（逐步脚本数组，每步「[时段]动作描述」格式，至少5步））/highlightKeywords（热点关键字数组，格式如「[高亮:职场霸凌]」）） 和 monetizationLanes（1-2条变现路径数组，每项含：title/fitReason/offerShape/revenueModes（数组）/firstValidation）。第一个字符必须是 {，最后必须是 }。",
          }),
        },
      ],
    });
      const stage1Raw = String(stage1Response.choices[0]?.message?.content || "");
      let contentResult: unknown = {};
      try {
        contentResult = JSON.parse(extractJsonString(stage1Raw));
      } catch (e) {
        console.error(
          "[platform_analysis] stage1 JSON.parse failed:",
          e instanceof Error ? e.message : e,
          "raw length=",
          stage1Raw.length,
          "tail=",
          stage1Raw.slice(-400),
        );
        contentResult = {};
      }

    // Stage 2: GPT-5.6 sol(reasoning high) — trend calibration + dashboard signals(与 Stage 1 同一主力/兜底链)
    const stage2SystemInstruction = "你是一位顶尖的平台趋势分析师。根据用户的脚本蓝图与平台快照数据，进行热点数据校准，计算关键指标，输出最终平台看板 JSON。";
      const stage2Response = await invokePlatformAnalysisChat({
      response_format: { type: "json_object" },
      max_tokens: 65536,
      temperature: 0.9,
      messages: [
        { role: "system", content: stage2SystemInstruction },
        {
          role: "user",
          content: JSON.stringify({
            context,
            windowDays,
            contentBlueprint: contentResult,
            snapshotSummary: {
              ...snapshotSummary,
              businessInsights: snapshotSummary.businessInsights ?? {},
              decisionFramework: snapshotSummary.decisionFramework ?? {},
              growthPlan: snapshotSummary.growthPlan ?? [],
              validationPlan: snapshotSummary.validationPlan ?? {},
              monetization: snapshotSummary.monetization ?? {},
              scores: snapshotSummary.scores ?? {},
            },
            task: "请根据以上蓝图与快照数据，输出严格合法 JSON，必须包含以下所有字段：headline（平台策略标题）、subheadline（副标题，一句话说明当前时间窗口最值得做的事）、topSignals（4条核心信号，每项含 title/detail/badge）、hotTopics（每个平台5-8个热门赛道，每项含 title/whyHot/howToUse）、actionCards（3-5张可执行动作卡，每项含 title/detail）、platformMenu（数组，每项必须包含：platform/displayName/whyNow/signal/primaryTrack（当前最推荐赛道名称）/estimatedTraffic（流量预估区间，如「月播放 10-30万」）/ipUniqueness（IP稀缺度说明，50字以内）/commercialConversion（商业转化预期，如「私信转化 2-4%」）/trafficBoosters（字符串数组，2-3条流量扶持活动）/referenceAccounts（字符串数组，1-2个可参考的对标账号）/whyNowDetail（为什么现在值得做，100字以内）/nextMove（首发动作，50字以内）/hook（内容开场钩子示例）/monetization（变现切入方向）））、conversationStarters（4个追问建议，字符串数组）、ipScarcity（整体赛道稀缺度，100字以内）、trafficForecast（整体流量预估，如「月播放 15-40万」）、conversionRate（整体预期转化率，如「私信咨询转化 2-5%」）。第一个字符必须是 {，最后必须是 }。",
          }),
        },
      ],
    });
      const stage2Raw = String(stage2Response.choices[0]?.message?.content || "");
      let dashboardResult: unknown = {};
      try {
        dashboardResult = JSON.parse(extractJsonString(stage2Raw));
      } catch (e) {
        console.error(
          "[platform_analysis] stage2 JSON.parse failed:",
          e instanceof Error ? e.message : e,
          "raw length=",
          stage2Raw.length,
          "tail=",
          stage2Raw.slice(-400),
        );
        dashboardResult = {};
      }

      return {
        provider: "gpt56-sol",
        output: {
          platformDashboard: dashboardResult,
          platformContent: contentResult,
          completedAt: new Date().toISOString(),
          engines: {
            stage1: `${PLATFORM_ANALYSIS_PRIMARY_MODEL}(high)`,
            stage2: `${PLATFORM_ANALYSIS_PRIMARY_MODEL}(high)`,
            fallback: PLATFORM_ANALYSIS_FALLBACK_MODEL,
            snapshotDepth: "full",
          },
        },
      };
    }

    /**
     * ── platform_topic_expand（初选扩写 · 一条一条冒出来）────────────────────
     *
     * 单条约 3 分钟（Kimi K3 带推理），七条串行就是二十多分钟。以前放在同步
     * mutation 里，用户要等最后一条跑完才看到第一条；现在每条写完立刻 patch 进
     * job.output，前端轮询到就渲染一张卡。扣费仍在入队时一次性发生，不按条计。
     */
    if (input.action === "platform_topic_expand") {
      const { expandPlatformTopicPicks } = await import("../services/platformTopicShortlist.js");
      const picks = Array.isArray(params.picks)
        ? (params.picks as Parameters<typeof expandPlatformTopicPicks>[0]["picks"])
        : [];
      const streamed: Array<Record<string, unknown>> = [];
      const expandChargedCredits = Math.max(0, Math.floor(Number(params.chargedCredits || 0)));
      const expandPerItemCredits = Math.max(0, Math.floor(Number(params.perItemCredits || 0)));
      let result: Awaited<ReturnType<typeof expandPlatformTopicPicks>>;
      try {
        result = await expandPlatformTopicPicks({
        userId: jobUserId ?? 0,
        context: typeof params.context === "string" ? params.context : undefined,
        picks,
        enabledSkillIds: Array.isArray(params.enabledSkillIds)
          ? (params.enabledSkillIds as unknown[]).filter((s): s is string => typeof s === "string")
          : null,
        allowBloggerTitle: params.allowBloggerTitle === true,
        engine: normalizePlatformTopicExpandEngine(params.expandEngine),
        onItem: platformJobId
          ? async ({ blueprint, index, total, elapsedMs }) => {
              streamed.push(blueprint);
              await patchJobRunningProgress(platformJobId, {
                contentBlueprints: [...streamed],
                expandDoneCount: index,
                expandTotalCount: total,
                expandElapsedMs: elapsedMs,
              });
            }
          : undefined,
        });
      } catch (err) {
        // 全灭/超时终态：整单退款（照 platform_html_ppt_outline 先例，attempts>=2 才退，防首轮 requeue 误退）
        if (expandChargedCredits > 0 && jobUserId != null && platformJobId) {
          const { getJobById } = await import("./repository.js");
          const jobRow = await getJobById(platformJobId);
          if ((jobRow?.attempts ?? 0) >= 2) {
            const { refundCredits } = await import("../credits.js");
            await refundCredits(
              Number(jobUserId),
              expandChargedCredits,
              "platform_topic_expand 整单失败退还",
            ).catch((e) => console.error("[platform_topic_expand] 整单退款失败:", e));
          }
        }
        throw err;
      }
      // 按条计费后的对账：失败条按单价自动退款，别让用户为空稿买单
      const failedPicks = Array.isArray(
        (result.diagnostics as Record<string, unknown> | undefined)?.failedPicks,
      )
        ? ((result.diagnostics as Record<string, unknown>).failedPicks as unknown[])
        : [];
      const failedIds = failedPicks
        .map((row) =>
          String((row && typeof row === "object" ? (row as Record<string, unknown>).id : "") || "").trim(),
        )
        .filter(Boolean);
      let refundedCredits = 0;
      if (failedPicks.length > 0 && expandPerItemCredits > 0 && jobUserId != null) {
        try {
          // 幂等防重：僵尸 run / requeue 重入前先读库，已退过就不再退
          const { getJobById } = await import("./repository.js");
          const jobRow = platformJobId ? await getJobById(platformJobId) : null;
          const prevOutput =
            jobRow && jobRow.output && typeof jobRow.output === "object"
              ? (jobRow.output as Record<string, unknown>)
              : null;
          const alreadyRefunded = Math.max(0, Math.floor(Number(prevOutput?.refundedCredits || 0)));
          if (alreadyRefunded > 0) {
            refundedCredits = alreadyRefunded;
          } else {
            const { addCredits } = await import("../credits.js");
            refundedCredits = expandPerItemCredits * failedPicks.length;
            await addCredits(Number(jobUserId), refundedCredits, "refund");
            console.info(
              `[platform_topic_expand] 失败 ${failedPicks.length} 条已退款 ${refundedCredits} 点 · user=${jobUserId}`,
            );
          }
        } catch (e) {
          // 退款失败只记日志，不影响已产出的文案；失败清单仍在 diagnostics 供免费重跑认领
          console.error("[platform_topic_expand] 失败条退款异常:", e);
          refundedCredits = 0;
        }
      }
      return {
        provider: "openrouter",
        output: {
          success: true,
          contentBlueprints: result.contentBlueprints,
          expandDoneCount: result.contentBlueprints.length,
          expandTotalCount: picks.length,
          diagnostics: result.diagnostics,
          chargedCredits: expandChargedCredits,
          refundedCredits,
          // 已退款的失败条同时标记为「免费重跑已认领」：退款与免单二选一，不双重补偿
          freeRetryClaimedIds: refundedCredits > 0 ? failedIds : [],
          completedAt: new Date().toISOString(),
        },
      };
    }

    // ── platform_html_ppt_outline（动效 PPT · GPT-5.6 Sol 清单，异步）────────────
    if (input.action === "platform_html_ppt_outline") {
      const title = String(params.title || "").trim();
      const purposeZh = params.purposeZh != null ? String(params.purposeZh) : undefined;
      const pageCount = Number(params.pageCount || 10);
      const styleId = String(params.styleId || "dark_research");
      const briefZh = params.briefZh != null ? String(params.briefZh) : undefined;
      const confirmedThemes = Array.isArray(params.confirmedThemes)
        ? (params.confirmedThemes as Array<{ id?: string; title?: string }>)
            .map((t) => ({
              id: String(t?.id || "").trim(),
              title: String(t?.title || "").trim(),
            }))
            .filter((t) => t.id && t.title)
        : undefined;
      const cost = Number(params.cost || 0);
      const creditsCharged = params.creditsCharged === true;
      const uidNum = jobUserId != null ? Number(jobUserId) : NaN;

      try {
        const { generateHtmlPptOutline } = await import("../services/platformHtmlPptOutline.js");
        const result = await generateHtmlPptOutline({
          title,
          purposeZh,
          pageCount,
          styleId: styleId as Parameters<typeof generateHtmlPptOutline>[0]["styleId"],
          briefZh,
          confirmedThemes,
        });
        return {
          provider: "openai",
          output: {
            success: true,
            cost: creditsCharged ? cost : 0,
            model: result.model,
            deckTitle: result.deckTitle,
            summary: result.summary,
            pages: result.pages,
            completedAt: new Date().toISOString(),
          },
        };
      } catch (err) {
        if (creditsCharged && Number.isFinite(uidNum) && cost > 0 && platformJobId) {
          const { getJobById } = await import("./repository.js");
          const jobRow = await getJobById(platformJobId);
          // attempts 在 claim 时 +1；>=2 表示将进入终态失败，才退积分（避免首轮 requeue 误退）
          if ((jobRow?.attempts ?? 0) >= 2) {
            const { refundCredits } = await import("../credits.js");
            await refundCredits(uidNum, cost, "platform_html_ppt_outline 失败退还").catch((e) =>
              console.error("[platform_html_ppt_outline] refund failed:", e),
            );
          }
        }
        throw err;
      }
    }

    // ── platform_qa ──────────────────────────────────────────────────────────────
    if (input.action === "platform_qa") {
      const question = String(params.question || "");
      const context = String(params.context || "");
      const windowDays = Number(params.windowDays || 15);
      const snapshot = (params.snapshot || {}) as Record<string, unknown>;
      const fileUri = typeof params.fileUri === "string" ? params.fileUri : undefined;
      const fileMimeTypeRaw =
        typeof params.fileMimeType === "string" ? params.fileMimeType : "application/octet-stream";
      const allowedFileMimes = [
        "audio/mpeg",
        "audio/wav",
        "application/pdf",
        "audio/mp4",
        "video/mp4",
        "video/quicktime",
      ] as const satisfies readonly NonNullable<FileContent["file_url"]["mime_type"]>[];
      const fileMimeType: NonNullable<FileContent["file_url"]["mime_type"]> = (
        allowedFileMimes as readonly string[]
      ).includes(fileMimeTypeRaw)
        ? (fileMimeTypeRaw as NonNullable<FileContent["file_url"]["mime_type"]>)
        : fileMimeTypeRaw.startsWith("video/")
          ? "video/mp4"
          : fileMimeTypeRaw.startsWith("audio/")
            ? "audio/mpeg"
            : "application/pdf";

      try {
        let parsedResult: {
          title: string;
          answer: string;
          encouragement: string;
          nextQuestions: string[];
        };
        let provider: string;
        let modelName: string;

        if (fileUri) {
          const {
            callGemini35FlashCopywriting,
            resolveGemini35FlashModelName,
            resolveGemini35FlashCopywritingMaxOutputTokens,
          } = await import("../services/gemini35FlashRuntime.js");
          const qaMaxOut = resolveGemini35FlashCopywritingMaxOutputTokens();
          const qaModel = resolveGemini35FlashModelName();
          const systemPrompt =
            "你是一位顶尖的平台增长顾问。请根据用户提问和平台快照数据，给出具体、可执行的专业建议。回答要精准、有结构，使用 Markdown 格式。";
          const contextPayload = JSON.stringify({
            windowDays,
            context,
            question,
            snapshot,
          });
          const userContent = [
            { type: "text" as const, text: contextPayload },
            { type: "file_url" as const, file_url: { url: fileUri, mime_type: fileMimeType } },
          ];
          const qaResponse = await invokeLLM({
            provider: "gemini",
            modelName: qaModel,
            max_tokens: qaMaxOut,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
          });
          const answerText = String(qaResponse.choices[0]?.message?.content || "");
          parsedResult = {
            title: question.slice(0, 40) || "追问回答",
            answer: answerText,
            encouragement: "",
            nextQuestions: [],
          };
          provider = "gemini-api";
          modelName = `${qaModel} · multimodal附件`;
        } else {
          const { invokePlatformFollowUpGpt55 } = await import("../services/platformFollowUpLlm.js");
          const {
            raw,
            modelName: usedModel,
            provider: followUpProvider,
          } = await invokePlatformFollowUpGpt55({
            windowDays,
            context,
            question,
            snapshot: snapshot as Parameters<typeof invokePlatformFollowUpGpt55>[0]["snapshot"],
          });
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            const match = raw.match(/```(?:json)?\s*([\s\S]+?)```/);
            try {
              parsed = match ? (JSON.parse(match[1].trim()) as Record<string, unknown>) : {};
            } catch {
              parsed = {};
            }
          }
          parsedResult = {
            title: String(parsed.title || question.slice(0, 40) || "追问回答"),
            answer: String(parsed.answer || raw || ""),
            encouragement: String(parsed.encouragement || ""),
            nextQuestions: Array.isArray(parsed.nextQuestions)
              ? parsed.nextQuestions.map((x) => String(x))
              : [],
          };
          provider = followUpProvider === "gemini" ? "gemini-api" : "openai";
          modelName = usedModel;
        }

        return {
          provider,
          output: {
            result: parsedResult,
            debug: {
              route: "platform_qa",
              modelName,
              provider,
              copyLlmMode: provider.startsWith("gemini") ? "vertex" : "openai",
              windowDays,
              multimodalFile: Boolean(fileUri),
            },
            completedAt: new Date().toISOString(),
          },
        };
      } finally {
        if (fileUri) {
          const match = fileUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
          if (match) {
            await deleteGcsObject({ bucket: match[1], objectName: match[2] }).catch((err) => {
              console.warn(`[processPlatformJob] 删除 GCS 临时文件失败 ${fileUri}:`, err);
            });
          }
        }
      }
    }

    // ── platform_build_content（Creator Growth · Stage 2 文案與選題）────────────────
    if (input.action === "platform_build_content") {
      const context = String(params.context || "");
      const windowDays = Number(params.windowDays ?? 15);
      const platformMenu = Array.isArray(params.platformMenu) ? params.platformMenu : [];
      const globalBlueOceanWords = Array.isArray((params as Record<string, unknown>).globalBlueOceanWords)
        ? ((params as Record<string, unknown>).globalBlueOceanWords as unknown[])
        : [];
      const snapshotSummary = (params.snapshotSummary || {}) as Record<string, unknown>;
      const strategicDashboard = (params as Record<string, unknown>).strategicDashboard;
      const stage1Handoff = buildStage1StrategicHandoffForStage2(strategicDashboard, snapshotSummary);
      const preferFlyLive = process.env.PLATFORM_TREND_PREFER_FLY_LIVE === "true";
      const requestedPlatforms = normalizePlatforms([
        ...((snapshotSummary?.platformSnapshots || []) as Array<{ platform?: string }>).map((item) =>
          String(item?.platform || ""),
        ),
        ...((platformMenu || []) as Array<{ platform?: string }>).map((item) => String(item?.platform || "")),
      ]);
      const storeNull = { collections: {}, history: null, backfill: null } as unknown as Awaited<
        ReturnType<typeof readTrendStore>
      >;
      const storeReadPromise = requestedPlatforms.length
        ? readTrendStoreForPlatforms(requestedPlatforms, { preferDerivedFiles: true, preferFlyLive })
        : readTrendStore({ preferDerivedFiles: true, preferFlyLive });
      const store = await new Promise<Awaited<ReturnType<typeof readTrendStore>>>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(storeNull);
        }, 20_000);
        storeReadPromise
          .then((s) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(s);
          })
          .catch(() => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(storeNull);
          });
      });
      const t0 = Date.now();
      const rawStage2 = (params as Record<string, unknown>).stage2LlmMode;
      const stage2LlmModeOverride =
        rawStage2 === "vertex" || rawStage2 === "openai" ? rawStage2 : undefined;
      // Incremental accumulator: holds blueprints already written to job output during generation
      const incrementalBlueprints: unknown[] = [];

      const rawSkillIds = (params as { enabledSkillIds?: unknown }).enabledSkillIds;
      const enabledSkillIdsForJob = Array.isArray(rawSkillIds)
        ? rawSkillIds.map(String).filter(Boolean).slice(0, 24)
        : null;
      const allowBloggerTitleForJob = Boolean((params as { allowBloggerTitle?: unknown }).allowBloggerTitle);
      const dash = strategicDashboard as Record<string, unknown> | undefined;
      const skillRouteContext = [
        context,
        typeof dash?.headline === "string" ? dash.headline : "",
        typeof dash?.subheadline === "string" ? dash.subheadline : "",
        typeof dash?.personaSummary === "string" ? dash.personaSummary : "",
        typeof (snapshotSummary as { topic?: unknown })?.topic === "string"
          ? (snapshotSummary as { topic: string }).topic
          : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 4000);

      let recentUserTopicTitles: string[] = [];
      const uidRawForRecent = jobUserId != null ? Number(jobUserId) : NaN;
      if (Number.isFinite(uidRawForRecent) && uidRawForRecent > 0) {
        try {
          const { loadRecentPlatformBlueprintTitles } = await import(
            "../services/platformStrategicBlueprintSnapshots.js"
          );
          recentUserTopicTitles = await loadRecentPlatformBlueprintTitles({
            userId: uidRawForRecent,
            withinDays: 14,
            limitSnapshots: 6,
            maxTitles: 36,
          });
        } catch (e) {
          console.warn(
            "[platform_build_content] load recent titles skipped:",
            e instanceof Error ? e.message.slice(0, 160) : e,
          );
        }
      }

      const built = await buildPlatformContent({
        snapshot: snapshotSummary,
        platformMenu,
        context: context || undefined,
        windowDays,
        requestedPlatforms,
        store,
        abortSignal: undefined,
        stage1Handoff,
        globalBlueOceanWords,
        stage2LlmModeOverride: stage2LlmModeOverride ?? null,
        userId: jobUserId ?? 0,
        enabledSkillIds: enabledSkillIdsForJob,
        allowBloggerTitle: allowBloggerTitleForJob,
        skillRouteMode: "auto",
        skillRouteContext,
        recentUserTopicTitles,
        enableProTopicOptimize: true,
        // monetization / 兜底：不再预灌单一赛道全文；六维由 buildPlatformContent 内 diverse 路由
        platformSkillsPrompt: "",
        onBlueprintGenerated: platformJobId
          ? async (blueprint, dimIndex) => {
              incrementalBlueprints[dimIndex] = blueprint;
              // Build a dense snapshot: only keep non-null slots in order
              const partialBlueprints = incrementalBlueprints.filter(Boolean);
              await patchJobRunningProgress(platformJobId, {
                platformContent: {
                  contentBlueprints: partialBlueprints,
                  monetizationLanes: [],
                },
                incrementalBlueprintCount: partialBlueprints.length,
                incrementalBlueprintLastDim: dimIndex + 1,
              });
            }
          : undefined,
      });
      const uidRaw = jobUserId != null ? Number(jobUserId) : NaN;
      if (Number.isFinite(uidRaw) && Array.isArray(built.data?.contentBlueprints) && built.data.contentBlueprints.length > 0) {
        try {
          const { savePlatformStrategicBlueprintSnapshot } = await import(
            "../services/platformStrategicBlueprintSnapshots.js",
          );
          await savePlatformStrategicBlueprintSnapshot({
            userId: uidRaw,
            windowDays,
            context,
            requestedPlatforms,
            contentBlueprints: built.data.contentBlueprints as unknown[],
          });
        } catch (e) {
          console.warn(
            "[platform_build_content] blueprint snapshot save skipped:",
            e instanceof Error ? e.message.slice(0, 200) : e,
          );
        }
      }
      const diag = built.diagnostics as Record<string, unknown>;
      const respProv = diag?.responseProvider;
      return {
        provider: typeof respProv === "string" && respProv ? respProv : "vertex",
        output: {
          success: true,
          platformContent: built.data,
          debug: {
            route: "platform_build_content",
            totalMs: Date.now() - t0,
            hasContent: Boolean(built.data),
            preferFlyLive,
            stage2Error: null as string | null,
            stage2TimedOut: false,
            platformLlmTimeoutMs: PLATFORM_LLM_TIMEOUT_MS,
            buildPlatformContent: slimBuildPlatformContentDiagnosticsForJob(
              built.diagnostics as Record<string, unknown>,
            ),
          },
        },
      };
    }

    // ── platform_topic_image（平台单帧封面 · 异步 worker）──────────────────────────
    if (input.action === "platform_topic_image") {
      const { runPlatformTopicImagePipeline } = await import("../services/runPlatformTopicImagePipeline.js");
      const creationRaw = params.creationId;
      const creationNum =
        typeof creationRaw === "number"
          ? creationRaw
          : creationRaw != null && String(creationRaw).trim() !== ""
            ? Number(creationRaw)
            : NaN;
      const creationIdOut = Number.isFinite(creationNum) ? creationNum : null;
      const meta = params.newJobMetaBase;
      const newJobMetaBase =
        meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
      let fmt = params.format;
      const uidNum = jobUserId != null ? Number(jobUserId) : NaN;
      const sceneIdRaw = typeof params.sceneId === "string" ? params.sceneId.trim() : "";
      if (!sceneIdRaw) {
        throw new Error("封面异步任务缺少 sceneId，无法从选题快照加载已优化文案");
      }
      if (!Number.isFinite(uidNum)) {
        throw new Error("封面异步任务用户上下文无效，无法解析选题快照");
      }
      const {
        assertOptimizedCoverInputsFromDb,
        PlatformCoverInputsError,
      } = await import("../services/platformStrategicBlueprintSnapshots.js");
      let topicHook: string;
      let contextRaw: string;
      let appealHookOut: string;
      let snapshotPlatformsKey = "";
      let coverSublineOut: string | undefined;
      let coverNativePlatformOut: string | undefined;
      let coverHeadlineFromVariantOut: boolean | undefined;
      try {
        const resolved = await assertOptimizedCoverInputsFromDb({
          userId: uidNum,
          sceneId: sceneIdRaw,
          preferredPlatform:
            typeof (params as { coverPlatformHint?: unknown }).coverPlatformHint === "string"
              ? String((params as { coverPlatformHint?: string }).coverPlatformHint)
              : undefined,
        });
        topicHook = resolved.topicHook;
        contextRaw = resolved.context;
        appealHookOut = resolved.appealHook;
        fmt = resolved.format;
        snapshotPlatformsKey = resolved.snapshotPlatformsKey ?? "";
        coverSublineOut = resolved.coverSubline;
        coverNativePlatformOut = resolved.coverNativePlatform;
        coverHeadlineFromVariantOut = resolved.coverHeadlineFromVariant;
      } catch (e) {
        const msg = e instanceof PlatformCoverInputsError ? e.message : e instanceof Error ? e.message : String(e);
        throw new Error(msg || "无法从选题快照解析封面文案");
      }
      const { buildPlatformCoverHistoryHintFromDb, mergeCoverContextWithDbHint } = await import(
        "../services/platformCoverHistoryHint.js",
      );
      const coverHistoryHint = Number.isFinite(uidNum)
        ? await buildPlatformCoverHistoryHintFromDb({ userId: uidNum })
        : "";
      const enrichedContext = mergeCoverContextWithDbHint(contextRaw, coverHistoryHint);
      const preferFlyLiveTrend = process.env.PLATFORM_TREND_PREFER_FLY_LIVE === "true";
      const { loadMergedTrendEngagementVisualBriefForUserSnapshot } = await import(
        "../services/trendEngagementVisualBrief.js",
      );
      const trendEngagementVisualBrief = await loadMergedTrendEngagementVisualBriefForUserSnapshot({
        platformsKeyCsv: snapshotPlatformsKey,
        preferFlyLive: preferFlyLiveTrend,
      });
      void (params as { coverProEngine?: unknown }).coverProEngine;
      const coverProEngine = undefined;
      const rawDrPro = (params as { enableTopicCoverDeepResearchPro?: unknown }).enableTopicCoverDeepResearchPro;
      const enableTopicCoverDeepResearchPro = rawDrPro === true;
      const rawDrSec = (params as { drProSecondarySceneId?: unknown }).drProSecondarySceneId;
      const drProSecondarySceneId = typeof rawDrSec === "string" ? rawDrSec.trim() : "";
      let drProSecondaryCoverInputs: { topicHook: string; context: string } | undefined;
      if (platformJobId) {
        const { getDrProSecondaryStagingByJobId } = await import("../services/drProSecondaryStaging.js");
        const frozen = await getDrProSecondaryStagingByJobId(platformJobId);
        if (frozen && (frozen.topicHook.trim() || frozen.context.trim())) {
          drProSecondaryCoverInputs = {
            topicHook: frozen.topicHook.trim(),
            context: frozen.context.trim(),
          };
        }
      }
      if (!drProSecondaryCoverInputs && drProSecondarySceneId && drProSecondarySceneId !== sceneIdRaw) {
        const { resolveOptionalDrProSecondaryCoverFromScene } = await import("../services/coverDeepResearchProBrief.js");
        drProSecondaryCoverInputs = await resolveOptionalDrProSecondaryCoverFromScene({
          userId: uidNum,
          secondarySceneId: drProSecondarySceneId,
        });
      }
      const rawRefPhoto = (params as { referencePhotoUrl?: unknown }).referencePhotoUrl;
      const referencePhotoUrl =
        typeof rawRefPhoto === "string" && rawRefPhoto.trim() ? rawRefPhoto.trim() : undefined;
      const result = await runPlatformTopicImagePipeline({
        topicHook,
        format: fmt === "图文" || fmt === "短视频" ? fmt : undefined,
        context: enrichedContext,
        coverPersonaContext: typeof params.coverPersonaContext === "string" ? params.coverPersonaContext : undefined,
        sceneId: typeof params.sceneId === "string" ? params.sceneId : undefined,
        appealHook: appealHookOut,
        imagePromptTranslator: "gpt54",
        creationIdOut,
        isFreeRetry: Boolean(params.isFreeRetry),
        newJobMetaBase,
        progressJobId: platformJobId,
        coverProEngine,
        enableTopicCoverDeepResearchPro,
        drProSecondaryCoverInputs,
        trendEngagementVisualBrief: trendEngagementVisualBrief || undefined,
        referencePhotoUrl,
        coverSubline:
          coverSublineOut ||
          (typeof (params as { coverSubline?: unknown }).coverSubline === "string"
            ? String((params as { coverSubline?: string }).coverSubline)
            : undefined),
        coverNativePlatform:
          coverNativePlatformOut ||
          (typeof (params as { coverNativePlatform?: unknown }).coverNativePlatform === "string"
            ? String((params as { coverNativePlatform?: string }).coverNativePlatform)
            : undefined),
        coverHeadlineFromVariant:
          coverHeadlineFromVariantOut ??
          Boolean((params as { coverHeadlineFromVariant?: unknown }).coverHeadlineFromVariant),
      });
      return { provider: "vertex", output: result };
    }

    if (input.action === "platform_topic_cover_composite_bundle") {
      const { runPlatformTopicImagePipeline } = await import("../services/runPlatformTopicImagePipeline.js");
      const { generatePlatformCompositeSheetImage, generatePlatformGridStitchedSheetImage } = await import(
        "../services/proxyImageService.js"
      );

      const bundleCreditsCharged = Math.max(0, Math.floor(Number(params.bundleCreditsCharged) || 0));
      const uidNum = jobUserId != null ? Number(jobUserId) : NaN;
      const sceneIdRaw = typeof params.sceneId === "string" ? params.sceneId.trim() : "";
      if (!sceneIdRaw || !Number.isFinite(uidNum)) {
        throw new Error("套裝任務缺少 sceneId 或有效 userId");
      }

      const creationRaw = params.creationId;
      const creationNum =
        typeof creationRaw === "number"
          ? creationRaw
          : creationRaw != null && String(creationRaw).trim() !== ""
            ? Number(creationRaw)
            : NaN;
      const creationIdOut = Number.isFinite(creationNum) ? creationNum : null;
      const meta = params.newJobMetaBase;
      const newJobMetaBase =
        meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};

      let fmt = params.format;
      const {
        assertOptimizedCoverInputsFromDb,
        PlatformCoverInputsError,
      } = await import("../services/platformStrategicBlueprintSnapshots.js");
      let topicHook: string;
      let contextRaw: string;
      let appealHookOut: string;
      let snapshotPlatformsKey = "";
      let coverSublineOut: string | undefined;
      let coverNativePlatformOut: string | undefined;
      let coverHeadlineFromVariantOut: boolean | undefined;
      try {
        const resolved = await assertOptimizedCoverInputsFromDb({
          userId: uidNum,
          sceneId: sceneIdRaw,
          preferredPlatform:
            typeof (params as { coverPlatformHint?: unknown }).coverPlatformHint === "string"
              ? String((params as { coverPlatformHint?: string }).coverPlatformHint)
              : undefined,
        });
        topicHook = resolved.topicHook;
        contextRaw = resolved.context;
        appealHookOut = resolved.appealHook;
        fmt = resolved.format;
        snapshotPlatformsKey = resolved.snapshotPlatformsKey ?? "";
        coverSublineOut = resolved.coverSubline;
        coverNativePlatformOut = resolved.coverNativePlatform;
        coverHeadlineFromVariantOut = resolved.coverHeadlineFromVariant;
      } catch (e) {
        const msg = e instanceof PlatformCoverInputsError ? e.message : e instanceof Error ? e.message : String(e);
        throw new Error(msg || "无法从选题快照解析封面文案");
      }
      const { buildPlatformCoverHistoryHintFromDb, mergeCoverContextWithDbHint } = await import(
        "../services/platformCoverHistoryHint.js",
      );
      const coverHistoryHint = await buildPlatformCoverHistoryHintFromDb({ userId: uidNum });
      const enrichedContext = mergeCoverContextWithDbHint(contextRaw, coverHistoryHint);

      const preferFlyLiveTrendBundle = process.env.PLATFORM_TREND_PREFER_FLY_LIVE === "true";
      const { loadMergedTrendEngagementVisualBriefForUserSnapshot } = await import(
        "../services/trendEngagementVisualBrief.js",
      );
      const trendEngagementVisualBrief = await loadMergedTrendEngagementVisualBriefForUserSnapshot({
        platformsKeyCsv: snapshotPlatformsKey,
        preferFlyLive: preferFlyLiveTrendBundle,
      });
      void (params as { coverProEngine?: unknown }).coverProEngine;
      const coverProEngine = undefined;
      const rawDrPro = (params as { enableTopicCoverDeepResearchPro?: unknown }).enableTopicCoverDeepResearchPro;
      const enableTopicCoverDeepResearchPro = rawDrPro === true;
      const rawDrSec = (params as { drProSecondarySceneId?: unknown }).drProSecondarySceneId;
      const drProSecondarySceneId = typeof rawDrSec === "string" ? rawDrSec.trim() : "";
      let drProSecondaryCoverInputs: { topicHook: string; context: string } | undefined;
      if (platformJobId) {
        const { getDrProSecondaryStagingByJobId } = await import("../services/drProSecondaryStaging.js");
        const frozen = await getDrProSecondaryStagingByJobId(platformJobId);
        if (frozen && (frozen.topicHook.trim() || frozen.context.trim())) {
          drProSecondaryCoverInputs = {
            topicHook: frozen.topicHook.trim(),
            context: frozen.context.trim(),
          };
        }
      }
      if (!drProSecondaryCoverInputs && drProSecondarySceneId && drProSecondarySceneId !== sceneIdRaw) {
        const { resolveOptionalDrProSecondaryCoverFromScene } = await import("../services/coverDeepResearchProBrief.js");
        drProSecondaryCoverInputs = await resolveOptionalDrProSecondaryCoverFromScene({
          userId: uidNum,
          secondarySceneId: drProSecondarySceneId,
        });
      }

      const compositeKind = params.compositeKind;
      if (
        compositeKind !== "storyboard_sheet_portrait" &&
        compositeKind !== "storyboard_sheet_landscape" &&
        compositeKind !== "xiaohongshu_dual_note"
      ) {
        throw new Error(`套裝 compositeKind 无效：${String(compositeKind)}`);
      }
      const compositeTitle = String(params.compositeTitle ?? "").trim();
      const compositeScriptContext = String(params.compositeScriptContext ?? "").trim();
      const compositeExecutionDetails =
        typeof params.compositeExecutionDetails === "string" ? params.compositeExecutionDetails.trim() : undefined;
      const compositeShootingTechniqueBrief =
        typeof (params as { compositeShootingTechniqueBrief?: unknown }).compositeShootingTechniqueBrief === "string"
          ? String((params as { compositeShootingTechniqueBrief?: string }).compositeShootingTechniqueBrief).trim() ||
            undefined
          : undefined;
      const imagePromptTranslator = "gpt54" as const;

      const rawCompDr = (params as { enableCompositeDeepResearchPro?: unknown }).enableCompositeDeepResearchPro;
      const enableCompositeDeepResearchProAdmin = rawCompDr === true;

      const rawCompositeEngine = (params as { compositeImageEngine?: unknown }).compositeImageEngine;
      const compositeImageEngine =
        rawCompositeEngine === "nano_banana_2" || rawCompositeEngine === "gpt_image2"
          ? rawCompositeEngine
          : undefined;

      // 3×4 十二格：仅 landscape / 小红书图文支持；走「分段生成 + sharp 直向拼接」
      const compositeIs3x4 =
        (params as { compositeGridVariant?: unknown }).compositeGridVariant === "3x4" &&
        (compositeKind === "storyboard_sheet_landscape" || compositeKind === "xiaohongshu_dual_note");

      const creationRecordIdRaw = (params as { creationRecordId?: unknown }).creationRecordId;
      const creationRecordId =
        typeof creationRecordIdRaw === "number" && Number.isFinite(creationRecordIdRaw) && creationRecordIdRaw > 0
          ? Math.floor(creationRecordIdRaw)
          : undefined;

      const isTrial = await resolveWatermark(uidNum, false);
      const compositeFlowLog: string[] = [];

      // 套裝：封面先生成 → 分镜以「已生成封面」为人脸参考（避免抠像直送 2×4 跨格换脸）。
      let coverResult: Awaited<ReturnType<typeof runPlatformTopicImagePipeline>> | null = null;
      let coverErr: unknown = null;
      let sheetUrl: string | null = null;
      let sheetErr: unknown = null;

      const rawRefPhotoBundle = (params as { referencePhotoUrl?: unknown }).referencePhotoUrl;
      const referencePhotoUrlBundle =
        typeof rawRefPhotoBundle === "string" && rawRefPhotoBundle.trim()
          ? rawRefPhotoBundle.trim()
          : undefined;

      try {
        coverResult = await runPlatformTopicImagePipeline({
          topicHook,
          format: fmt === "图文" || fmt === "短视频" ? fmt : undefined,
          context: enrichedContext,
          coverPersonaContext: typeof params.coverPersonaContext === "string" ? params.coverPersonaContext : undefined,
          sceneId: sceneIdRaw,
          appealHook: appealHookOut,
          imagePromptTranslator: "gpt54",
          creationIdOut,
          isFreeRetry: Boolean(params.isFreeRetry),
          newJobMetaBase,
          progressJobId: platformJobId,
          coverProEngine,
          enableTopicCoverDeepResearchPro,
          drProSecondaryCoverInputs,
          trendEngagementVisualBrief: trendEngagementVisualBrief || undefined,
          referencePhotoUrl: referencePhotoUrlBundle,
          coverSubline: coverSublineOut,
          coverNativePlatform: coverNativePlatformOut,
          coverHeadlineFromVariant: coverHeadlineFromVariantOut,
        });
      } catch (e) {
        coverErr = e;
      }

      const coverUrl = String(coverResult?.imageUrl ?? coverResult?.url ?? "").trim();
      const storyboardReferenceUrl = coverUrl || referencePhotoUrlBundle;
      const storyboardRefFromCover = Boolean(coverUrl);

      if (storyboardReferenceUrl) {
        try {
          sheetUrl = await (compositeIs3x4 ? generatePlatformGridStitchedSheetImage : generatePlatformCompositeSheetImage)({
            kind: compositeKind,
            title: compositeTitle,
            scriptContext: compositeScriptContext,
            isTrial,
            executionDetails: compositeExecutionDetails,
            shootingTechniqueBrief: compositeShootingTechniqueBrief,
            imagePromptTranslator,
            flowLog: compositeFlowLog,
            enableCompositeDeepResearchPro: enableCompositeDeepResearchProAdmin,
            coverPersonaContext: typeof params.coverPersonaContext === "string" ? params.coverPersonaContext : undefined,
            referencePhotoUrl: storyboardReferenceUrl,
            referencePhotoFromApprovedCover: storyboardRefFromCover,
            progressJobId: platformJobId,
            compositeImageEngine,
          });
        } catch (e) {
          sheetErr = e;
        }
      } else if (!coverUrl) {
        sheetErr = coverErr ?? new Error("缺少参考人像，无法生成分镜");
      }
      const sheetOk = String(sheetUrl ?? "").trim();

      // Neon DR 副選題暫存：僅在整個 executeJob return 後由 markJobSucceeded/markJobFailed 刪除；
      // 套裝須等下方封面與 2×4 均 settle（含失敗）才進入終態，不在單路完成時刪 staging。
      if (!coverUrl || !sheetOk) {
        if (bundleCreditsCharged > 0 && Number.isFinite(uidNum)) {
          const { refundCredits } = await import("../credits.js");
          await refundCredits(
            uidNum,
            bundleCreditsCharged,
            "platform_topic_cover_composite_bundle 套裝失败退还",
          ).catch((e) => console.error("[platform_topic_cover_composite_bundle] refund failed:", e));
        }
        const parts = [
          coverErr instanceof Error ? coverErr.message : coverErr != null ? String(coverErr) : !coverUrl ? "封面无有效 URL" : "",
          sheetErr instanceof Error ? sheetErr.message : sheetErr != null ? String(sheetErr) : !sheetOk ? "2×4/八格无有效 URL" : "",
        ]
          .filter(Boolean)
          .join(" · ");
        throw new Error(`套裝生图失败：${parts || "未知原因"}`);
      }

      try {
        const { persistStoryboardSheetExportAfterGeneration } = await import(
          "../services/storyboardSheetExportPersistence.js"
        );
        await persistStoryboardSheetExportAfterGeneration({
          userId: uidNum,
          creationRecordId,
          jobId: platformJobId,
          sceneId: sceneIdRaw,
          payload: {
            imageUrl: sheetOk,
            scriptContextForPanels: compositeScriptContext,
            executionDetails: compositeExecutionDetails,
            reportTitle: compositeTitle,
            kind: compositeKind,
            sceneId: sceneIdRaw,
            updatedAt: new Date().toISOString(),
          },
        });
      } catch (pe) {
        console.warn("[platform_topic_cover_composite_bundle] persistStoryboardSheetExport skipped:", pe);
      }

      const coverLog = Array.isArray(coverResult?.imageGenFlowLog) ? coverResult!.imageGenFlowLog! : [];
      const mergedLog = [
        `${new Date().toISOString()} [套裝] 封面與 2×4 並行完成 · sceneId=${sceneIdRaw} · compositeKind=${compositeKind} · 封面=中文直送 · 2×4=中文直送`,
        ...coverLog,
        ...compositeFlowLog,
      ];

      return {
        provider: "vertex",
        output: {
          ...coverResult,
          success: true,
          imageUrl: coverUrl,
          url: coverUrl,
          compositeImageUrl: sheetOk,
          compositeKind,
          imageGenFlowLog: mergedLog,
          bundleCreditsCharged,
        },
      };
    }

    // ── knowledge_card_distill ───────────────────────────────────────────────
    // 长书提炼：整本 10 万字要分十几段跑数分钟，放同步 HTTP 会被网关掐断且拖死健康检查。
    if (input.action === "knowledge_card_distill") {
      const { prepareKnowledgeCardCopy } = await import("../services/knowledgeCardDistill.js");
      const { planKnowledgeCardPages } = await import("../../shared/knowledgeCardPagination.js");

      const sourceText = String(params.sourceText || "");
      const distillModel = typeof params.distillModel === "string" ? params.distillModel : undefined;
      const imageDataUrls = Array.isArray(params.imageDataUrls)
        ? (params.imageDataUrls as unknown[]).filter((u): u is string => typeof u === "string")
        : [];
      const extractionMethods = Array.isArray(params.extractionMethods)
        ? (params.extractionMethods as unknown[]).filter((m): m is string => typeof m === "string")
        : [];

      const prepared = await prepareKnowledgeCardCopy({
        sourceText,
        files: imageDataUrls.map((url) => ({ fileBase64: url, mimeType: "image/jpeg" })),
        forceDistill: true,
        distillModel,
        onProgress: async (p) => {
          if (!platformJobId) return;
          await patchJobRunningProgress(platformJobId, {
            distillPhase: p.phase,
            distillDoneChunks: p.doneChunks,
            distillTotalChunks: p.totalChunks,
          }).catch(() => {});
        },
      });
      const plan = planKnowledgeCardPages(prepared.distilledMarkdown, prepared.distillModel);

      // 服务端账本（审查必须修 P0·6）：真实提炼产出的稿子绑档位，出图页费按此结算
      if (!prepared.skippedDistill && prepared.distillModel) {
        const { recordKnowledgeCardDistillReceipt } = await import(
          "../services/knowledgeCardDistillReceipt.js"
        );
        // fail-closed：receipt 落不了盘就让 job 报错重试——吞错会让后续出图按客户端声明档计费
        await recordKnowledgeCardDistillReceipt(
          Number(jobUserId),
          prepared.distillModel,
          prepared.distilledMarkdown,
        );
      }

      /**
       * 提炼费：只有前端明确带 `chargeDistillFee` 才收，也就是「纯文本长文，
       * 用户在弹窗里选了先提炼」那条路。上传文档的提炼是抽文的必要环节，成本已含在页费里，不另收。
       * 扣在**提炼成功之后**：失败连扣都没扣过，不必写退款。
       */
      let distillFeeCharged = 0;
      const uidForDistillFee = Number(jobUserId);
      if (
        params.chargeDistillFee === true &&
        !prepared.skippedDistill &&
        Number.isFinite(uidForDistillFee) &&
        uidForDistillFee > 0
      ) {
        const { knowledgeCardDistillFeeForModel } = await import(
          "../../shared/knowledgeCardDistillModels.js"
        );
        const fee = knowledgeCardDistillFeeForModel(prepared.distillModel);
        /**
         * 幂等（审查必须修）：withTimeout 只是 Promise.race，超时后原执行仍在跑，
         * job 重排后新旧两次执行都会走到这里——按 jobId 查账，已扣过就不再扣第二次。
         */
        const chargeMarker = `[chargeKey:kcdistill/${String(platformJobId || "nojob")}]`;
        const { getDb } = await import("../db.js");
        let alreadyCharged = false;
        try {
          const db = await getDb();
          if (db) {
            const { stripeUsageLogs } = await import("../../drizzle/schema.js");
            const { and, eq, like } = await import("drizzle-orm");
            const [row] = await db
              .select({ creditsCost: stripeUsageLogs.creditsCost })
              .from(stripeUsageLogs)
              .where(
                and(
                  eq(stripeUsageLogs.userId, uidForDistillFee),
                  like(stripeUsageLogs.description, `%${chargeMarker}%`),
                ),
              )
              .limit(1);
            if (row) {
              alreadyCharged = true;
              distillFeeCharged = Math.max(0, Number(row.creditsCost) || 0);
            }
          }
        } catch (e) {
          // 审查修正：查账失败时不许盲扣（可能已扣过）——报错让 job 稍后重试
          console.warn("[knowledgeCardDistill] 幂等查账失败，停账重试：", e);
          throw new Error("计费对账暂不可用，请稍后重试");
        }
        if (!alreadyCharged) {
          const deducted = await deductCreditsAmount(
            uidForDistillFee,
            fee,
            "knowledgeCardDistill",
            `图文知识卡·提炼（${prepared.sourceChars.toLocaleString()} 字 → ${plan.pageCount} 页）${chargeMarker}`,
            // DB 唯一索引兜底并发双扣（超时旧执行 vs 重排新执行都过了上面的 SELECT 查账）
            { chargeKey: chargeMarker },
          );
          distillFeeCharged = deducted.cost;
        }
      }

      return {
        provider: prepared.distillModel === "claude-opus-5" ? "anthropic" : "evolink",
        output: {
          success: true,
          distillFeeCharged,
          distilledMarkdown: prepared.distilledMarkdown,
          skippedDistill: prepared.skippedDistill,
          extractionMethods: extractionMethods.length ? extractionMethods : prepared.extractionMethods,
          sourceChars: prepared.sourceChars,
          distillModel: prepared.distillModel,
          pageCount: plan.pageCount,
          credits: plan.credits,
          pages: plan.pages,
        },
      };
    }

    throw new Error(`不支持的平台任务动作：${input.action}`);
  } catch (error) {
    console.error("[processPlatformJob] 实际错误详情:", error);
    // buildPlatformJobError: preserves original error message inside the new error so that
    // job.error field (written by markJobFailed) contains actionable diagnostics for operators.
    throw buildPlatformJobError(error);
  }
}

async function executeJob(
  type: JobType,
  inputRaw: unknown,
  timeoutMs: number,
  userId: string,
  jobId?: string,
): Promise<{ output: unknown; provider?: string }> {
  const input = asEnvelope(inputRaw);
  if (type === "video") return processVideoJob(input, timeoutMs, userId, jobId);
  if (type === "image") return processImageJob(input, timeoutMs, userId, jobId);
  if (type === "platform") return processPlatformJob(input, jobId, userId);
  if (type === "pdf_export") return processPdfExportJob(inputRaw, userId, jobId);
  if (type === "post_prod") {
    // 防御分支:post_prod 已排除出主队列,正常只走 processOnePostProdJob(带 Abort 贯通)
    const { runPostProdJobWithLimit } = await import("./postProdJob.js");
    return runPostProdJobWithLimit(input, userId, timeoutMs);
  }
  return processAudioJob(input, timeoutMs, userId);
}

async function runClaimedJob(job: Awaited<ReturnType<typeof claimNextQueuedJob>> & object) {
  if (!job) return;
  let releaseInteractiveWorkload: (() => Promise<void>) | undefined;
  let paidImageHeartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    const jobType = job.type as JobType;
    const timeoutMs = resolveJobTimeoutMs(jobType, job.input);
    const paidImageTaskType = jobType === "image" ? paidImageLedgerTaskType(job.input) : null;
    if (paidImageTaskType) {
      const { heartbeatActiveJob } = await import("../services/paidJobLedger.js");
      paidImageHeartbeat = setInterval(() => {
        void heartbeatActiveJob(job.id, paidImageTaskType).catch(() => {});
      }, 30_000);
      paidImageHeartbeat.unref?.();
    }
    // claimNextQueuedJob 已经用数据库 CAS 把 queued 改为 running；再同时核对正整数
    // users.id，确保 public/匿名/伪造字符串不会持有前台租约。租约由本函数 finally
    // 释放，因此墙钟超时/requeue 后不会被仍未 settle 的孤儿 Promise 永久续心跳。
    if (isAuthenticatedRunningPlatformJob(job)) {
      releaseInteractiveWorkload = await beginGrowthInteractiveWorkload(`platform-job:${job.id}`);
    }
    const manhuaLearnJob =
      jobType === "video"
      && isRecord(job.input)
      && job.input.action === "manhua_template_learn";
    const { output, provider } = await withTimeout(
      executeJob(jobType, job.input, timeoutMs, String(job.userId), job.id),
      timeoutMs,
      `${job.type} job timed out after ${timeoutMs}ms`,
      manhuaLearnJob
        ? {
            onTimeout: () => {
              abortRunningManhuaLearnJob(job.id);
            },
            cleanupGraceMs: 30_000,
          }
        : undefined,
    );
    const succeededPersisted = manhuaLearnJob
      ? await markManhuaLearnJobSucceededWithRetry(job.id, output, provider)
      : await markJobSucceeded(job.id, output, provider);
    if (manhuaLearnJob && !succeededPersisted) {
      // terminalOutput 已先写入 running.output；列表端与下次启动都能按 done 收敛成功。
      // 此处绝不 throw/requeue，否则会把已经完成的媒体与模型工作整条再烧一次。
      console.error(`[Jobs] manhua learn finished but status persistence is pending: jobId=${job.id}`);
      return;
    }
    const paidAssetStandardize =
      jobType === "image" &&
      isRecord(job.input) &&
      isRecord(job.input.params) &&
      (job.input.params.assetStandardizeQuality === "medium" || job.input.params.assetStandardizeQuality === "high");
    // 八审 P0-4:普通 canvas 出图(非资产标准化)成功后同样要结算账本 hold
    const paidCanvasImage =
      jobType === "image" && isCanvasGptImage2Job(job.input) && !paidAssetStandardize;
    const paidCreativeNanoImage = jobType === "image" && isCreativeNanoImageJob(job.input);
    if (paidCreativeNanoImage) {
      const { markSettlementPending, unregisterActiveJob, refundCreditsOnFailure } =
        await import("../services/paidJobLedger.js");
      if (!succeededPersisted) {
        await refundCreditsOnFailure(
          job.id,
          CREATIVE_NANO_IMAGE_TASK_TYPE,
          "task_failed",
          "Creative Nano 结果保存失败·退回积分",
        ).catch((error) => console.error("[Jobs] Creative Nano persistence refund failed:", error));
        await markJobFailed(job.id, "Creative Nano 结果保存失败，已进入退分流程");
        return;
      }
      try {
        await unregisterActiveJob(job.id, CREATIVE_NANO_IMAGE_TASK_TYPE, "settled");
      } catch {
        await markSettlementPending(job.id, CREATIVE_NANO_IMAGE_TASK_TYPE);
      }
    }
    if (paidCanvasImage) {
      const { markSettlementPending, unregisterActiveJob, refundCreditsOnFailure } =
        await import("../services/paidJobLedger.js");
      if (!succeededPersisted) {
        // 上游有图但 output 没落库:用户拿不到产物,不能先结算后留永久扣费
        await refundCreditsOnFailure(
          job.id,
          "canvasGptImage2",
          "task_failed",
          "画布出图结果保存失败·退回积分",
        ).catch((e) => console.error("[Jobs] canvas image persistence refund failed:", e));
        await markJobFailed(job.id, "画布出图结果保存失败，已进入退分流程");
        return;
      }
      try {
        await unregisterActiveJob(job.id, "canvasGptImage2", "settled");
      } catch {
        // 产物已落库,不能退款;reaper 只补结算不退成功单
        await markSettlementPending(job.id, "canvasGptImage2");
      }
    }
    const paidPlatformVisualReport =
      jobType === "platform" &&
      isRecord(job.input) &&
      job.input.action === "platform_visual_report";
    if (paidAssetStandardize) {
      if (!succeededPersisted) {
        // 上游有图但 job.output 没落库，用户拿不到产物；不能先结算后留下永久扣费。
        const { refundCreditsOnFailure } = await import("../services/paidJobLedger.js");
        await refundCreditsOnFailure(
          job.id,
          "manhuaAssetStandardize",
          "task_failed",
          "资产标准化结果保存失败·退回积分",
        );
        await markJobFailed(job.id, "资产标准化结果保存失败，已进入退分流程");
        return;
      }
      const { markSettlementPending, unregisterActiveJob } = await import("../services/paidJobLedger.js");
      try {
        await unregisterActiveJob(job.id, "manhuaAssetStandardize", "settled");
      } catch {
        // job.output 已经持久化，不能退款；reaper 只补结算，不会把成功单退掉。
        await markSettlementPending(job.id, "manhuaAssetStandardize");
      }
    }
    if (paidPlatformVisualReport) {
      if (!succeededPersisted) {
        const { refundCreditsOnFailure } = await import("../services/paidJobLedger.js");
        await refundCreditsOnFailure(
          job.id,
          "platformAnalysis",
          "task_failed",
          "趋势报告结果保存失败·退回积分",
        ).catch((refundError) =>
          console.error("[Jobs] trend report persistence refund failed:", refundError),
        );
        await markJobFailed(job.id, "趋势报告结果保存失败，已进入退分流程");
        return;
      }
      const { markSettlementPending, unregisterActiveJob } = await import("../services/paidJobLedger.js");
      try {
        await unregisterActiveJob(job.id, "platformAnalysis", "settled");
      } catch {
        // 结果已经落库，不能退款；由 ledger reaper 只补结算。
        await markSettlementPending(job.id, "platformAnalysis");
      }
    }
  } catch (error) {
    const userCancelled = error instanceof Error
      && (error.name === "ManhuaLearnCancelledError" || /用户已停止学习/.test(error.message));
    const message =
      job.type === "platform" && error instanceof Error
        ? error.message
        : getJobFailureMessage(job.type as JobType, error);
    const nativeManhuaLearnJob =
      job.type === "video"
      && isRecord(job.input)
      && job.input.action === "manhua_template_learn"
      && isRecord(job.input.params)
      && job.input.params.nativeDeepReadConfirmed === true;
    if (nativeManhuaLearnJob) {
      const partial = (error as JobTimeoutErrorWithPartial<{
        output?: unknown;
        provider?: string;
      }>)?.partialResult;
      const carriedReceipts = parsePersistedNativeModelReceipts(
        (error as { nativeModelReceipts?: unknown })?.nativeModelReceipts,
      );
      const partialOutput = partial?.output && isRecord(partial.output) && !Array.isArray(partial.output)
        ? partial.output
        : undefined;
      const failureReceipts = parsePersistedNativeModelReceipts([
        ...carriedReceipts,
        ...(Array.isArray(partialOutput?.nativeModelReceipts)
          ? partialOutput.nativeModelReceipts
          : []),
      ]);
      const receiptPatch = failureReceipts.length > 0
        ? { nativeModelReceipts: failureReceipts }
        : {};
      const failureOutputPatch = partialOutput
        ? {
          ...partialOutput,
          ...receiptPatch,
          analysisStage: "manhua_learn_failed",
          analysisStageLabel: userCancelled
            ? "用户已停止学习；已入库内容与费用回执保留"
            : "原生精读任务未完整结束；已入库内容与费用回执保留",
        }
        : (() => {
        const carriedNativeUsage = isRecord((error as { nativeUsage?: unknown })?.nativeUsage)
          ? (error as { nativeUsage: Record<string, unknown> }).nativeUsage
          : undefined;
        // 计划复核前失败不会产生模型用量；一旦进入原生执行却未能在清理窗口内
        // 返回完整结果，必须显式标成“回执待核”，不能让面板把缺字段解释为 0 元。
        return {
          pipelineMode: "native_deep_read",
          ...receiptPatch,
          nativeUsage: carriedNativeUsage || {
              model: "qwen3.8-max",
              billingMode: "unknown",
              inputTokens: 0,
              outputTokens: 0,
              priceEquivalentCny: 0,
              elapsedMs: 0,
              receiptComplete: false,
            },
          analysisStage: "manhua_learn_failed",
          analysisStageLabel: userCancelled
            ? "用户已停止学习；费用回执待核"
            : "原生精读任务未完整结束；费用回执待核",
        };
      })();
      // 原生学习按模型请求计费；整单重排可能再次发请求。失败、中止、墙钟到期
      // 均只落终态，保留 claim 供人工核对，不自动重跑。
      const failedPersisted = await markManhuaLearnJobFailedWithOutputRetry(
        job.id,
        userCancelled
          ? "用户已停止学习；已入库内容与费用回执保留"
          : `${message}；已入库内容保留，未自动重跑`,
        failureOutputPatch,
      );
      if (!failedPersisted) {
        console.error(`[Jobs] native manhua learn failed terminal persistence exhausted: jobId=${job.id}`);
      }
    } else if (userCancelled) {
      await markJobFailed(job.id, "用户已停止学习；已落盘内容保留");
    } else if (
      job.type === "image" &&
      isRecord(job.input) &&
      isRecord(job.input.params) &&
      (job.input.params.assetStandardizeQuality === "medium" || job.input.params.assetStandardizeQuality === "high")
    ) {
      // 包含 worker 外层墙钟超时：上游 Promise 可能仍在跑，先把用户账幂等退掉，且不重试双烧。
      const { refundCreditsOnFailure } = await import("../services/paidJobLedger.js");
      await refundCreditsOnFailure(
        job.id,
        "manhuaAssetStandardize",
        "external_api_error",
        "资产标准化失败或超时·退回积分",
      ).catch((refundError) =>
        console.error("[Jobs] manhua asset standardize refund failed:", refundError),
      );
      await markJobFailed(job.id, message);
    } else if (
      job.type === "platform" &&
      isRecord(job.input) &&
      job.input.action === "platform_visual_report"
    ) {
      // generateVisualReport 内部已完成三次模型重试；worker 不再重排整单重复烧模型。
      const { refundCreditsOnFailure } = await import("../services/paidJobLedger.js");
      await refundCreditsOnFailure(
        job.id,
        "platformAnalysis",
        "external_api_error",
        "趋势报告生成失败或超时·退回积分",
      ).catch((refundError) =>
        console.error("[Jobs] trend report refund failed:", refundError),
      );
      await markJobFailed(job.id, message);
    } else if (resolveFailedJobDisposition(job) === "refund_and_fail_paid_image") {
      /**
       * 七审 P0-2:canvas_gpt_image2 绝不整单重排——重排会第二次调用付费图片上游。
       * 八审 P0-4:外层墙钟超时/进程级失败走账本 refundCreditsOnFailure——退款失败
       * 落 refund_pending 由 reaper 补退,不再是"打日志就丢";与内部退款同一账本键幂等。
       */
      const { refundCreditsOnFailure } = await import("../services/paidJobLedger.js");
      const paidImageTaskType = paidImageLedgerTaskType(job.input)!;
      await refundCreditsOnFailure(
        job.id,
        paidImageTaskType,
        "task_timeout",
        "付费图片任务失败或超时·退回已扣积分",
      ).catch((refundError) =>
        console.error("[Jobs] paid image refund pending:", refundError),
      );
      await markJobFailed(job.id, message);
    } else if ((job.attempts ?? 0) < 2) {
      await requeueJob(job.id, message);
    } else {
      await markJobFailed(job.id, message);
    }
  } finally {
    if (paidImageHeartbeat) clearInterval(paidImageHeartbeat);
    await releaseInteractiveWorkload?.();
  }
}

/**
 * 僵尸行清理只归 startStaleJobsReaper（20 分钟一次）。原先每个 tick 都先跑一遍
 * reapStaleJobsOnce（三个 interval 合计每秒 2-3 次 × 双 DELETE），5 个月在 Neon
 * 上打出 2800 万次 DELETE——是账单里 compute 的最大单项，而清理门槛本来就是
 * 20 分钟量级，每秒清一次毫无意义。
 */
async function processOneJob() {
  const job = await claimNextQueuedJob();
  if (!job) return false;

  await runClaimedJob(job);
  return true;
}

async function processOneGrowthAnalyzeJob(): Promise<boolean> {
  if (growthAnalyzeJobsActive >= GROWTH_CAMP_JOB_WORKER_CONCURRENCY) return false;
  const job = await claimNextGrowthCampAnalyzeJob();
  if (!job) return false;

  growthAnalyzeJobsActive += 1;
  void runClaimedJob(job).finally(() => {
    growthAnalyzeJobsActive = Math.max(0, growthAnalyzeJobsActive - 1);
  });
  return true;
}

export async function processGrowthAnalyzeJobsOnce() {
  while (await processOneGrowthAnalyzeJob()) {
    // 直到队列空或达到 GROWTH_CAMP_JOB_WORKER_CONCURRENCY
  }
}

async function processOneManhuaLearnJob(): Promise<boolean> {
  if (manhuaLearnJobsActive >= MANHUA_LEARN_JOB_WORKER_CONCURRENCY) return false;
  const job = await claimNextManhuaTemplateLearnJob();
  if (!job) return false;

  manhuaLearnJobsActive += 1;
  void runClaimedJob(job).finally(() => {
    manhuaLearnJobsActive = Math.max(0, manhuaLearnJobsActive - 1);
    void processManhuaLearnJobsOnce();
  });
  return true;
}

export async function processManhuaLearnJobsOnce() {
  while (await processOneManhuaLearnJob()) {
    // 直到持久队列为空或达到双并发上限；任务结束会立即唤醒下一条。
  }
}

async function processOnePdfExportJob(): Promise<boolean> {
  const job = await claimNextPdfExportJob();
  if (!job) return false;

  try {
    const jobType = job.type as JobType;
    const timeoutMs = JOB_TIMEOUT_MS[jobType];
    const { output, provider } = await withTimeout(
      executeJob(jobType, job.input, timeoutMs, String(job.userId), job.id),
      timeoutMs,
      `${job.type} job timed out after ${timeoutMs}ms`,
    );
    await markJobSucceeded(job.id, output, provider);
  } catch (error) {
    const message = getJobFailureMessage(job.type as JobType, error);
    const { recordPdfExportStep } = await import("./repository");
    await recordPdfExportStep(job.id, "job_failed", message.slice(0, 800));
    if ((job.attempts ?? 0) < 2) {
      await requeueJob(job.id, message);
    } else {
      await markJobFailed(job.id, message);
    }
  }

  return true;
}

export async function processPdfJobsOnce() {
  if (pdfProcessing) return;
  pdfProcessing = true;
  try {
    while (await processOnePdfExportJob()) {
      // Drain pdf_export only.
    }
  } finally {
    pdfProcessing = false;
  }
}

async function processOnePostProdJob(): Promise<boolean> {
  const job = await claimNextPostProdJob();
  if (!job) return false;

  // 心跳刷新 updatedAt:stale reaper 只清"最后活动过旧"的 running 行,
  // 心跳在=进程活着;进程崩溃后心跳停,租约到期由 reaper 清理,不自动重做。
  const heartbeat = setInterval(() => {
    void patchJobRunningProgress(job.id, {
      postProdHeartbeatAt: new Date().toISOString(),
    }).catch(() => {});
  }, 30_000);
  heartbeat.unref?.();

  try {
    const timeoutMs = JOB_TIMEOUT_MS.post_prod;
    const { runPostProdJobWithLimit } = await import("./postProdJob.js");
    // 时限贯通 AbortSignal:到点下载与 ffmpeg/ffprobe 子进程同步终止
    const { output, provider } = await runPostProdJobWithLimit(
      job.input,
      String(job.userId),
      timeoutMs,
    );
    // 只重试状态写入,不重新执行媒体处理;写不进去按失败留痕
    const saved = await markJobSucceededWithRetry(job.id, output, provider);
    if (!saved) {
      await markJobFailed(job.id, "后期结果状态保存未完成,请重新提交");
      return true;
    }
  } catch (error) {
    // 后期任务确定性強、重跑同样贵:一律直接失败,不 requeue 重做整项媒体处理
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `后期任务超时(${JOB_TIMEOUT_MS.post_prod}ms),已终止本次处理`
        : getJobFailureMessage("post_prod" as JobType, error);
    await markJobFailed(job.id, message.slice(0, 800));
  } finally {
    clearInterval(heartbeat);
  }

  return true;
}

/** 后期工坊独立通道:串行消化(单并发),不与普通媒体任务抢队列 */
export async function processPostProdJobsOnce() {
  if (postProdProcessing) return;
  postProdProcessing = true;
  try {
    while (await processOnePostProdJob()) {
      // Drain post_prod only, one at a time.
    }
  } finally {
    postProdProcessing = false;
  }
}

export async function processJobsOnce() {
  if (processing) return;
  processing = true;
  try {
    while (await processOneJob()) {
      // Continue until queue is drained.
    }
  } finally {
    processing = false;
  }
}

export function startJobWorker() {
  if (workerStarted) return;
  workerStarted = true;

  void processJobsOnce();
  void processPdfJobsOnce();
  void processPostProdJobsOnce();
  void processGrowthAnalyzeJobsOnce();
  void processManhuaLearnJobsOnce();
  timer = setInterval(() => {
    void processJobsOnce();
  }, 1_000);
  growthAnalyzeTimer = setInterval(() => {
    void processGrowthAnalyzeJobsOnce();
  }, 1_000);
  manhuaLearnTimer = setInterval(() => {
    void processManhuaLearnJobsOnce();
  }, 1_000);
  pdfTimer = setInterval(() => {
    void processPdfJobsOnce();
  }, 3_000);
  postProdTimer = setInterval(() => {
    void processPostProdJobsOnce();
  }, 3_000);
  if (typeof postProdTimer.unref === "function") {
    postProdTimer.unref();
  }

  if (typeof timer.unref === "function") {
    timer.unref();
  }
  if (growthAnalyzeTimer && typeof growthAnalyzeTimer.unref === "function") {
    growthAnalyzeTimer.unref();
  }
  if (manhuaLearnTimer && typeof manhuaLearnTimer.unref === "function") {
    manhuaLearnTimer.unref();
  }
  if (pdfTimer && typeof pdfTimer.unref === "function") {
    pdfTimer.unref();
  }
}

export function stopJobWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  if (growthAnalyzeTimer) clearInterval(growthAnalyzeTimer);
  growthAnalyzeTimer = null;
  if (manhuaLearnTimer) clearInterval(manhuaLearnTimer);
  manhuaLearnTimer = null;
  if (pdfTimer) clearInterval(pdfTimer);
  pdfTimer = null;
  if (postProdTimer) clearInterval(postProdTimer);
  postProdTimer = null;
  workerStarted = false;
}
