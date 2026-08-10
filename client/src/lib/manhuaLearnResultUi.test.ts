import { describe, expect, it } from "vitest";
import {
  isManhuaLearnEmptyBatchFailure,
  manhuaLearnResultFromJobOutput,
  mergeManhuaLearnLiveProgress,
} from "./manhuaLearnResultUi";

describe("manhuaLearnResultUi soft-fail", () => {
  it("detects empty-batch failure message", () => {
    expect(
      isManhuaLearnEmptyBatchFailure({
        batchLearned: 0,
        messageZh: "本轮未能成功采下新集（列表 1 集，已累计 0）。请换链接或稍后重试。",
      }),
    ).toBe(true);
    expect(
      isManhuaLearnEmptyBatchFailure({
        batchLearned: 2,
        messageZh: "本轮学了 2 集",
      }),
    ).toBe(false);
  });

  it("marks job output with 0 learned as failed ui", () => {
    const ui = manhuaLearnResultFromJobOutput({
      seriesKey: "abc",
      batchLearned: 0,
      learnedCount: 0,
      messageZh: "本轮未能成功采下新集（列表 1 集，已累计 0）。",
      digestsPreview: [],
      learnChannel: "cloud",
    });
    expect(ui.liveStatus).toBe("failed");
    expect(ui.errorZh).toMatch(/未能成功/);
  });

  it("running job derives learned count from persisted episode logs", () => {
    const ui = mergeManhuaLearnLiveProgress(null, {
      status: "running",
      output: {
        analysisStage: "manhua_learn_persist",
        analysisStageLabel: "第 7 集整集学完（约 3 分钟 · 本轮新增 7）",
        learnProgressLog: [
          { atIso: "2026-08-10T12:00:00.000Z", stage: "list", detailZh: "已解析 90 集（合集展开）" },
          { atIso: "2026-08-10T12:07:00.000Z", stage: "persist", detailZh: "第 7 集整集学完（约 3 分钟 · 本轮新增 7）" },
        ],
      },
    });
    expect(ui.batchLearned).toBe(7);
    expect(ui.learnedCount).toBe(7);
    expect(ui.listedEpisodeCount).toBe(90);
    expect(ui.pendingCount).toBe(83);
  });
});
