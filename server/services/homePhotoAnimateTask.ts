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
  pauseActiveJob,
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
  isOpenRouterHappyHorseConfigured,
  OPENROUTER_HAPPYHORSE_1_1_MODEL,
} from "./openrouterHappyHorseVideo.js";
import {
  isAnyHappyHorseChannelConfigured,
  submitHappyHorseViaChannels,
  type HappyHorseChannel,
} from "./happyHorseChannels.js";
import { pollWavespeedWanOnce } from "./wavespeedWanVideo.js";
import { pollEvolinkVideoTaskOnce } from "./evolinkSeedanceVideo.js";
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
  pollBailianHappyHorseOnce,
} from "./bailianHappyHorseVideo.js";
import { mirrorSeedanceMp4ToGcsSignedUrl } from "./seedanceVideo.js";

const TASK_TYPE = "homePhotoAnimate" as const;
const PRIMARY_DIR =
  process.env.HOME_PHOTO_ANIMATE_TASK_DIR || "/data/growth/home-photo-animate";

export type HomePhotoAnimateTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  /** 上游状态无法确认(提交结果未知/超轮询期限):停自动化、不退款,转人工对账 */
  | "reconcile_manual";

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
  /** 提交百炼用的国内可达镜像图 URL(阿里云拉不动 GCS,见 2026-08-21 排障) */
  bailianImageUrl?: string;
  /** 官方提交失败回落网关时的原因摘要 */
  fallbackReason?: string;
  /** 0825 拆百炼三通道：EvoLink 任务号 */
  evolinkTaskId?: string;
  /** 0825 拆百炼三通道：WaveSpeed prediction id */
  wavespeedPredictionId?: string;
  /** 已路由通道（崩溃恢复重提交时钉回原家） */
  hhChannel?: HappyHorseChannel;
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

/**
 * 百炼(阿里云北京)的 worker 拉不动 storage.googleapis.com——GCS 在大陆不可达,
 * 首帧签名 URL 直接透传会让任务建单成功、执行期报 "Failed to download <url>"
 * (2026-08-21 四连挂实锤)。提交百炼前把图镜像到自有域名(Fly 卷图床,
 * mvstudiopro.com 的国内可达性被日常业务验证);OpenRouter 国际通道不受影响,
 * 继续用原 URL。镜像结果落 task.bailianImageUrl,重试不重复下载。
 */
