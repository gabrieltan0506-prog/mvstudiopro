import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  BASE_STRIDE_SEC,
  CLIMAX_STRIDE_SEC,
  type ClimaxWindow,
} from "../../shared/manhuaTemplateLearnFramePlan.js";

const execFileAsync = promisify(execFile);
const MEDIA_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAX_DEEP_WINDOWS = 3;
const MAX_DEEP_WINDOW_SEC = 24;

export type ManhuaRemoteMediaSource = {
  url: string;
  referer?: string;
};

export type ManhuaDenseFrame = {
  path: string;
  atSec: number;
};

export type ManhuaDenseFrameSample = {
  frames: ManhuaDenseFrame[];
  requestedCount: number;
  extractedCount: number;
  success: boolean;
};

function remoteInputArgs(source: ManhuaRemoteMediaSource, startSec: number): string[] {
  const isHttpSource = /^https?:\/\//i.test(source.url);
  return [
    "-ss",
    String(Math.max(0, startSec)),
    ...(isHttpSource ? ["-user_agent", MEDIA_UA] : []),
    ...(source.referer ? ["-headers", `Referer: ${source.referer}\r\n`] : []),
    "-i",
    source.url,
  ];
}

export function classifyRemoteFfmpegFailure(stderr: unknown, fallbackZh: string): string {
  const detail = String(stderr || "").toLowerCase();
  if (/server returned 403|http error 403|error 403/.test(detail)) {
    return "媒体节点拒绝访问";
  }
  if (/server returned 404|http error 404|error 404/.test(detail)) {
    return "媒体地址已失效";
  }
  if (/server returned 416|http error 416|error 416/.test(detail)) {
    return "媒体分段范围不可用";
  }
  if (/timed out|timeout|connection reset|connection refused/.test(detail)) {
    return "媒体读取超时或连接中断";
  }
  if (
    /channel element|non-existing pps|decode_slice_header|invalid data found|error while decoding|moov atom not found|could not find codec parameters/.test(
      detail,
    )
  ) {
    return "媒体数据体损坏或不可解码";
  }
  return fallbackZh;
}

async function runRemoteFfmpeg(
  args: string[],
  errorZh: string,
  timeoutMs = 300_000,
): Promise<void> {
  try {
    await execFileAsync("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args], {
      // 单核/双核机上的 10 分钟远程媒体解码会明显慢于本地文件。
      timeout: timeoutMs,
    });
  } catch (error) {
    // Error.message 会带完整签名 URL，不能写进日志或前台。
    const stderr = error && typeof error === "object" && "stderr" in error
      ? (error as { stderr?: unknown }).stderr
      : "";
    throw new Error(classifyRemoteFfmpegFailure(stderr, errorZh));
  }
}

/**
 * ffprobe 只能证明容器头可读；部分 CDN 响应会保留时长/轨道元数据，
 * 但 AAC 数据体已经损坏。模型调用前先真实解码 2 秒音频。
 */
export async function probeRemoteManhuaMediaDecodability(
  source: ManhuaRemoteMediaSource,
): Promise<void> {
  await runRemoteFfmpeg(
    [
      ...remoteInputArgs(source, 0),
      "-t",
      "2",
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "null",
      "-",
    ],
    "媒体数据体损坏或不可解码",
    25_000,
  );
}

export async function extractRemoteManhuaAudio(input: {
  source: ManhuaRemoteMediaSource;
  startSec: number;
  durationSec: number;
  outputPath: string;
}): Promise<void> {
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  await runRemoteFfmpeg(
    [
      ...remoteInputArgs(input.source, input.startSec),
      "-t",
      String(Math.max(1, input.durationSec)),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      input.outputPath,
    ],
    "语音流提取失败（媒体地址失效或节点拒绝）",
  );
  const stat = await fs.stat(input.outputPath).catch(() => null);
  if (!stat || stat.size < 1024) throw new Error("语音流为空，不能计为学习成功");
}

