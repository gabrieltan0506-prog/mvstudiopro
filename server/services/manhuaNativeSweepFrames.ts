/**
 * 补扫取帧执行层：ffmpeg 探测信号 → 规划秒位 → 抽帧 → GCS → 签名 URL。
 *
 * 用户 0920 拍板「改」：不再整片丢给 GLM 让厂商均匀抽（15 秒 11 帧），
 * 改成我们自己按**信号**决定抽哪几秒。秒位规划是纯函数，在
 * shared/manhuaNativeSweepFramePlan.ts，可单测；本文件只负责跑 ffmpeg 与上传。
 *
 * 🔑 为什么秒位不用 LLM 定：切点与有声区间是纯信号，ffmpeg 测得出；
 * 「这一帧精不精彩」才需要理解内容，那是 GLM 的活，不是这里的活。
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { getGcsBucketName, signGsUriV4ReadUrl, uploadBufferToGcsIfAbsent } from "./gcs.js";
import {
  buildManhuaNativeSweepFramePlan,
  parseSweepSceneCutsFromShowinfo,
  parseSweepSpeechRegionsFromSilenceLog,
} from "../../shared/manhuaNativeSweepFramePlan.js";

/** 单片最多抽多少帧。帧数＝输入 token＝钱；12 张在 1 秒 1 帧的厂商口径之上，又不至于翻倍烧。 */
export const SWEEP_MAX_FRAMES_PER_SEGMENT = 12;
/** 场景切换阈值：0.4 是 ffmpeg 社区常用的「真切镜」线，低于它会把运动误判成切。 */
export const SWEEP_SCENE_THRESHOLD = 0.4;
const SWEEP_FFMPEG_TIMEOUT_MS = 180_000;
const SWEEP_FRAME_CONCURRENCY = 4;

export type SweepFrame = { atSecLocal: number; atSecAbsolute: number; url: string; objectName: string };

export type SweepFrameDeps = {
  runFfmpegCapture?: (args: string[], abortSignal?: AbortSignal) => Promise<string>;
  runFfmpeg?: (args: string[], abortSignal?: AbortSignal) => Promise<void>;
  makeTempDir?: () => Promise<string>;
  readFrame?: (path: string) => Promise<Buffer>;
  removePath?: (path: string, recursive?: boolean) => Promise<void>;
  upload?: typeof uploadBufferToGcsIfAbsent;
  bucket?: () => string;
  signUrl?: typeof signGsUriV4ReadUrl;
};

/** 跑 ffmpeg 并把 stderr 收回来（信号检测的结果都在 stderr）。 */
function runFfmpegCapture(args: string[], abortSignal?: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    execFile("ffmpeg", args, { maxBuffer: 32 * 1024 * 1024, timeout: SWEEP_FFMPEG_TIMEOUT_MS, signal: abortSignal },
      (_error, _stdout, stderr) => resolve(String(stderr || "")));
  });
}
function runFfmpeg(args: string[], abortSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, { maxBuffer: 8 * 1024 * 1024, timeout: SWEEP_FFMPEG_TIMEOUT_MS, signal: abortSignal },
      (error) => error ? reject(new Error("补扫抽帧未完成")) : resolve());
  });
}

async function mapConcurrent<T, R>(rows: readonly T[], limit: number, fn: (row: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(rows.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    for (;;) {
      const i = next; next += 1;
      if (i >= rows.length) return;
      out[i] = await fn(rows[i]!, i);
    }
  }));
  return out;
}

/**
 * 探测本片的切点与有声区间。**任何失败都返回空**，由调用方退回疏抽——
 * 补扫是增益步骤，探测不到信号不该让整片失败。
 */
