/** 秒锁物理音轨：固定 48kHz 样本边界；不循环、不加速、不截短已选区间。 */
import { audioTimelineParamsSchema, audioTrimParamsSchema, type RawAudioTimelineParams, type RawAudioTrimParams } from "../jobs/postProdInput";

export const AUDIO_SAMPLE_RATE = 48000;
export const audioSamples = (seconds: number) => Math.round(seconds * AUDIO_SAMPLE_RATE);

export function buildAudioTrimArgs(input: RawAudioTrimParams, sourcePath: string, outputPath: string): string[] {
  const clip = audioTrimParamsSchema.parse(input);
  const start = audioSamples(clip.sourceStartSec);
  const end = audioSamples(clip.sourceEndSec);
  const count = end - start;
  if (count <= 0) throw new Error("音频裁段区间为空");
  const filters = [
    "aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=stereo",
    `atrim=start_sample=${start}:end_sample=${end}`, "asetpts=PTS-STARTPTS",
    `volume=${clip.volume}`,
  ];
  if (clip.fadeInSec > 0) filters.push(`afade=t=in:ss=0:ns=${audioSamples(clip.fadeInSec)}`);
  if (clip.fadeOutSec > 0) filters.push(`afade=t=out:ss=${count - audioSamples(clip.fadeOutSec)}:ns=${audioSamples(clip.fadeOutSec)}`);
  return ["-y", "-nostdin", "-protocol_whitelist", "file", "-i", sourcePath, "-map", "0:a:0", "-vn", "-af", filters.join(","),
    "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", "-t", String(count / AUDIO_SAMPLE_RATE), outputPath];
}

/** 输入必须是已经裁切、验证完整的片段；仅补时间轴空白，不补缺失的原音。 */
export function buildAudioTimelineArgs(input: RawAudioTimelineParams, clipPaths: string[], outputPath: string): string[] {
  const timeline = audioTimelineParamsSchema.parse(input);
  if (clipPaths.length !== timeline.clips.length) throw new Error("秒锁音频片段数量不一致");
  const total = audioSamples(timeline.durationSec);
  const args = ["-y", "-nostdin"];
  clipPaths.forEach((filePath) => args.push("-i", filePath));
  const filters = timeline.clips.map((clip, i) => {
    const delay = audioSamples(clip.startSec);
    const length = audioSamples(clip.sourceEndSec) - audioSamples(clip.sourceStartSec);
    if (delay + length > total) throw new Error("片段超出秒锁时间轴，不允许截短尾音");
    return `[${i}:a:0]adelay=${delay}S:all=1,apad=whole_len=${total},atrim=end_sample=${total}[a${i}]`;
  });
  filters.push(`${timeline.clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clipPaths.length}:duration=longest:normalize=0,alimiter=limit=0.95:level=0:latency=1,atrim=end_sample=${total}[out]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-vn", "-ar", "48000", "-ac", "2",
    "-c:a", "pcm_s16le", "-t", String(total / AUDIO_SAMPLE_RATE), outputPath);
  return args;
}
