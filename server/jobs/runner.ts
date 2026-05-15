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
import { appRouter, buildPlatformContent, slimBuildPlatformContentDiagnosticsForJob } from "../routers";
import { invokeLLM, extractJsonString } from "../_core/llm";
import { deleteGcsObject } from "../services/gcs";
import { resolveWatermark } from "../services/tier-provider-routing.js";
import { buildStage1StrategicHandoffForStage2 } from "../services/stage1StrategicHandoff.js";
import { getDb } from "../db";
import { users, type User } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { deductCredits, getCredits, getUserPlan } from "../credits";
import { CREDIT_COSTS } from "../plans";
import { calculateAnalysisCost, MAX_DURATION_SECONDS } from "../utils/costCalculator";
import {
  createProducerTask,
  getProducerTaskStatus,
  type ProducerModel,
  type ProducerQuality,
} from "../services/aimusic-producer";
import { analyzeVideo as analyzeGrowthCampVideo } from "../growth/analyzeVideo";
import { resolveGrowthCampExtractorModel } from "../growth/extractorPipeline";
import { normalizePlatforms } from "../growth/growthSchema";
import { readTrendStore, readTrendStoreForPlatforms } from "../growth/trendStore";
import {
  claimNextQueuedJob,
  claimNextPdfExportJob,
  markJobFailed,
  markJobSucceeded,
  requeueJob,
  type JobType,
} from "./repository";
import { processPdfExportJob } from "./pdfExportJob";
import { reapStaleJobsOnce } from "./staleJobsReaper";

const JOB_TIMEOUT_MS: Record<JobType, number> = {
  image: 12_000,
  audio: 8 * 60_000,
  video: 30_000,
  // platform：預設 12 min；platform_topic_image 預設 10 min；platform_build_content / 套裝由 resolveJobTimeoutMs 加長
  platform: 12 * 60_000,
  /** 与 Cloud Run pdf-worker + 跨云回传对齐；独占队列不阻塞别的任务 */
  pdf_export: 55 * 60_000,
};

const GROWTH_VIDEO_ANALYSIS_TIMEOUT_MS = 12 * 60_000;
const PLATFORM_LLM_TIMEOUT_MS = 8 * 60_000;

const POLL_INTERVAL_MS = 2_000;

let klingInitialized = false;
let workerStarted = false;
let processing = false;
let timer: NodeJS.Timeout | null = null;
let pdfProcessing = false;
let pdfTimer: NodeJS.Timeout | null = null;

type JobEnvelope = {
  action: string;
  params?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
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
    lower.includes("aborted")
  );
}

