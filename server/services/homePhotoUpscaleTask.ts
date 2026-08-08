/**
 * 首页照片高清放大：异步任务（落盘 + 短轮询 + 部署后续跑）。
 *
 * 根因：原先 tRPC 同步等 Gemini 2K/4K，客户端/SDK 120s abort 或 Fly 部署 SIGINT
 * 会直接掐断，前端停住且无结果。现改为：扣费 → 立刻返回 taskId → 后台跑 Gemini →
 * 状态接口短轮询；进程被杀后启动时可按落盘记录续跑（重试上游）。
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { imageUpscaleTotalCredits } from "../../shared/plans.js";
import { isHomePhotoResultBrowserReadable } from "../../shared/homePhotoTools.js";
import { getUserPlan, refundCredits } from "../credits.js";
import { recordCreation } from "../routers/creations.js";
import {
  heartbeatActiveJob,
  registerActiveJob,
  refundCreditsOnFailure,
  unregisterActiveJob,
} from "./paidJobLedger.js";
import {
  isGeminiApiImageUpscaleConfigured,
  runGeminiApiImageUpscale,
  type GeminiApiUpscaleFactor,
} from "./geminiApiImageUpscale.js";

const TASK_TYPE = "homePhotoUpscale" as const;
const PRIMARY_DIR =
  process.env.HOME_PHOTO_UPSCALE_TASK_DIR || "/data/growth/home-photo-upscale";
/** 整单墙钟上限（含部署后重试） */
const MAX_WALL_MS = 15 * 60_000;
/** 部署中断后最多再跑几次 Gemini */
const MAX_ATTEMPTS = 3;
const WORKER_TICK_MS = 5_000;
const HEARTBEAT_MS = 30_000;

