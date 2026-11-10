/**
 * 视频局部修改 · 裁段：ffmpeg 直接按区间读远程原片（Range），不整片下载。
 * 远程读取不可用（非 https、不支持 Range、超时、产物时长不符）时回退「整片下载再裁」。
 */
import { rm, stat } from "node:fs/promises";
import path from "node:path";

export type VideoSegmentCutDeps = {
  /** 生产传 pp.runMediaTool（保留其超时/中止/并发控制）。 */
  runMediaTool(command: "ffmpeg" | "ffprobe", args: string[], signal: AbortSignal): Promise<{ stdout: string; stderr: string }>;
  /** 整片下载（回退路径）。 */
  download(uri: string, filePath: string, signal: AbortSignal): Promise<unknown>;
  probe(filePath: string, signal: AbortSignal): Promise<{ durationSec: number }>;
  signRead(gsUri: string): Promise<string> | string;
};

export type VideoSegmentCutOptions = {
  /** 远程裁切总时限（探测 + ffmpeg），到时回退整片下载。 */
  remoteTimeoutMs?: number;
  /** 仅测试：允许 http 作为远程输入。 */
  allowInsecureHttp?: boolean;
};

export const VIDEO_SEGMENT_REMOTE_CUT_TIMEOUT_MS = 90_000;
const RANGE_PROBE_TIMEOUT_MS = 10_000;
/** 裁出时长允许的误差（帧取整 + 音频封装补帧）。 */
const DURATION_TOLERANCE_SEC = 0.25;

/** 上游输入要求 24–60fps；只改帧率不改速度。 */
export function videoSegmentCutRate(fps: number) {
  return Math.min(60, Math.max(24, Math.round(fps) || 24));
}

function encodeArgs(fps: number, out: string) {
  return ["-r", String(videoSegmentCutRate(fps)), "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out];
}

/** 远程按区间裁：输入前置 -ss 快速定位，转码时默认精确到帧，音画同起点。 */
export function buildRemoteSegmentCutArgs(input: { url: string; startSec: number; endSec: number; fps: number; out: string }) {
  const insecure = input.url.startsWith("http://");
  return ["-y", "-protocol_whitelist", insecure ? "http,tcp" : "https,tls,tcp", "-rw_timeout", "20000000",
    "-ss", input.startSec.toFixed(3), "-i", input.url, "-t", (input.endSec - input.startSec).toFixed(3),
    ...encodeArgs(input.fps, input.out)];
}

/** 整片在本地后的裁切（原有路径，参数不变）。 */
export function buildLocalSegmentCutArgs(input: { src: string; startSec: number; endSec: number; fps: number; out: string }) {
  return ["-y", "-i", input.src, "-ss", input.startSec.toFixed(3), "-to", input.endSec.toFixed(3), ...encodeArgs(input.fps, input.out)];
}

/** 服务器是否支持按字节区间读取（206）；跳转一律视为不可用。 */
export async function remoteSupportsRange(url: string, signal: AbortSignal): Promise<boolean> {
  const response = await fetch(url, {
    headers: { Range: "bytes=0-0" }, redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(RANGE_PROBE_TIMEOUT_MS)]),
  });
  await response.body?.cancel().catch(() => {});
  return response.status === 206;
}

export async function cutVideoSegmentToFile(
  input: { videoUri: string; startSec: number; endSec: number; fps: number; dir: string; signal: AbortSignal },
  deps: VideoSegmentCutDeps,
  options: VideoSegmentCutOptions = {},
): Promise<{ filePath: string; mode: "remote" | "download"; fallbackReason?: string }> {
  const { videoUri, startSec, endSec, fps, dir, signal } = input;
  signal.throwIfAborted();
  const out = path.join(dir, "segment.mp4");
  const lengthSec = endSec - startSec;
  let fallbackReason: string;
  try {
    const url = videoUri.startsWith("gs://") ? await deps.signRead(videoUri) : videoUri;
    if (!(url.startsWith("https://") || (options.allowInsecureHttp && url.startsWith("http://")))) throw new Error("not-https");
    const remoteSignal = AbortSignal.any([signal, AbortSignal.timeout(options.remoteTimeoutMs ?? VIDEO_SEGMENT_REMOTE_CUT_TIMEOUT_MS)]);
    if (!(await remoteSupportsRange(url, remoteSignal))) throw new Error("no-range");
    await deps.runMediaTool("ffmpeg", buildRemoteSegmentCutArgs({ url, startSec, endSec, fps, out }), remoteSignal);
    if ((await stat(out)).size <= 0) throw new Error("empty-output");
    const measured = await deps.probe(out, signal);
    if (!(Math.abs(measured.durationSec - lengthSec) <= DURATION_TOLERANCE_SEC)) throw new Error("duration-mismatch");
    return { filePath: out, mode: "remote" };
  } catch (error) {
    // 任务本身被中止（超时/停机）不回退；其余一律走整片下载。原因只留短码，不带签名链。
    signal.throwIfAborted();
    const message = error instanceof Error ? error.message : "";
    fallbackReason = /^(not-https|no-range|empty-output|duration-mismatch)$/.test(message) ? message
      : (error as { name?: string } | null)?.name === "TimeoutError" ? "timeout" : "remote-read-failed";
    await rm(out, { force: true }).catch(() => {});
  }
  const src = path.join(dir, "source.mp4");
  await deps.download(videoUri, src, signal);
  await deps.runMediaTool("ffmpeg", buildLocalSegmentCutArgs({ src, startSec, endSec, fps, out }), signal);
  return { filePath: out, mode: "download", fallbackReason };
}
