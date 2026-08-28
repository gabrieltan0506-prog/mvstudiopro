import { describe, expect, it } from "vitest";
import {
  isManhuaLearnListComplete,
  MANHUA_LEARN_ANALYSIS_MIN,
  MANHUA_LEARN_BATCH_DEFAULT,
  MANHUA_LEARN_BATCH_MAX,
  MANHUA_LEARN_BATCH_MIN,
  MANHUA_LEARN_CONSECUTIVE_FAIL_STOP,
  canEmitManhuaLearnAnalysis,
  clampManhuaLearnBatchSize,
  classifyManhuaLearnTitle,
  mergeEpisodeDigestsIntoProposal,
  nextManhuaLearnEpisodeFailureStreak,
  deriveManhuaLearnPaywallState,
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

  it("允许自定义 1–80 集，缺省仍为 8", () => {
    expect(clampManhuaLearnBatchSize(-1)).toBe(MANHUA_LEARN_BATCH_MIN);
    expect(clampManhuaLearnBatchSize(3)).toBe(3);
    expect(clampManhuaLearnBatchSize(8)).toBe(8);
    expect(clampManhuaLearnBatchSize(31)).toBe(31);
    expect(clampManhuaLearnBatchSize(999)).toBe(MANHUA_LEARN_BATCH_MAX);
    expect(clampManhuaLearnBatchSize(undefined)).toBe(MANHUA_LEARN_BATCH_DEFAULT);
  });

  it("连续失败 8 集停止；任一集成功会清零", () => {
    let count = 0;
    for (let i = 1; i < MANHUA_LEARN_CONSECUTIVE_FAIL_STOP; i += 1) {
      const state = nextManhuaLearnEpisodeFailureStreak(count, "failure");
      count = state.count;
      expect(state.shouldStop).toBe(false);
    }
    const stopped = nextManhuaLearnEpisodeFailureStreak(count, "failure");
    expect(stopped).toEqual({
      count: MANHUA_LEARN_CONSECUTIVE_FAIL_STOP,
      shouldStop: true,
    });
    expect(nextManhuaLearnEpisodeFailureStreak(stopped.count, "success")).toEqual({
      count: 0,
      shouldStop: false,
    });
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

  it("系列底稿聚合全部已学分片，不再只读取前 20 集", () => {
    const all = Array.from({ length: 25 }, (_, index) => ({
      ...digest(index + 1),
      seriesDraftEvidence: index < 10
        ? {
            laneZh: "古言种田" as const,
            summaryZh: "前段开荒",
            castShape: { leadDesireZh: "守住家园", pressureZh: "断粮" },
          }
        : {
            laneZh: "系统觉醒" as const,
            summaryZh: "后段系统升级",
            castShape: { leadDesireZh: "完成进化", pressureZh: "强敌追杀" },
          },
    }));
    const card = mergeEpisodeDigestsIntoProposal({
      seriesKey: "all-evidence",
      titleHint: "完整系列",
      sourceUrl: "https://example.com/mix",
      digests: all,
    });
    expect(card?.laneZh).toBe("系统觉醒");
    expect(card?.summaryZh).toContain("后段系统升级");
    expect(card?.castShape.leadDesireZh).toBe("完成进化");
    expect(card?.sourceRefs[0]?.noteZh).toContain("累计学习25集");
  });

  it("旧抽帧系列聚合保留超过 24 条节拍证据", () => {
    const complete = {
      ...digest(1),
      beatHints: Array.from({ length: 40 }, (_, index) => ({
        atSec: index,
        conflictZh: `冲突${index}`,
        visualZh: `画面${index}`,
      })),
    };
    const card = mergeEpisodeDigestsIntoProposal({
      seriesKey: "legacy-full-evidence",
      titleHint: "完整旧链证据",
      sourceUrl: "https://example.com/mix",
      digests: [complete],
    });
    expect(card?.beatGrid).toHaveLength(40);
    expect(card?.beatGrid.at(-1)?.visualZh).toBe("画面39");
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

describe("deriveManhuaLearnPaywallState（付费边界）", () => {
  it("第14集明确付费后跳过14及以后，保留1–13可学", () => {
    const listed = Array.from({ length: 72 }, (_, offset) => ({
      index: offset + 1,
      access: offset + 1 >= 14 ? "paid_locked" as const : "free" as const,
    }));
    const state = deriveManhuaLearnPaywallState({ listed, reliable: true });
    expect(state.paywallStartEpisodeIndex).toBe(14);
    expect(state.paywallEpisodeIndexes).toHaveLength(59);
    expect(state.paywallEpisodeIndexes[0]).toBe(14);
    expect(state.paywallEpisodeIndexes.at(-1)).toBe(72);
  });

  it("接口瞬时缺字段时保留旧边界；完整明确免费时才解冻", () => {
    expect(deriveManhuaLearnPaywallState({
      listed: [{ index: 13 }, { index: 14 }],
      reliable: true,
      previousIndexes: [14, 15],
      previousStartIndex: 14,
    })).toMatchObject({ paywallStartEpisodeIndex: 14, paywallEpisodeIndexes: [14, 15] });
    expect(deriveManhuaLearnPaywallState({
      listed: [{ index: 13, access: "free" }, { index: 14, access: "free" }],
      reliable: true,
      previousIndexes: [14, 15],
      previousStartIndex: 14,
    })).toEqual({ paywallEpisodeIndexes: [], detected: true });
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
