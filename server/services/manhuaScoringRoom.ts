/**
 * 配乐间：剧情段表 → BGM → 可直接喂 `bgm_mount` 的 gs://。
 *
 * **没有曲库**（用户 0824 定）：BGM 由剧情自动填 music prompt，时长按段表指定。
 * 所以这里不做「上传/入库/选段」，只做一条直线：
 *
 *   段表 → buildManhuaBgmBrief（题材查表 + 段情绪 + duration）
 *        → EvoLink Suno V5.5 建单 → 轮询
 *        → 即取即转 GCS（Suno 产物 72h 过期，直链不能进库）
 *        → 返回 gs://，交给 #1285 已有的 bgm_mount
 *
 * ⚠️ 这一步**花钱**（per_call 预留 10 credits），调用方必须已过发车检查单。
 */
import { buildManhuaBgmBrief, type BgmBeatMood } from "../../shared/manhuaBgmBrief.js";
import {
  createEvolinkSunoTask,
  getEvolinkSunoTask,
  pickEvolinkSunoAudioUrls,
} from "./evolinkSunoMusic.js";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { promisify } from "node:util";
import { signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs.js";
import { readBgmStructure, type BgmStructure } from "../../shared/manhuaBeatTable.js";
import { probeBgmLevels } from "./manhuaBgmLevelProbe.js";

const execFileAsync = promisify(execFile);

/** 单条变体上限；超了说明上游给错了东西 */
export const MAX_BGM_VARIANT_BYTES = 64 * 1024 * 1024;

/** 流式累计字节：不先整体 arrayBuffer 再检查——那时内存已经吃进去了 */
export async function readBgmAudioWithLimit(
  response: Response,
  maxBytes = MAX_BGM_VARIANT_BYTES,
): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("配乐文件超过处理上限");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("配乐下载缺少响应流");
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("配乐文件超过处理上限");
    }
    chunks.push(Buffer.from(value));
  }
  if (!total) throw new Error("配乐文件为空");
  return Buffer.concat(chunks);
}

/**
 * 用 ffprobe 确认真有音轨。
 *
 * **不能只信 URL 或 Content-Type**：上游给错东西、CDN 返回错误页
 * 都会带着看起来正常的头。落进曲库的必须是真音频。
 */
