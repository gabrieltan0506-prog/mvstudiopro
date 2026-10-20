import { buildManhuaSubtitleBurnSrt } from "./manhuaEditSubtitle";
import { z } from "zod";
import { normalizeDialogueSubtitleSrt } from "./dialogueSubtitleSrt";

/** 已由本人对齐回执冻结，时间以歌曲开头为零点，不随镜头重新分配。 */
export const songAlignedSubtitleSchema = z
  .object({
    requestId: z.string().uuid(),
    sourceId: z.string().min(1),
    durationSec: z.number().finite().positive().max(3600),
    words: z
      .array(
        z
          .object({
            text: z.string().trim().min(1),
            startSec: z.number().finite().nonnegative(),
            endSec: z.number().finite().positive(),
          })
          .strict()
      )
      .min(1),
    srt: z.string().min(1).max(200_000),
  })
  .strict();
export type SongAlignedSubtitle = z.infer<typeof songAlignedSubtitleSchema>;

export function validateSongAlignedSubtitle(
  raw: unknown,
  actualDurationSec?: number
): SongAlignedSubtitle {
  const value = songAlignedSubtitleSchema.parse(raw);
  const duration = actualDurationSec ?? value.durationSec;
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("无法核对歌词字幕对应的真实时长");
  for (let i = 0; i < value.words.length; i++) {
    const word = value.words[i];
    if (
      word.endSec <= word.startSec ||
      word.endSec > value.durationSec + 0.001 ||
      word.endSec > duration + 0.001 ||
      (i > 0 && word.startSec < value.words[i - 1].startSec)
    )
      throw new Error("歌词对齐时间超出歌曲或成片范围，未裁切或移动字幕");
  }
  return {
    ...value,
    srt: normalizeDialogueSubtitleSrt(
      value.srt,
      Math.min(value.durationSec, duration)
    ),
  };
}

/** 高光版明确选择原歌区间，裁取相交字幕并把原绝对秒位平移到成片零点。 */
export function cropSongAlignedSubtitle(
  raw: SongAlignedSubtitle,
  startSec: number,
  endSec: number
): SongAlignedSubtitle | undefined {
  const source = validateSongAlignedSubtitle(raw);
  if (
    !Number.isFinite(startSec) ||
    !Number.isFinite(endSec) ||
    startSec < 0 ||
    endSec <= startSec ||
    endSec > source.durationSec + 0.001
  )
    throw new Error("歌词高光区间超出原歌曲");
  const words = source.words
    .filter(word => word.endSec > startSec && word.startSec < endSec)
    .map(word => ({
      ...word,
      startSec: Math.max(0, word.startSec - startSec),
      endSec: Math.min(endSec, word.endSec) - startSec,
    }));
  if (!words.length) return undefined;
  const cues = source.srt
    .trim()
    .split(/\n\s*\n/)
    .flatMap((block, index) => {
      const lines = block.split("\n");
      if (/^\d+$/.test(lines[0].trim())) lines.shift();
      const match = lines
        .shift()!
        .match(
          /^(\d{2}):([0-5]\d):([0-5]\d),(\d{3}) --> (\d{2}):([0-5]\d):([0-5]\d),(\d{3})$/
        )!;
      const seconds = (offset: number) =>
        Number(match[offset]) * 3600 +
        Number(match[offset + 1]) * 60 +
        Number(match[offset + 2]) +
        Number(match[offset + 3]) / 1000;
      const from = seconds(1),
        to = seconds(5);
      return to > startSec && from < endSec
        ? [
            {
              shotIndex: index + 1,
              order: index + 1,
              startSec: Math.max(0, from - startSec),
              endSec: Math.min(endSec, to) - startSec,
              textZh: lines.join("\n"),
            },
          ]
        : [];
    });
  if (!cues.length) throw new Error("高光歌词与字幕条目不一致");
  return validateSongAlignedSubtitle({
    ...source,
    durationSec: endSec - startSec,
    words,
    srt: buildManhuaSubtitleBurnSrt(cues),
  });
}
