import { describe, it, expect } from "vitest";
import { musicMvShotSlices, musicMvHighlightSchema } from "./musicMvHighlight";
import { cropSongAlignedSubtitle } from "./songAlignedSubtitle";
import { canvasMusicMvStateSchema } from "./canvasMusicMv";
const plan = {
  version: 1 as const,
  audioId: "song",
  audioDurationSec: 100,
  analysisBasis: "lyrics_and_user_description" as const,
  shots: Array.from({ length: 10 }, (_, i) => ({
    id: `shot-${i}`,
    startSec: i * 10,
    endSec: (i + 1) * 10,
    visualPrompt: "行走",
    cameraPrompt: "跟随",
    lyricQuote: "",
    referenceIndices: [],
  })),
};
describe("高光区间与歌词保持原歌时间", () => {
  it("从整曲中只取相交片段，首尾真裁切，范围与30–60秒验证", () => {
    expect(
      musicMvShotSlices(plan, { startSec: 25, endSec: 65 }).map(r => [
        r.shot.id,
        r.offsetSec,
        r.durationSec,
      ])
    ).toEqual([
      ["shot-2", 5, 5],
      ["shot-3", 0, 10],
      ["shot-4", 0, 10],
      ["shot-5", 0, 10],
      ["shot-6", 0, 5],
    ]);
    expect(() =>
      musicMvHighlightSchema.parse({ startSec: 20, endSec: 49 })
    ).toThrow();
    expect(() =>
      musicMvShotSlices(plan, { startSec: 80, endSec: 120 })
    ).toThrow("超出");
    expect(() =>
      musicMvShotSlices(plan, { startSec: 9.8, endSec: 49.8 })
    ).toThrow("0.5");
  });
  it("高光字幕裁边并平移，纯器乐区间不凭空补歌词", () => {
    const source = {
      requestId: "11111111-1111-4111-8111-111111111111",
      sourceId: "song",
      durationSec: 100,
      words: [
        { text: "之前", startSec: 10, endSec: 11 },
        { text: "高光", startSec: 24, endSec: 26 },
        { text: "后来", startSec: 50, endSec: 52 },
      ],
      srt: "1\n00:00:10,000 --> 00:00:11,000\n之前\n\n2\n00:00:24,000 --> 00:00:26,000\n高光\n\n3\n00:00:50,000 --> 00:00:52,000\n后来\n",
    };
    const result = cropSongAlignedSubtitle(source, 25, 51)!;
    expect(result.durationSec).toBe(26);
    expect(result.words).toEqual([
      { text: "高光", startSec: 0, endSec: 1 },
      { text: "后来", startSec: 25, endSec: 26 },
    ]);
    expect(result.srt).toContain("00:00:00,000 --> 00:00:01,000");
    expect(result.srt).not.toContain("之前");
    expect(cropSongAlignedSubtitle(source, 60, 100)).toBeUndefined();
    expect(source.words[1].startSec).toBe(24);
  });
  it("交付类型、范围和专辑封面尺寸经过实际状态schema不丢失", () => {
    const state = canvasMusicMvStateSchema.parse({
      status: "music_ready",
      candidates: [],
      deliveryMode: "highlight",
      highlight: { startSec: 25, endSec: 65 },
      songCovers: [
        {
          musicJobId: "bgm_test",
          prompt: "专辑封面",
          aspectRatio: "1:1",
          status: "waiting_music",
        },
      ],
    });
    expect(state.deliveryMode).toBe("highlight");
    expect(state.highlight?.startSec).toBe(25);
    expect(state.songCovers?.[0].aspectRatio).toBe("1:1");
  });
});
