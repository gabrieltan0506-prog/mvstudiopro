import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  digitalHumanProductionInputSchema, digitalHumanSplitManifestSchema, planDigitalHumanAudioSegments,
  type DigitalHumanProductionInput, type DigitalHumanFinalParams,
} from "../../shared/digitalHumanProduction";
import { fetchPostProdSourceToFile, runMediaTool, probe, probeAudio, uploadResult, MAX_SOURCE_BYTES, MAX_CONCAT_TOTAL_BYTES } from "./postProduction";

export function parseDigitalHumanSilences(stderr: string, duration: number) {
  const rows: Array<{ start: number; end: number }> = [];
  let start: number | undefined;
  for (const m of Array.from(stderr.matchAll(/silence_(start|end):\s*([0-9.]+)/g))) {
    const value = Number(m[2]);
    if (m[1] === "start") start = value;
    else if (start !== undefined) { rows.push({ start, end: value }); start = undefined; }
  }
  if (start !== undefined) rows.push({ start, end: duration });
  return rows;
}

/** 所有滤镜参数均由有限数值和枚举生成，原始文本不会进入表达式。 */
export function digitalHumanMixFilter(p: DigitalHumanFinalParams, duration: number): string {
  const pan = p.voice.pan;
  const left = Math.sqrt((1 - pan) / 2).toFixed(6), right = Math.sqrt((1 + pan) / 2).toFixed(6);
  const echo = p.voice.room === "dry" ? "" : p.voice.room === "small" ? ",aecho=0.9:0.9:24|47:0.08|0.04" : ",aecho=0.9:0.9:35|71:0.1|0.05";
  const filters = [`[1:a]aresample=48000,atrim=0:${duration},asetpts=PTS-STARTPTS,aformat=channel_layouts=mono,volume=${p.voice.volume},pan=stereo|c0=${left}*c0|c1=${right}*c0${echo},apad,atrim=0:${duration}[voice]`];
  const ducks = p.tracks.map((t, i) => t.duck ? i : -1).filter(i => i >= 0);
  if (ducks.length) filters.push(`[voice]asplit=${ducks.length + 1}[voiceMix]${ducks.map(i => `[key${i}]`).join("")}`);
  p.tracks.forEach((t, i) => {
    filters.push(`[${i + 2}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=start=${t.sourceStartSec}:duration=${t.durationSec},asetpts=PTS-STARTPTS,volume=${t.volume},afade=t=in:st=0:d=${t.fadeInSec},afade=t=out:st=${t.durationSec - t.fadeOutSec}:d=${t.fadeOutSec},adelay=${Math.round(t.startSec * 1000)}:all=1,apad,atrim=0:${duration}[track${i}]`);
    if (t.duck) filters.push(`[track${i}][key${i}]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=250[duck${i}]`);
  });
  const labels = `[${ducks.length ? "voiceMix" : "voice"}]` + p.tracks.map((t, i) => `[${t.duck ? "duck" : "track"}${i}]`).join("");
  filters.push(`${labels}amix=inputs=${1 + p.tracks.length}:duration=first:normalize=0,alimiter=limit=0.95:level=0:latency=1,atrim=0:${duration}[audio]`);
  return filters.join(";");
}

