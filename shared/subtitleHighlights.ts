import { z } from "zod";

export const SUBTITLE_HIGHLIGHT_OPTIONS = [
  {
    id: "impact",
    label: "冲击弹入",
    description: "暖金关键词快速弹入并落定。",
  },
  {
    id: "arrange",
    label: "归序排列",
    description: "用竖线分开关键词，依次滑入并排列。",
  },
  {
    id: "spiral",
    label: "暖金定格与螺旋光",
    description: "关键词渐显定格，下方螺旋光持续旋转。",
  },
] as const;
/** 编辑稿允许尚未填完的文字和时间，提交时再执行严格校验。 */
export const subtitleHighlightDraftSchema = z
  .array(
    z.object({
      id: z.string(),
      startSec: z.number().finite(),
      endSec: z.number().finite(),
      text: z.string(),
      effect: z.enum(["impact", "arrange", "spiral"]),
      positionPercent: z.number().finite(),
      fontSize: z.number().finite().default(13),
    })
  )
  .max(120);

export const subtitleHighlightSchema = z
  .object({
    id: z.string().min(1).max(80),
    startSec: z.number().finite().min(0).max(7200),
    endSec: z.number().finite().min(0).max(7200),
    text: z.string().trim().min(1).max(48),
    effect: z.enum(["impact", "arrange", "spiral"]),
    /** 相对画面顶部的百分比，创作者根据原片调整避脸位置。 */
    positionPercent: z.number().finite().min(15).max(85),
    fontSize: z.number().finite().min(8).max(24).default(13),
  })
  .strict()
  .superRefine((cue, ctx) => {
    if (cue.endSec - cue.startSec < 0.2 || cue.endSec - cue.startSec > 30)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "重点字幕每条时长须为0.2至30秒",
      });
    if (cue.effect !== "arrange" && Array.from(cue.text).length > 18)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "重点字幕请精简到18字以内",
      });
    if (cue.effect === "arrange") {
      const words = cue.text.split(/[|｜]/).map(word => word.trim());
      if (
        words.length < 2 ||
        words.length > 4 ||
        words.some(word => !word || Array.from(word).length > 6)
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "归序排列请用竖线分成2至4个关键词，每个最多6字",
        });
    }
  });
export const subtitleHighlightsSchema = z
  .array(subtitleHighlightSchema)
  .max(120)
  .superRefine((cues, ctx) => {
    if (
      cues
        .filter(cue => cue.effect === "spiral")
        .reduce((sum, cue) => sum + cue.endSec - cue.startSec, 0) > 180
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "单次螺旋光累计时长最多180秒，请分批处理",
      });
    const ids = new Set<string>();
    for (const cue of cues) {
      if (ids.has(cue.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "重点字幕编号重复",
        });
      ids.add(cue.id);
    }
  });
export type SubtitleHighlight = z.infer<typeof subtitleHighlightSchema>;

export function validateSubtitleHighlights(
  cues: unknown,
  durationSec?: number
): SubtitleHighlight[] {
  const parsed = subtitleHighlightsSchema.parse(cues);
  if (
    durationSec != null &&
    parsed.some(cue => cue.endSec > durationSec + 0.05)
  )
    throw new Error("重点字幕超出当前视频时长，请调整时间");
  return parsed;
}
