/**
 * MV 合成前的镜头实测适配（1109）：ffprobe 实测每段时长；演唱段用生成片自带音轨与原歌该窗做包络互相关
 * 求首尾偏移，按偏移落位、漂移超 2 帧判不合格。只裁不变速；不合格的段列出，由调用方只重做该段。
 * 纯判定在 shared/canvasMusicMvClipFit.ts；这里只负责下载、探测与解码。
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execHeavyMedia } from "./heavyMediaProcess";
import { downloadFileToPath } from "../vercel-api-core/renderUtils.js";
import {
  estimateEnvelopeLagSec,
  planMvClipFit,
  type MvClipFitInput,
  type MvClipFitResult,
} from "../../shared/canvasMusicMvClipFit";

const PCM_RATE = 16_000;
/** 互相关窗长与两侧搜索余量（秒）。 */
const XCORR_WINDOW_SEC = 4;
const XCORR_MARGIN_SEC = 1;

async function probe(file: string): Promise<{ duration: number; hasAudio: boolean }> {
  const { stdout } = await execHeavyMedia("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file]);
  const parsed = JSON.parse(String(stdout)) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
  const duration = Number(parsed.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("镜头时长不可实测，未合成");
  return { duration, hasAudio: (parsed.streams || []).some(s => s.codec_type === "audio") };
}

let pcmSeq = 0;
async function pcm(file: string, fromSec: number, durSec: number): Promise<Float32Array> {
  const target = `${file}.${pcmSeq++}.f32`;
  await execHeavyMedia(
    "ffmpeg",
    ["-y", "-v", "error", "-ss", String(Math.max(0, fromSec)), "-t", String(durSec + Math.min(0, fromSec)), "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", String(PCM_RATE), "-f", "f32le", target],
    { timeout: 60_000 },
  );
  const b = await readFile(target);
  const out = new Float32Array(Math.floor(b.length / 4));
  for (let i = 0; i < out.length; i += 1) out[i] = b.readFloatLE(i * 4);
  // ss 落在 0 之前时前补静音，保持时间原点一致
  if (fromSec < 0) {
    const pad = new Float32Array(Math.round(-fromSec * PCM_RATE));
    const merged = new Float32Array(pad.length + out.length);
    merged.set(pad, 0);
    merged.set(out, pad.length);
    return merged;
  }
  return out;
}

/** 生成片里与原歌 songAt 秒对齐的位置相对 expectedAt 的偏移（秒）。 */
async function lagAt(clip: string, song: string, songAt: number, expectedAt: number, len: number) {
  const ref = await pcm(song, songAt, len);
  const probeBuf = await pcm(clip, expectedAt - XCORR_MARGIN_SEC, len + 2 * XCORR_MARGIN_SEC);
  // probe 原点比 expectedAt 早 margin；互相关结果减去 margin 即偏移
  const { lagSec, confidence } = estimateEnvelopeLagSec(ref, probeBuf, PCM_RATE, 2 * XCORR_MARGIN_SEC);
  return { lag: Math.round((lagSec - XCORR_MARGIN_SEC) * 1000) / 1000, confidence };
}

export type MusicMvClipFitReport = { results: MvClipFitResult[]; ok: boolean; redoShotIds: string[] };

/**
 * 逐段实测与落位。clipUrls 与 fits 同序（可读的 https 签名链或本地路径）；songUrl 为原歌。
 */
export async function fitMusicMvClips(
  clipUrls: readonly string[],
  fits: readonly MvClipFitInput[],
  songUrl: string,
  deps: { download?: (url: string, target: string) => Promise<unknown> } = {},
): Promise<MusicMvClipFitReport> {
  if (clipUrls.length !== fits.length) throw new Error("镜头实测清单与合成镜头数不一致，未合成");
  const download = deps.download ?? ((url: string, target: string) => downloadFileToPath(url, target, AbortSignal.timeout(120_000)));
  const dir = await mkdtemp(path.join(tmpdir(), "mv-fit-"));
  try {
    const needsSong = fits.some(f => f.kind === "singing");
    const song = path.join(dir, "song");
    if (needsSong) await download(songUrl, song);
    const results: MvClipFitResult[] = [];
    for (let i = 0; i < fits.length; i += 1) {
      const fit = fits[i]!;
      const file = path.join(dir, `clip-${i}.mp4`);
      await download(clipUrls[i]!, file);
      const facts = await probe(file);
      const measure: Parameters<typeof planMvClipFit>[1] = { measuredSec: facts.duration, hasAudio: facts.hasAudio };
      if (fit.kind === "singing" && facts.hasAudio) {
        const len = Math.min(XCORR_WINDOW_SEC, fit.durationSec);
        const head = await lagAt(file, song, fit.songStartSec, fit.offsetSec, len);
        const tailStart = Math.max(0, fit.durationSec - len);
        const tail = await lagAt(file, song, fit.songStartSec + tailStart, fit.offsetSec + tailStart, len);
        Object.assign(measure, { lagHeadSec: head.lag, lagTailSec: tail.lag, confidence: Math.min(head.confidence, tail.confidence) });
      }
      results.push(planMvClipFit(fit, measure));
    }
    const redoShotIds = results.filter(r => !r.ok).map(r => r.shotId);
    return { results, ok: redoShotIds.length === 0, redoShotIds };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
