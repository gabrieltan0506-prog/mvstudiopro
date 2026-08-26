/**
 * 漫剧配乐异步核心：brief → EvoLink Suno V5.5 task → 全变体即时转存 GCS。
 *
 * 建单和收单刻意分开。建单成功后调用方必须先把 task ID 写进 jobs.output，随后
 * 才能轮询；部署重启只带原 task ID 进入 `resumeManhuaBgmTask`，绝不再次 POST。
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { promisify } from "node:util";
import {
  assertBgmStyleSubmittable,
  buildManhuaBgmBrief,
  type BgmBeatMood,
  type BgmBrief,
} from "../../shared/manhuaBgmBrief.js";
import {
  beatTableToVolumeExpr,
  buildBeatTable,
  buildBgmAlignment,
  readBgmStructure,
  type FilmEvent,
} from "../../shared/manhuaBeatTable.js";
import {
  digestManhuaBgmBrief,
  manhuaBgmBriefSchema,
  type ManhuaBgmStructure,
} from "../jobs/manhuaBgmJobInput.js";
import {
  createEvolinkSunoTask,
  getEvolinkSunoTask,
  pickEvolinkSunoAudioUrls,
} from "./evolinkSunoMusic.js";
import { signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs.js";
import { probeBgmLevels } from "./manhuaBgmLevelProbe.js";
import { postProdOutputPrefix } from "./postProdMediaSource.js";

const execFileAsync = promisify(execFile);

export const MAX_BGM_VARIANT_BYTES = 64 * 1024 * 1024;
export const MANHUA_BGM_POLL_TIMEOUT_MS = 6 * 60_000;
export const MANHUA_BGM_POLL_INTERVAL_MS = 5_000;

export type ScoringRoomRequest = {
  laneZh: string;
  durationSec: number;
  moods: readonly BgmBeatMood[];
  moodArcZh?: string;
  endingZh?: string;
  tempoPlanZh?: string;
  bpm?: number;
  styleAnchorZh?: string;
  titleZh?: string;
  styleOverrideZh?: string;
  hasSilenceBreak?: boolean;
};

export type ScoringRoomVariant = {
  index: number;
  gcsUri: string;
  /** 临时试听地址；持久真源始终是 gcsUri，查询任务时应重新签发。 */
  previewUrl: string;
  bytes: number;
  structure: ManhuaBgmStructure | null;
};

export type ScoringRoomResult = {
  taskId: string;
  briefDigest: string;
  variants: ScoringRoomVariant[];
  elapsedMs: number;
  brief: BgmBrief;
};

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("已取消");
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError(signal));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** 路由的零成本起草入口也可复用这一生产者。 */
export function buildScoringRoomBrief(input: ScoringRoomRequest): BgmBrief {
  return buildManhuaBgmBrief(input);
}

/** 流式读取并累计限额，避免先吃进超大 arrayBuffer 才发现越界。 */
export async function readBgmAudioWithLimit(
  response: Response,
  options: { maxBytes?: number; abortSignal?: AbortSignal } = {}
): Promise<Buffer> {
  const maxBytes = options.maxBytes ?? MAX_BGM_VARIANT_BYTES;
  assertNotAborted(options.abortSignal);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("配乐文件超过处理上限");
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("配乐下载缺少响应流");
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for (;;) {
    if (options.abortSignal?.aborted) {
      await reader.cancel().catch(() => {});
      throw abortError(options.abortSignal);
    }
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("配乐文件超过处理上限");
    }
    chunks.push(Buffer.from(value));
  }
  if (!totalBytes) throw new Error("配乐文件为空");
  return Buffer.concat(chunks, totalBytes);
}

/** URL、扩展名与 Content-Type 都不能证明是真音频，落库前必须 ffprobe。 */
export async function assertBgmAudioPlayable(
  buffer: Buffer,
  abortSignal?: AbortSignal
): Promise<void> {
  assertNotAborted(abortSignal);
  const directory = await mkdtemp(nodePath.join(tmpdir(), "mvbgm-probe-"));
  const filePath = nodePath.join(directory, "variant.mp3");
  try {
    await writeFile(filePath, buffer);
    assertNotAborted(abortSignal);
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "csv=p=0",
        filePath,
      ],
      { timeout: 60_000, signal: abortSignal }
    );
    if (!String(stdout).includes("audio"))
      throw new Error("配乐文件里没有音轨");
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

