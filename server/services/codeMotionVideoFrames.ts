import { codeMotionVideoDurationMatches } from "./codeMotionVideoDuration";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { CodeMotionVideo } from "../../shared/codeMotionVideo";
import { fetchPostProdSourceToFile, runMediaTool } from "./postProduction";

/** Decode only the short owned clips. Generated clip audio is never mixed a second time. */
export async function prepareCodeMotionVideoFrames(
  video: CodeMotionVideo | undefined,
  meta: { width: number; height: number; fps: number },
  root: string,
  signal: AbortSignal,
  preserve: (name: string, bytes: Buffer) => Promise<void>
) {
  const frames = new Map<number, string>();
  if (!video) return frames;
  const inputs = new Map<string, string>();
  const sourceTiming = new Map<string, { duration: number; frameSeconds: number }>();
  for (let index = 0; index < video.assets.length; index++) {
    const asset = video.assets[index],
      file = path.join(root, `video-source-${index}.mp4`);
    await fetchPostProdSourceToFile(asset.videoUri, file, {
      signal,
      maxBytes: 100 * 1024 ** 2,
    });
    const actualSha = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
    if (actualSha !== asset.sha256)
      throw new Error("视频素材指纹变化，请重新准备本次内容");
    const probe = await runMediaTool(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      signal
    );
    await preserve(`video-source-${index}.raw.json`, Buffer.from(probe.stdout));
    const raw = JSON.parse(probe.stdout),
      stream = raw.streams?.find(
        (s: { codec_type: string }) => s.codec_type === "video"
      );
    const duration = Number(stream?.duration ?? raw.format?.duration);
    if (
      !stream ||
      !codeMotionVideoDurationMatches(duration, asset.durationSec)
    )
      throw new Error("视频素材实际时长与已保存回执不一致");
    const [rateNumerator, rateDenominator = 1] = String(stream.avg_frame_rate || stream.r_frame_rate || meta.fps).split("/").map(Number);
    const sourceFps = rateNumerator / rateDenominator;
    sourceTiming.set(asset.id, { duration, frameSeconds: Number.isFinite(sourceFps) && sourceFps > 0 ? 1 / sourceFps : 1 / meta.fps });
    await preserve(
      `video-source-${index}.identity.json`,
      Buffer.from(
        JSON.stringify({
          id: asset.id,
          sha256: actualSha,
          durationSec: duration,
          sourceAudio: "muted",
          width: stream.width,
          height: stream.height,
        })
      )
    );
    inputs.set(asset.id, file);
  }
  for (let index = 0; index < video.clips.length; index++) {
    const clip = video.clips[index],
      file = inputs.get(clip.assetId);
    if (!file) throw new Error("视频片段缺少已保存素材");
    const timing = sourceTiming.get(clip.assetId)!;
    // If a selected offset exceeds a shortened source, hold its last available frame.
    const sourceStart = Math.min(clip.sourceStartSec, Math.max(0, timing.duration - timing.frameSeconds));
    const available = Math.max(0, timing.duration - sourceStart);
    const dir = path.join(root, `video-frames-${index}`);
    await mkdir(dir);
    const count = Math.round(clip.duration * meta.fps),
      first = Math.round(clip.at * meta.fps);
    const size = `${meta.width}:${meta.height}`;
    const fit =
      clip.fit === "contain"
        ? `scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2:color=black`
        : `scale=${size}:force_original_aspect_ratio=increase,crop=${size}`;
    await runMediaTool(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        file,
        "-t",
        String(clip.duration),
        "-map",
        "0:v:0",
        "-an",
        "-vf",
        `trim=start=${sourceStart},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${clip.duration},fps=${meta.fps},${fit},setsar=1`,
        "-frames:v",
        String(count),
        "-start_number",
        "1",
        path.join(dir, "frame-%06d.png"),
      ],
      signal
    );
    const names = (await readdir(dir))
      .filter(n => /^frame-\d{6}\.png$/.test(n))
      .sort();
    if (names.length !== count)
      throw new Error("视频片段解码帧数不足，未采用缩短产物");
    for (let frame = 0; frame < count; frame++)
      frames.set(first + frame, path.join(dir, names[frame]));
    await preserve(
      `video-clip-${index}.parsed.json`,
      Buffer.from(
        JSON.stringify({
          ...clip,
          firstFrame: first,
          frameCount: count,
          actualSourceDuration: timing.duration,
          effectiveSourceStartSec: sourceStart,
          normalization: available < clip.duration ? "hold_last_frame" : available > clip.duration ? "trim_to_timeline" : "none",
          paddedSeconds: Math.max(0, clip.duration - available),
          decoder: "ffmpeg",
          audio: "muted",
        })
      )
    );
  }
  return frames;
}