function getPlatformJobErrorMessage(error: unknown): string {
  if (isPlatformTimeoutError(error)) {
    return "AI 深度思考时间过长导致连接超时。请尝试缩减提示词范围，或重新提交分析。";
  }
  return "任务执行失败，请稍后重试。";
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

async function processVideoJob(input: JobEnvelope, timeoutMs: number, userId?: string): Promise<{ output: unknown; provider?: string }> {
  const params = input.params ?? {};

  if (input.action === "growth_analyze_video") {
    const numericUserId = userId ? Number(userId) : NaN;
    const growthMode = params.mode === "REMIX" ? "REMIX" : "GROWTH";
    const creditAction = growthMode === "REMIX" ? "growthCampRemix" : "growthCampGrowth";

    // 前端可传入 durationSeconds（本地文档上传时可获取），URL 类视频无法提前获取则为 0
    const durationSeconds = typeof params.durationSeconds === "number" ? params.durationSeconds : 0;

    // 硬限制：超过 60 分钟直接拒绝
    if (durationSeconds > MAX_DURATION_SECONDS) {
      throw new Error("系统暂不支持超过 60 分钟的超长视频，请剪辑后再试");
    }

    // 阶梯式计费（durationSeconds 为 0 时默认按 10 分钟 1.5× 计）
    const cost = calculateAnalysisCost(growthMode, durationSeconds);
    let creditDeducted = 0;

    if (Number.isFinite(numericUserId)) {
      const credits = await getCredits(numericUserId);
      if (credits.totalAvailable < cost) {
        throw new Error(
          durationSeconds > 0
            ? `积分不足，${Math.round(durationSeconds / 60)} 分钟视频分析需要 ${cost} 积分（当前余额: ${credits.totalAvailable}）`
            : `积分不足，本次分析需要 ${cost} 积分（当前余额: ${credits.totalAvailable}）`,
        );
      }
      const durationLabel = durationSeconds > 0 ? `（${Math.round(durationSeconds / 60)} 分钟）` : "（时长未知，按默认计费）";
      await deductCredits(numericUserId, creditAction, `创作者成长营 ${growthMode} 分析${durationLabel}`);
      creditDeducted = cost;
    }

    try {
      const result = await analyzeGrowthCampVideo({
        gcsUri: typeof params.gcsUri === "string" ? params.gcsUri : undefined,
        fileUrl: typeof params.fileUrl === "string" ? params.fileUrl : undefined,
        fileKey: typeof params.fileKey === "string" ? params.fileKey : undefined,
        mimeType: String(params.mimeType ?? "video/mp4"),
        fileName: typeof params.fileName === "string" ? params.fileName : undefined,
        context: typeof params.context === "string" ? params.context : undefined,
        modelName: typeof params.modelName === "string" ? params.modelName : undefined,
        mode: params.mode === "REMIX" ? "REMIX" : "GROWTH",
        forceRefresh: params.forceRefresh === true,
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

  ensureKlingInitialized();

  if (input.action === "omni_t2v") {
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

async function processImageJob(input: JobEnvelope, timeoutMs: number, jobUserId: string): Promise<{ output: unknown; provider?: string }> {
  const params = input.params ?? {};

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

function resolveJobTimeoutMs(type: JobType, inputRaw: unknown) {
  const defaultTimeout = JOB_TIMEOUT_MS[type];
  if (type === "platform") {
    try {
      const input = asEnvelope(inputRaw);
      if (input.action === "platform_build_content") {
        const raw = Number(process.env.PLATFORM_BUILD_CONTENT_JOB_TIMEOUT_MS);
        if (Number.isFinite(raw) && raw >= 120_000) return raw;
        // Stage 2：冷數據讀取 + 大 JSON LLM（預設 20min，可用 PLATFORM_BUILD_CONTENT_JOB_TIMEOUT_MS 覆蓋）
        return 20 * 60_000;
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
    } catch {
      /* fall through */
    }
    return defaultTimeout;
  }
  if (type !== "video") return defaultTimeout;
  try {
    const input = asEnvelope(inputRaw);
    if (input.action === "growth_analyze_video") {
      return GROWTH_VIDEO_ANALYSIS_TIMEOUT_MS;
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
 *   vertex / gemini-3.1-pro-preview，多模态追问；如有 fileUri 则附带文档
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
    // ── platform_analysis ────────────────────────────────────────────────────────
    if (input.action === "platform_analysis") {
      const context = String(params.context || "");
      const windowDays = Number(params.windowDays || 15);
      const snapshotSummary = (params.snapshotSummary || {}) as Record<string, unknown>;

    // Stage 1: 3.1 Pro — deep original content blueprint (director mode, no trend data)
    // Strict: no outlines. Must output verbatim copy, precise shooting scripts, emotional direction.
    const stage1SystemInstruction = `你是一位顶级内容创作导演兼文案大师，你的产出标准绝对不接受大纲、空洞建议或模糊描述。

【铁律】——违反任何一条即视为失败，必须重写：
1. detailedScript 必须使用精确时间轴格式，视频方案每段格式：「[00:00-00:05] 画面：镜头景别+运镜+道具+演员动作。口播：逐字文案。情绪：氛围描述。」图文方案每页格式：「[封面] 设计说明+大标题文案。[图2] 图片内容+正文段落。」总字数不得少于400字。
2. copywriting 必须是可直接使用的完整正文，包含开头段落全文（≥60字）+中段内容展开（≥100字）+结尾引导行动（≥40字），总字数不得少于200字。
3. executionDetails.environmentAndWardrobe 必须说明：拍摄地点+背景布置+创作者服装要求+必备道具（≥50字）。
4. executionDetails.lightingAndCamera 必须说明：使用哪种光源+布光方式+机位角度+焦距建议+是否手持（≥50字）。
5. executionDetails.stepByStepScript 必须是至少5个步骤的数组，每步格式「[第X步 时间段] 具体动作描述」。
6. hook 必须是能让陌生用户在0.5秒内停下来的具体一句话，不得是泛泛描述，不得超过40字。
7. highlightKeywords 必须指出应借势的当前热点关键词，格式「[高亮:关键词]」。

你的产出是创作者的「施工图纸」，拿到就能立刻开拍，没有任何理解成本。`;

      const stage1Response = await invokeLLM({
      provider: "vertex",
      modelName: "gemini-3.1-pro-preview",
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
            task: "必须严格输出纯 JSON 格式，不要包含任何 markdown 代码块标记或前后缀说明文字。在 contentBlueprints 数组中，务必精确生成 4 个深度内容方案/选题，切勿少于 4 个；须严格结合用户 context 所描述的真实 IP 背景与定位，从以下 4 个维度各出 1 个独特选题：①核心专业洞察 ②跨界结合与价值观 ③目标受众痛点暴击 ④个人经历与人设魅力。输出严格合法 JSON，必须包含以下字段：contentBlueprints（必须恰好 4 条内容方案数组，每项含：title（选题标题）/format（「短视频」或「图文」）/hook（≥30字开场钩子，必须是让用户停下来的具体一句话）/copywriting（≥200字逐字文案，包含完整开头段落/中段展开/结尾引导行动）/suitablePlatforms（适合平台数组）/actionableSteps（至少3个落地步骤，字符串数组）/detailedScript（精确时间轴拍摄脚本：视频格式用「[00:00-00:05] 画面：...口播：...情绪：...」格式；图文格式用「[封面] 设计：... [图2] 文案：...」格式，≥400字）/publishingAdvice（发布时机与平台设置，包含具体hashtag）/executionDetails（对象，必须包含environmentAndWardrobe（拍摄环境+服装道具，≥50字）/lightingAndCamera（灯光+机位设置，≥50字）/stepByStepScript（逐步脚本数组，每步「[时段]动作描述」格式，至少5步））/highlightKeywords（热点关键字数组，格式如「[高亮:职场霸凌]」）） 和 monetizationLanes（1-2条变现路径数组，每项含：title/fitReason/offerShape/revenueModes（数组）/firstValidation）。第一个字符必须是 {，最后必须是 }。",
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

    // Stage 2: 3.1 Pro — trend calibration + dashboard signals + 3 key metrics
    const stage2SystemInstruction = "你是一位顶尖的平台趋势分析师。根据用户的脚本蓝图与平台快照数据，进行热点数据校准，计算关键指标，输出最终平台看板 JSON。";
      const stage2Response = await invokeLLM({
      provider: "vertex",
      modelName: "gemini-2.5-pro",
      response_format: { type: "json_object" },
      max_tokens: 32768,
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
        provider: "vertex",
        output: {
          platformDashboard: dashboardResult,
          platformContent: contentResult,
          completedAt: new Date().toISOString(),
          engines: { stage1: "vertex/gemini-3.1-pro-preview", stage2: "vertex/gemini-3.1-pro-preview", snapshotDepth: "full" },
        },
      };
    }

    // ── platform_qa ──────────────────────────────────────────────────────────────
    if (input.action === "platform_qa") {
      const question = String(params.question || "");
      const context = String(params.context || "");
      const windowDays = Number(params.windowDays || 15);
      const snapshot = (params.snapshot || {}) as Record<string, unknown>;
      const fileUri = typeof params.fileUri === "string" ? params.fileUri : undefined;
      const fileMimeType = typeof params.fileMimeType === "string" ? params.fileMimeType : "application/octet-stream";

      try {
        const systemPrompt = "你是一位顶尖的平台增长顾问。请根据用户提问和平台快照数据，给出具体、可执行的专业建议。回答要精准、有结构，使用 Markdown 格式。";
        const contextPayload = JSON.stringify({
          windowDays,
          context,
          question,
          snapshot,
        });

        const userContent: any = fileUri
          ? [
              { type: "text", text: contextPayload },
              { type: "file_url", file_url: { url: fileUri, mime_type: fileMimeType } },
            ]
          : contextPayload;

        const qaResponse = await invokeLLM({
          provider: "vertex",
          modelName: "gemini-3.1-pro-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
        });

        const answerText = String(qaResponse.choices[0]?.message?.content || "");

        return {
          provider: "vertex",
          output: {
            result: {
              title: question.slice(0, 40) || "追问回答",
              answer: answerText,
              encouragement: "",
              nextQuestions: [],
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
      const built = await buildPlatformContent({
        snapshot: snapshotSummary,
        platformMenu,
        context: context || undefined,
        windowDays,
        requestedPlatforms,
        store,
        abortSignal: undefined,
        stage1Handoff,
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
      try {
        const resolved = await assertOptimizedCoverInputsFromDb({
          userId: uidNum,
          sceneId: sceneIdRaw,
        });
        topicHook = resolved.topicHook;
        contextRaw = resolved.context;
        appealHookOut = resolved.appealHook;
        fmt = resolved.format;
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
      const rawCoverPro = (params as { coverProEngine?: unknown }).coverProEngine;
      const coverProEngine =
        rawCoverPro === "nano_banana_2" || rawCoverPro === "nano_banana_pro"
          ? ("nano_banana_2" as const)
          : undefined;
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
      const rawBatchIdx = (params as { batchSceneSlotIndex?: unknown }).batchSceneSlotIndex;
      const rawBatchTot = (params as { batchSceneSlotTotal?: unknown }).batchSceneSlotTotal;
      const batchSceneDiversity =
        typeof rawBatchIdx === "number" && typeof rawBatchTot === "number" && rawBatchTot >= 2
          ? { slotIndex: Math.max(0, Math.floor(rawBatchIdx)), slotTotal: Math.floor(rawBatchTot) }
          : undefined;
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
        batchSceneDiversity,
      });
      return { provider: "vertex", output: result };
    }

    if (input.action === "platform_topic_cover_composite_bundle") {
      const { runPlatformTopicImagePipeline } = await import("../services/runPlatformTopicImagePipeline.js");
      const { generatePlatformCompositeSheetImage } = await import("../services/proxyImageService.js");

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
      try {
        const resolved = await assertOptimizedCoverInputsFromDb({
          userId: uidNum,
          sceneId: sceneIdRaw,
        });
        topicHook = resolved.topicHook;
        contextRaw = resolved.context;
        appealHookOut = resolved.appealHook;
        fmt = resolved.format;
      } catch (e) {
        const msg = e instanceof PlatformCoverInputsError ? e.message : e instanceof Error ? e.message : String(e);
        throw new Error(msg || "无法从选题快照解析封面文案");
      }
      const { buildPlatformCoverHistoryHintFromDb, mergeCoverContextWithDbHint } = await import(
        "../services/platformCoverHistoryHint.js",
      );
      const coverHistoryHint = await buildPlatformCoverHistoryHintFromDb({ userId: uidNum });
      const enrichedContext = mergeCoverContextWithDbHint(contextRaw, coverHistoryHint);

      const rawCoverPro = (params as { coverProEngine?: unknown }).coverProEngine;
      const coverProEngine =
        rawCoverPro === "nano_banana_2" || rawCoverPro === "nano_banana_pro"
          ? ("nano_banana_2" as const)
          : undefined;
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
      const imagePromptTranslator =
        params.compositeImagePromptTranslator === "gpt54" ||
        params.compositeImagePromptTranslator === "vertex_gemini_3_flash_preview"
          ? params.compositeImagePromptTranslator
          : "vertex_gemini_3_flash_preview";

      const rawCompDr = (params as { enableCompositeDeepResearchPro?: unknown }).enableCompositeDeepResearchPro;
      const enableCompositeDeepResearchProAdmin = rawCompDr === true;

      const creationRecordIdRaw = (params as { creationRecordId?: unknown }).creationRecordId;
      const creationRecordId =
        typeof creationRecordIdRaw === "number" && Number.isFinite(creationRecordIdRaw) && creationRecordIdRaw > 0
          ? Math.floor(creationRecordIdRaw)
          : undefined;

      const isTrial = await resolveWatermark(uidNum, false);
      const compositeFlowLog: string[] = [];

      // 套裝：封面（GPT 5.4 英文化 → 9:16）與 2×4（預設 Vertex Flash 英文化 → 16:9）**並行**。
      // 各自內部仍為「翻譯完成再送 GPT-IMAGE-2」；總牆鐘約 max(兩路)，而非兩段相加。
      // 舊注：曾串行以避免兩路同時塞滿載翻譯；現分轨譯者不同（5.4 vs Flash），可並行。
      let coverResult: Awaited<ReturnType<typeof runPlatformTopicImagePipeline>> | null = null;
      let coverErr: unknown = null;
      let sheetUrl: string | null = null;
      let sheetErr: unknown = null;

      const rawBatchIdxB = (params as { batchSceneSlotIndex?: unknown }).batchSceneSlotIndex;
      const rawBatchTotB = (params as { batchSceneSlotTotal?: unknown }).batchSceneSlotTotal;
      const batchSceneDiversityBundle =
        typeof rawBatchIdxB === "number" && typeof rawBatchTotB === "number" && rawBatchTotB >= 2
          ? { slotIndex: Math.max(0, Math.floor(rawBatchIdxB)), slotTotal: Math.floor(rawBatchTotB) }
          : undefined;

      const [coverSettled, sheetSettled] = await Promise.allSettled([
        runPlatformTopicImagePipeline({
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
          batchSceneDiversity: batchSceneDiversityBundle,
        }),
        generatePlatformCompositeSheetImage({
          kind: compositeKind,
          title: compositeTitle,
          scriptContext: compositeScriptContext,
          isTrial,
          executionDetails: compositeExecutionDetails,
          imagePromptTranslator,
          flowLog: compositeFlowLog,
          enableCompositeDeepResearchPro: enableCompositeDeepResearchProAdmin,
          coverPersonaContext: typeof params.coverPersonaContext === "string" ? params.coverPersonaContext : undefined,
          progressJobId: platformJobId,
        }),
      ]);

      if (coverSettled.status === "fulfilled") {
        coverResult = coverSettled.value;
      } else {
        coverErr = coverSettled.reason;
      }
      if (sheetSettled.status === "fulfilled") {
        sheetUrl = sheetSettled.value;
      } else {
        sheetErr = sheetSettled.reason;
      }

      const coverUrl = String(coverResult?.imageUrl ?? coverResult?.url ?? "").trim();
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
        `${new Date().toISOString()} [套裝] 封面與 2×4 並行完成 · sceneId=${sceneIdRaw} · compositeKind=${compositeKind} · 封面英文化=GPT5.4 · 2×4英文化=${imagePromptTranslator}`,
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

    throw new Error(`不支持的平台任务动作：${input.action}`);
  } catch (error) {
    console.error("[processPlatformJob] 实际错误详情:", error);
    throw new Error(getPlatformJobErrorMessage(error));
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
  if (type === "video") return processVideoJob(input, timeoutMs, userId);
  if (type === "image") return processImageJob(input, timeoutMs, userId);
  if (type === "platform") return processPlatformJob(input, jobId, userId);
  if (type === "pdf_export") return processPdfExportJob(inputRaw, userId, jobId);
  return processAudioJob(input, timeoutMs, userId);
}

async function processOneJob() {
  await reapStaleJobsOnce();
  const job = await claimNextQueuedJob();
  if (!job) return false;

  try {
    const jobType = job.type as JobType;
    const timeoutMs = resolveJobTimeoutMs(jobType, job.input);
    const { output, provider } = await withTimeout(
      executeJob(jobType, job.input, timeoutMs, String(job.userId), job.id),
      timeoutMs,
      `${job.type} job timed out after ${timeoutMs}ms`
    );
    await markJobSucceeded(job.id, output, provider);
  } catch (error) {
    const message = getJobFailureMessage(job.type as JobType, error);
    if ((job.attempts ?? 0) < 2) {
      await requeueJob(job.id, message);
    } else {
      await markJobFailed(job.id, message);
    }
  }

  return true;
}

async function processOnePdfExportJob(): Promise<boolean> {
  await reapStaleJobsOnce();
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
  timer = setInterval(() => {
    void processJobsOnce();
  }, 1_000);
  pdfTimer = setInterval(() => {
    void processPdfJobsOnce();
  }, 3_000);

  if (typeof timer.unref === "function") {
    timer.unref();
  }
  if (pdfTimer && typeof pdfTimer.unref === "function") {
    pdfTimer.unref();
  }
}

export function stopJobWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  if (pdfTimer) clearInterval(pdfTimer);
  pdfTimer = null;
  workerStarted = false;
}
