/**
 * 画布成片异步任务（Seedance OpenRouter / Hailuo / Happy Horse /
 * Seedance 2.5 BytePlus 主路径 + EvoLink fallback）。
 *
 * 原先 seedanceI2V / hailuo3Video 单条 HTTP 同步等上游数分钟，部署 SIGINT 会掐断。
 * 现：扣费 → 提交上游 → 立刻返回 taskId → worker/status 短轮询 → 镜像可读 URL。
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { refundCredits } from "../credits.js";
import {
  heartbeatActiveJob,
  registerActiveJob,
  refundCreditsOnFailure,
  unregisterActiveJob,
} from "./paidJobLedger.js";
import { buildOpenRouterSeedanceSubmitBody } from "./openrouterSeedanceVideo.js";
import { buildOpenRouterHailuoSubmitBody } from "./openrouterHailuoVideo.js";
import { buildOpenRouterHappyHorseSubmitBody } from "./openrouterHappyHorseVideo.js";
import { getOpenRouterApiKey } from "./openrouterGptImage2.js";
import {
  mirrorOpenRouterVideoSourceUrl,
  OPENROUTER_VIDEO_MAX_POLL_MS,
  OPENROUTER_VIDEO_POLL_INTERVAL_MS,
  pollOpenRouterVideoJobOnce,
  submitOpenRouterVideoJob,
} from "./openrouterVideoCore.js";
import {
  BYTEPLUS_SEEDANCE_MAX_POLL_MS,
  isByteplusFallbackableError,
  isByteplusSeedanceConfigured,
  pollByteplusVideoTaskOnce,
  submitByteplusSeedance25Video,
} from "./byteplusSeedanceVideo.js";
import {
  EVOLINK_SEEDANCE_MAX_POLL_MS,
  EVOLINK_SEEDANCE_POLL_INTERVAL_MS,
  isEvolinkSeedanceConfigured,
  pollEvolinkVideoTaskOnce,
  submitEvolinkSeedanceVideo,
  type EvolinkSeedanceRunInput,
} from "./evolinkSeedanceVideo.js";
import { mirrorSeedanceMp4ToGcsSignedUrl } from "./seedanceVideo.js";
import type { SeedanceEvolinkMode } from "../../shared/seedanceEvolinkModels.js";

const TASK_TYPE = "canvasVideo" as const;
const PRIMARY_DIR =
  process.env.CANVAS_VIDEO_TASK_DIR || "/data/growth/canvas-video";

export type CanvasVideoEngine =
  | "seedance-openrouter"
  | "hailuo-openrouter"
  | "happyhorse-openrouter"
  | "seedance25-byteplus"
  | "seedance25-evolink"
  /** Seedance 2.0 Mini 草稿档：EvoLink 单路径（OpenRouter 没有 mini） */
  | "seedance-mini-evolink";

