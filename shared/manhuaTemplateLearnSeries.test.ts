import { describe, expect, it } from "vitest";
import {
  isManhuaLearnListComplete,
  MANHUA_LEARN_ANALYSIS_MIN,
  MANHUA_LEARN_BATCH_DEFAULT,
  canEmitManhuaLearnAnalysis,
  clampManhuaLearnBatchSize,
  classifyManhuaLearnTitle,
  mergeEpisodeDigestsIntoProposal,
  pickNextEpisodeIndexes,
  type ManhuaLearnEpisodeDigest,
  pickManhuaLearnEpisodeGapMs,
  pickRetrySkippedEpisodeIndexes,
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

  it("skips temporarily unavailable episodes and continues from later episodes", () => {
    expect(
      pickNextEpisodeIndexes({
        listedIndexes: [1, 2, 3, 4, 5, 6],
        learnedIndexes: [1, 2],
        skippedIndexes: [3, 4],
        batchSize: 8,
      }),
    ).toEqual([5, 6]);
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

  it("门槛（2026-08-11 拍板）：学 1 集即可出草版入库；只有 0 集不出", () => {
    expect(canEmitManhuaLearnAnalysis(MANHUA_LEARN_ANALYSIS_MIN)).toBe(true);
    expect(canEmitManhuaLearnAnalysis(4)).toBe(true);
    expect(canEmitManhuaLearnAnalysis(3)).toBe(true);
    expect(canEmitManhuaLearnAnalysis(1)).toBe(true);
    expect(canEmitManhuaLearnAnalysis(1, { allListedComplete: false })).toBe(true);
    // 不出：一集没学
    expect(canEmitManhuaLearnAnalysis(0)).toBe(false);
    expect(canEmitManhuaLearnAnalysis(0, { allListedComplete: true })).toBe(false);
    // 集合判定辅助：列表降级缩水不会误判
    expect(isManhuaLearnListComplete([1, 2], [1, 2, 3])).toBe(true);
    expect(isManhuaLearnListComplete([1, 2, 3], [1, 2])).toBe(false);
    expect(isManhuaLearnListComplete([], [1])).toBe(false);
    expect(isManhuaLearnListComplete(undefined, [1])).toBe(false);
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

describe("pickRetrySkippedEpisodeIndexes（重试暂跳集批次）", () => {
  it("只取仍在列表里的暂跳集，升序，尊重批次上限", () => {
    expect(
      pickRetrySkippedEpisodeIndexes({
        listedIndexes: [1, 2, 3, 4, 5, 6],
        skippedIndexes: [4, 3, 99],
        learnedIndexes: [1, 2],
        batchSize: 8,
      }),
    ).toEqual([3, 4]);
  });

  it("已学成的集不再重试；空暂跳返回空组", () => {
    expect(
      pickRetrySkippedEpisodeIndexes({
        listedIndexes: [1, 2, 3],
        skippedIndexes: [2],
        learnedIndexes: [2],
      }),
    ).toEqual([]);
    expect(
      pickRetrySkippedEpisodeIndexes({ listedIndexes: [1, 2, 3], skippedIndexes: [] }),
    ).toEqual([]);
  });

  it("批次裁剪：暂跳 5 集 batchSize=2 只取前 2", () => {
    expect(
      pickRetrySkippedEpisodeIndexes({
        listedIndexes: [1, 2, 3, 4, 5],
        skippedIndexes: [5, 1, 3, 2, 4],
        batchSize: 2,
      }),
    ).toEqual([1, 2]);
  });
});

describe("pickManhuaLearnEpisodeGapMs（集间礼貌间隔）", () => {
  it("在 10–15 秒区间内取值，seed 越界收敛", () => {
    expect(pickManhuaLearnEpisodeGapMs(0)).toBe(10_000);
    expect(pickManhuaLearnEpisodeGapMs(1)).toBe(15_000);
    expect(pickManhuaLearnEpisodeGapMs(0.5)).toBe(12_500);
    expect(pickManhuaLearnEpisodeGapMs(-1)).toBe(10_000);
    expect(pickManhuaLearnEpisodeGapMs(2)).toBe(15_000);
    expect(pickManhuaLearnEpisodeGapMs(Number.NaN)).toBe(10_000);
  });
});
