/**
 * 对白秒锁母轨拼接（0901 夜施工，TTS 闭环第一刀）。
 *
 * 输入是逐句 TTS mp3 与台词表秒位（shared/manhuaPromptCompiler.ts 的 buildTtsCueSheet），
 * 输出一条可直接作参考音频投给引擎的母轨。工艺全部来自知识库《秒锁单轨工艺》：
 * - 母轨只许纯对白，句间是真静音（anullsrc 打底，不是压音量）；
 * - 每句先 silenceremove 掐头去尾，再 adelay 落到台词表秒位；
 * - 首句开口前必须留 ≥1.5s 跑道（口型锚点：音频起点＝首句开口时刻由提示词交代）；
 * - 30s 顶格裁 29.7s 且必须重编码（-c copy 裁不准）；
 * - 引擎时长下限不许垫静音凑（用户 0822 明令）：不足回 TTS 重出长句。
 */
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { uploadBufferToGcs } from "./gcs.js";

const execFileAsync = promisify(execFile);
/** stdout+stderr 一并返回：silencedetect 的证据写在 stderr */
export type MasterTrackMediaRunner = (
  cmd: "ffmpeg" | "ffprobe",
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<string>;
const defaultRunMedia: MasterTrackMediaRunner = async (cmd, args, timeoutMs, signal) => {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    signal,
  });
  return `${stdout ?? ""}\n${stderr ?? ""}`;
};

/** 引擎参考音频时长约束（知识库《秒锁单轨工艺》实测口径） */
export const DIALOGUE_MASTER_TRACK_ENGINE_LIMITS = {
  evolink: { minSec: 2, maxSec: 30 },
  byteplus: { minSec: 1.8, maxSec: 30 },
  wan30: { minSec: 0, maxSec: 15 },
} as const;
export type DialogueMasterTrackEngine = keyof typeof DIALOGUE_MASTER_TRACK_ENGINE_LIMITS;

/** 首句前的静音跑道下限 */
export const DIALOGUE_MASTER_TRACK_LEAD_IN_SEC = 1.5;
/** 30s 顶格档的实际裁切点 */
export const DIALOGUE_MASTER_TRACK_HARD_CAP_SEC = 29.7;

const lineSchema = z.object({
  /** 句序（台词表顺序），只用于报错定位 */
  index: z.number().int().min(0),
  /** 本句在母轨上的开口秒位（来自 buildTtsCueSheet 的 startSec） */
  startSec: z.number().finite().min(0),
  /** 本句 TTS 产物的实际时长（ffprobe 实测，不是台词表窗口） */
  audioDurationSec: z.number().finite().positive(),
});
export type DialogueMasterTrackLine = z.infer<typeof lineSchema>;

export type DialogueMasterTrackPlan = {
  /** filter_complex 全文；输入 [0..n-1] 为逐句 mp3，静音底由 anullsrc 在图内生成 */
  filterGraph: string;
  /** 输出母轨时长（裁切后） */
  totalDurationSec: number;
  /** 是否触发 29.7s 顶格裁切 */
  hardCapApplied: boolean;
};

/**
 * 纯函数计划：钉住「不报错但全体错位」的滤镜顺序
 * silenceremove → asetpts → adelay → amix(静音底) → atrim → 重编码由调用方 args 承担。
 */
