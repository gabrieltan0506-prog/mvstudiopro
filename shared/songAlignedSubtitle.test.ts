import { describe, expect, it } from "vitest";
import { validateSongAlignedSubtitle } from "./songAlignedSubtitle";
const input = { requestId: "33333333-3333-4333-8333-333333333333", sourceId: "song", durationSec: 3, words: [{ text: "归来", startSec: 1.125, endSec: 2.25 }], srt: "1\n00:00:01,125 --> 00:00:02,250\n归来\n" };
describe("歌曲字幕沿用真实对齐秒位", () => {
  it("保留真实词时间，不按镜头数量均分", () => {
    const result = validateSongAlignedSubtitle(input, 3);
    expect(result.words).toEqual(input.words);
    expect(result.srt).toContain("00:00:01,125 --> 00:00:02,250");
  });
  it("空词、倒序、无效或超过真实输出时间均拒绝，不静默裁切", () => {
    for (const words of [[], [{ text: "归来", startSec: 2, endSec: 1 }], [{ text: "归来", startSec: 2, endSec: 4 }], [...input.words, { text: "倒序", startSec: 0, endSec: 0.5 }]])
      expect(() => validateSongAlignedSubtitle({ ...input, words })).toThrow();
    expect(() => validateSongAlignedSubtitle(input, 2)).toThrow();
    expect(() => validateSongAlignedSubtitle({ ...input, srt: "1\n00:00:02,000 --> 00:00:04,000\n越界\n" })).toThrow();
  });
});
