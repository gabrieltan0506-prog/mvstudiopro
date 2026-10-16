import { z } from "zod";
import { normalizeDialogueSubtitleSrt } from "./dialogueSubtitleSrt";

/** 已由本人对齐回执冻结，时间以歌曲开头为零点，不随镜头重新分配。 */
export const songAlignedSubtitleSchema = z.object({
  requestId: z.string().uuid(),
  sourceId: z.string().min(1),
  durationSec: z.number().finite().positive().max(3600),
  words: z.array(z.object({ text: z.string().trim().min(1), startSec: z.number().finite().nonnegative(), endSec: z.number().finite().positive() }).strict()).min(1),
  srt: z.string().min(1).max(200_000),
}).strict();
export type SongAlignedSubtitle = z.infer<typeof songAlignedSubtitleSchema>;

export function validateSongAlignedSubtitle(raw: unknown, actualDurationSec?: number): SongAlignedSubtitle {
  const value = songAlignedSubtitleSchema.parse(raw);
  const duration = actualDurationSec ?? value.durationSec;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法核对歌词字幕对应的真实时长");
  for (let i = 0; i < value.words.length; i++) {
    const word = value.words[i];
    if (word.endSec <= word.startSec || word.endSec > value.durationSec + 0.001 || word.endSec > duration + 0.001 ||
      (i > 0 && word.startSec < value.words[i - 1].startSec))
      throw new Error("歌词对齐时间超出歌曲或成片范围，未裁切或移动字幕");
  }
  return { ...value, srt: normalizeDialogueSubtitleSrt(value.srt, Math.min(value.durationSec, duration)) };
}