async function probeVariantStructure(
  buffer: Buffer,
  totalSec: number,
  abortSignal?: AbortSignal
): Promise<ManhuaBgmStructure | null> {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "mvbgm-level-"));
  const filePath = nodePath.join(directory, "variant.mp3");
  try {
    await writeFile(filePath, buffer);
    const samples = await probeBgmLevels(filePath, { totalSec, abortSignal });
    return readBgmStructure(samples);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 对象名同时带可读 task 片段与完整 task 的短摘要，防清洗/截断后不同 task 撞名。
 * 同一 task 重启续跑仍得到同名对象，重复上传不会长出垃圾副本。
 */
export function scoringBgmObjectName(
  userId: string,
  taskId: string,
  variantIndex: number
): string {
  const rawTaskId = String(taskId || "").trim();
  if (!rawTaskId) throw new Error("配乐缺少上游任务号");
  if (!Number.isInteger(variantIndex) || variantIndex < 0) {
    throw new Error("配乐变体序号不合法");
  }
  const readable =
    rawTaskId.replace(/[^0-9A-Za-z_-]/g, "").slice(0, 40) || "task";
  const digest = createHash("sha256")
    .update(rawTaskId, "utf8")
    .digest("hex")
    .slice(0, 10);
  return `${postProdOutputPrefix(userId)}bgm/${readable}-${digest}-v${variantIndex}.mp3`;
}

/** 只发一次付费 POST；调用方拿到 task ID 后必须先严格持久化。 */
export async function createManhuaBgmTask(
  briefInput: BgmBrief,
  opts: { abortSignal?: AbortSignal } = {}
): Promise<{ taskId: string; briefDigest: string }> {
  assertNotAborted(opts.abortSignal);
  const brief = manhuaBgmBriefSchema.parse(briefInput) as BgmBrief;
  // 在付费 POST 之前拦住上游会静默拒绝的音乐家姓名。
  assertBgmStyleSubmittable(brief);
  const task = await createEvolinkSunoTask(brief, {
    abortSignal: opts.abortSignal,
  });
  const taskId = String(task.id || "").trim();
  if (!taskId) throw new Error("配乐建单成功但未返回 task id");
  return { taskId, briefDigest: digestManhuaBgmBrief(brief) };
}

/**
 * 只恢复已有 task：轮询 → 每条变体验音 → 立即转存本人 GCS 前缀 → 客观量结构。
 * 本函数没有建单入口，因此部署恢复不会重复付费。
 */
export async function resumeManhuaBgmTask(input: {
  taskId: string;
  userId: string;
  brief: BgmBrief;
  startedAtMs?: number;
  abortSignal?: AbortSignal;
  /** 测试与专用 worker 可覆盖；生产默认 5 秒。 */
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}): Promise<ScoringRoomResult> {
  const taskId = String(input.taskId || "").trim();
  const userId = String(input.userId || "").trim();
  if (!taskId) throw new Error("配乐缺少上游任务号，不能恢复轮询");
  if (!userId) throw new Error("配乐缺少会话用户，无法落本人后期前缀");
  assertNotAborted(input.abortSignal);
  const brief = manhuaBgmBriefSchema.parse(input.brief) as BgmBrief;
  const briefDigest = digestManhuaBgmBrief(brief);
  const startedAtMs = Number.isFinite(input.startedAtMs)
    ? Number(input.startedAtMs)
    : Date.now();
  const pollTimeoutMs = Math.max(
    1,
    input.pollTimeoutMs ?? MANHUA_BGM_POLL_TIMEOUT_MS
  );
  const deadlineMs = Date.now() + pollTimeoutMs;

  let raw: unknown;
  for (;;) {
    assertNotAborted(input.abortSignal);
    if (Date.now() > deadlineMs) {
      throw new Error(
        `配乐任务 ${taskId} 超过 ${Math.ceil(pollTimeoutMs / 60_000)} 分钟未完成`
      );
    }
    const polled = await getEvolinkSunoTask(taskId, {
      abortSignal: input.abortSignal,
    });
    if (polled.task.status === "completed") {
      raw = polled.raw;
      break;
    }
    if (polled.task.status === "failed" || polled.task.status === "cancelled") {
      throw new Error(`配乐任务 ${taskId} ${polled.task.status}`);
    }
    await sleep(
      input.pollIntervalMs ?? MANHUA_BGM_POLL_INTERVAL_MS,
      input.abortSignal
    );
  }

  const urls = pickEvolinkSunoAudioUrls(raw);
  if (!urls.length) throw new Error(`配乐任务 ${taskId} 完成但没有音频地址`);

  /**
   * 先把**所有**临时上游变体转存，再做逐 0.5 秒的重分析。
   * 单条长曲的电平探针可能运行数分钟，若夹在两个变体的转存之间，墙钟一到就会
   * 只保住第一条、第二条仍留在 72 小时临时链，违背“全变体即时转存”。
   */
  const persisted: Array<{
    index: number;
    audio: Buffer;
    gcsUri: string;
    previewUrl: string;
  }> = [];
  for (let index = 0; index < urls.length; index += 1) {
    assertNotAborted(input.abortSignal);
    const response = await fetch(urls[index]!, { signal: input.abortSignal });
    if (!response.ok)
      throw new Error(`取回配乐变体 ${index} 失败 HTTP ${response.status}`);
    const audio = await readBgmAudioWithLimit(response, {
      abortSignal: input.abortSignal,
    });
    await assertBgmAudioPlayable(audio, input.abortSignal);

    // 72 小时临时链不能进入持久任务；每条验真后立刻转存，不等其余变体。
    const { gcsUri } = await uploadBufferToGcs({
      objectName: scoringBgmObjectName(userId, taskId, index),
      buffer: audio,
      contentType: "audio/mpeg",
      signal: input.abortSignal,
    });

    persisted.push({
      index,
      audio,
      gcsUri,
      previewUrl: signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600),
    });
  }

  const variants: ScoringRoomVariant[] = [];
  for (const row of persisted) {
    let structure: ManhuaBgmStructure | null = null;
    try {
      structure = await probeVariantStructure(
        row.audio,
        brief.duration,
        input.abortSignal
      );
    } catch (error) {
      // 电平结构是零成本增强，可降级；中止不能被吞掉，否则墙钟后还会继续起 ffmpeg。
      if (input.abortSignal?.aborted) throw abortError(input.abortSignal);
      console.warn(
        "[manhuaScoringRoom] 配乐变体结构量测失败：",
        error instanceof Error ? error.message : String(error)
      );
    }

    variants.push({
      index: row.index,
      gcsUri: row.gcsUri,
      previewUrl: row.previewUrl,
      bytes: row.audio.byteLength,
      structure,
    });
  }

  return {
    taskId,
    briefDigest,
    variants,
    elapsedMs: Math.max(0, Date.now() - startedAtMs),
    brief,
  };
}