export type HomePhotoUpscaleTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export type HomePhotoUpscaleTaskRecord = {
  taskId: string;
  userId: number;
  status: HomePhotoUpscaleTaskStatus;
  creditsCharged: number;
  imageUrl: string;
  upscaleFactor: GeminiApiUpscaleFactor;
  qualityWarningAccepted?: boolean;
  sourceBlurScore?: number;
  resultImageUrl?: string;
  inputWidth?: number;
  inputHeight?: number;
  outputWidth?: number;
  outputHeight?: number;
  attempts: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

let resolvedDir: string | null = null;
const inflight = new Set<string>();
let workerTimer: NodeJS.Timeout | null = null;

function resolveImageUrlForServerFetch(imageUrl: string): string {
  const u = String(imageUrl || "").trim();
  if (!u) return u;
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  const base = String(
    process.env.OAUTH_SERVER_URL || process.env.PUBLIC_APP_URL || "",
  ).replace(/\/$/, "");
  if (u.startsWith("/") && base) return `${base}${u}`;
  return u;
}

async function persistHomePhotoSignedImage(
  sourceUrl: string,
  keyPrefix: string,
): Promise<string> {
  const url = String(sourceUrl || "").trim();
  if (!url) return url;
  if (!/[?&]X-Goog-(?:Signature|Algorithm)=/i.test(url)) return url;
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`download HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 64 * 1024 * 1024) {
      throw new Error(`invalid image bytes=${buffer.length}`);
    }
    const safePrefix =
      String(keyPrefix || "result")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .slice(0, 48) || "result";
    const { uploadBufferToPlatformStorage } = await import("./evolinkGptImage2.js");
    const persisted = await uploadBufferToPlatformStorage(
      buffer,
      `home_photo_${safePrefix}`,
    );
    const out = String(persisted || "").trim();
    if (isHomePhotoResultBrowserReadable(out)) return out;
    return isHomePhotoResultBrowserReadable(url) ? url : out;
  } catch (error) {
    console.error("[homePhotoUpscaleTask] persistSignedImage failed", error);
    return url;
  }
}

function assertHomePhotoResultBrowserReadable(imageUrl: string): string {
  const url = String(imageUrl || "").trim();
  if (!isHomePhotoResultBrowserReadable(url)) {
    throw new Error("home_photo_result_url_not_browser_readable");
  }
  return url;
}

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
    const fallback = path.join(os.tmpdir(), "mvstudiopro-home-photo-upscale");
    console.warn(
      `[homePhotoUpscaleTask] primary dir unavailable, fallback=${fallback}`,
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

async function writeTask(record: HomePhotoUpscaleTaskRecord): Promise<void> {
  const dir = await getTaskDir();
  const file = taskPath(dir, record.taskId);
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  record.updatedAt = new Date().toISOString();
  await fs.writeFile(tmp, JSON.stringify(record, null, 2));
  await fs.rename(tmp, file);
}

async function readTask(taskId: string): Promise<HomePhotoUpscaleTaskRecord | null> {
  const dir = await getTaskDir();
  try {
    const raw = await fs.readFile(taskPath(dir, taskId), "utf8");
    return JSON.parse(raw) as HomePhotoUpscaleTaskRecord;
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

async function failTask(
  task: HomePhotoUpscaleTaskRecord,
  error: string,
): Promise<HomePhotoUpscaleTaskRecord> {
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
        "照片高清放大失败·退回已扣积分",
      ).catch(() => {});
    }
  });
  return task;
}

async function succeedTask(
  task: HomePhotoUpscaleTaskRecord,
  imageUrl: string,
  dims: {
    inputWidth?: number;
    inputHeight?: number;
    outputWidth?: number;
    outputHeight?: number;
  },
): Promise<HomePhotoUpscaleTaskRecord> {
  task.status = "succeeded";
  task.resultImageUrl = imageUrl;
  task.inputWidth = dims.inputWidth;
  task.inputHeight = dims.inputHeight;
  task.outputWidth = dims.outputWidth;
  task.outputHeight = dims.outputHeight;
  task.finishedAt = new Date().toISOString();
  task.error = undefined;
  await writeTask(task);
  await unregisterActiveJob(task.taskId, TASK_TYPE, "settled").catch(() => {});

  try {
    const plan = await getUserPlan(task.userId);
    await recordCreation({
      userId: task.userId,
      type: "photo_upscale_image",
      title: `照片高清放大 ${task.upscaleFactor === "x4" ? "4×" : "2×"}`,
      outputUrl: imageUrl,
      thumbnailUrl: imageUrl,
      quality: task.upscaleFactor === "x4" ? "4×" : "2×",
      creditsUsed: task.creditsCharged,
      plan,
      metadata: {
        sourceImageUrl: task.imageUrl,
        upscaleFactor: task.upscaleFactor,
        inputWidth: dims.inputWidth,
        inputHeight: dims.inputHeight,
        outputWidth: dims.outputWidth,
        outputHeight: dims.outputHeight,
        qualityWarningAccepted: task.qualityWarningAccepted === true,
        sourceBlurScore: task.sourceBlurScore,
        tool: "home_photo_upscale",
        taskId: task.taskId,
      },
    });
  } catch (error) {
    console.error("[homePhotoUpscaleTask] recordCreation failed", error);
  }
  return task;
}

async function advanceTask(taskId: string): Promise<HomePhotoUpscaleTaskRecord | null> {
  if (inflight.has(taskId)) {
    return readTask(taskId);
  }
  inflight.add(taskId);
  try {
    const task = await readTask(taskId);
    if (!task) return null;
    if (task.status === "succeeded" || task.status === "failed") return task;

    const createdMs = Date.parse(task.createdAt) || Date.now();
    if (Date.now() - createdMs > MAX_WALL_MS) {
      return failTask(
        task,
        `高清放大超时（${Math.round(MAX_WALL_MS / 60_000)} 分钟）`,
      );
    }

    if (!isGeminiApiImageUpscaleConfigured()) {
      return failTask(task, "高清放大服务暂不可用，请稍后重试");
    }

    if (task.attempts >= MAX_ATTEMPTS) {
      return failTask(task, "高清放大多次失败，请稍后重试");
    }

    task.status = "running";
    task.startedAt = task.startedAt || new Date().toISOString();
    task.attempts += 1;
    await writeTask(task);
    await heartbeatActiveJob(task.taskId, TASK_TYPE).catch(() => {});

    const heartbeat = setInterval(() => {
      void heartbeatActiveJob(task.taskId, TASK_TYPE).catch(() => {});
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    try {
      const result = await runGeminiApiImageUpscale({
        imageUrl: resolveImageUrlForServerFetch(task.imageUrl),
        upscaleFactor: task.upscaleFactor,
      });
      let imageUrl = String(result.imageUrl || "").trim();
      if (!result.ok || !imageUrl) {
        const err = String(result.error || "放大失败");
        // 可重试错误（超时/中断）且未超次数：回到 queued 等 worker 再跑
        if (
          task.attempts < MAX_ATTEMPTS &&
          /abort|timeout|aborted|ETIMEDOUT|ECONNRESET|socket hang up/i.test(err)
        ) {
          task.status = "queued";
          task.error = `第 ${task.attempts} 次未完成：${err.slice(0, 160)}`;
          await writeTask(task);
          console.warn(
            `[homePhotoUpscaleTask] retryable failure taskId=${task.taskId} attempt=${task.attempts}`,
            err,
          );
          return task;
        }
        return failTask(task, err);
      }

      imageUrl = assertHomePhotoResultBrowserReadable(
        await persistHomePhotoSignedImage(
          imageUrl,
          task.upscaleFactor === "x4" ? "upscale-4x" : "upscale-2x",
        ),
      );

      return succeedTask(task, imageUrl, {
        inputWidth: result.inputWidth,
        inputHeight: result.inputHeight,
        outputWidth: result.outputWidth,
        outputHeight: result.outputHeight,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "高清放大失败";
      if (
        task.attempts < MAX_ATTEMPTS &&
        /abort|timeout|aborted|ETIMEDOUT|ECONNRESET|socket hang up/i.test(message)
      ) {
        task.status = "queued";
        task.error = `第 ${task.attempts} 次未完成：${message.slice(0, 160)}`;
        await writeTask(task);
        return task;
      }
      return failTask(task, message);
    } finally {
      clearInterval(heartbeat);
    }
  } finally {
    inflight.delete(taskId);
  }
}

export async function createHomePhotoUpscaleTask(input: {
  userId: number;
  creditsCharged: number;
  imageUrl: string;
  upscaleFactor: GeminiApiUpscaleFactor;
  qualityWarningAccepted?: boolean;
  sourceBlurScore?: number;
}): Promise<HomePhotoUpscaleTaskRecord> {
  if (!isGeminiApiImageUpscaleConfigured()) {
    throw new Error("高清放大服务暂不可用，请稍后重试");
  }
  const factor = input.upscaleFactor;
  if (factor !== "x2" && factor !== "x4") {
    throw new Error("仅支持 2× 或 4× 高清放大");
  }
  const expected = imageUpscaleTotalCredits("homePhotoUpscaleBase", factor);
  if (input.creditsCharged > 0 && input.creditsCharged !== expected) {
    console.warn(
      `[homePhotoUpscaleTask] credits mismatch charged=${input.creditsCharged} expected=${expected}`,
    );
  }

  const imageUrl = String(input.imageUrl || "").trim();
  if (!imageUrl) throw new Error("请先上传一张照片");

  const taskId = `hpu_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const task: HomePhotoUpscaleTaskRecord = {
    taskId,
    userId: input.userId,
    status: "queued",
    creditsCharged: Math.max(0, Number(input.creditsCharged) || 0),
    imageUrl,
    upscaleFactor: factor,
    qualityWarningAccepted: input.qualityWarningAccepted === true,
    sourceBlurScore: input.sourceBlurScore,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  await writeTask(task);
  await registerActiveJob({
    jobId: taskId,
    taskType: TASK_TYPE,
    userId: input.userId,
    creditsBilled: task.creditsCharged,
    action: `首页照片高清放大（${factor === "x4" ? "4×" : "2×"}）`,
    externalApiCostHint: "gemini api image upscale",
    metadata: {
      imageUrl: task.imageUrl.slice(0, 200),
      upscaleFactor: task.upscaleFactor,
    },
  }).catch((error) => {
    console.warn("[homePhotoUpscaleTask] registerActiveJob failed", error);
  });

  void advanceTask(taskId).catch((error) => {
    console.error("[homePhotoUpscaleTask] initial advance failed", error);
  });
  ensureHomePhotoUpscaleWorker();
  return (await readTask(taskId)) || task;
}

export async function getHomePhotoUpscaleTask(
  taskId: string,
  userId: number,
): Promise<HomePhotoUpscaleTaskRecord | null> {
  const task = await readTask(String(taskId || "").trim());
  if (!task || task.userId !== userId) return null;
  // 仅 queued 时由查询触发推进；running 交给 worker/startup，避免短轮询叠跑 Gemini
  if (task.status === "queued") {
    return (await advanceTask(task.taskId)) || task;
  }
  return task;
}

export function ensureHomePhotoUpscaleWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void (async () => {
      const ids = await listActiveTaskIds();
      for (const id of ids) {
        await advanceTask(id).catch((error) => {
          console.warn("[homePhotoUpscaleTask] worker tick failed", id, error);
        });
      }
    })();
  }, WORKER_TICK_MS);
  workerTimer.unref?.();
}

export async function resumeHomePhotoUpscaleTasksOnStartup(): Promise<void> {
  ensureHomePhotoUpscaleWorker();
  const ids = await listActiveTaskIds();
  if (!ids.length) {
    console.log("[homePhotoUpscaleTask] startup: no active tasks");
    return;
  }
  console.log(`[homePhotoUpscaleTask] startup: resume ${ids.length} task(s)`);
  for (const id of ids) {
    await advanceTask(id).catch((error) => {
      console.warn("[homePhotoUpscaleTask] startup resume failed", id, error);
    });
  }
}
