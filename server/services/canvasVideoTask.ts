/**
 * 画布成片异步任务（Seedance OpenRouter / Hailuo / Happy Horse /
 * Seedance 2.5 BytePlus 主路径 + EvoLink fallback）。
 *
 * 原先 seedanceI2V / hailuo3Video 单条 HTTP 同步等上游数分钟，部署 SIGINT 会掐断。
 * 现：扣费 → 提交上游 → 立刻返回 taskId → worker/status 短轮询 → 镜像可读 URL。
 */

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { refundCredits } from "../credits.js";
import {
  heartbeatActiveJob,
  pauseActiveJob,
  registerActiveJob,
  refundCreditsOnFailure,
  unregisterActiveJob,
  type PaidJobDeductSnapshot,
} from "./paidJobLedger.js";
import { buildOpenRouterSeedanceSubmitBody } from "./openrouterSeedanceVideo.js";
import { buildOpenRouterHailuoSubmitBody } from "./openrouterHailuoVideo.js";
import { buildOpenRouterHappyHorseSubmitBody } from "./openrouterHappyHorseVideo.js";
import { getOpenRouterApiKey } from "./openrouterGptImage2.js";
import {
  isOpenRouterVideoConfigured,
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
import {
  pollWavespeedUpscaleOnce,
  submitWavespeedVideoUpscale,
  WAVESPEED_UPSCALE_MAX_POLL_MS,
} from "./wavespeedVideoUpscale.js";
import type { WavespeedUpscaleTarget } from "../../shared/wavespeedVideoUpscaleModels.js";
import {
  SEEDANCE_EVOLINK_CONTENT_FILTER,
  type SeedanceEvolinkMode,
} from "../../shared/seedanceEvolinkModels.js";

const TASK_TYPE = "canvasVideo" as const;
const PRIMARY_DIR =
  process.env.CANVAS_VIDEO_TASK_DIR || "/data/growth/canvas-video";

/**
 * 越过 maxPollMs 之后的对账窗口：上游任务不可取消、积分已扣，超线不能当失败退分
 * （实测 4K 968s，超线任务常常晚点就成功）。窗口内继续轮询；窗口也尽了才转人工。
 */
const RECONCILE_EXTRA_MS = Math.min(
  Math.max(Number(process.env.CANVAS_VIDEO_RECONCILE_EXTRA_MS) || 2_700_000, 300_000),
  7_200_000,
);

export type CanvasVideoEngine =
  | "seedance-openrouter"
  | "hailuo-openrouter"
  | "happyhorse-openrouter"
  | "seedance25-byteplus"
  | "seedance25-evolink"
  /** Seedance 2.0 Mini 草稿档：EvoLink 单路径（OpenRouter 没有 mini） */
  | "seedance-mini-evolink"
  /** Seedance 2.0 标准档·仿真人正向路由：真人照参考被 BytePlus/OpenRouter 拦，扣费前直切 EvoLink */
  | "seedance20-evolink"
  /** WaveSpeed 字节视频超分（2K/4K）：复用同一套异步任务框架，入参走 upscale* 字段 */
  | "wavespeed-upscale";

export type CanvasVideoTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  /** 越过轮询期限但上游任务还在（不可取消、已扣费）：继续对账轮询，不退分 */
  | "timed_out_pending_reconcile"
  /** 对账窗口也尽了、上游终态仍无法确认：停止轮询，等人工/账本 24h 硬底处理，不自动退分 */
  | "reconcile_manual";

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
  /** OpenRouter Seedance 2.0 / 2.0-fast；EvoLink Mini 记 2.0-mini；2.5 仅 BytePlus 回落 OpenRouter 时写入 */
  seedanceVersion?: "2.0" | "2.0-fast" | "2.0-mini" | "2.5";
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
  /** 首次越过轮询期限的时刻；进入 timed_out_pending_reconcile 时写入 */
  timedOutAt?: string;
  /** 最近一次瞬态故障（查询接口挂 / 镜像失败），仅诊断展示用，不代表任务失败 */
  lastTransientError?: string;
  /** 客户端幂等键；同键重复创建返回同一任务（见 createCanvasVideoTask） */
  idempotencyKey?: string;
  /** 扣费来源快照：hold 丢失时按此同源退回（团队扣款不得退进个人） */
  deduct?: PaidJobDeductSnapshot;
  /** wavespeed-upscale 专用：要放大的源视频（必须是真实成片 URL）与目标档 */
  upscaleSourceUrl?: string;
  upscaleTarget?: WavespeedUpscaleTarget;
  wavespeedPredictionId?: string;
};

