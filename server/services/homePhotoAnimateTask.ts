/**
 * 首页照片动画：异步任务（落盘 + 短轮询 + 部署后续跑）。
 *
 * 根因：原先单条 HTTP 同步等 OpenRouter 数分钟，Fly rolling deploy / SIGINT
 * 会直接掐断连接，前端「没返回任何讯息」。上游视频其实可能还在生成。
 *
 * 现改为：扣费 → 提交上游 → 立即返回 taskId → 后台/状态接口续轮询 → 镜像可读 URL。
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION,
  homePhotoAnimateCredits,
  isHomePhotoAnimateDuration,
  isHomePhotoAnimateResolution,
  type HomePhotoAnimateDuration,
  type HomePhotoAnimateResolution,
} from "../../shared/homePhotoTools.js";
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
  buildOpenRouterHappyHorseSubmitBody,
  isOpenRouterHappyHorseConfigured,
  OPENROUTER_HAPPYHORSE_1_1_MODEL,
} from "./openrouterHappyHorseVideo.js";
import { getOpenRouterApiKey } from "./openrouterGptImage2.js";
import {
  mirrorOpenRouterVideoSourceUrl,
  OPENROUTER_VIDEO_MAX_POLL_MS,
  OPENROUTER_VIDEO_POLL_INTERVAL_MS,
  pollOpenRouterVideoJobOnce,
  submitOpenRouterVideoJob,
} from "./openrouterVideoCore.js";
import {
  BAILIAN_HAPPYHORSE_I2V_MODEL,
  isBailianHappyHorseConfigured,
  pollBailianHappyHorseOnce,
  submitBailianHappyHorseVideo,
} from "./bailianHappyHorseVideo.js";
import { mirrorSeedanceMp4ToGcsSignedUrl } from "./seedanceVideo.js";

const TASK_TYPE = "homePhotoAnimate" as const;
const PRIMARY_DIR =
  process.env.HOME_PHOTO_ANIMATE_TASK_DIR || "/data/growth/home-photo-animate";

export type HomePhotoAnimateTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export type HomePhotoAnimateTaskRecord = {
  taskId: string;
  userId: number;
  /** 扣款来源快照：退款按同源退回（团队不退个人）；hold 丢失时兜底直退用 */
  deduct?: PaidJobDeductSnapshot;
  status: HomePhotoAnimateTaskStatus;
  creditsCharged: number;
  imageUrl: string;
  prompt: string;
  duration: HomePhotoAnimateDuration;
  resolution: HomePhotoAnimateResolution;
  aspectRatio: string;
  openRouterJobId?: string;
  pollingUrl?: string;
  /** 百炼官方 HappyHorse 异步任务 id(主通道;OpenRouter 兜底时为空) */
  bailianTaskId?: string;
  /** 官方提交失败回落网关时的原因摘要 */
  fallbackReason?: string;
  model?: string;
  videoUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

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
    const fallback = path.join(os.tmpdir(), "mvstudiopro-home-photo-animate");
    console.warn(
      `[homePhotoAnimateTask] primary dir unavailable, fallback=${fallback}`,
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

async function writeTask(record: HomePhotoAnimateTaskRecord): Promise<void> {
  const dir = await getTaskDir();
  const file = taskPath(dir, record.taskId);
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  record.updatedAt = new Date().toISOString();
  await fs.writeFile(tmp, JSON.stringify(record, null, 2));
  await fs.rename(tmp, file);
}

async function readTask(taskId: string): Promise<HomePhotoAnimateTaskRecord | null> {
  const dir = await getTaskDir();
  try {
    const raw = await fs.readFile(taskPath(dir, taskId), "utf8");
    return JSON.parse(raw) as HomePhotoAnimateTaskRecord;
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
  task: HomePhotoAnimateTaskRecord,
  error: string,
): Promise<HomePhotoAnimateTaskRecord> {
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
        const reason = `照片动画生成失败·退回已扣积分 ${marker}`;
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
            "首页照片人物动起来",
            { refundKey },
          );
        } else if (d?.source !== "admin" && d?.source !== "none") {
          await refundCredits(task.userId, task.creditsCharged, reason, { refundKey });
        }
      }
    }
  } catch (e) {
    console.error("[homePhotoAnimateTask] 退款未完成（等 reaper 对账）", task.taskId, e);
  }
  return task;
}