/** 选定变体后交给既有 `bgm_mount` 的确定性参数。 */
export function buildBgmMountParamsFromScoring(input: {
  videoUri: string;
  bgm: Pick<ScoringRoomVariant, "gcsUri">;
  /** 真实画面事件 + 客观量测结构齐全时，自动编译卡点施工参数。 */
  events?: readonly FilmEvent[];
  structure?: ManhuaBgmStructure | null;
  filmDurationSec?: number;
  bgmVolume?: number;
  /** 旧入口手填入点；有 events + structure 时由最强击点对齐覆盖。 */
  entrySec?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
}) {
  const events = input.events ?? [];
  const filmDurationSec = Math.max(0, Number(input.filmDurationSec) || 0);
  const hasBeatPlan = Boolean(
    input.structure && events.length > 0 && filmDurationSec > 0
  );
  const alignment = hasBeatPlan
    ? buildBgmAlignment(input.structure!, events)
    : { entrySec: input.entrySec ?? 0, seekSec: 0 };
  const beatRows = hasBeatPlan
    ? buildBeatTable({
        structure: input.structure!,
        events,
        entrySec: alignment.entrySec,
        bgmSeekSec: alignment.seekSec,
        filmDurationSec,
      })
    : null;
  return {
    videoUri: input.videoUri,
    bgmUri: input.bgm.gcsUri,
    bgmVolume: input.bgmVolume ?? 0.48,
    entrySec: alignment.entrySec,
    bgmSeekSec: alignment.seekSec,
    fadeInSec: input.fadeInSec ?? 0.5,
    fadeOutSec: input.fadeOutSec ?? 1,
    ...(beatRows ? { volumeExpr: beatTableToVolumeExpr(beatRows) } : {}),
  };
}
