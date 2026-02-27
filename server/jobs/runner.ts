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
import { generateImage } from "../_core/imageGeneration";
import { appRouter } from "../routers";
import { getDb } from "../db";
import { users, type User } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  claimNextQueuedJob,
  markJobFailed,
  markJobSucceeded,
  requeueJob,
  type JobType,
} from "./repository";

const JOB_TIMEOUT_MS: Record<JobType, number> = {
  image: 12_000,
  audio: 20_000,
  video: 30_000,
};

const POLL_INTERVAL_MS = 2_000;

const SUNO_API_BASE = process.env.SUNO_API_BASE || "https://api.sunoapi.org";
const SUNO_API_KEY = process.env.SUNO_API_KEY || "";

let klingInitialized = false;
let workerStarted = false;
let processing = false;
let timer: NodeJS.Timeout | null = null;

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

async function processVideoJob(input: JobEnvelope, timeoutMs: number): Promise<{ output: unknown; provider?: string }> {
  ensureKlingInitialized();
  const params = input.params ?? {};

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

    const fallback = await withTimeout(
      generateImage({
        prompt,
        originalImages: referenceImageUrl
          ? [{ url: referenceImageUrl, mimeType: "image/jpeg" }]
          : undefined,
      }),
      timeoutMs,
      `Image job timed out after ${timeoutMs}ms`
    );
    if (!fallback.url) {
      throw new Error("Nano fallback image generation failed");
    }
    return {
      provider: "nano",
      output: {
        imageUrl: fallback.url,
        quality,
        fallback: true,
      },
    };
  }

  if (input.action === "virtual_idol") {
    const user = await resolveUserForJob(jobUserId);
    const caller = appRouter.createCaller({
      req: {} as any,
      res: {} as any,
      user,
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
      provider: quality.startsWith("kling") ? "kling-cn" : quality === "free" ? "forge" : "nano",
      output: result as any,
    };
  }

  throw new Error(`Unsupported image action: ${input.action}`);
}

async function callSunoAPI(endpoint: string, body: Record<string, unknown>) {
  if (!SUNO_API_KEY) {
    throw new Error("Suno API key not configured");
  }

  const response = await fetch(`${SUNO_API_BASE}/api/v1/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUNO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Suno API error (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const json = (await response.json()) as {
    code?: number;
    msg?: string;
    data?: Record<string, unknown>;
  };
  if (json.code !== 200 || !json.data) {
    throw new Error(`Suno API returned error: ${json.msg || "unknown error"}`);
  }
  return json.data;
}

async function getSunoTaskStatus(taskId: string) {
  if (!SUNO_API_KEY) {
    throw new Error("Suno API key not configured");
  }

  const response = await fetch(
    `${SUNO_API_BASE}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
    {
      headers: {
        Authorization: `Bearer ${SUNO_API_KEY}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Suno status error (${response.status})`);
  }

  const json = (await response.json()) as {
    code?: number;
    msg?: string;
    data?: Record<string, any>;
  };
  if (json.code !== 200 || !json.data) {
    throw new Error(`Suno status failed: ${json.msg || "unknown error"}`);
  }
  return json.data;
}

async function processAudioJob(input: JobEnvelope, timeoutMs: number): Promise<{ output: unknown; provider?: string }> {
  if (input.action !== "suno_music") {
    throw new Error(`Unsupported audio action: ${input.action}`);
  }

  const params = input.params ?? {};
  const mode = params.mode === "bgm" ? "bgm" : "theme_song";
  const model = params.model === "V5" ? "V5" : "V4";
  const title = String(params.title ?? "AI Generated Song");
  const lyrics = typeof params.lyrics === "string" ? params.lyrics : undefined;
  const customStyle = typeof params.customStyle === "string" ? params.customStyle : undefined;
  const mood = typeof params.mood === "string" ? params.mood : undefined;
  const callbackUrl = typeof params.callbackUrl === "string" ? params.callbackUrl : "";

  const submitPayload: Record<string, unknown> = {
    customMode: true,
    model,
    title,
    callBackUrl: callbackUrl,
  };

  if (mode === "theme_song") {
    if (!lyrics || lyrics.length === 0) {
      throw new Error("Theme song mode requires lyrics");
    }
    submitPayload.instrumental = false;
    submitPayload.prompt = lyrics;
    submitPayload.style = mood || "Pop, Emotional, Modern";
  } else {
    submitPayload.instrumental = true;
    submitPayload.style = customStyle || mood || "Cinematic, Emotional, Instrumental";
  }

  const created = await callSunoAPI("generate", submitPayload);
  const taskId = String(created.taskId ?? "");
  if (!taskId) throw new Error("Suno API did not return taskId");

  const startedAt = Date.now();
  let lastStatus: Record<string, any> | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    const status = await getSunoTaskStatus(taskId);
    lastStatus = status;
    const state = String(status.status ?? "");
    if (state === "SUCCESS" || state === "FIRST_SUCCESS") {
      const songs = Array.isArray(status.response?.data)
        ? status.response.data.map((song: Record<string, any>) => ({
            id: song.id,
            audioUrl: song.audio_url || song.stream_audio_url,
            streamUrl: song.stream_audio_url,
            imageUrl: song.image_url,
            title: song.title,
            tags: song.tags,
            duration: song.duration,
          }))
        : [];

      return {
        provider: "suno",
        output: {
          taskId,
          status: state,
          songs,
          model,
          mode,
          creditCost: model === "V5" ? 22 : 12,
        },
      };
    }
    if (state === "FAILED") {
      throw new Error(String(status.errorMessage || "Suno generation failed"));
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (lastStatus && String(lastStatus.status) === "SUCCESS") {
    return { provider: "suno", output: lastStatus };
  }
  throw new Error("Suno generation timeout");
}

async function executeJob(type: JobType, inputRaw: unknown, timeoutMs: number, userId: string): Promise<{ output: unknown; provider?: string }> {
  const input = asEnvelope(inputRaw);
  if (type === "video") return processVideoJob(input, timeoutMs);
  if (type === "image") return processImageJob(input, timeoutMs, userId);
  return processAudioJob(input, timeoutMs);
}

async function processOneJob() {
  const job = await claimNextQueuedJob();
  if (!job) return false;

  try {
    const timeoutMs = JOB_TIMEOUT_MS[job.type];
    const { output, provider } = await withTimeout(
      executeJob(job.type, job.input, timeoutMs, String(job.userId)),
      timeoutMs,
      `${job.type} job timed out after ${timeoutMs}ms`
    );
    await markJobSucceeded(job.id, output, provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown job error";
    if ((job.attempts ?? 0) < 2) {
      await requeueJob(job.id, message);
    } else {
      await markJobFailed(job.id, message);
    }
  }

  return true;
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
  timer = setInterval(() => {
    void processJobsOnce();
  }, 1_000);

  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

export function stopJobWorker() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  workerStarted = false;
}