/**
 * 画布 Seedance 2.5：有 BytePlus Key 则主路径；否则 EvoLink。
 * video_edit / video_extend 例外：强制 EvoLink——BytePlus 通道对 edit 发固定 15s
 * （官方契约只收 -1 等长）、adaptive 画幅被反转成 16:9，且该通道这两个模式从未实测；
 * EvoLink 是官方文档口径的实测通路。
 */
export function resolveSeedance25CanvasEngine(
  mode?: SeedanceEvolinkMode,
  opts?: {
    /**
     * 仿真人信号（用户 2026-08-10 明文）：写实人脸走 BytePlus 会被
     * InputImageSensitiveContentDetected 拦住任务失败，只能走 EvoLink；CG 漫画风无碍。
     * 信号来源是参考图 URL 的 photoreal 资产路径；用户自传真人照片识别不到，
     * 由 BytePlus 失败回落 EvoLink 兜底（isByteplusFallbackableError 默认放行）。
     */
    photoreal?: boolean;
  },
): CanvasVideoEngine {
  if (mode === "video_edit" || mode === "video_extend") return "seedance25-evolink";
  if (opts?.photoreal) return "seedance25-evolink";
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
  // 同一进程可在同一毫秒并发写同一任务；仅用 pid + Date.now() 会让两个写入撞临时文件，
  // 先完成 rename 的请求会令另一个请求得到 ENOENT。每次写入使用独立 UUID 保持原子替换。
  const tmp = `${file}.tmp.${process.pid}.${randomUUID()}`;
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
      if (
        task &&
        (task.status === "queued" ||
          task.status === "running" ||
          task.status === "timed_out_pending_reconcile")
      ) {
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
  if (engine === "seedance-mini-evolink" || engine === "seedance20-evolink") {
    return EVOLINK_SEEDANCE_MAX_POLL_MS;
  }
  if (engine === "wavespeed-upscale") return WAVESPEED_UPSCALE_MAX_POLL_MS;
  return OPENROUTER_VIDEO_MAX_POLL_MS;
}

/** 轮询期间保活写状态：已进对账态的不许被「running」冲回去，否则超时判定来回震荡 */
function activePollStatus(task: CanvasVideoTaskRecord): CanvasVideoTaskStatus {
  return task.status === "timed_out_pending_reconcile" ? "timed_out_pending_reconcile" : "running";
}

/** 已拿到上游任务号/查询地址 = 上游在跑、钱已烧出去，超时只能对账不能退分 */
function hasProviderTask(task: CanvasVideoTaskRecord): boolean {
  return Boolean(
    task.evolinkTaskId || task.byteplusTaskId || task.pollingUrl || task.wavespeedPredictionId,
  );
}

/** 走 EvoLink 任务号轮询的引擎（2.5 / Mini / 2.0 仿真人共用同一套 submit/poll） */
function usesEvolinkTaskId(engine: CanvasVideoEngine): boolean {
  return (
    engine === "seedance25-evolink"
    || engine === "seedance-mini-evolink"
    || engine === "seedance20-evolink"
  );
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
    // 8-09 拍板值（放宽送审，EvoLink 不挡人脸是仿真人档的前提）；原先是三处硬编码 true 的死常量
    contentFilter: SEEDANCE_EVOLINK_CONTENT_FILTER,
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
  return submitSeedanceEvolinkVersioned(task, "2.0-mini");
}

/** 2.0 仿真人：标准/快速各按原档走 EvoLink 九模型（fast 有对应型号，不降不换档） */
async function submitSeedance20Evolink(task: CanvasVideoTaskRecord): Promise<void> {
  return submitSeedanceEvolinkVersioned(
    task,
    task.seedanceVersion === "2.0-fast" ? "2.0-fast" : "2.0",
  );
}

async function submitSeedanceEvolinkVersioned(
  task: CanvasVideoTaskRecord,
  version: "2.0" | "2.0-fast" | "2.0-mini",
): Promise<void> {
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
    // 8-09 拍板值（放宽送审，EvoLink 不挡人脸是仿真人档的前提）；原先是三处硬编码 true 的死常量
    contentFilter: SEEDANCE_EVOLINK_CONTENT_FILTER,
    version,
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
    if (!isByteplusFallbackableError(error)) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    /**
     * CG 漫剧回落顺序（用户 2026-08-12 拍板）：BytePlus 挂了先去 OpenRouter（比 EvoLink 省 25%）。
     * 例外仍去 EvoLink：①真人脸敏感错（OpenRouter 同为 BytePlus 转发方，一样拦脸）
     * ②带参考视频的任务（OpenRouter 通道未接 video_urls，硬切会静默丢运镜参考）。
     */
    const faceBlocked = /InputImageSensitiveContentDetected|sensitive/i.test(reason);
    if (!faceBlocked && !task.videoUrls?.length && isOpenRouterVideoConfigured()) {
      console.warn(
        `[canvasVideoTask] BytePlus Seedance 2.5 提交失败，回落 OpenRouter · task=${task.taskId} · ${reason}`,
      );
      task.fallbackReason = reason.slice(0, 200);
      task.byteplusTaskId = undefined;
      task.engine = "seedance-openrouter";
      task.seedanceVersion = "2.5";
      await writeTask(task);
      await submitUpstream(task);
      return;
    }
    if (!isEvolinkSeedanceConfigured()) {
      throw error;
    }
    console.warn(
      `[canvasVideoTask] BytePlus Seedance 2.5 提交失败，回落 EvoLink · task=${task.taskId} · ${reason}`,
    );
    task.fallbackReason = reason.slice(0, 200);
    task.byteplusTaskId = undefined;
    await writeTask(task);
    await submitSeedance25Evolink(task);
  }
}