export type CanvasVideoTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export type CanvasVideoTaskRecord = {
  taskId: string;
  userId: number;
  status: CanvasVideoTaskStatus;
  creditsCharged: number;
  engine: CanvasVideoEngine;
  label: string;
  prompt: string;
  imageUrl?: string;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  aspectRatio: string;
  duration: number;
  resolution?: string;
  generateAudio: boolean;
  /** OpenRouter Seedance 2.0 / 2.0-fast；EvoLink Mini 记 2.0-mini */
  seedanceVersion?: "2.0" | "2.0-fast" | "2.0-mini";
  /** Seedance 2.5 工作模式 */
  workMode?: SeedanceEvolinkMode;
  openRouterJobId?: string;
  pollingUrl?: string;
  evolinkTaskId?: string;
  /** BytePlus ModelArk contents/generations task id */
  byteplusTaskId?: string;
  /** 若从 BytePlus 回落到 EvoLink，记下原因摘要 */
  fallbackReason?: string;
  model?: string;
  provider?: string;
  videoUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

/** 画布 Seedance 2.5：有 BytePlus Key 则主路径；否则 EvoLink。 */
export function resolveSeedance25CanvasEngine(): CanvasVideoEngine {
  if (isByteplusSeedanceConfigured()) return "seedance25-byteplus";
  return "seedance25-evolink";
}

let resolvedDir: string | null = null;
const inflight = new Set<string>();
let workerTimer: NodeJS.Timeout | null = null;

async function getTaskDir(): Promise<string> {
  if (resolvedDir) return resolvedDir;
  try {
    await fs.mkdir(PRIMARY_DIR, { recursive: true });
    const probe = path.join(PRIMARY_DIR, ".write-probe");
    await fs.writeFile(probe, String(Date.now()));
    await fs.unlink(probe).catch(() => {});
    resolvedDir = PRIMARY_DIR;
    return resolvedDir;
  } catch (error) {
    const fallback = path.join(os.tmpdir(), "mvstudiopro-canvas-video");
    console.warn(
      `[canvasVideoTask] primary dir unavailable, fallback=${fallback}`,
      error instanceof Error ? error.message : error,
    );
    await fs.mkdir(fallback, { recursive: true });
    resolvedDir = fallback;
    return resolvedDir;
  }
}

function taskPath(dir: string, taskId: string): string {
  const safe = String(taskId).replace(/[^a-zA-Z0-9_.-]+/g, "_");
  return path.join(dir, `${safe}.json`);
}

async function writeTask(record: CanvasVideoTaskRecord): Promise<void> {
  const dir = await getTaskDir();
  const file = taskPath(dir, record.taskId);
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  record.updatedAt = new Date().toISOString();
  await fs.writeFile(tmp, JSON.stringify(record, null, 2));
  await fs.rename(tmp, file);
}

async function readTask(taskId: string): Promise<CanvasVideoTaskRecord | null> {
  const dir = await getTaskDir();
  try {
    const raw = await fs.readFile(taskPath(dir, taskId), "utf8");
    return JSON.parse(raw) as CanvasVideoTaskRecord;
  } catch {
    return null;
  }
}

async function listActiveTaskIds(): Promise<string[]> {
  const dir = await getTaskDir();
  try {
    const names = await fs.readdir(dir);
    const ids: string[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const taskId = name.slice(0, -".json".length);
      const task = await readTask(taskId);
      if (task && (task.status === "queued" || task.status === "running")) {
        ids.push(taskId);
      }
    }
    return ids;
  } catch {
    return [];
  }
}

function maxPollMs(engine: CanvasVideoEngine): number {
  if (engine === "seedance25-evolink" || engine === "seedance25-byteplus") {
    return Math.max(EVOLINK_SEEDANCE_MAX_POLL_MS, BYTEPLUS_SEEDANCE_MAX_POLL_MS);
  }
  if (engine === "seedance-mini-evolink") return EVOLINK_SEEDANCE_MAX_POLL_MS;
  return OPENROUTER_VIDEO_MAX_POLL_MS;
}

/** 走 EvoLink 任务号轮询的引擎（2.5 与 Mini 共用同一套 submit/poll） */
function usesEvolinkTaskId(engine: CanvasVideoEngine): boolean {
  return engine === "seedance25-evolink" || engine === "seedance-mini-evolink";
}

function seedance25RunInput(task: CanvasVideoTaskRecord): EvolinkSeedanceRunInput {
  return {
    prompt: task.prompt,
    imageUrl: task.imageUrl,
    imageUrls: task.imageUrls,
    videoUrls: task.videoUrls,
    audioUrls: task.audioUrls,
    quality: task.resolution,
    aspectRatio: task.aspectRatio,
    duration: task.duration,
    generateAudio: task.generateAudio,
    contentFilter: true,
    mode: task.workMode,
    version: "2.5",
  };
}

async function submitSeedance25Evolink(task: CanvasVideoTaskRecord): Promise<void> {
  const submitted = await submitEvolinkSeedanceVideo(seedance25RunInput(task));
  task.engine = "seedance25-evolink";
  task.evolinkTaskId = submitted.evolinkTaskId;
  task.model = submitted.model;
  task.workMode = submitted.mode;
  task.provider = "evolink";
  task.status = "running";
  task.startedAt = task.startedAt || new Date().toISOString();
  await writeTask(task);
  if (submitted.immediateSourceUrl) {
    const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(submitted.immediateSourceUrl);
    await succeedTask(task, videoUrl, submitted.model, "evolink");
  }
}

/**
 * Mini 草稿档提交。与 2.5 共用 EvoLink 提交/轮询，差别只在 version 与不做 BytePlus 主路径
 * ——BytePlus ModelArk 没有 mini 型号，回落无处可落，失败就按失败退费。
 */
async function submitSeedanceMiniEvolink(task: CanvasVideoTaskRecord): Promise<void> {
  const submitted = await submitEvolinkSeedanceVideo({
    prompt: task.prompt,
    imageUrl: task.imageUrl,
    imageUrls: task.imageUrls,
    videoUrls: task.videoUrls,
    audioUrls: task.audioUrls,
    quality: task.resolution,
    aspectRatio: task.aspectRatio,
    duration: task.duration,
    generateAudio: task.generateAudio,
    contentFilter: true,
    version: "2.0-mini",
  });
  task.evolinkTaskId = submitted.evolinkTaskId;
  task.model = submitted.model;
  task.provider = "evolink";
  task.status = "running";
  task.startedAt = task.startedAt || new Date().toISOString();
  await writeTask(task);
  if (submitted.immediateSourceUrl) {
    const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(submitted.immediateSourceUrl);
    await succeedTask(task, videoUrl, submitted.model, "evolink");
  }
}

async function submitSeedance25Byteplus(task: CanvasVideoTaskRecord): Promise<void> {
  try {
    const submitted = await submitByteplusSeedance25Video({
      prompt: task.prompt,
      imageUrl: task.imageUrl,
      imageUrls: task.imageUrls,
      videoUrls: task.videoUrls,
      audioUrls: task.audioUrls,
      aspectRatio: task.aspectRatio,
      duration: task.duration,
      resolution: task.resolution,
      generateAudio: task.generateAudio,
      watermark: false,
      mode: task.workMode,
    });
    task.engine = "seedance25-byteplus";
    task.byteplusTaskId = submitted.byteplusTaskId;
    task.model = submitted.model;
    task.workMode = submitted.mode;
    task.provider = "byteplus";
    task.status = "running";
    task.startedAt = task.startedAt || new Date().toISOString();
    await writeTask(task);
    if (submitted.immediateSourceUrl) {
      const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(submitted.immediateSourceUrl);
      await succeedTask(task, videoUrl, submitted.model, "byteplus");
    }
  } catch (error) {
    if (!isByteplusFallbackableError(error) || !isEvolinkSeedanceConfigured()) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[canvasVideoTask] BytePlus Seedance 2.5 提交失败，回落 EvoLink · task=${task.taskId} · ${reason}`,
    );
    task.fallbackReason = reason.slice(0, 200);
    task.byteplusTaskId = undefined;
    await writeTask(task);
    await submitSeedance25Evolink(task);
  }
}

async function failTask(
  task: CanvasVideoTaskRecord,
  error: string,
): Promise<CanvasVideoTaskRecord> {
  task.status = "failed";
  task.error = error.slice(0, 280);
  task.finishedAt = new Date().toISOString();
  await writeTask(task);
  await refundCreditsOnFailure(
    task.taskId,
    TASK_TYPE,
    "task_failed",
    task.error,
  ).catch(async () => {
    if (task.creditsCharged > 0) {
      await refundCredits(
        task.userId,
        task.creditsCharged,
        `${task.label}·生成失败退回`,
      ).catch(() => {});
    }
  });
  return task;
}

async function succeedTask(
  task: CanvasVideoTaskRecord,
  videoUrl: string,
  model: string,
  provider: string,
): Promise<CanvasVideoTaskRecord> {
  task.status = "succeeded";
  task.videoUrl = videoUrl;
  task.model = model;
  task.provider = provider;
  task.finishedAt = new Date().toISOString();
  task.error = undefined;
  await writeTask(task);
  await unregisterActiveJob(task.taskId, TASK_TYPE, "settled").catch(() => {});
  return task;
}

async function submitUpstream(task: CanvasVideoTaskRecord): Promise<void> {
  if (task.engine === "seedance-openrouter") {
    const body = buildOpenRouterSeedanceSubmitBody({
      variant: task.seedanceVersion === "2.0-fast" ? "2.0-fast" : "2.0",
      prompt: task.prompt,
      imageUrl: task.imageUrl,
      imageUrls: task.imageUrls,
      audioUrls: task.audioUrls,
      aspectRatio: task.aspectRatio,
      duration: task.duration,
      quality: task.resolution,
      generateAudio: task.generateAudio,
    });
    const submitted = await submitOpenRouterVideoJob(body);
    task.openRouterJobId = submitted.openRouterJobId;
    task.pollingUrl = submitted.pollingUrl;
    task.model = submitted.model;
    task.provider = "openrouter";
    task.status = "running";
    task.startedAt = task.startedAt || new Date().toISOString();
    await writeTask(task);
    if (submitted.immediateSourceUrl) {
      const videoUrl = await mirrorOpenRouterVideoSourceUrl(
        submitted.immediateSourceUrl,
        submitted.apiKey,
        { keyPrefix: "canvas-video/seedance", required: true },
      );
      await succeedTask(task, videoUrl, submitted.model, "openrouter");
    }
    return;
  }

  if (task.engine === "hailuo-openrouter") {
    const body = buildOpenRouterHailuoSubmitBody({
      prompt: task.prompt,
      imageUrl: task.imageUrl,
      imageUrls: task.imageUrls,
      aspectRatio: task.aspectRatio,
      duration: task.duration,
      generateAudio: task.generateAudio,
    });
    const submitted = await submitOpenRouterVideoJob(body);
    task.openRouterJobId = submitted.openRouterJobId;
    task.pollingUrl = submitted.pollingUrl;
    task.model = submitted.model;
    task.provider = "openrouter";
    task.status = "running";
    task.startedAt = task.startedAt || new Date().toISOString();
    await writeTask(task);
    if (submitted.immediateSourceUrl) {
      const videoUrl = await mirrorOpenRouterVideoSourceUrl(
        submitted.immediateSourceUrl,
        submitted.apiKey,
        { keyPrefix: "canvas-video/hailuo", required: true },
      );
      await succeedTask(task, videoUrl, submitted.model, "openrouter");
    }
    return;
  }

  if (task.engine === "happyhorse-openrouter") {
    const imageUrl = String(task.imageUrl || task.imageUrls?.[0] || "").trim();
    if (!imageUrl) throw new Error("Happy Horse 成片需要至少一张首帧参考图");
    const body = buildOpenRouterHappyHorseSubmitBody({
      prompt: task.prompt,
      imageUrl,
      aspectRatio: task.aspectRatio,
      duration: task.duration,
      resolution: task.resolution || "720p",
    });
    const submitted = await submitOpenRouterVideoJob(body);
    task.openRouterJobId = submitted.openRouterJobId;
    task.pollingUrl = submitted.pollingUrl;
    task.model = submitted.model;
    task.provider = "openrouter";
    task.status = "running";
    task.startedAt = task.startedAt || new Date().toISOString();
    await writeTask(task);
    if (submitted.immediateSourceUrl) {
      const videoUrl = await mirrorOpenRouterVideoSourceUrl(
        submitted.immediateSourceUrl,
        submitted.apiKey,
        { keyPrefix: "canvas-video/happyhorse", required: true },
      );
      await succeedTask(task, videoUrl, submitted.model, "openrouter");
    }
    return;
  }

  if (task.engine === "seedance25-byteplus") {
    await submitSeedance25Byteplus(task);
    return;
  }

  if (task.engine === "seedance-mini-evolink") {
    await submitSeedanceMiniEvolink(task);
    return;
  }

  // seedance25-evolink
  await submitSeedance25Evolink(task);
}

async function advanceTask(taskId: string): Promise<CanvasVideoTaskRecord | null> {
  if (inflight.has(taskId)) return readTask(taskId);
  inflight.add(taskId);
  try {
    const task = await readTask(taskId);
    if (!task) return null;
    if (task.status === "succeeded" || task.status === "failed") return task;

    await heartbeatActiveJob(task.taskId, TASK_TYPE).catch(() => {});

    const createdMs = Date.parse(task.createdAt) || Date.now();
    if (Date.now() - createdMs > maxPollMs(task.engine)) {
      return failTask(
        task,
        `视频生成超时（${Math.round(maxPollMs(task.engine) / 60_000)} 分钟）`,
      );
    }

    const needsSubmit = usesEvolinkTaskId(task.engine)
      ? !task.evolinkTaskId
      : task.engine === "seedance25-byteplus"
        ? !task.byteplusTaskId
        : !task.pollingUrl;

    if (needsSubmit) {
      try {
        await submitUpstream(task);
        const after = await readTask(taskId);
        if (after?.status === "succeeded" || after?.status === "failed") {
          return after;
        }
      } catch (error) {
        return failTask(
          task,
          error instanceof Error ? error.message : "成片创建失败",
        );
      }
    }

    const current = (await readTask(taskId)) || task;
    if (current.status === "succeeded" || current.status === "failed") {
      return current;
    }

    try {
      if (current.engine === "seedance25-byteplus") {
        if (!current.byteplusTaskId) {
          return failTask(current, "视频服务未返回任务编号");
        }
        const snap = await pollByteplusVideoTaskOnce(
          current.byteplusTaskId,
          `Seedance ${current.seedanceVersion || "2.5"}`,
        );
        if (snap.state === "running") {
          current.status = "running";
          await writeTask(current);
          return current;
        }
        if (snap.state === "failed") {
          // 上游跑挂：若还可回落且尚未提交过 EvoLink，切引擎重提（不重复扣费）
          if (isEvolinkSeedanceConfigured() && !current.evolinkTaskId) {
            const reason = snap.error;
            console.warn(
              `[canvasVideoTask] BytePlus 任务失败，回落 EvoLink · task=${current.taskId} · ${reason}`,
            );
            current.fallbackReason = reason.slice(0, 200);
            current.byteplusTaskId = undefined;
            current.engine = "seedance25-evolink";
            current.status = "queued";
            await writeTask(current);
            try {
              await submitSeedance25Evolink(current);
              const after = await readTask(taskId);
              return after || current;
            } catch (error) {
              return failTask(
                current,
                error instanceof Error ? error.message : reason,
              );
            }
          }
          return failTask(current, snap.error);
        }
        const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(snap.sourceUrl);
        return succeedTask(
          current,
          videoUrl,
          current.model || "dreamina-seedance-2-5",
          "byteplus",
        );
      }

      if (usesEvolinkTaskId(current.engine)) {
        const isMini = current.engine === "seedance-mini-evolink";
        if (!current.evolinkTaskId) {
          return failTask(current, "视频服务未返回任务编号");
        }
        const snap = await pollEvolinkVideoTaskOnce(
          current.evolinkTaskId,
          `Seedance ${current.seedanceVersion || (isMini ? "2.0-mini" : "2.5")}`,
        );
        if (snap.state === "running") {
          current.status = "running";
          await writeTask(current);
          return current;
        }
        if (snap.state === "failed") return failTask(current, snap.error);
        const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(snap.sourceUrl);
        return succeedTask(
          current,
          videoUrl,
          current.model || (isMini ? "seedance-2.0-mini" : "seedance-2.5"),
          "evolink",
        );
      }

      if (!current.pollingUrl) {
        return failTask(current, "视频服务未返回任务查询地址");
      }
      const apiKey = getOpenRouterApiKey();
      if (!apiKey) return failTask(current, "视频服务暂不可用，请稍后重试");

      const snap = await pollOpenRouterVideoJobOnce(current.pollingUrl, apiKey);
      if (snap.state === "running") {
        current.status = "running";
        await writeTask(current);
        return current;
      }
      if (snap.state === "failed") return failTask(current, snap.error);

      const keyPrefix =
        current.engine === "hailuo-openrouter"
          ? "canvas-video/hailuo"
          : current.engine === "happyhorse-openrouter"
            ? "canvas-video/happyhorse"
            : "canvas-video/seedance";
      const videoUrl = await mirrorOpenRouterVideoSourceUrl(
        snap.sourceUrl,
        apiKey,
        { keyPrefix, required: true },
      );
      return succeedTask(
        current,
        videoUrl,
        current.model || "openrouter-video",
        "openrouter",
      );
    } catch (error) {
      return failTask(
        current,
        error instanceof Error ? error.message : "成片生成失败",
      );
    }
  } finally {
    inflight.delete(taskId);
  }
}

export async function createCanvasVideoTask(input: {
  userId: number;
  creditsCharged: number;
  engine: CanvasVideoEngine;
  label: string;
  prompt: string;
  imageUrl?: string;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  aspectRatio?: string;
  duration: number;
  resolution?: string;
  generateAudio?: boolean;
  seedanceVersion?: "2.0" | "2.0-fast" | "2.0-mini";
  workMode?: SeedanceEvolinkMode;
}): Promise<CanvasVideoTaskRecord> {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("请填写视频提示词");

  const taskId = `cv_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const task: CanvasVideoTaskRecord = {
    taskId,
    userId: input.userId,
    status: "queued",
    creditsCharged: Math.max(0, Number(input.creditsCharged) || 0),
    engine: input.engine,
    label: String(input.label || "画布成片").slice(0, 120),
    prompt,
    imageUrl: input.imageUrl,
    imageUrls: input.imageUrls,
    videoUrls: input.videoUrls,
    audioUrls: input.audioUrls,
    aspectRatio: String(input.aspectRatio || "16:9").trim() || "16:9",
    duration: Number(input.duration) || 15,
    resolution: input.resolution,
    generateAudio: input.generateAudio !== false,
    seedanceVersion: input.seedanceVersion,
    workMode: input.workMode,
    createdAt: now,
    updatedAt: now,
  };
  await writeTask(task);
  await registerActiveJob({
    jobId: taskId,
    taskType: TASK_TYPE,
    userId: input.userId,
    creditsBilled: task.creditsCharged,
    action: task.label,
    externalApiCostHint: task.engine,
    metadata: {
      engine: task.engine,
      duration: task.duration,
      resolution: task.resolution,
    },
  }).catch((error) => {
    console.warn("[canvasVideoTask] registerActiveJob failed", error);
  });

  void advanceTask(taskId).catch((error) => {
    console.error("[canvasVideoTask] initial advance failed", error);
  });
  ensureCanvasVideoWorker();
  return (await readTask(taskId)) || task;
}

export async function getCanvasVideoTask(
  taskId: string,
  userId: number,
): Promise<CanvasVideoTaskRecord | null> {
  const task = await readTask(String(taskId || "").trim());
  if (!task || task.userId !== userId) return null;
  if (task.status === "queued" || task.status === "running") {
    return (await advanceTask(task.taskId)) || task;
  }
  return task;
}

export function ensureCanvasVideoWorker(): void {
  if (workerTimer) return;
  const tickMs = Math.min(
    OPENROUTER_VIDEO_POLL_INTERVAL_MS,
    EVOLINK_SEEDANCE_POLL_INTERVAL_MS,
  );
  workerTimer = setInterval(() => {
    void (async () => {
      const ids = await listActiveTaskIds();
      for (const id of ids) {
        await advanceTask(id).catch((error) => {
          console.warn("[canvasVideoTask] worker tick failed", id, error);
        });
      }
    })();
  }, Math.max(3_000, tickMs));
  workerTimer.unref?.();
}

export async function resumeCanvasVideoTasksOnStartup(): Promise<void> {
  ensureCanvasVideoWorker();
  const ids = await listActiveTaskIds();
  if (!ids.length) {
    console.log("[canvasVideoTask] startup: no active tasks");
    return;
  }
  console.log(`[canvasVideoTask] startup: resume ${ids.length} task(s)`);
  for (const id of ids) {
    await advanceTask(id).catch((error) => {
      console.warn("[canvasVideoTask] startup resume failed", id, error);
    });
  }
}
