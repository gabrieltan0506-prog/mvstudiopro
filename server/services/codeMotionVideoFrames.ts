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
      !Number.isFinite(duration) ||
      duration < 4 - 1 / meta.fps ||
      duration > 5 + 1 / meta.fps ||
      Math.abs(duration - asset.durationSec) > 1 / meta.fps + 0.001
    )
      throw new Error("视频素材实际时长与已保存回执不一致");
    if (
      video.clips.some(
        c =>
          c.assetId === asset.id &&
          c.sourceStartSec + c.duration > duration + 0.001
      )
    )
      throw new Error("视频素材不足所选秒窗");
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
        "-ss",
        String(clip.sourceStartSec),
        "-t",
        String(clip.duration),
        "-map",
        "0:v:0",
        "-an",
        "-vf",
        `fps=${meta.fps},${fit},setsar=1`,
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
          decoder: "ffmpeg",
          audio: "muted",
        })
      )
    );
  }
  return frames;
}