async function succeedTask(
  task: HomePhotoAnimateTaskRecord,
  videoUrl: string,
  model: string,
): Promise<HomePhotoAnimateTaskRecord> {
  task.status = "succeeded";
  task.videoUrl = videoUrl;
  task.model = model;
  task.finishedAt = new Date().toISOString();
  task.error = undefined;
  await writeTask(task);
  try {
    await unregisterActiveJob(task.taskId, TASK_TYPE, "settled");
  } catch (e) {
    // 结算失败不许吞：转 settlement_pending，reaper 只补结算不退款（防成功单被误退）
    console.warn("[homePhotoAnimateTask] settle 失败，转 settlement_pending", task.taskId, e);
    await markSettlementPending(task.taskId, TASK_TYPE);
  }

  try {
    const plan = await getUserPlan(task.userId);
    await recordCreation({
      userId: task.userId,
      type: "photo_animation_video",
      title: `照片人物动起来 · ${task.resolution} · ${task.duration} 秒`,
      outputUrl: videoUrl,
      thumbnailUrl: task.imageUrl,
      quality: task.resolution,
      creditsUsed: task.creditsCharged,
      plan,
      metadata: {
        sourceImageUrl: task.imageUrl,
        prompt: task.prompt,
        duration: task.duration,
        resolution: task.resolution,
        model,
        tool: "home_photo_animate",
        taskId: task.taskId,
      },
    });
  } catch (error) {
    console.error("[homePhotoAnimateTask] recordCreation failed", error);
  }
  return task;
}

async function advanceTask(taskId: string): Promise<HomePhotoAnimateTaskRecord | null> {
  if (inflight.has(taskId)) {
    return readTask(taskId);
  }
  inflight.add(taskId);
  try {
    const task = await readTask(taskId);
    if (!task) return null;
    if (task.status === "succeeded" || task.status === "failed") return task;

    await heartbeatActiveJob(task.taskId, TASK_TYPE).catch(() => {});

    // 尚未提交上游:百炼官方为主通道(0820 拍板),提交失败回落 OpenRouter 网关
    if (!task.pollingUrl && !task.bailianTaskId) {
      if (isBailianHappyHorseConfigured()) {
        try {
          const submitted = await submitBailianHappyHorseVideo({
            prompt: task.prompt,
            imageUrl: task.imageUrl,
            duration: task.duration,
            resolution: task.resolution,
          });
          task.bailianTaskId = submitted.bailianTaskId;
          task.model = submitted.model;
          task.status = "running";
          task.startedAt = task.startedAt || new Date().toISOString();
          await writeTask(task);
          return task;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(
            `[homePhotoAnimateTask] 百炼 HappyHorse 提交失败,回落 OpenRouter · task=${task.taskId} · ${reason}`,
          );
          task.fallbackReason = reason.slice(0, 200);
          task.bailianTaskId = undefined;
        }
      }
      try {
        const body = buildOpenRouterHappyHorseSubmitBody({
          prompt: task.prompt,
          imageUrl: task.imageUrl,
          duration: task.duration,
          resolution: task.resolution,
          aspectRatio: task.aspectRatio,
        });
        const submitted = await submitOpenRouterVideoJob(body);
        task.openRouterJobId = submitted.openRouterJobId;
        task.pollingUrl = submitted.pollingUrl;
        task.model = submitted.model;
        task.status = "running";
        task.startedAt = task.startedAt || new Date().toISOString();
        await writeTask(task);

        if (submitted.immediateSourceUrl) {
          const videoUrl = await mirrorOpenRouterVideoSourceUrl(
            submitted.immediateSourceUrl,
            submitted.apiKey,
            { keyPrefix: "home-photo/animation", required: true },
          );
          return succeedTask(task, videoUrl, submitted.model);
        }
      } catch (error) {
        return failTask(
          task,
          error instanceof Error ? error.message : "照片动画创建失败",
        );
      }
    }

    if (!task.pollingUrl && !task.bailianTaskId) {
      return failTask(task, "视频服务未返回任务查询地址");
    }

    const createdMs = Date.parse(task.createdAt) || Date.now();
    if (Date.now() - createdMs > OPENROUTER_VIDEO_MAX_POLL_MS) {
      return failTask(
        task,
        `视频生成超时（${Math.round(OPENROUTER_VIDEO_MAX_POLL_MS / 60_000)} 分钟）`,
      );
    }

    // 百炼官方轮询:瞬态查询故障不作终态(照 canvasVideoTask 口径),等下一轮
    if (task.bailianTaskId) {
      const snap = await pollBailianHappyHorseOnce(task.bailianTaskId);
      if (snap.state === "running") {
        task.status = "running";
        await writeTask(task);
        return task;
      }
      if (snap.state === "failed") {
        return failTask(task, snap.error);
      }
      // 官方产物是阿里 OSS 短期直链,镜像 GCS 再交付(存储签名铁律)
      const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(snap.sourceUrl, {
        durableStorage: { keyPrefix: "home-photo/animation" },
      });
      return succeedTask(task, videoUrl, task.model || BAILIAN_HAPPYHORSE_I2V_MODEL);
    }

    const pollingUrl = task.pollingUrl;
    if (!pollingUrl) {
      return failTask(task, "视频服务未返回任务查询地址");
    }
    const apiKey = getOpenRouterApiKey();
    if (!apiKey) {
      return failTask(task, "视频服务暂不可用，请稍后重试");
    }

    try {
      const snap = await pollOpenRouterVideoJobOnce(pollingUrl, apiKey);
      if (snap.state === "running") {
        task.status = "running";
        await writeTask(task);
        return task;
      }
      if (snap.state === "failed") {
        return failTask(task, snap.error);
      }
      const videoUrl = await mirrorOpenRouterVideoSourceUrl(snap.sourceUrl, apiKey, {
        keyPrefix: "home-photo/animation",
        required: true,
      });
      return succeedTask(
        task,
        videoUrl,
        task.model || OPENROUTER_HAPPYHORSE_1_1_MODEL,
      );
    } catch (error) {
      return failTask(
        task,
        error instanceof Error ? error.message : "照片动画生成失败",
      );
    }
  } finally {
    inflight.delete(taskId);
  }
}