/** 落临时文件 → 逐 0.5 秒量电平 → 读结构；量完即删 */
async function probeVariantStructure(
  buf: Buffer,
  totalSec: number,
  abortSignal?: AbortSignal,
): Promise<BgmStructure | null> {
  const dir = await mkdtemp(nodePath.join(tmpdir(), "mvbgmlv-"));
  const file = nodePath.join(dir, "v.mp3");
  try {
    await writeFile(file, buf);
    const samples = await probeBgmLevels(file, { totalSec, abortSignal });
    return readBgmStructure(samples);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function assertBgmAudioPlayable(buf: Buffer, abortSignal?: AbortSignal): Promise<void> {
  const dir = await mkdtemp(nodePath.join(tmpdir(), "mvbgm-"));
  const file = nodePath.join(dir, "v.mp3");
  try {
    await writeFile(file, buf);
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file],
      { timeout: 60_000, signal: abortSignal },
    );
    if (!String(stdout).includes("audio")) throw new Error("配乐文件里没有音轨");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
import { postProdOutputPrefix } from "./postProdMediaSource.js";

export type ScoringRoomRequest = {
  /** 赛道，决定器乐底色 */
  laneZh: string;
  /** 时长由用户指定（10–360）；不靠提示词求，直接进 duration 参数 */
  durationSec: number;
  /** 段情绪走向 */
  moods: readonly BgmBeatMood[];
  /** 读片得到的情绪弧线；片后配乐时优先用它——读片看到的比剧本猜的准 */
  moodArcZh?: string;
  /** 收尾方式，必须写死；不写模型自己选，混进片子和尾钩打架 */
  endingZh?: string;
  /** 有明确节拍点时的分段 bpm */
  tempoPlanZh?: string;
  bpm?: number;
  /** 作品风格锚（作品名可用，人名会被 Suno 拦） */
  styleAnchorZh?: string;
  titleZh?: string;
  /** 用户在卡面改过的 style；给了就原样用 */
  styleOverrideZh?: string;
  /** 画面有静音停顿 → 结构里插 [Break] 让模型自己留空 */
  hasSilenceBreak?: boolean;
};

export type ScoringRoomVariant = {
  index: number;
  gcsUri: string;
  /** 供试听；进 bgm_mount 用 gcsUri */
  previewUrl: string;
  bytes: number;
  /**
   * 逐 0.5 秒量出的曲子结构（最强击点 / 天然空隙 / 衰减起点）。
   *
   * skill 要求「挑变体先量再听」—— 两条变体不能凭感觉挑，
   * 要看结构对不对得上画面。这也是卡点表的输入。
   */
  structure?: BgmStructure | null;
};

export type ScoringRoomResult = {
  taskId: string;
  /**
   * 一次请求出多个变体，**全部转存后返回**。
   * skill 要求「先量再听」——只留第一条就没法逐 0.5 秒量电平对结构。
   */
  variants: ScoringRoomVariant[];
  elapsedMs: number;
  brief: ReturnType<typeof buildManhuaBgmBrief>;
};

/**
 * BGM 落**本人后期工坊前缀**。
 *
 * 上一版写 `manhua-bgm/<日期>/…`，而 resolvePostProdInputSources 只放行四类
 * （本人 post-prod 产物 / 本人上传 / 登记簿验主的画布素材 / 该用户 succeeded
 * 任务的明确产物）。那个前缀一类都不沾，真去贴装会被判「素材尚未登记」——
 * 生成出来了却进不了 bgm_mount，等于白花。
 */
export function scoringBgmObjectName(
  userId: string,
  taskId: string,
  variantIndex: number,
): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const safeTask = String(taskId).replace(/[^0-9A-Za-z_-]/g, "").slice(0, 60);
  return `${postProdOutputPrefix(userId)}bgm/${stamp}/${safeTask}-v${variantIndex}.mp3`;
}

/** 轮询上限：文档给的预估是 120s，留三倍余量 */
const POLL_TIMEOUT_MS = 6 * 60_000;
const POLL_INTERVAL_MS = 5_000;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("已取消"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(new Error("已取消"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * 生成一段 BGM 并落 GCS。
 *
 * 变体默认取第一条：一次请求会出多个，但配乐间是自动链路，
 * 需要人挑时由调用方拿 `variantCount` 再决定，不在这里做交互。
 */
/**
 * 建单：**只发一次 POST，立刻返回 task id 供持久化**。
 *
 * 与轮询分开是为了让 worker 重启时能「只恢复轮询、不重新建单」——
 * 上一版建单和轮询在同一个函数里，实例一重启就只能整单重来，等于再付一次。
 */
export async function createManhuaBgmTask(
  brief: ReturnType<typeof buildManhuaBgmBrief>,
  opts: { abortSignal?: AbortSignal } = {},
): Promise<{ taskId: string }> {
  const task = await createEvolinkSunoTask(brief, { abortSignal: opts.abortSignal });
  return { taskId: task.id };
}

/**
 * 续跑：轮询既有任务 → 变体全部转存本人后期前缀。
 *
 * 只吃 taskId，不碰建单 —— worker 重启走这条，不会产生第二次付费。
 */
export async function resumeManhuaBgmTask(input: {
  taskId: string;
  userId: string;
  brief: ReturnType<typeof buildManhuaBgmBrief>;
  startedAtMs?: number;
  abortSignal?: AbortSignal;
  /** 仅供测试压缩等待；生产走默认 5 秒 */
  pollIntervalMs?: number;
}): Promise<ScoringRoomResult> {
  const userId = String(input.userId || "").trim();
  if (!userId) throw new Error("配乐缺少会话用户，无法落本人后期前缀");
  const startedAt = input.startedAtMs ?? Date.now();

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let raw: unknown = null;
  for (;;) {
    if (input.abortSignal?.aborted) throw new Error("已取消");
    if (Date.now() > deadline) {
      throw new Error(`配乐任务 ${input.taskId} 超过 ${POLL_TIMEOUT_MS / 60000} 分钟未完成`);
    }
    await sleep(input.pollIntervalMs ?? POLL_INTERVAL_MS, input.abortSignal);
    const polled = await getEvolinkSunoTask(input.taskId, { abortSignal: input.abortSignal });
    if (polled.task.status === "completed") {
      raw = polled.raw;
      break;
    }
    if (polled.task.status === "failed" || polled.task.status === "cancelled") {
      throw new Error(`配乐任务 ${input.taskId} ${polled.task.status}`);
    }
  }

  const urls = pickEvolinkSunoAudioUrls(raw);
  if (!urls.length) throw new Error(`配乐任务 ${input.taskId} 完成但没有音频地址`);

  // Suno 产物 72h 过期 —— 全部变体即取即转，交用户「先量再听」
  const variants: ScoringRoomVariant[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    const got = await fetch(urls[i]!, { signal: input.abortSignal });
    if (!got.ok) throw new Error(`取回配乐变体 ${i} 失败 HTTP ${got.status}`);
    const audio = await readBgmAudioWithLimit(got);
    // 落进曲库的必须是真音频，不能只信 URL 或 Content-Type
    await assertBgmAudioPlayable(audio, input.abortSignal);
    const { gcsUri } = await uploadBufferToGcs({
      objectName: scoringBgmObjectName(userId, input.taskId, i),
      buffer: audio,
      contentType: "audio/mpeg",
    });
    // 顺手量结构：纯 ffmpeg 零成本，挑变体与做卡点表都要它
    let structure: BgmStructure | null = null;
    try {
      structure = await probeVariantStructure(audio, input.brief.duration, input.abortSignal);
    } catch (e) {
      // 量不到不阻断落库：曲子还是能用，只是挑变体时少一份客观依据
      console.warn("[scoringRoom] 变体结构量测失败：", e instanceof Error ? e.message : e);
    }
    variants.push({
      index: i,
      gcsUri,
      previewUrl: signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600),
      bytes: audio.length,
      structure,
    });
  }

  return {
    taskId: input.taskId,
    variants,
    elapsedMs: Date.now() - startedAt,
    brief: input.brief,
  };
}

/**
 * 配乐 → `bgm_mount` 入参。
 *
 * 把「生成」和「贴装」之间那段拼装收在一处：
 * 各处自己拼 params 迟早会出现某处漏了 fadeOut、某处音量写死。
 */
export function buildBgmMountParamsFromScoring(input: {
  videoUri: string;
  /** 用户选定的那条变体 */
  bgm: Pick<ScoringRoomVariant, "gcsUri">;
  /** 0.48 规实弹默认 */
  bgmVolume?: number;
  entrySec?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
}) {
  return {
    videoUri: input.videoUri,
    bgmUri: input.bgm.gcsUri,
    bgmVolume: input.bgmVolume ?? 0.48,
    entrySec: input.entrySec ?? 0,
    fadeInSec: input.fadeInSec ?? 0.5,
    fadeOutSec: input.fadeOutSec ?? 1,
  };
}
