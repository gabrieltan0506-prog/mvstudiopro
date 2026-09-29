/** 白模音轨只在服务端读取本人已登记素材，混音结果直接进入本次MP4。 */
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { manhuaPrevisAudioSchema, type ManhuaPrevisAudio } from "../../shared/manhuaPrevisAudio";
import { fetchPostProdSourceToFile } from "./postProduction";
import { buildAudioTrimArgs, audioSamples } from "./audioTimelineRender";
import { resolvePostProdInputSources } from "./postProdMediaSource";
import type { ManhuaPrevisRequest } from "../../shared/manhuaPrevis";

export async function validatePrevisAudioSources(request: ManhuaPrevisRequest, userId: string) {
  if (!request.audio) return;
  await resolvePostProdInputSources({ userId, input: { action: "manhua_previs", params: request } });
}

type AudioDeps = {
  run: (command: string, args: string[], signal: AbortSignal) => Promise<string>;
  fetch?: typeof fetchPostProdSourceToFile;
  archive?: (name: string, bytes: Buffer) => Promise<void>;
  validate?: typeof validatePrevisAudioSources;
};
export function buildPrevisAudioTimelineArgs(audio: ManhuaPrevisAudio, files: string[], output: string) {
  const plan = manhuaPrevisAudioSchema.parse(audio);
  if (files.length !== plan.clips.length) throw new Error("白模音轨数量不一致");
  const total = audioSamples(plan.durationSec);
  const filters = plan.clips.map((c,i) => `[${i}:a:0]adelay=${audioSamples(c.startSec)}S:all=1,apad=whole_len=${total},atrim=end_sample=${total}[a${i}]`);
  filters.push(`${files.map((_,i) => `[a${i}]`).join("")}amix=inputs=${files.length}:duration=longest:normalize=0,alimiter=limit=0.95:level=0:latency=1,atrim=end_sample=${total}[out]`);
  return ["-v", "error", "-nostdin", ...files.flatMap(f => ["-i", f]), "-filter_complex", filters.join(";"), "-map", "[out]", "-vn", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", "-t", String(plan.durationSec), output];
}
export async function preparePrevisAudio(request: ManhuaPrevisRequest, userId: string, dir: string, signal: AbortSignal, deps: AudioDeps): Promise<string | undefined> {
  if (!request.audio) return;
  const audio = manhuaPrevisAudioSchema.parse(request.audio);
  if (audio.durationSec !== request.spec.durationSec || request.spec.timeMap?.spans.some(s => s.rate !== 1)) throw new Error("音轨与白模时序不一致");
  // 所有素材先鉴权，任一归属不符时不读取音频、也不启动Blender。
  await (deps.validate ?? validatePrevisAudioSources)(request, userId);
  const folder = path.join(dir, "audio");
  await mkdir(folder);
  const sources = new Map<string, { file: string; duration: number }>();
  const budget = { remainingBytes: 256 * 1024 * 1024 };
  const files: string[] = [];
  let probeIndex = 0;
  async function duration(file: string) {
    const raw = await deps.run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type,duration:format=duration", "-of", "json", file], signal);
    const name = `audio-probe-${++probeIndex}`;
    await deps.archive?.(`${name}.json`, Buffer.from(raw));
    const probe = JSON.parse(raw);
    await deps.archive?.(`${name}.parsed.json`, Buffer.from(JSON.stringify(probe)));
    const seconds = Number(probe.streams?.[0]?.duration ?? probe.format?.duration);
    if (probe.streams?.[0]?.codec_type !== "audio" || !Number.isFinite(seconds) || seconds <= 0) throw new Error("已采用素材缺少有效音频");
    return seconds;
  }
  for (let i = 0; i < audio.clips.length; i++) {
    const clip = audio.clips[i]!;
    let source = sources.get(clip.audioUri);
    if (!source) {
      const file = path.join(folder, `source-${i}.audio`);
      await (deps.fetch ?? fetchPostProdSourceToFile)(clip.audioUri, file, { signal, maxBytes: 64 * 1024 * 1024, budget });
      source = { file, duration: await duration(file) }; sources.set(clip.audioUri, source);
    }
    if (clip.sourceEndSec > source.duration + 1 / 48000) throw new Error("音轨源长度不足，未补静音冒充完整对白");
    const output = path.join(folder, `clip-${i}.wav`);
    const { startSec, ...trim } = clip;
    await deps.run("ffmpeg", ["-v", "error", ...buildAudioTrimArgs(trim, source.file, output)], signal);
    if (Math.abs(await duration(output) - (clip.sourceEndSec - clip.sourceStartSec)) > 2 / 48000) throw new Error("音轨裁段解码长度不符");
    files.push(output);
  }
  const output = path.join(folder, "timeline.wav");
  await deps.run("ffmpeg", buildPrevisAudioTimelineArgs(audio, files, output), signal);
  if (Math.abs(await duration(output) - audio.durationSec) > 2 / 48000) throw new Error("白模混音时间轴长度不符");
  return output;
}
