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
import { signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs.js";

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

export type ScoringRoomResult = {
  gcsUri: string;
  /** 供试听；进 bgm_mount 用 gcsUri */
  previewUrl: string;
  bytes: number;
  taskId: string;
  /** 一次请求出多个变体，这里记下总数，采用的是第几条 */
  variantCount: number;
  brief: ReturnType<typeof buildManhuaBgmBrief>;
};

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
export async function generateManhuaBgm(
  req: ScoringRoomRequest,
  opts: { abortSignal?: AbortSignal; variantIndex?: number } = {},
): Promise<ScoringRoomResult> {
  const brief = buildManhuaBgmBrief({
    laneZh: req.laneZh,
    moods: req.moods,
    durationSec: req.durationSec,
    moodArcZh: req.moodArcZh,
    endingZh: req.endingZh,
    tempoPlanZh: req.tempoPlanZh,
    bpm: req.bpm,
    styleAnchorZh: req.styleAnchorZh,
    titleZh: req.titleZh,
    styleOverrideZh: req.styleOverrideZh,
    hasSilenceBreak: req.hasSilenceBreak,
  });

  const task = await createEvolinkSunoTask(brief, { abortSignal: opts.abortSignal });

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let raw: unknown = null;
  for (;;) {
    if (opts.abortSignal?.aborted) throw new Error("已取消");
    if (Date.now() > deadline) throw new Error(`配乐任务 ${task.id} 超过 ${POLL_TIMEOUT_MS / 60000} 分钟未完成`);
    await sleep(POLL_INTERVAL_MS, opts.abortSignal);
    const polled = await getEvolinkSunoTask(task.id, { abortSignal: opts.abortSignal });
    if (polled.task.status === "completed") {
      raw = polled.raw;
      break;
    }
    if (polled.task.status === "failed" || polled.task.status === "cancelled") {
      throw new Error(`配乐任务 ${task.id} ${polled.task.status}`);
    }
  }

  const urls = pickEvolinkSunoAudioUrls(raw);
  if (!urls.length) throw new Error(`配乐任务 ${task.id} 完成但没有音频地址`);
  const pick = urls[Math.min(Math.max(0, opts.variantIndex ?? 0), urls.length - 1)]!;

  // Suno 产物 72h 过期，直链不能进库 —— 即取即转
  const got = await fetch(pick, { signal: opts.abortSignal });
  if (!got.ok) throw new Error(`取回配乐失败 HTTP ${got.status}`);
  const audio = Buffer.from(await got.arrayBuffer());
  if (!audio.length) throw new Error("配乐音频为空");

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 8);
  const { gcsUri } = await uploadBufferToGcs({
    objectName: `manhua-bgm/${stamp}/${task.id}-${rand}.mp3`,
    buffer: audio,
    contentType: "audio/mpeg",
  });

  return {
    gcsUri,
    previewUrl: signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600),
    bytes: audio.length,
    taskId: task.id,
    variantCount: urls.length,
    brief,
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
  bgm: Pick<ScoringRoomResult, "gcsUri">;
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
