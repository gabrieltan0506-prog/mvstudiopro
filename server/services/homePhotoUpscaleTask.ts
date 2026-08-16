/**
 * 首页照片高清放大：异步任务（落盘 + 短轮询 + 部署后续跑）。
 *
 * 根因：原先 tRPC 同步等 Gemini 2K/4K，客户端/SDK 120s abort 或 Fly 部署 SIGINT
 * 会直接掐断，前端停住且无结果。现改为：扣费 → 立刻返回 taskId → 后台跑供应商链 →
 * 状态接口短轮询。外部创建一旦开始便不在部署恢复时盲目重建；未确认结果按失败退款。
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
  hasRefundMarker,
  refundMarkerFor,
  canonicalRefundKey,
  markSettlementPending,
  type PaidJobDeductSnapshot,
} from "./paidJobLedger.js";
import {
  isImageUpscaleConfigured,
  runImageUpscaleWithFallback,
  type GeminiApiUpscaleFactor,
  type ImageUpscaleProvider,
} from "./geminiApiImageUpscale.js";
import {
  releaseHomePhotoUpscaleLease,
  tryAcquireHomePhotoUpscaleLease,
} from "./homePhotoUpscaleLease.js";

const TASK_TYPE = "homePhotoUpscale" as const;
const PRIMARY_DIR =
  process.env.HOME_PHOTO_UPSCALE_TASK_DIR || "/data/growth/home-photo-upscale";
/** 整单墙钟上限（含排队与一次外部创建） */
const MAX_WALL_MS = 15 * 60_000;
/** 外部请求结果可能已计费；整条 provider 链只允许创建一次，部署中断后不盲重建。 */
const MAX_ATTEMPTS = 1;
/** 比任务墙钟多留一倍：旧进程仍在收尾时，新进程不得误接管。 */
const LEASE_STALE_MS = MAX_WALL_MS * 2;
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
  /** 扣款来源快照：退款按同源退回（团队不退个人）；hold 丢失时兜底直退用 */
  deduct?: PaidJobDeductSnapshot;
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
  resultProvider?: ImageUpscaleProvider;
  resultModel?: string;
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
  // 第七轮 P0·3：必须消费返回值——hold 缺失（missing）时按 canonical 键同源直退，
  // 查真账防双退；账本抛错则保持待退等 reaper，不裸退不吞错
  try {
    const out = await refundCreditsOnFailure(task.taskId, TASK_TYPE, "task_failed", task.error);
    if (out.status === "missing" && !out.refunded && task.creditsCharged > 0) {
      const marker = refundMarkerFor(TASK_TYPE, task.taskId);
      const refundKey = canonicalRefundKey(TASK_TYPE, task.taskId);
      const seen = await hasRefundMarker(task.userId, marker);
      if (seen === false) {
        const d = task.deduct;
        const reason = `照片高清放大失败·退回已扣积分 ${marker}`;
        if (d?.source === "team" && d.teamId != null && d.teamMemberId != null) {
          const { refundCreditsForDeductAmount } = await import("../credits.js");
          await refundCreditsForDeductAmount(
            task.userId,
            reason,
            {
              success: true,
              cost: task.creditsCharged,
              remainingBalance: -1,
              source: "team",
              teamId: d.teamId,
              teamMemberId: d.teamMemberId,
            } as Awaited<ReturnType<typeof import("../credits.js")["deductCreditsAmount"]>>,
            "首页照片高清放大",
            { refundKey },
          );
        } else if (d?.source !== "admin" && d?.source !== "none") {
          await refundCredits(task.userId, task.creditsCharged, reason, { refundKey });
        }
      }
    }
  } catch (e) {
    console.error("[homePhotoUpscaleTask] 退款未完成（等 reaper 对账）", task.taskId, e);
  }
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
    provider?: ImageUpscaleProvider;
    model?: string;
  },
): Promise<HomePhotoUpscaleTaskRecord> {
  task.status = "succeeded";
  task.resultImageUrl = imageUrl;
  task.inputWidth = dims.inputWidth;
  task.inputHeight = dims.inputHeight;
  task.outputWidth = dims.outputWidth;
  task.outputHeight = dims.outputHeight;
  task.resultProvider = dims.provider;
  task.resultModel = dims.model;
  task.finishedAt = new Date().toISOString();
  task.error = undefined;
  await writeTask(task);
  try {
    await unregisterActiveJob(task.taskId, TASK_TYPE, "settled");
  } catch (e) {
    // 结算失败不许吞：转 settlement_pending，reaper 只补结算不退款（防成功单被误退）
    console.warn("[homePhotoUpscaleTask] settle 失败，转 settlement_pending", task.taskId, e);
    await markSettlementPending(task.taskId, TASK_TYPE);
  }

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
        provider: dims.provider,
        model: dims.model,
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
  const dir = await getTaskDir();
  const lease = await tryAcquireHomePhotoUpscaleLease({
    leasePath: `${taskPath(dir, taskId)}.lock`,
    staleAfterMs: LEASE_STALE_MS,
  });
  if (!lease) return readTask(taskId);
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

    if (!isImageUpscaleConfigured(task.upscaleFactor)) {
      return failTask(task, "高清放大服务暂不可用，请稍后重试");
    }

    if (task.attempts >= MAX_ATTEMPTS) {
      return failTask(
        task,
        "上次高清放大执行已中断；为避免重复创建外部任务，本次不自动重试",
      );
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
      const remainingWallMs = Math.max(1_000, MAX_WALL_MS - (Date.now() - createdMs));
      const result = await runImageUpscaleWithFallback({
        imageUrl: resolveImageUrlForServerFetch(task.imageUrl),
        upscaleFactor: task.upscaleFactor,
        abortSignal: AbortSignal.timeout(remainingWallMs),
      });
      let imageUrl = String(result.imageUrl || "").trim();
      if (!result.ok || !imageUrl) {
        const err = String(result.error || "放大失败");
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
        provider: result.provider,
        model: result.model,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "高清放大失败";
      return failTask(task, message);
    } finally {
      clearInterval(heartbeat);
    }
  } finally {
    inflight.delete(taskId);
    await releaseHomePhotoUpscaleLease(lease).catch((error) => {
      console.error("[homePhotoUpscaleTask] release lease failed", taskId, error);
    });
  }
}

export async function createHomePhotoUpscaleTask(input: {
  userId: number;
  creditsCharged: number;
  /** 扣款来源快照（API 扣费时生成），必须透传进任务与账本 */
  deduct?: PaidJobDeductSnapshot;
  imageUrl: string;
  upscaleFactor: GeminiApiUpscaleFactor;
  qualityWarningAccepted?: boolean;
  sourceBlurScore?: number;
}): Promise<HomePhotoUpscaleTaskRecord> {
  if (!isImageUpscaleConfigured(input.upscaleFactor)) {
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
    deduct: input.deduct,
    imageUrl,
    upscaleFactor: factor,
    qualityWarningAccepted: input.qualityWarningAccepted === true,
    sourceBlurScore: input.sourceBlurScore,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  await writeTask(task);
  try {
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
      deduct: input.deduct,
    });
  } catch (error) {
    // 账本没登记成不许跑上游：失败时查无此单会一分不退（第七轮 P0·3）
    console.error("[homePhotoUpscaleTask] registerActiveJob failed, abort before upstream", error);
    task.status = "failed";
    task.error = "任务账本登记失败，未提交生成，费用已退回";
    task.finishedAt = new Date().toISOString();
    await writeTask(task).catch(() => {});
    throw new Error("paid_job_ledger_register_failed");
  }

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