/** hold 缺失/账本异常时的兜底直退：按任务里持久化的 deduct 同源退回。
 * 退前查真账 refundKey，重复调用不双退（与 paidJobLedger 对账同一套 marker）。 */
async function refundTaskDirect(task: CanvasVideoTaskRecord, reason: string): Promise<void> {
  if (task.creditsCharged <= 0) return;
  const d = task.deduct;
  if (d?.source === "admin" || d?.source === "none") return;
  const { hasRefundMarker, refundMarkerFor } = await import("./paidJobLedger.js");
  const seen = await hasRefundMarker(task.userId, refundMarkerFor(TASK_TYPE, task.taskId));
  if (seen === true) return; // 已在账，勿重复
  if (seen === null) throw new Error("db_unavailable_refund_deferred");
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
      task.label,
    );
    return;
  }
  await refundCredits(task.userId, task.creditsCharged, reason);
}

async function failTask(
  task: CanvasVideoTaskRecord,
  error: string,
): Promise<CanvasVideoTaskRecord> {
  task.status = "failed";
  task.error = error.slice(0, 280);
  task.finishedAt = new Date().toISOString();
  await writeTask(task);
  const refundReason = `${task.label}·生成失败退回 [refundKey:${TASK_TYPE}/${task.taskId}]`;
  try {
    const out = await refundCreditsOnFailure(task.taskId, TASK_TYPE, "task_failed", task.error);
    // hold 缺失时账本正常 resolve {status:"missing"} 而非 reject——不兜底就一分不退
    if (out.status === "missing" && !out.refunded) {
      await refundTaskDirect(task, refundReason).catch((e) => {
        console.error("[canvasVideoTask] direct refund after missing hold failed", task.taskId, e);
      });
    }
  } catch {
    await refundTaskDirect(task, refundReason).catch((e) => {
      console.error("[canvasVideoTask] direct refund after ledger error failed", task.taskId, e);
    });
  }
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
  try {
    await unregisterActiveJob(task.taskId, TASK_TYPE, "settled");
  } catch (e) {
    // 结算失败不许静默吞：转 settlement_pending 持久态，reaper 只补结算不退款
    console.warn("[canvasVideoTask] settle 失败，转 settlement_pending", task.taskId, e);
    const { markSettlementPending } = await import("./paidJobLedger.js");
    await markSettlementPending(task.taskId, TASK_TYPE);
  }
  return task;
}

