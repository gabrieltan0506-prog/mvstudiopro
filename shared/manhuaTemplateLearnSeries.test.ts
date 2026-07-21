import { describe, expect, it } from "vitest";
import {
  MANHUA_LEARN_ANALYSIS_MIN,
  MANHUA_LEARN_BATCH_DEFAULT,
  canEmitManhuaLearnAnalysis,
  clampManhuaLearnBatchSize,
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

  it("requires min episodes before analysis", () => {
    expect(canEmitManhuaLearnAnalysis(15)).toBe(false);
    expect(canEmitManhuaLearnAnalysis(MANHUA_LEARN_ANALYSIS_MIN)).toBe(true);
  });

  it("merges digests into one proposal only when enough episodes", () => {
    const few = Array.from({ length: 10 }, (_, i) => digest(i + 1));
    expect(
      mergeEpisodeDigestsIntoProposal({
        seriesKey: "abc",
        titleHint: "边关开荒",
        sourceUrl: "https://example.com/mix",
        digests: few,
      }),
    ).toBeNull();

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
