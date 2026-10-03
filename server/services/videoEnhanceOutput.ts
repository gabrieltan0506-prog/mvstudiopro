import { mkdtemp, rm } from "node:fs/promises";
import { signGsUriV4ReadUrl } from "./gcs.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { fetchPostProdSourceToFile, probe, runMediaTool, uploadResult } from "./postProduction.js";

export const VIDEO_INTERPOLATE_MAX_MS = 6 * 60 * 60 * 1000;
export const VIDEO_INTERPOLATE_MAX_BYTES = 8 * 1024 * 1024 * 1024;

export class VideoEnhanceOutputMismatch extends Error {}

export function assertEnhancedVideo(source: { durationSec: number; width: number | null; height: number | null; fps: number | null }, result: typeof source, target?: string, targetFps?: number, allowFpsOvershoot = false, allowResize = false) {
  if (!source.width || !source.height || !result.width || !result.height || !source.fps || !result.fps) throw new VideoEnhanceOutputMismatch("增强产物缺少有效视频元数据");
  if (Math.abs(result.durationSec - source.durationSec) > Math.max(0.15, 2 / source.fps)) throw new VideoEnhanceOutputMismatch("增强产物改变了原片时长，未交付");
  if (Math.abs(result.width / result.height - source.width / source.height) > 0.01) throw new VideoEnhanceOutputMismatch("增强产物改变了原画幅，未交付");
  if (target && Math.min(result.width, result.height) < (target === "4k" ? 2160 : 1440)) throw new VideoEnhanceOutputMismatch("超分产物未达到所选尺寸，未交付");
  if (targetFps) {
    if ((!target && !allowResize && (result.width !== source.width || result.height !== source.height)) || (allowFpsOvershoot ? result.fps < targetFps - 0.1 : Math.abs(result.fps - targetFps) > 0.1)) throw new VideoEnhanceOutputMismatch("补帧产物未保留原尺寸或未达到目标帧率");
  } else if (Math.abs(result.fps - source.fps) > 0.1) throw new VideoEnhanceOutputMismatch("超分产物改变了原帧率，未交付");
}

/** 云端AI完成画质/补帧；服务端只核尺寸、时长及帧率，并复用原音轨，不重新混音。 */
export async function finalizeEnhancedVideo(input: { source: string; enhanced: string; userId: number; target?: string; targetFps?: 30 | 60; allowResize?: boolean }) {
  const signal = AbortSignal.timeout(600_000);
  const dir = await mkdtemp(path.join(tmpdir(), "video-enhance-"));
  try {
    const sourceFile = path.join(dir, "original.mp4"), enhancedFile = path.join(dir, "enhanced.mp4"), output = path.join(dir, "out.mp4");
    await fetchPostProdSourceToFile(input.source, sourceFile, { signal });
    await fetchPostProdSourceToFile(input.enhanced, enhancedFile, { signal });
    const source = await probe(sourceFile, signal), enhanced = await probe(enhancedFile, signal);
    assertEnhancedVideo(source, enhanced, input.target, input.targetFps, true, input.allowResize);
    const args = ["-y", "-i", enhancedFile, "-i", sourceFile, "-map", "0:v:0", "-map", "1:a?", "-map_metadata", "1"];
    // 翻倍后超过目标帧率时只丢弃多余插值帧；不变速、不改音轨。
    if (input.targetFps && Math.abs(enhanced.fps! - input.targetFps) > 0.1) args.push("-vf", `fps=${input.targetFps}`, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0", "-threads", "2");
    else args.push("-c:v", "copy");
    args.push("-c:a", "copy", "-fs", String(VIDEO_INTERPOLATE_MAX_BYTES + 1), "-t", String(source.durationSec), "-movflags", "+faststart", output);
    await runMediaTool("ffmpeg", args, signal);
    const result = await probe(output, signal);
    assertEnhancedVideo(source, result, input.target, input.targetFps, false, input.allowResize);
    if (source.hasAudio !== result.hasAudio) throw new VideoEnhanceOutputMismatch("原片音轨未保留，未交付");
    const uploaded = await uploadResult({ filePath: output, userId: String(input.userId), kind: input.targetFps ? `fps${input.targetFps}` : `upscale-${input.target}`, ext: "mp4", contentType: "video/mp4", signal });
    return uploaded;
  } finally { await rm(dir, { recursive: true, force: true }); }
}


/** 仅由已鉴权、已计费的增强任务调用；保留原尺寸和音频包，运动插帧采用无损编码。 */
export async function interpolateVideo(input: { videoUri: string; targetFps: 30 | 60 }, userId: string, options?: { signal?: AbortSignal }) {
  const signal = options?.signal ?? AbortSignal.timeout(VIDEO_INTERPOLATE_MAX_MS);
  const dir = await mkdtemp(path.join(tmpdir(), "video-interpolate-"));
  try {
    const original = input.videoUri.startsWith("gs://") ? signGsUriV4ReadUrl(input.videoUri, 7 * 60 * 60) : input.videoUri;
    const output = path.join(dir, "out.mp4");
    const source = await probe(original, signal);
    if (!source.fps || source.durationSec > 600 || source.fps >= input.targetFps - 0.01) throw new Error("原片帧率无效、超过600秒或已达到目标帧率");
    await runMediaTool("ffmpeg", ["-y", "-nostdin", "-i", original,
      "-map", "0:v:0", "-map", "0:a?", "-map_metadata", "0",
      "-vf", `tpad=stop_mode=clone:stop_duration=0.1,minterpolate=fps=${input.targetFps}:mi_mode=mci:mc_mode=obmc:me_mode=bidir:vsbmc=1`,
      "-filter_threads", "2", "-c:v", "libx264", "-preset", "fast", "-crf", "0", "-threads", "2",
      "-c:a", "copy", "-fs", String(VIDEO_INTERPOLATE_MAX_BYTES + 1), "-t", String(source.durationSec), "-movflags", "+faststart", output], signal);
    const result = await probe(output, signal);
    assertEnhancedVideo(source, result, undefined, input.targetFps);
    if (source.hasAudio !== result.hasAudio) throw new VideoEnhanceOutputMismatch("补帧未保留原音轨");
    const uploaded = await uploadResult({ filePath: output, userId, kind: `fps${input.targetFps}`, maxBytes: VIDEO_INTERPOLATE_MAX_BYTES, ext: "mp4", contentType: "video/mp4", signal });
    return { ...uploaded, durationSec: result.durationSec, width: result.width, height: result.height, fps: result.fps, hasAudio: result.hasAudio };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
