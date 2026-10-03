import { mkdtemp, rm } from "node:fs/promises";
import { signGsUriV4ReadUrl } from "./gcs.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { probe, probeAudio, runMediaTool, uploadResult } from "./postProduction.js";

export const VIDEO_INTERPOLATE_MAX_BYTES = 8 * 1024 * 1024 * 1024;

export class VideoEnhanceOutputMismatch extends Error {}

function readableUrl(source: string) {
  const result = source.startsWith("gs://") ? signGsUriV4ReadUrl(source, 3600) : source;
  const parsed = new URL(result);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new VideoEnhanceOutputMismatch("媒体来源必须为云端HTTPS地址");
  return result;
}

/** AI调用前保存原音轨；输入URL由已鉴权任务提供，媒体不经过用户电脑。 */
export async function preserveOriginalVideoAudio(sourceUri: string, userId: number): Promise<string | null> {
  const signal = AbortSignal.timeout(600_000);
  const source = readableUrl(sourceUri);
  const metadata = await probe(source, signal);
  if (!metadata.hasAudio) return null;
  const dir = await mkdtemp(path.join(tmpdir(), "video-original-audio-"));
  try {
    const output = path.join(dir, "original.m4a");
    await runMediaTool("ffmpeg", ["-y", "-nostdin", "-i", source, "-map", "0:a", "-vn", "-c:a", "copy", "-f", "mp4", output], signal);
    await probeAudio(output, signal);
    const saved = await uploadResult({ filePath: output, userId: String(userId), kind: "original-audio", ext: "m4a", contentType: "audio/mp4", signal });
    return saved.gcsUri || saved.url;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

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
export async function finalizeEnhancedVideo(input: { source: string; enhanced: string; userId: number; target?: string; targetFps?: 30 | 60; allowResize?: boolean; interpolationIntermediate?: boolean; originalAudioSource?: string }) {
  const signal = AbortSignal.timeout(600_000);
  const dir = await mkdtemp(path.join(tmpdir(), "video-enhance-"));
  try {
    const sourceFile = readableUrl(input.source), enhancedFile = readableUrl(input.enhanced), output = path.join(dir, "out.mp4");
    const source = await probe(sourceFile, signal), enhanced = await probe(enhancedFile, signal);
    assertEnhancedVideo(source, enhanced, input.target, input.interpolationIntermediate ? enhanced.fps || undefined : input.targetFps, true, input.allowResize);
    if (input.interpolationIntermediate && (!enhanced.fps || !source.fps || enhanced.fps <= source.fps)) throw new VideoEnhanceOutputMismatch("AI补帧未增加帧率，未交付");
    const args = ["-y", "-nostdin", "-i", enhancedFile, "-i", readableUrl(input.originalAudioSource || input.source), "-map", "0:v:0", "-map", "1:a?", "-map_metadata", "1"];
    // 翻倍后超过目标帧率时只丢弃多余插值帧；不变速、不改音轨。
    if (input.targetFps && Math.abs(enhanced.fps! - input.targetFps) > 0.1) args.push("-vf", `fps=${input.targetFps}`, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0", "-threads", "2");
    else args.push("-c:v", "copy");
    args.push("-c:a", "copy", "-fs", String(VIDEO_INTERPOLATE_MAX_BYTES + 1), "-t", String(source.durationSec), "-movflags", "+faststart", output);
    await runMediaTool("ffmpeg", args, signal);
    const result = await probe(output, signal);
    assertEnhancedVideo(source, result, input.target, input.interpolationIntermediate ? enhanced.fps || undefined : input.targetFps, false, input.allowResize);
    if (source.hasAudio !== result.hasAudio) throw new VideoEnhanceOutputMismatch("原片音轨未保留，未交付");
    const uploaded = await uploadResult({ filePath: output, userId: String(input.userId), kind: input.targetFps ? `fps${input.targetFps}` : input.interpolationIntermediate ? "fps-stage" : `upscale-${input.target}`, maxBytes: VIDEO_INTERPOLATE_MAX_BYTES, ext: "mp4", contentType: "video/mp4", signal });
    return uploaded;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
