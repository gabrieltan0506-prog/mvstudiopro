import { z } from "zod";
import type { CanvasMusicMvPlan } from "./canvasMusicMv";

export const musicMvHighlightSchema = z
  .object({
    startSec: z.number().finite().nonnegative(),
    endSec: z.number().finite().positive(),
  })
  .strict()
  .superRefine((range, ctx) => {
    const duration = range.endSec - range.startSec;
    if (duration < 30 || duration > 60)
      ctx.addIssue({ code: "custom", message: "高光MV须为30至60秒" });
  });
export type MusicMvHighlight = z.infer<typeof musicMvHighlightSchema>;
/** 原歌绝对秒位不变，输出裁点按30fps统一量化，不改变演唱速度。 */
export function musicMvShotSlices(
  plan: CanvasMusicMvPlan,
  range?: MusicMvHighlight
) {
  if (range) {
    musicMvHighlightSchema.parse(range);
    if (range.endSec > plan.audioDurationSec)
      throw new Error("高光区间超出所选歌曲");
  }
  const startFrame = Math.round((range?.startSec ?? 0) * 30);
  const endFrame = Math.round((range?.endSec ?? plan.audioDurationSec) * 30);
  const rows = plan.shots.flatMap(shot => {
    const shotStart = Math.round(shot.startSec * 30);
    const start = Math.max(startFrame, shotStart);
    const end = Math.min(endFrame, Math.round(shot.endSec * 30));
    return end > start
      ? [
          {
            shot,
            offsetSec: (start - shotStart) / 30,
            durationSec: (end - start) / 30,
          },
        ]
      : [];
  });
  if (
    range &&
    (!rows.length ||
      Math.abs(
        rows.reduce((sum, row) => sum + row.durationSec, 0) -
          (endFrame - startFrame) / 30
      ) > 0.001)
  )
    throw new Error("高光区间的分镜不完整");
  if (range && rows.some(row => row.durationSec < 0.5))
    throw new Error("高光边缘镜头不足0.5秒，请调整起止点至邻近镜头边界");
  return rows;
}

/**
 * 1109 推荐高光（只取有歌词的部分）：在 30–60 秒窗里选歌词句数最多、且含副歌（能量高）的一段，
 * 起止对齐乐句边界（窗从某句开口前 0.3 秒起、到某句收声后 0.5 秒止，不切进相邻句）。
 * 能量取 audiomap 分段（缺省视为同能量）；同句数时取平均能量高者，再取更早者。用户仍可手动改。
 */
export type MusicMvHighlightRecommendation = MusicMvHighlight & { lineCount: number; meanEnergy: number; peakEnergy: number; reasonZh: string };
export function recommendMusicMvHighlight(
  lines: ReadonlyArray<{ text: string; startSec: number; endSec: number }>,
  songDurationSec: number,
  segments: ReadonlyArray<{ startSec: number; endSec: number; energy: number }> = [],
  opts: { minSec?: number; maxSec?: number; chorusEnergy?: number } = {},
): MusicMvHighlightRecommendation | undefined {
  const minSec = opts.minSec ?? 30;
  const maxSec = opts.maxSec ?? 60;
  const chorus = opts.chorusEnergy ?? 0.8;
  const sorted = [...lines].filter(l => l.text.trim() && l.endSec > l.startSec).sort((a, b) => a.startSec - b.startSec);
  if (!sorted.length) return undefined;
  const energyOver = (a: number, b: number) => {
    let sum = 0, len = 0, peak = 0;
    for (const s of segments) {
      const o = Math.min(b, s.endSec) - Math.max(a, s.startSec);
      if (o <= 0) continue;
      sum += s.energy * o; len += o; peak = Math.max(peak, s.energy);
    }
    return len ? { mean: sum / len, peak } : { mean: 1, peak: 1 };
  };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  let best: MusicMvHighlightRecommendation | undefined;
  for (let i = 0; i < sorted.length; i++) {
    const prevEnd = i > 0 ? sorted[i - 1]!.endSec : 0;
    const start = r2(Math.max(prevEnd, sorted[i]!.startSec - 0.3, 0));
    for (let j = i; j < sorted.length; j++) {
      const nextStart = j + 1 < sorted.length ? sorted[j + 1]!.startSec : songDurationSec;
      let end = r2(Math.min(nextStart, sorted[j]!.endSec + 0.5, songDurationSec));
      if (end - start > maxSec) break;
      // 窗不足 30 秒：在不切进下一句的前提下向后补到 30 秒（含尾奏/器乐），补不够则跳过
      if (end - start < minSec) {
        const room = Math.min(nextStart, songDurationSec);
        if (room - start < minSec) continue;
        end = r2(start + minSec);
      }
      const { mean, peak } = energyOver(start, end);
      const count = j - i + 1;
      const hasChorus = peak >= chorus;
      const better = !best
        || (hasChorus && best.peakEnergy < chorus)
        || ((hasChorus || best.peakEnergy < chorus) && (count > best.lineCount || (count === best.lineCount && mean > best.meanEnergy + 1e-9)));
      // 对外 0.1 秒精度：起点向下、终点向上取 0.1 秒，仍不切进相邻句（相邻句太近时取不越界的一侧）
      const s10 = Math.max(Math.ceil((prevEnd - 1e-9) * 10) / 10, Math.floor(start * 10) / 10);
      const e10 = Math.min(Math.floor((Math.min(nextStart, songDurationSec) + 1e-9) * 10) / 10, Math.ceil(end * 10) / 10);
      if (e10 - s10 < minSec - 1e-9 || e10 - s10 > maxSec + 1e-9) continue;
      if (better) best = { startSec: r2(s10), endSec: r2(e10), lineCount: count, meanEnergy: r2(mean), peakEnergy: r2(peak), reasonZh: `${count} 句歌词${hasChorus ? "，含高能量段（副歌）" : ""}，平均能量 ${r2(mean)}` };
    }
  }
  return best;
}