export function buildDialogueMasterTrackPlan(input: {
  lines: readonly DialogueMasterTrackLine[];
  /** 目标窗口时长（通常＝分段时长）；母轨不会长于它 */
  windowDurationSec: number;
  engine: DialogueMasterTrackEngine;
}): DialogueMasterTrackPlan {
  const lines = z.array(lineSchema).min(1).parse(input.lines);
  const limits = DIALOGUE_MASTER_TRACK_ENGINE_LIMITS[input.engine];
  if (!limits) throw new Error(`未知引擎 ${String(input.engine)}`);
  const window = Number(input.windowDurationSec);
  if (!Number.isFinite(window) || window <= 0) throw new Error("母轨窗口时长无效");

  const ordered = [...lines].sort((a, b) => a.startSec - b.startSec);
  if (ordered[0]!.startSec < DIALOGUE_MASTER_TRACK_LEAD_IN_SEC) {
    throw new Error(
      `首句开口秒位 ${ordered[0]!.startSec}s 早于 ${DIALOGUE_MASTER_TRACK_LEAD_IN_SEC}s 跑道下限；`
      + `请把台词表整体后移，不要砍跑道`,
    );
  }
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1]!;
    const prevEnd = prev.startSec + prev.audioDurationSec;
    if (ordered[i]!.startSec < prevEnd - 0.05) {
      throw new Error(
        `第${prev.index + 1}句（止于 ${prevEnd.toFixed(2)}s）与第${ordered[i]!.index + 1}句`
        + `（起于 ${ordered[i]!.startSec}s）在母轨上重叠；句间必须是真静音`,
      );
    }
  }

  const lastEnd = ordered.at(-1)!.startSec + ordered.at(-1)!.audioDurationSec;
  let totalDurationSec = Math.min(window, lastEnd + 0.3);
  let hardCapApplied = false;
  if (totalDurationSec > DIALOGUE_MASTER_TRACK_HARD_CAP_SEC) {
    if (lastEnd > DIALOGUE_MASTER_TRACK_HARD_CAP_SEC) {
      throw new Error(
        `末句止于 ${lastEnd.toFixed(2)}s，超过 ${DIALOGUE_MASTER_TRACK_HARD_CAP_SEC}s 顶格线；`
        + `请缩台词或拆段，不得让引擎裁掉尾句`,
      );
    }
    totalDurationSec = DIALOGUE_MASTER_TRACK_HARD_CAP_SEC;
    hardCapApplied = true;
  }
  if (totalDurationSec > limits.maxSec) {
    throw new Error(
      `母轨 ${totalDurationSec.toFixed(2)}s 超过 ${input.engine} 上限 ${limits.maxSec}s；请拆段`,
    );
  }
  if (totalDurationSec < limits.minSec) {
    // 用户 0822 明令：禁止垫静音凑时长
    throw new Error(
      `母轨 ${totalDurationSec.toFixed(2)}s 低于 ${input.engine} 下限 ${limits.minSec}s；`
      + `回 TTS 重出更长的句子，禁止垫静音凑时长`,
    );
  }

  const parts: string[] = [];
  const mixLabels: string[] = [];
  ordered.forEach((line, slot) => {
    const delayMs = Math.round(line.startSec * 1000);
    parts.push(
      `[${slot}:a]`
      + `silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,`
      + `areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,`
      + `asetpts=PTS-STARTPTS,`
      + `adelay=${delayMs}|${delayMs}`
      + `[v${slot}]`,
    );
    mixLabels.push(`[v${slot}]`);
  });
  // 静音底：真空由 anullsrc 提供，句子 amix 落位；normalize=0 保各句原电平
  parts.push(
    `anullsrc=r=44100:cl=stereo,atrim=0:${totalDurationSec.toFixed(3)},asetpts=PTS-STARTPTS[base]`,
  );
  parts.push(
    `[base]${mixLabels.join("")}amix=inputs=${mixLabels.length + 1}:duration=first:normalize=0,`
    + `atrim=0:${totalDurationSec.toFixed(3)}[master]`,
  );
  return { filterGraph: parts.join(";"), totalDurationSec, hardCapApplied };
}

/** ffmpeg 完整参数：调用方喂逐句本地路径，产物必然重编码（顶格裁切精度要求） */
export function buildDialogueMasterTrackArgs(input: {
  lineLocalPaths: readonly string[];
  plan: DialogueMasterTrackPlan;
  outputPath: string;
}): string[] {
  if (!input.lineLocalPaths.length) throw new Error("母轨没有输入句");
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror", "-y",
    ...input.lineLocalPaths.flatMap((path) => ["-i", path]),
    "-filter_complex", input.plan.filterGraph,
    "-map", "[master]",
    "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100",
    input.outputPath,
  ];
}


/* ────────────────── 执行层：逐句合成产物 → 单条母轨落 GCS ────────────────── */

export type MasterTrackRenderDeps = {
  /** 拉取逐句 mp3（GCS 签名 URL）。可注入替身测试 */
  fetchAudio?: (url: string, signal?: AbortSignal) => Promise<Buffer>;
  runMedia?: MasterTrackMediaRunner;
  uploadAudio?: typeof uploadBufferToGcs;
};

