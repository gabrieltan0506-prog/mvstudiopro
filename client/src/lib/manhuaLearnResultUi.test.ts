import { describe, expect, it } from "vitest";
import {
  manhuaLearnResultFromFailure,
  manhuaLearnResultFromJobOutput,
  manhuaLearnResultFromSnapshot,
} from "./manhuaLearnResultUi";

describe("manhuaLearnResultUi", () => {
  it("maps job output with pending counts", () => {
    const ui = manhuaLearnResultFromJobOutput({
      seriesKey: "abc123def456",
      analysisReady: false,
      learnedCount: 8,
      listedEpisodeCount: 20,
      analysisMin: 16,
      analysisTarget: 20,
      batchLearned: 8,
      messageZh: "ok",
      digestsPreview: [
        {
          episodeIndex: 1,
          title: "开局",
          hookNoteZh: "钩",
          transcriptPreview: "对白",
          durationSec: 60,
        },
      ],
    });
    expect(ui.seriesKey).toBe("abc123def456");
    expect(ui.pendingCount).toBe(12);
    expect(ui.learnedCount).toBe(8);
    expect(ui.digestsPreview).toHaveLength(1);
  });

  it("maps snapshot for hydrate after refresh", () => {
    const ui = manhuaLearnResultFromSnapshot({
      seriesKey: "abc123def456",
      progress: {
        listedEpisodeCount: 24,
        titleHint: "测试剧",
        categoryLabelZh: "AI漫剧",
        tagLabelsZh: ["古装"],
      },
      digestsPreview: [
        {
          episodeIndex: 2,
          title: "第二集",
          hookNoteZh: "",
          transcriptPreview: "",
          durationSec: 55,
        },
      ],
      analysisReady: false,
      proposal: null,
    });
    expect(ui.pendingCount).toBe(23);
    expect(ui.learnedCount).toBe(1);
    expect(ui.categoryLabelZh).toBe("AI漫剧");
    expect(ui.messageZh).toMatch(/云端恢复/);
  });

  it("maps failure into visible panel state", () => {
    const ui = manhuaLearnResultFromFailure({
      errorZh: "合集可解析集数不足",
      url: "https://www.douyin.com/video/1",
    });
    expect(ui.errorZh).toMatch(/不足/);
    expect(ui.learnedCount).toBe(0);
    expect(ui.digestsPreview).toEqual([]);
  });
});