/** 独立数字人后期，只消费已登记素材；不读漫剧项目、编剧或分集数据。 */
export async function renderDigitalHumanProduction(raw: DigitalHumanProductionInput, userId: string, signal: AbortSignal) {
  const input = digitalHumanProductionInputSchema.parse(raw);
  const dir = await mkdtemp(join(tmpdir(), "digital-human-"));
  const budget = { remainingBytes: MAX_CONCAT_TOTAL_BYTES };
  const download = async (uri: string, name: string) => {
    const path = join(dir, name);
    await fetchPostProdSourceToFile(uri, path, { signal, budget, maxBytes: MAX_SOURCE_BYTES });
    return path;
  };
  const upload = (path: string, kind: string, ext: string, contentType: string) => uploadResult({ filePath: path, userId, kind, ext, contentType, signal });
  try {
    if (input.action === "digital_human_continuity_frame") {
      const video = await download(input.params.videoUri, "source.mp4");
      const info = await probe(video, signal);
      if (input.params.atSec > info.durationSec + 0.05) throw new Error("前段画面不足以覆盖配音，不能导出连续性参考");
      const frame = join(dir, "continuity.png");
      const at = Math.max(0, Math.min(input.params.atSec, info.durationSec) - 1 / (info.fps || 30));
      await runMediaTool("ffmpeg", ["-y", "-i", video, "-ss", String(at), "-frames:v", "1", frame], signal);
      return { ...(await upload(frame, "dh-continuity", "png", "image/png")), atSec: at };
    }
    const audio = await download(input.params.audioUri, "voice-source");
    const duration = await probeAudio(audio, signal);
    if (duration <= 0 || duration > 1800) throw new Error("完整配音时长超出当前处理范围");
    if (input.action === "digital_human_audio_split") {
      const detected = await runMediaTool("ffmpeg", ["-i", audio, "-af", "silencedetect=noise=-38dB:d=0.12", "-f", "null", "-"], signal);
      const plan = planDigitalHumanAudioSegments(duration, parseDigitalHumanSilences(detected.stderr, duration));
      const segments = [];
      for (const [index, segment] of Array.from(plan.entries())) {
        signal.throwIfAborted();
        const path = join(dir, `part-${index}.wav`);
        await runMediaTool("ffmpeg", ["-y", "-i", audio, "-af", `aresample=48000,atrim=start_sample=${Math.round(segment.startSec * 48000)}:end_sample=${Math.round(segment.endSec * 48000)},asetpts=PTS-STARTPTS`, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", path], signal);
        const actual = await probeAudio(path, signal);
        if (Math.abs(actual - (segment.endSec - segment.startSec)) > 0.03) throw new Error("音频分段长度不一致，未采用清单");
        const result = await upload(path, "dh-audio-segment", "wav", "audio/wav");
        segments.push({ index, ...segment, audioUri: result.gcsUri });
      }
      const manifest = digitalHumanSplitManifestSchema.parse({ version: 1, ...input.params, durationSec: duration, segments });
      const path = join(dir, "manifest.json");
      await writeFile(path, JSON.stringify(manifest));
      return { ...(await upload(path, "dh-audio-manifest", "json", "application/json")), manifest, audioUrls: segments.map(s => s.audioUri) };
    }
    const p = input.params;
    const end = p.clips[p.clips.length - 1].endSec;
    if (Math.abs(duration - end) > 0.03) throw new Error("视频清单未完整覆盖原始配音，未合成");
    const [width, height] = p.aspectRatio === "9:16" ? [1080, 1920] : [1920, 1080];
    const normalized = [];
    for (const [i, clip] of Array.from(p.clips.entries())) {
      const source = await download(clip.videoUri, `video-${i}`);
      const info = await probe(source, signal);
      const needed = clip.endSec - clip.startSec;
      if (info.durationSec + 0.05 < needed) throw new Error(`第${i + 1}段画面短于原配音，未用定格或加速补齐`);
      const frames = (i === p.clips.length - 1 ? Math.ceil(clip.endSec * 30) : Math.round(clip.endSec * 30)) - Math.round(clip.startSec * 30);
      const target = join(dir, `normalized-${i}.mp4`);
      await runMediaTool("ffmpeg", ["-y", "-i", source, "-an", "-vf", `fps=30,trim=end_frame=${frames},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`, "-c:v", "libx264", "-preset", "fast", "-crf", "20", target], signal);
      const checked = await probe(target, signal);
      if (Math.abs(checked.durationSec - frames / 30) > 0.04) throw new Error(`第${i + 1}段标准化后帧数不足`);
      normalized.push(target);
    }
    const list = join(dir, "concat.txt");
    await writeFile(list, normalized.map(path => `file '${path}'`).join("\n"));
    const picture = join(dir, "picture.mp4");
    await runMediaTool("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", picture], signal);
    const args = ["-y", "-i", picture, "-i", audio];
    for (const [i, track] of Array.from(p.tracks.entries())) {
      const path = await download(track.source, `mix-${i}`);
      const actual = await probeAudio(path, signal);
      if (track.sourceStartSec + track.durationSec > actual + 0.03) throw new Error(`音轨「${track.name}」的选段超过素材长度`);
      args.push("-i", path);
    }
    const target = join(dir, "final.mp4");
    args.push("-filter_complex", digitalHumanMixFilter(p, duration), "-map", "0:v", "-map", "[audio]", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", target);
    await runMediaTool("ffmpeg", args, signal);
    const result = await probe(target, signal);
    if (!result.hasAudio || result.durationSec + 0.04 < duration || result.durationSec - duration > 0.1) throw new Error("合成结果音画时长校验失败");
    return { ...(await upload(target, "dh-final", "mp4", "video/mp4")), durationSec: duration, width, height, audioRequestId: p.audioRequestId, clips: p.clips, mix: { voice: p.voice, tracks: p.tracks } };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