function trimDeepWindows(
  windows: ClimaxWindow[],
  durationSec: number,
): Array<{ startSec: number; endSec: number }> {
  return windows.slice(0, MAX_DEEP_WINDOWS).map((window) => {
    const start = Math.max(0, Math.min(durationSec, window.startSec));
    const rawEnd = Math.max(start, Math.min(durationSec, window.endSec));
    const end = Math.min(rawEnd, start + MAX_DEEP_WINDOW_SEC);
    return { startSec: start, endSec: end };
  }).filter((window) => window.endSec - window.startSec >= 1);
}

async function readNumberedFrames(input: {
  dir: string;
  prefix: string;
  absoluteStartSec: number;
  strideSec: number;
}): Promise<ManhuaDenseFrame[]> {
  const names = (await fs.readdir(input.dir))
    .filter((name) => name.startsWith(input.prefix) && name.endsWith(".jpg"))
    .sort();
  return names.map((name, index) => ({
    path: path.join(input.dir, name),
    atSec: Number((input.absoluteStartSec + index * input.strideSec).toFixed(2)),
  }));
}

export async function extractRemoteManhuaDenseFrames(input: {
  source: ManhuaRemoteMediaSource;
  segmentStartSec: number;
  durationSec: number;
  framesDir: string;
  baseTimestamps: number[];
  climaxWindows: ClimaxWindow[];
}): Promise<ManhuaDenseFrameSample> {
  await fs.mkdir(input.framesDir, { recursive: true });
  const durationSec = Math.max(1, input.durationSec);
  const basePattern = path.join(input.framesDir, "base-%05d.jpg");
  await runRemoteFfmpeg(
    [
      ...remoteInputArgs(input.source, input.segmentStartSec),
      "-t",
      String(durationSec),
      "-vf",
      `fps=1/${BASE_STRIDE_SEC},scale=640:-2:force_original_aspect_ratio=decrease`,
      "-q:v",
      "4",
      basePattern,
    ],
    "高密度基线抽帧失败（媒体流中断或画面不可解码）",
  );
  const frames = await readNumberedFrames({
    dir: input.framesDir,
    prefix: "base-",
    absoluteStartSec: input.segmentStartSec,
    strideSec: BASE_STRIDE_SEC,
  });

  const deepWindows = trimDeepWindows(input.climaxWindows, durationSec);
  for (let index = 0; index < deepWindows.length; index++) {
    const window = deepWindows[index]!;
    const prefix = `deep-${String(index + 1).padStart(2, "0")}-`;
    await runRemoteFfmpeg(
      [
        ...remoteInputArgs(input.source, input.segmentStartSec + window.startSec),
        "-t",
        String(window.endSec - window.startSec),
        "-vf",
        `fps=1/${CLIMAX_STRIDE_SEC},scale=640:-2:force_original_aspect_ratio=decrease`,
        "-q:v",
        "3",
        path.join(input.framesDir, `${prefix}%05d.jpg`),
      ],
      "高能片段加密抽帧失败（媒体流中断或画面不可解码）",
    );
    frames.push(...await readNumberedFrames({
      dir: input.framesDir,
      prefix,
      absoluteStartSec: input.segmentStartSec + window.startSec,
      strideSec: CLIMAX_STRIDE_SEC,
    }));
  }

  const unique = Array.from(
    new Map(frames.sort((a, b) => a.atSec - b.atSec).map((frame) => [
      frame.atSec.toFixed(2),
      frame,
    ])).values(),
  );
  const deepRequested = deepWindows.reduce(
    (sum, window) => sum + Math.ceil((window.endSec - window.startSec) / CLIMAX_STRIDE_SEC),
    0,
  );
  const requestedCount = Math.max(input.baseTimestamps.length, Math.ceil(durationSec / BASE_STRIDE_SEC))
    + deepRequested;
  return {
    frames: unique,
    requestedCount,
    extractedCount: unique.length,
    success: isManhuaDenseFrameSampleSuccessful(requestedCount, unique.length),
  };
}

/** 抽帧输出必须非空，且至少达到计划密度的 65%。 */
export function isManhuaDenseFrameSampleSuccessful(
  requestedCount: number,
  extractedCount: number,
): boolean {
  const requested = Math.max(1, Math.floor(Number(requestedCount) || 0));
  const extracted = Math.max(0, Math.floor(Number(extractedCount) || 0));
  return extracted >= Math.max(2, Math.ceil(requested * 0.65));
}