/* export 仅为单测 */
export async function ensureBailianReachableImageUrl(
  task: HomePhotoAnimateTaskRecord,
): Promise<string> {
  if (task.bailianImageUrl) return task.bailianImageUrl;
  const src = String(task.imageUrl || "").trim();
  const ownRoot = String(process.env.OAUTH_SERVER_URL || "").trim().replace(/\/+$/, "") || "https://mvstudiopro.com";
  if (src.startsWith(ownRoot) || src.includes("op=flyVolumeMedia")) {
    return src; // 已是自有域,阿里可达
  }
  const res = await fetch(src, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`镜像首帧图下载失败 HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length || buffer.length > 30 * 1024 * 1024) {
    throw new Error(`镜像首帧图大小异常: ${buffer.length} bytes`);
  }
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const isWebp = buffer.length > 11 && buffer.toString("ascii", 8, 12) === "WEBP";
  const contentType = isJpeg ? "image/jpeg" : isWebp ? "image/webp" : "image/png";
  const { writeFlyPlatformImageBuffer, buildFlyPlatformImagePublicUrl } = await import(
    "./flyVolumeGeneratedImages.js"
  );
  const { relPath } = await writeFlyPlatformImageBuffer({
    subdir: "home-photo-animate-src",
    buffer,
    contentType,
  });
  const publicUrl = buildFlyPlatformImagePublicUrl(relPath);
  task.bailianImageUrl = publicUrl;
  await writeTask(task);
  return publicUrl;
}

async function advanceTask(taskId: string): Promise<HomePhotoAnimateTaskRecord | null> {
  if (inflight.has(taskId)) {
    return readTask(taskId);
  }
  inflight.add(taskId);
  try {
    const task = await readTask(taskId);
    if (!task) return null;
    if (
      task.status === "succeeded" ||
      task.status === "failed" ||
      task.status === "reconcile_manual"
    ) {
      return task;
    }

    await heartbeatActiveJob(task.taskId, TASK_TYPE).catch(() => {});

    // 0825 拆百炼三通道：EvoLink → OpenRouter → WaveSpeed（用户拍板顺序）。
    // 百炼在途老单（bailianTaskId）只在下方轮询收尾，绝不再新建。
    const hasHandle = Boolean(
      task.pollingUrl || task.bailianTaskId || task.evolinkTaskId || task.wavespeedPredictionId,
    );
    if (!hasHandle) {
      try {
        const routed = await submitHappyHorseViaChannels({
          prompt: task.prompt,
          imageUrl: task.imageUrl,
          duration: task.duration,
          resolution: task.resolution,
          aspectRatio: task.aspectRatio,
        }, undefined, task.hhChannel);
        const { submitted, skippedZh } = routed;
        if (skippedZh.length) {
          console.warn(`[homePhotoAnimateTask] 路由跳过: ${skippedZh.join("；")}`);
        }
        task.hhChannel = submitted.channel;
        task.status = "running";
        task.startedAt = task.startedAt || new Date().toISOString();
        if (submitted.channel === "evolink") {
          task.evolinkTaskId = submitted.evolinkTaskId;
          task.model = task.model || "happyhorse-1.1";
          await writeTask(task);
          if (submitted.immediateSourceUrl) {
            // 句柄已落盘、上游已计费——镜像抖动是瞬态，留 running 下一轮再搬
            try {
              const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(submitted.immediateSourceUrl, {
                durableStorage: { keyPrefix: "home-photo/animation" },
              });
              return succeedTask(task, videoUrl, task.model || "happyhorse-1.1");
            } catch (mirrorError) {
              task.error = (
                mirrorError instanceof Error ? mirrorError.message : "照片动画搬运暂时失败"
              ).slice(0, 280);
              await writeTask(task);
              return task;
            }
          }
          return task;
        }
        if (submitted.channel === "wavespeed") {
          task.wavespeedPredictionId = submitted.predictionId;
          task.model = task.model || "happyhorse-1.1";
          await writeTask(task);
          return task;
        }
        task.openRouterJobId = submitted.openRouterJobId;
        task.pollingUrl = submitted.pollingUrl;
        task.model = submitted.model;
        await writeTask(task);
        if (submitted.immediateSourceUrl) {
          try {
            const videoUrl = await mirrorOpenRouterVideoSourceUrl(
              submitted.immediateSourceUrl,
              submitted.apiKey,
              { keyPrefix: "home-photo/animation", required: true },
            );
            return succeedTask(task, videoUrl, submitted.model);
          } catch (mirrorError) {
            task.error = (
              mirrorError instanceof Error ? mirrorError.message : "照片动画搬运暂时失败"
            ).slice(0, 280);
            await writeTask(task);
            return task;
          }
        }
        return task;
      } catch (error) {
        // unknown = 上游可能已建单：转对账、不退款（与 canvasVideoTask 同一铁律）
        if ((error as { kind?: string } | null)?.kind === "unknown") {
          task.status = "reconcile_manual";
          task.error = "照片动画提交结果无法确认，为避免重复生成已停止自动重试，转人工对账";
          task.finishedAt = new Date().toISOString();
          await writeTask(task);
          await pauseActiveJob(task.taskId, TASK_TYPE).catch(() => {});
          return task;
        }
        return failTask(
          task,
          error instanceof Error ? error.message : "照片动画创建失败",
        );
      }
    }

    if (!task.pollingUrl && !task.bailianTaskId && !task.evolinkTaskId && !task.wavespeedPredictionId) {
      return failTask(task, "视频服务未返回任务查询地址");
    }

    const createdMs = Date.parse(task.createdAt) || Date.now();
    if (Date.now() - createdMs > OPENROUTER_VIDEO_MAX_POLL_MS) {
      /**
       * 六审第10条:已提交上游的任务超线不能 failTask 退款——上游不可取消、
       * 可能晚点成功,假失败真退款。转人工对账;只有从未提交上游的才按失败退。
       */
      if (task.bailianTaskId || task.pollingUrl || task.evolinkTaskId || task.wavespeedPredictionId) {
        task.status = "reconcile_manual";
        task.error = "上游任务超过自动轮询期限，最终状态未确认，已转人工对账";
        task.finishedAt = new Date().toISOString();
        await writeTask(task);
        await pauseActiveJob(task.taskId, TASK_TYPE).catch(() => {});
        return task;
      }
      return failTask(task, "任务在提交上游前超时");
    }

    if (task.evolinkTaskId) {
      const snap = await pollEvolinkVideoTaskOnce(task.evolinkTaskId, "HappyHorse");
      if (snap.state === "running") {
        task.status = "running";
        await writeTask(task);
        return task;
      }
      if (snap.state === "failed") return failTask(task, snap.error);
      try {
        const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(snap.sourceUrl, {
          durableStorage: { keyPrefix: "home-photo/animation" },
        });
        return succeedTask(task, videoUrl, task.model || "happyhorse-1.1");
      } catch (error) {
        task.status = "running";
        task.error = (
          error instanceof Error ? error.message : "照片动画搬运暂时失败"
        ).slice(0, 280);
        await writeTask(task);
        return task;
      }
    }

    if (task.wavespeedPredictionId) {
      const snap = await pollWavespeedWanOnce(task.wavespeedPredictionId);
      if (snap.state === "running") {
        task.status = "running";
        await writeTask(task);
        return task;
      }
      if (snap.state === "failed") return failTask(task, snap.error);
      try {
        const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(snap.sourceUrl, {
          durableStorage: { keyPrefix: "home-photo/animation" },
        });
        return succeedTask(task, videoUrl, task.model || "happyhorse-1.1");
      } catch (error) {
        task.status = "running";
        task.error = (
          error instanceof Error ? error.message : "照片动画搬运暂时失败"
        ).slice(0, 280);
        await writeTask(task);
        return task;
      }
    }

    // 百炼官方轮询(仅在途老单收尾;0825 起不再新建):瞬态查询故障不作终态,等下一轮
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
      // 官方产物是阿里 OSS 短期直链,镜像 GCS 再交付(存储签名铁律);
      // 七审 P1-5B:镜像抖动不是生成失败,留任务下一轮再搬,不许 failTask 退款
      try {
        const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(snap.sourceUrl, {
          durableStorage: { keyPrefix: "home-photo/animation" },
        });
        return succeedTask(task, videoUrl, task.model || BAILIAN_HAPPYHORSE_I2V_MODEL);
      } catch (error) {
        task.status = "running";
        task.error = (
          error instanceof Error ? error.message : "照片动画搬运暂时失败"
        ).slice(0, 280);
        await writeTask(task);
        return task;
      }
    }

    const pollingUrl = task.pollingUrl;
    if (!pollingUrl) {
      return failTask(task, "视频服务未返回任务查询地址");
    }
    const apiKey = getOpenRouterApiKey();
    if (!apiKey) {
      // 七审 P1-5B:已有 pollingUrl=任务已提交;本地查询配置缺失只是查不了,
      // 不能 failTask 假失败真退款——保持 running 等配置恢复
      task.status = "running";
      task.error = "OpenRouter 查询配置暂不可用，任务状态尚未确认";
      await writeTask(task);
      return task;
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
      // 七审 P1-5B:查询/镜像异常说明不了任务死活,记录后保持 running 等下一轮
      task.status = "running";
      task.error = (
        error instanceof Error ? error.message : "照片动画查询暂时失败"
      ).slice(0, 280);
      await writeTask(task);
      return task;
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
  if (!isAnyHappyHorseChannelConfigured()) {
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