const defaultFetchAudio = async (url: string, signal?: AbortSignal): Promise<Buffer> => {
  const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`拉取逐句音频失败 HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

/** ffprobe 实测一段本地音频时长（母轨秒位以实测为准，不信 TTS 报的） */
async function probeLocalAudioDurationSec(
  path: string,
  runMedia: MasterTrackMediaRunner,
  signal?: AbortSignal,
): Promise<number> {
  const text = await runMedia("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "json", path,
  ], 30_000, signal);
  const sec = Number(JSON.parse(text)?.format?.duration);
  if (!Number.isFinite(sec) || sec <= 0) throw new Error("逐句音频时长探测失败");
  return sec;
}

export async function renderManhuaDialogueMasterTrack(input: {
  ownerUserId: number;
  /** 逐句：TTS 产物 URL + 台词表开口秒位 */
  lines: ReadonlyArray<{ index: number; audioUrl: string; startSec: number }>;
  windowDurationSec: number;
  engine: DialogueMasterTrackEngine;
  signal?: AbortSignal;
}, deps: MasterTrackRenderDeps = {}): Promise<{
  audioGcsUri: string;
  objectName: string;
  totalDurationSec: number;
  hardCapApplied: boolean;
  bytes: number;
}> {
  const fetchAudio = deps.fetchAudio ?? defaultFetchAudio;
  const runMedia = deps.runMedia ?? defaultRunMedia;
  const uploadAudio = deps.uploadAudio ?? uploadBufferToGcs;
  const runId = crypto.randomUUID();
  const tmpPaths: string[] = [];
  try {
    const measured: DialogueMasterTrackLine[] = [];
    for (const lineInput of input.lines) {
      const buf = await fetchAudio(lineInput.audioUrl, input.signal);
      const path = `/tmp/manhua-dialogue-line-${runId}-${lineInput.index}.mp3`;
      await fs.writeFile(path, buf);
      tmpPaths.push(path);
      measured.push({
        index: lineInput.index,
        startSec: lineInput.startSec,
        audioDurationSec: await probeLocalAudioDurationSec(path, runMedia, input.signal),
      });
    }
    const ordered = [...measured].sort((a, b) => a.startSec - b.startSec);
    const plan = buildDialogueMasterTrackPlan({
      lines: ordered,
      windowDurationSec: input.windowDurationSec,
      engine: input.engine,
    });
    const outputPath = `/tmp/manhua-dialogue-master-${runId}.mp3`;
    tmpPaths.push(outputPath);
    const orderedPaths = ordered.map((row) =>
      `/tmp/manhua-dialogue-line-${runId}-${row.index}.mp3`);
    await runMedia("ffmpeg", buildDialogueMasterTrackArgs({
      lineLocalPaths: orderedPaths,
      plan,
      outputPath,
    }), 5 * 60_000, input.signal);
    // 自检①：成品时长与计划一致（顶格裁切必须真的裁到位）
    const renderedSec = await probeLocalAudioDurationSec(outputPath, runMedia, input.signal);
    if (Math.abs(renderedSec - plan.totalDurationSec) > 0.35) {
      throw new Error(`母轨成品 ${renderedSec.toFixed(2)}s 与计划 ${plan.totalDurationSec.toFixed(2)}s 不符`);
    }
    // 自检②：silencedetect 证明句间存在真静音（多句时至少一段；禁 Gemini 耳测）
    if (ordered.length > 1) {
      const det = await runMedia("ffmpeg", [
        "-nostdin", "-hide_banner", "-i", outputPath,
        "-af", "silencedetect=noise=-45dB:d=0.2", "-f", "null", "-",
      ], 60_000, input.signal).catch((e) => String(e));
      if (!/silence_start/.test(String(det))) {
        throw new Error("母轨自检未测到句间真静音，拒绝入库");
      }
    }
    const master = await fs.readFile(outputPath);
    const objectName = `manhua-dialogue-master/${input.ownerUserId}/${runId}.mp3`;
    const uploaded = await uploadAudio({
      objectName,
      contentType: "audio/mpeg",
      buffer: master,
    });
    return {
      audioGcsUri: uploaded.gcsUri,
      objectName,
      totalDurationSec: plan.totalDurationSec,
      hardCapApplied: plan.hardCapApplied,
      bytes: master.length,
    };
  } finally {
    await Promise.allSettled(tmpPaths.map((path) => fs.unlink(path)));
  }
}
