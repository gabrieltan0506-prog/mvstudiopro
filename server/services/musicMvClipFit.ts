/**
 * MV 合成前的镜头实测适配（1109）：ffprobe 实测每段时长，只裁不变速；演唱段按原歌绝对时间帧精确落位。
 * 不合格的段（实测不够入片/唱句尾）列出，由调用方只重做该段。口型由视觉核验另判，不用模型音轨相关。
 * 纯判定在 shared/canvasMusicMvClipFit.ts；这里只负责下载、探测与解码。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execHeavyMedia } from "./heavyMediaProcess";
import { downloadFileToPath } from "../vercel-api-core/renderUtils.js";
import {
  planMvClipFit,
  type MvClipFitInput,
  type MvClipFitResult,
} from "../../shared/canvasMusicMvClipFit";


async function probe(file: string): Promise<{ duration: number; hasAudio: boolean }> {
  const { stdout } = await execHeavyMedia("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file]);
  const parsed = JSON.parse(String(stdout)) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
  const duration = Number(parsed.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("镜头时长不可实测，未合成");
  return { duration, hasAudio: (parsed.streams || []).some(s => s.codec_type === "audio") };
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
    void songUrl;
    const results: MvClipFitResult[] = [];
    for (let i = 0; i < fits.length; i += 1) {
      const fit = fits[i]!;
      const file = path.join(dir, `clip-${i}.mp4`);
      await download(clipUrls[i]!, file);
      const facts = await probe(file);
      results.push(planMvClipFit(fit, { measuredSec: facts.duration, hasAudio: facts.hasAudio }));
    }
    const redoShotIds = results.filter(r => !r.ok).map(r => r.shotId);
    return { results, ok: redoShotIds.length === 0, redoShotIds };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