export async function probeSweepSignals(input: {
  mediaUrl: string;
  lenSec: number;
  abortSignal?: AbortSignal;
}, deps: SweepFrameDeps = {}): Promise<{
  sceneCutsSec: number[];
  speechRegions: Array<{ start: number; end: number }>;
}> {
  const capture = deps.runFfmpegCapture ?? runFfmpegCapture;
  const empty = { sceneCutsSec: [] as number[], speechRegions: [] as Array<{ start: number; end: number }> };
  try {
    // 一趟 ffmpeg 同时跑视频侧 scene 检测与音频侧 silencedetect，不落盘（-f null）。
    const stderr = await capture([
      "-nostdin", "-hide_banner", "-i", input.mediaUrl,
      "-filter_complex",
      `[0:v]select='gt(scene,${SWEEP_SCENE_THRESHOLD})',showinfo[v];[0:a]silencedetect=noise=-32dB:d=0.45[a]`,
      "-map", "[v]", "-map", "[a]", "-f", "null", "-",
    ], input.abortSignal);
    return {
      sceneCutsSec: parseSweepSceneCutsFromShowinfo(stderr),
      speechRegions: parseSweepSpeechRegionsFromSilenceLog(stderr, input.lenSec),
    };
  } catch {
    return empty;
  }
}

/**
 * 抽帧 → GCS → 签名 URL。失败的单帧跳过，不抛。
 */
export async function extractSweepFrames(input: {
  seriesKey: string;
  episodeIndex: number;
  segmentIndex: number;
  mediaUrl: string;
  /** 本片在全片中的起点（绝对秒），用于把局部秒换算成绝对秒。 */
  segmentStartSec: number;
  lenSec: number;
  maxFrames?: number;
  abortSignal?: AbortSignal;
}, deps: SweepFrameDeps = {}): Promise<SweepFrame[]> {
  const ff = deps.runFfmpeg ?? runFfmpeg;
  const makeTemp = deps.makeTempDir ?? (() => mkdtemp(join(tmpdir(), "sweep-frames-")));
  const read = deps.readFrame ?? readFile;
  const remove = deps.removePath ?? (async (p: string, recursive = false) => { await rm(p, { force: true, recursive }); });
  const upload = deps.upload ?? uploadBufferToGcsIfAbsent;
  const bucketOf = deps.bucket ?? getGcsBucketName;
  const sign = deps.signUrl ?? signGsUriV4ReadUrl;

  const signals = await probeSweepSignals({ mediaUrl: input.mediaUrl, lenSec: input.lenSec, abortSignal: input.abortSignal }, deps);
  const plan = buildManhuaNativeSweepFramePlan({
    lenSec: input.lenSec,
    sceneCutsSec: signals.sceneCutsSec,
    speechRegions: signals.speechRegions,
    maxFrames: Math.max(1, input.maxFrames ?? SWEEP_MAX_FRAMES_PER_SEGMENT),
  });
  if (!plan.length) return [];

  let tempDir: string;
  try { tempDir = await makeTemp(); } catch { return []; }
  try {
    const bucket = bucketOf();
    const rows = await mapConcurrent(plan, SWEEP_FRAME_CONCURRENCY, async (atSecLocal, index) => {
      const outputPath = join(tempDir, `sweep-${String(index).padStart(3, "0")}.jpg`);
      try {
        // -ss 放在 -i 之前＝快速 seek；补扫只要「大概这一秒」，不需要精确 seek 的代价。
        await ff([
          "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
          "-ss", String(atSecLocal), "-i", input.mediaUrl,
          "-map", "0:v:0", "-frames:v", "1", "-q:v", "4", outputPath,
        ], input.abortSignal);
        const buffer = await read(outputPath);
        if (!buffer?.byteLength) return null;
        const sha = createHash("sha256").update(buffer).digest("hex");
        const objectName = `manhua-template-learn/sweep-frames/${input.seriesKey}/ep${
          String(input.episodeIndex).padStart(3, "0")}/seg${
          String(input.segmentIndex).padStart(3, "0")}/${sha.slice(0, 16)}.jpg`;
        await upload({
          bucket, objectName, buffer, contentType: "image/jpeg",
          metadata: { atSecLocal: String(atSecLocal), segmentIndex: String(input.segmentIndex) },
        });
        return {
          atSecLocal,
          atSecAbsolute: Math.round((input.segmentStartSec + atSecLocal) * 10) / 10,
          objectName,
          url: sign(`gs://${bucket}/${objectName}`, 2 * 3600),
        } satisfies SweepFrame;
      } catch {
        return null;
      } finally {
        await remove(outputPath).catch(() => undefined);
      }
    });
    return rows.filter((row): row is SweepFrame => row !== null);
  } finally {
    await remove(tempDir, true).catch(() => undefined);
  }
}
