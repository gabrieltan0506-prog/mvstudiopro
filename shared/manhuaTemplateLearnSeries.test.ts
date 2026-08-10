import { describe, expect, it } from "vitest";
import {
  MANHUA_LEARN_ANALYSIS_MIN,
  MANHUA_LEARN_BATCH_DEFAULT,
  canEmitManhuaLearnAnalysis,
  clampManhuaLearnBatchSize,
  classifyManhuaLearnTitle,
  mergeEpisodeDigestsIntoProposal,
  pickNextEpisodeIndexes,
  type ManhuaLearnEpisodeDigest,
} from "./manhuaTemplateLearnSeries";

function digest(i: number): ManhuaLearnEpisodeDigest {
  return {
    episodeIndex: i,
    url: `https://example.com/ep${i}`,
    title: `第${i}集`,
    durationSec: 90,
    transcriptPreview: "打脸反转",
    hookNoteZh: i === 1 ? "开场贬令落地" : `第${i}集压迫升级`,
    beatHints: [{ atSec: 0, conflictZh: "冲突", visualZh: "动作" }],
    climaxNotes: ["反转"],
    sceneHints: ["边塞"],
    learnedAt: new Date().toISOString(),
  };
}

describe("manhuaTemplateLearnSeries", () => {
  it("classifies title like rising board", () => {
    const c = classifyManhuaLearnTitle("重生漫剧开局团宠");
    expect(c.categoryLabelZh).toBe("AI漫剧");
    expect(c.tagLabelsZh).toContain("重生");
  });

  it("clamps batch to 8–10", () => {
    expect(clampManhuaLearnBatchSize(3)).toBe(8);
    expect(clampManhuaLearnBatchSize(8)).toBe(8);
    expect(clampManhuaLearnBatchSize(9)).toBe(9);
    expect(clampManhuaLearnBatchSize(12)).toBe(10);
    expect(clampManhuaLearnBatchSize(undefined)).toBe(MANHUA_LEARN_BATCH_DEFAULT);
  });

  it("picks next episodes in order skipping learned", () => {
    const listed = Array.from({ length: 30 }, (_, i) => i + 1);
    const picked = pickNextEpisodeIndexes({
      listedIndexes: listed,
      learnedIndexes: [1, 2, 3],
      batchSize: 8,
    });
    expect(picked).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("picks single remaining episode without forcing batch of 8", () => {
    expect(
      pickNextEpisodeIndexes({
        listedIndexes: [1],
        learnedIndexes: [],
        batchSize: 8,
      }),
    ).toEqual([1]);
    expect(
      pickNextEpisodeIndexes({
        listedIndexes: [1, 2, 3],
        learnedIndexes: [1],
        batchSize: 8,
      }),
    ).toEqual([2, 3]);
  });

  it("门槛：≥16 完整版；4 集或合集学完出草版；0 集与 3/长合集不出", () => {
    expect(canEmitManhuaLearnAnalysis(MANHUA_LEARN_ANALYSIS_MIN)).toBe(true);
    // 草版：学满 4 集即出
    expect(canEmitManhuaLearnAnalysis(4)).toBe(true);
    expect(canEmitManhuaLearnAnalysis(15)).toBe(true);
    // 草版：短合集全学完（2 集合集学完 2 集）
    expect(canEmitManhuaLearnAnalysis(2, 2)).toBe(true);
    expect(canEmitManhuaLearnAnalysis(1, 1)).toBe(true);
    // 不出：一集没学 / 长合集只学了 3 集
    expect(canEmitManhuaLearnAnalysis(0, 2)).toBe(false);
    expect(canEmitManhuaLearnAnalysis(3, 20)).toBe(false);
    expect(canEmitManhuaLearnAnalysis(3)).toBe(false);
  });

  it("merges digests into one proposal（草版口径：有几集合成几集，空集合返 null）", () => {
    expect(
      mergeEpisodeDigestsIntoProposal({
        seriesKey: "abc",
        titleHint: "边关开荒",
        sourceUrl: "https://example.com/mix",
        digests: [],
      }),
    ).toBeNull();

    const few = Array.from({ length: 2 }, (_, i) => digest(i + 1));
    expect(
      mergeEpisodeDigestsIntoProposal({
        seriesKey: "abc",
        titleHint: "边关开荒",
        sourceUrl: "https://example.com/mix",
        digests: few,
      })?.status,
    ).toBe("proposed");

    const enough = Array.from({ length: 16 }, (_, i) => digest(i + 1));
    const card = mergeEpisodeDigestsIntoProposal({
      seriesKey: "abc12",
      titleHint: "边关开荒",
      sourceUrl: "https://example.com/mix",
      digests: enough,
    });
    expect(card?.status).toBe("proposed");
    expect(card?.id).toMatch(/^tpl_series_/);
    expect(card?.hook3sZh).toMatch(/贬令|开场/);
    expect(card?.beatGrid.length).toBeGreaterThan(0);
  });
});
