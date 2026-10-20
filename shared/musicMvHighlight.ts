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