async function submitUpstream(task: CanvasVideoTaskRecord): Promise<void> {
  if (task.engine === "seedance-openrouter") {
    const body = buildOpenRouterSeedanceSubmitBody({
      variant:
        task.seedanceVersion === "2.0-fast"
          ? "2.0-fast"
          : task.seedanceVersion === "2.5"
            ? "2.5"
            : "2.0",
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

  if (task.engine === "seedance20-evolink") {
    await submitSeedance20Evolink(task);
    return;
  }

  if (task.engine === "wavespeed-upscale") {
    const source = String(task.upscaleSourceUrl || "").trim();
    if (!source) throw new Error("缺少要放大的视频地址");
    if (!task.upscaleTarget) throw new Error("缺少高清放大目标档");
    const submitted = await submitWavespeedVideoUpscale({
      videoUrl: source,
      target: task.upscaleTarget,
    });
    task.wavespeedPredictionId = submitted.predictionId;
    task.model = task.model || "bytedance-video-upscaler";
    task.provider = "wavespeed";
    task.status = "running";
    task.startedAt = task.startedAt || new Date().toISOString();
    await writeTask(task);
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
    if (
      task.status === "succeeded" ||
      task.status === "failed" ||
      task.status === "reconcile_manual"
    ) {
      return task;
    }

    await heartbeatActiveJob(task.taskId, TASK_TYPE).catch(() => {});

    const createdMs = Date.parse(task.createdAt) || Date.now();
    const deadlineMs = maxPollMs(task.engine);
    if (Date.now() - createdMs > deadlineMs) {
      if (!hasProviderTask(task)) {
        // 从未提交到上游：上游没在烧钱，按失败退分是安全的
        return failTask(
          task,
          `视频生成超时（${Math.round(deadlineMs / 60_000)} 分钟）`,
        );
      }
      if (task.status !== "timed_out_pending_reconcile") {
        // 上游任务还在（不可取消、积分已扣）：不能当失败退分——实测 4K 要 968s，
        // 超线任务常常晚点就成功。转对账态继续轮询；晚到的成功照常入账。
        task.status = "timed_out_pending_reconcile";
        task.timedOutAt = task.timedOutAt || new Date().toISOString();
        await writeTask(task);
      }
      const timedOutMs = Date.parse(task.timedOutAt || "") || Date.now();
      if (Date.now() - timedOutMs > RECONCILE_EXTRA_MS) {
        // 对账窗口也尽了还确认不了终态 → 停轮询转人工；不自动退分
        // （hold 侧 pause 掉，由账本 resumable 24h 硬底做最终兜底退分）
        task.status = "reconcile_manual";
        task.error = "上游任务长时间无法确认最终状态，已转人工对账";
        task.finishedAt = new Date().toISOString();
        await writeTask(task);
        await pauseActiveJob(task.taskId, TASK_TYPE).catch(() => {});
        return task;
      }
      // 对账态继续走下面的轮询逻辑
    }

    const needsSubmit = usesEvolinkTaskId(task.engine)
      ? !task.evolinkTaskId
      : task.engine === "seedance25-byteplus"
        ? !task.byteplusTaskId
        : task.engine === "wavespeed-upscale"
          ? !task.wavespeedPredictionId
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
          current.status = activePollStatus(current);
          current.lastTransientError = snap.status.startsWith("transient_") ? snap.status : undefined;
          await writeTask(current);
          return current;
        }
        if (snap.state === "failed") {
          // 上游跑挂：CG 无参考视频先回落 OpenRouter（拍板口径），脸敏感/带参考视频回落 EvoLink；均不重复扣费
          const reason = snap.error;
          const faceBlocked = /InputImageSensitiveContentDetected|sensitive/i.test(reason);
          if (
            !faceBlocked &&
            !current.videoUrls?.length &&
            isOpenRouterVideoConfigured() &&
            !current.openRouterJobId
          ) {
            console.warn(
              `[canvasVideoTask] BytePlus 任务失败，回落 OpenRouter · task=${current.taskId} · ${reason}`,
            );
            current.fallbackReason = reason.slice(0, 200);
            current.byteplusTaskId = undefined;
            current.engine = "seedance-openrouter";
            current.seedanceVersion = "2.5";
            current.status = "queued";
            await writeTask(current);
            try {
              await submitUpstream(current);
              const after = await readTask(taskId);
              return after || current;
            } catch (error) {
              return failTask(
                current,
                error instanceof Error ? error.message : reason,
              );
            }
          }
          if (isEvolinkSeedanceConfigured() && !current.evolinkTaskId) {
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
          current.status = activePollStatus(current);
          current.lastTransientError = snap.status.startsWith("transient_") ? snap.status : undefined;
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

      if (current.engine === "wavespeed-upscale") {
        if (!current.wavespeedPredictionId) {
          return failTask(current, "超分服务未返回任务编号");
        }
        const snap = await pollWavespeedUpscaleOnce(current.wavespeedPredictionId);
        if (snap.state === "running") {
          current.status = activePollStatus(current);
          current.lastTransientError = snap.status.startsWith("transient_") ? snap.status : undefined;
          await writeTask(current);
          return current;
        }
        if (snap.state === "failed") return failTask(current, snap.error);
        // 上游直链是短期的，镜像到 GCS 再交付；结果写 videoUrl，原片 URL 在 upscaleSourceUrl 里不动
        const videoUrl = await mirrorSeedanceMp4ToGcsSignedUrl(snap.sourceUrl);
        return succeedTask(
          current,
          videoUrl,
          current.model || "bytedance-video-upscaler",
          "wavespeed",
        );
      }

      if (!current.pollingUrl) {
        return failTask(current, "视频服务未返回任务查询地址");
      }
      const apiKey = getOpenRouterApiKey();
      if (!apiKey) return failTask(current, "视频服务暂不可用，请稍后重试");

      const snap = await pollOpenRouterVideoJobOnce(current.pollingUrl, apiKey);
      if (snap.state === "running") {
        current.status = activePollStatus(current);
        current.lastTransientError = snap.status.startsWith("transient_") ? snap.status : undefined;
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
      // 轮询 / 镜像阶段抛出的都是查询侧或搬运侧故障，说明不了上游任务死活——
      // 当终态会「假失败真退分」（上游不可取消、照跑照收钱）。记瞬态、等下一轮；
      // 真正的终态失败只认各 pollOnce 返回的 state:"failed"（2xx 明确终态）。
      // 长期起不来的由超时线 → 对账态 → 人工兜底，不会永远滚下去。
      current.lastTransientError = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 280);
      current.status = activePollStatus(current);
      await writeTask(current).catch(() => {});
      return current;
    }
  } finally {
    inflight.delete(taskId);
  }
}

function idemMapPath(dir: string, userId: number, key: string): string {
  const hash = createHash("sha256").update(`${userId}:${key}`).digest("hex").slice(0, 40);
  return path.join(dir, "idem", `${hash}.json`);
}

/**
 * 按幂等键找既有任务。API 层在扣费**之前**调它：命中直接返回既有任务，
 * 不再扣第二次费——这是「POST 重试不重复扣费」的第一道闸。
 */
export async function findCanvasVideoTaskByIdemKey(
  userId: number,
  idempotencyKey: string,
): Promise<CanvasVideoTaskRecord | null> {
  const key = String(idempotencyKey || "").trim();
  if (!key) return null;
  const dir = await getTaskDir();
  try {
    const raw = JSON.parse(await fs.readFile(idemMapPath(dir, userId, key), "utf8")) as {
      taskId?: string;
    };
    const mappedId = String(raw.taskId || "").trim();
    if (!mappedId) return null;
    const task = await readTask(mappedId);
    return task && task.userId === userId ? task : null;
  } catch {
    return null;
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
  /** 客户端提交的稳定幂等键：同键并发/重试返回同一任务（文件 wx 原子排他当唯一约束） */
  idempotencyKey?: string;
  /** 扣费来源快照：进账本 hold，退分时按同源退回 */
  deduct?: PaidJobDeductSnapshot;
  /** wavespeed-upscale 专用 */
  upscaleSourceUrl?: string;
  upscaleTarget?: WavespeedUpscaleTarget;
}): Promise<CanvasVideoTaskRecord> {
  const prompt = String(input.prompt || "").trim();
  if (!prompt && input.engine !== "wavespeed-upscale") throw new Error("请填写视频提示词");

  let taskId = `cv_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const idemKey = String(input.idempotencyKey || "").trim();
  if (idemKey) {
    const dir = await getTaskDir();
    const mapFile = idemMapPath(dir, input.userId, idemKey);
    await fs.mkdir(path.dirname(mapFile), { recursive: true });
    // 原子排他 = 先写 tmp 再 link：link 是排他且原子的（EEXIST 即输家），
    // 且输家读到的映射文件一定是完整内容——直接 wx 写入时并发读会读到半截 JSON，
    // 半截被 catch 当「映射损坏」走新任务 = 同键出两个任务
    const tmpMap = `${mapFile}.tmp.${process.pid}.${taskId}`;
    await fs.writeFile(tmpMap, JSON.stringify({ taskId, userId: input.userId, createdAt: now }));
    try {
      await fs.link(tmpMap, mapFile);
      await fs.unlink(tmpMap).catch(() => {});
    } catch (e) {
      await fs.unlink(tmpMap).catch(() => {});
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
      try {
        const raw = JSON.parse(await fs.readFile(mapFile, "utf8")) as { taskId?: string };
        const mappedId = String(raw.taskId || "").trim();
        if (mappedId) {
          const existing = await readTask(mappedId);
          if (existing && existing.status === "failed") {
            // 既有任务已终态失败（已退分）：这是一次全新的付费重试，换新 taskId 重开
            // tmp+rename 原子替换，并发读不到半截内容
            const reopenTmp = `${mapFile}.tmp.${process.pid}.${taskId}`;
            await fs.writeFile(
              reopenTmp,
              JSON.stringify({ taskId, userId: input.userId, createdAt: now }),
            );
            await fs.rename(reopenTmp, mapFile);
          } else if (existing) {
            // 同键重复请求：直接还既有任务，不重复扣费、不重复提交上游
            return existing;
          } else {
            // 映射在、任务文件没写成（上一次在两写之间崩了）：沿用同一 taskId 补完创建
            taskId = mappedId;
          }
        }
      } catch {
        // 映射文件损坏：当新任务处理
      }
    }
  }
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
    idempotencyKey: idemKey || undefined,
    deduct: input.deduct,
    upscaleSourceUrl: input.upscaleSourceUrl,
    upscaleTarget: input.upscaleTarget,
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
      action: task.label,
      externalApiCostHint: task.engine,
      metadata: {
        engine: task.engine,
        duration: task.duration,
        resolution: task.resolution,
      },
      deduct: input.deduct,
      // 任务记录已持久化、启动会 resume：SIGTERM/心跳 reaper 不得退分（见 paidJobLedger）
      resumable: true,
    });
  } catch (error) {
    // hold 没登记成就提交上游 = 任务失败时账本查无此单、一分不退（永久漏退窗）。
    // fail-fast：任务落终态失败、不碰上游，抛给调用方按 deduct 同源退款；
    // 幂等映射里的 failed 任务会在付费重试时换新 taskId 重开，不挡重试。
    console.error("[canvasVideoTask] registerActiveJob failed, abort before upstream", error);
    task.status = "failed";
    task.error = "任务账本登记失败，未提交生成，费用已退回";
    task.finishedAt = new Date().toISOString();
    await writeTask(task).catch(() => {});
    throw new Error("paid_job_ledger_register_failed");
  }

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
  if (
    task.status === "queued" ||
    task.status === "running" ||
    task.status === "timed_out_pending_reconcile"
  ) {
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
    // 恢复前补登记 hold：跨部署丢账本卷/上次 register 失败的任务，失败时才有账可退。
    // registerActiveJob 幂等且保留终态，不会把 refunded/settled 冲回 active。
    const task = await readTask(id);
    if (task) {
      await registerActiveJob({
        jobId: id,
        taskType: TASK_TYPE,
        userId: task.userId,
        creditsBilled: task.creditsCharged,
        action: task.label,
        externalApiCostHint: task.engine,
        metadata: { engine: task.engine, duration: task.duration, resolution: task.resolution },
        deduct: task.deduct,
        resumable: true,
      }).catch((error) => {
        console.warn("[canvasVideoTask] startup re-register hold failed", id, error);
      });
    }
    await advanceTask(id).catch((error) => {
      console.warn("[canvasVideoTask] startup resume failed", id, error);
    });
  }
}