export async function createHomePhotoAnimateTask(input: {
  userId: number;
  creditsCharged: number;
  /** 扣款来源快照（API 扣费时生成），必须透传进任务与账本 */
  deduct?: PaidJobDeductSnapshot;
  imageUrl: string;
  prompt: string;
  duration: number;
  resolution: string;
  aspectRatio?: string;
}): Promise<HomePhotoAnimateTaskRecord> {
  if (!isBailianHappyHorseConfigured() && !isOpenRouterHappyHorseConfigured()) {
    throw new Error("视频服务暂不可用，请稍后重试");
  }
  if (!isHomePhotoAnimateDuration(input.duration)) {
    throw new Error("照片动起来只支持 5、10 或 15 秒");
  }
  const resolution = isHomePhotoAnimateResolution(input.resolution)
    ? input.resolution
    : HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION;
  const expected = homePhotoAnimateCredits(input.duration, resolution);
  if (input.creditsCharged > 0 && input.creditsCharged !== expected) {
    // 允许 admin 0 扣；非零时必须与服务端计价一致
    console.warn(
      `[homePhotoAnimateTask] credits mismatch charged=${input.creditsCharged} expected=${expected}`,
    );
  }

  const taskId = `hpa_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const task: HomePhotoAnimateTaskRecord = {
    taskId,
    userId: input.userId,
    status: "queued",
    creditsCharged: Math.max(0, Number(input.creditsCharged) || 0),
    deduct: input.deduct,
    imageUrl: String(input.imageUrl || "").trim(),
    prompt:
      String(input.prompt || "").trim().slice(0, 500) ||
      "让照片中的人物做自然、克制的微动作，保持身份、脸部特征、服装、背景与原始构图稳定；动作连贯，镜头稳定，不新增人物或物件。",
    duration: input.duration,
    resolution,
    aspectRatio: String(input.aspectRatio || "16:9").trim() || "16:9",
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
      action: `首页照片人物动起来（${resolution} · ${input.duration}s）`,
      externalApiCostHint: "openrouter happyhorse-1.1",
      metadata: {
        imageUrl: task.imageUrl.slice(0, 200),
        duration: task.duration,
        resolution: task.resolution,
      },
      deduct: input.deduct,
    });
  } catch (error) {
    // 账本没登记成不许跑上游：失败时查无此单会一分不退（第七轮 P0·3）
    console.error("[homePhotoAnimateTask] registerActiveJob failed, abort before upstream", error);
    task.status = "failed";
    task.error = "任务账本登记失败，未提交生成，费用已退回";
    task.finishedAt = new Date().toISOString();
    await writeTask(task).catch(() => {});
    throw new Error("paid_job_ledger_register_failed");
  }

  // 立即推进一轮（尽量在本请求内完成上游提交），然后靠 worker/status 续跑
  void advanceTask(taskId).catch((error) => {
    console.error("[homePhotoAnimateTask] initial advance failed", error);
  });
  ensureHomePhotoAnimateWorker();
  return (await readTask(taskId)) || task;
}

export async function getHomePhotoAnimateTask(
  taskId: string,
  userId: number,
): Promise<HomePhotoAnimateTaskRecord | null> {
  const task = await readTask(String(taskId || "").trim());
  if (!task || task.userId !== userId) return null;
  if (task.status === "queued" || task.status === "running") {
    return (await advanceTask(task.taskId)) || task;
  }
  return task;
}

export function ensureHomePhotoAnimateWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void (async () => {
      const ids = await listActiveTaskIds();
      for (const id of ids) {
        await advanceTask(id).catch((error) => {
          console.warn("[homePhotoAnimateTask] worker tick failed", id, error);
        });
      }
    })();
  }, Math.max(3_000, OPENROUTER_VIDEO_POLL_INTERVAL_MS));
  // 不阻止进程退出
  workerTimer.unref?.();
}

export async function resumeHomePhotoAnimateTasksOnStartup(): Promise<void> {
  ensureHomePhotoAnimateWorker();
  const ids = await listActiveTaskIds();
  if (!ids.length) {
    console.log("[homePhotoAnimateTask] startup: no active tasks");
    return;
  }
  console.log(`[homePhotoAnimateTask] startup: resume ${ids.length} task(s)`);
  for (const id of ids) {
    await advanceTask(id).catch((error) => {
      console.warn("[homePhotoAnimateTask] startup resume failed", id, error);
    });
  }
}
