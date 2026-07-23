import { describe, expect, it } from "vitest";
import {
  manhuaLearnResultFromFailure,
  manhuaLearnResultFromJobOutput,
  manhuaLearnResultFromLocalFallback,
  manhuaLearnResultFromSnapshot,
  manhuaLearnResultFromStart,
  mergeManhuaLearnLiveProgress,
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
    expect(ui.liveStatus).toBe("failed");
    expect(ui.progressLines?.length).toBeGreaterThan(0);
  });

  it("starts with visible progress panel state", () => {
    const start = manhuaLearnResultFromStart({
      channel: "cloud",
      title: "测剧",
      url: "https://www.douyin.com/video/1",
    });
    expect(start.liveStatus).toBe("queued");
    expect(start.progressLines?.[0]?.detailZh).toMatch(/已开始/);

    const live = mergeManhuaLearnLiveProgress(start, {
      status: "running",
      output: {
        analysisStage: "manhua_learn_download",
        analysisStageLabel: "正在下载第 1 集…",
        learnProgressLog: [
          {
            atIso: "2026-07-23T00:00:00.000Z",
            stage: "download",
            detailZh: "正在下载第 1 集…",
          },
        ],
      },
    });
    expect(live.liveStatus).toBe("running");
    expect(live.liveLabelZh).toMatch(/下载/);
  });

  it("maps local fallback into panel steps", () => {
    const ui = manhuaLearnResultFromLocalFallback({
      reasonZh: "网路失败",
      cmd: "pnpm run manhua:template-learn -- --url x",
      title: "某剧",
    });
    expect(ui.channel).toBe("local");
    expect(ui.liveStatus).toBe("local");
    expect(ui.progressLines?.some((l) => /剪贴板|终端/.test(l.detailZh))).toBe(true);
  });
});
