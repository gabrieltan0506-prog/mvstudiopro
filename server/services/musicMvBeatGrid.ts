/**
 * 歌曲拍点网格（1109）：把整首歌解码成单声道 PCM，复用 shared/manhuaBeatTable.buildMusicBeatGrid
 * 求相位与逐拍重音；BPM 以创作说明里写明的为准（如「129 BPM」），否则用起音包络自相关估计。
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execHeavyMedia } from "./heavyMediaProcess";
import { buildMusicBeatGrid, onsetEnvelope, resolveSongBpm } from "../../shared/manhuaBeatTable";
import type { MusicMvBeatGrid, MusicMvPacing } from "../../shared/canvasMusicMv";

const RATE = 11_025;

export async function decodeMonoPcm(buffer: Buffer, rate = RATE): Promise<Float32Array> {
  const dir = await mkdtemp(path.join(tmpdir(), "mv-beat-"));
  try {
    const src = path.join(dir, "song");
    const out = path.join(dir, "song.f32");
    await writeFile(src, buffer);
    await execHeavyMedia("ffmpeg", ["-y", "-v", "error", "-i", src, "-ac", "1", "-ar", String(rate), "-f", "f32le", out], { timeout: 120_000 });
    const b = await readFile(out);
    const pcm = new Float32Array(Math.floor(b.length / 4));
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = b.readFloatLE(i * 4);
    return pcm;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 拍点拟合度：拍位（±30ms）起音强度均值相对全段均值的倍率，映射到 0–1（1 倍=无周期性，≥2.5 倍=稳定强拍）。 */
function beatConfidence(env: number[], phaseSec: number, beatSec: number, fromSec: number, toSec: number): number {
  const hop = 0.01;
  const a = Math.max(0, Math.floor(fromSec / hop));
  const b = Math.min(env.length, Math.ceil(toSec / hop));
  if (b - a < 50) return 0;
  let all = 0;
  for (let i = a; i < b; i += 1) all += env[i]!;
  const mean = all / (b - a);
  if (mean <= 1e-9) return 0;
  let onBeat = 0;
  let n = 0;
  const k0 = Math.ceil((fromSec - phaseSec) / beatSec);
  for (let k = Math.max(0, k0); phaseSec + k * beatSec < toSec; k += 1) {
    const f = Math.round((phaseSec + k * beatSec) / hop);
    let best = 0;
    for (let d = -3; d <= 3; d += 1) best = Math.max(best, env[f + d] ?? 0);
    onBeat += best;
    n += 1;
  }
  if (!n) return 0;
  return Math.max(0, Math.min(1, (onBeat / n / mean - 1) / 1.5));
}

export type AudioMapSection = { startSec: number; endSec: number };

/**
 * audiomap：唯一节拍分析产物（下游只读）。分段默认取听音证据段落，否则 10 秒一段；
 * 每段给能量与拍点拟合度，并自动判定节奏模式 beat / phrase / free。
 */
export function beatGridFromPcm(
  pcm: ArrayLike<number>,
  rate: number,
  creativePrompt?: string,
  sections?: readonly AudioMapSection[],
  generationPrompt?: string,
): MusicMvBeatGrid & { strongBeatsSec: number[]; bpmResolution: ReturnType<typeof resolveSongBpm> } {
  const estimated = buildMusicBeatGrid(pcm, rate, 120).estimatedBpm;
  const resolution = resolveSongBpm({ estimatedBpm: estimated, generationPrompt, creativePrompt });
  const bpm = resolution.bpm;
  const stated = resolution.source !== "estimated";
  const grid = buildMusicBeatGrid(pcm, rate, bpm);
  const env = onsetEnvelope(pcm, rate);
  const duration = pcm.length / rate;
  const beatSec = 60 / bpm;
  const ranges: AudioMapSection[] = sections?.length
    ? sections.map(s => ({ startSec: s.startSec, endSec: Math.min(duration, s.endSec) })).filter(s => s.endSec > s.startSec)
    : Array.from({ length: Math.ceil(duration / 10) }, (_, i) => ({ startSec: i * 10, endSec: Math.min(duration, (i + 1) * 10) }));
  const rms = ranges.map(r => {
    const a = Math.floor(r.startSec * rate);
    const b = Math.min(pcm.length, Math.floor(r.endSec * rate));
    let sum = 0;
    for (let i = a; i < b; i += 1) sum += pcm[i]! * pcm[i]!;
    return Math.sqrt(sum / Math.max(1, b - a));
  });
  const peak = Math.max(1e-9, ...rms);
  const segments = ranges.map((r, i) => {
    const energy = Number((rms[i]! / peak).toFixed(3));
    const conf = Number(beatConfidence(env, grid.phaseSec, beatSec, r.startSec, r.endSec).toFixed(3));
    // 抒情/慢歌：按乐句与能量切（拍点只作微调）；否则按拍点置信度
    const pacing: MusicMvPacing = energy < 0.12 || conf < 0.2 ? "free" : resolution.lyrical ? "phrase" : conf >= 0.5 ? "beat" : "phrase";
    return { startSec: Number(r.startSec.toFixed(3)), endSec: Number(r.endSec.toFixed(3)), energy, beatConfidence: conf, pacing };
  });
  return {
    bpm: Number(bpm.toFixed(2)),
    beatSec: Number(beatSec.toFixed(5)),
    phaseSec: grid.phaseSec,
    source: stated ? "creative_prompt" : "estimated",
    bpmResolution: resolution,
    beatConfidence: Number(beatConfidence(env, grid.phaseSec, beatSec, 0, duration).toFixed(3)),
    segments,
    strongBeatsSec: grid.beats.filter(b => b.strength >= 0.6).map(b => b.sec),
  };
}

export async function computeSongBeatGrid(buffer: Buffer, creativePrompt?: string, sections?: readonly AudioMapSection[], generationPrompt?: string) {
  return beatGridFromPcm(await decodeMonoPcm(buffer), RATE, creativePrompt, sections, generationPrompt);
}
