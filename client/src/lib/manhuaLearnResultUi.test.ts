import { afterEach, describe, expect, it } from "vitest";
import {
  isManhuaLearnEmptyBatchFailure,
  manhuaLearnResultFromJobOutput,
  manhuaLearnResultFromStart,
  mergeManhuaLearnLiveProgress,
  readManhuaLearnActiveJob,
  readManhuaLearnResult,
  writeManhuaLearnActiveJob,
  writeManhuaLearnResult,
} from "./manhuaLearnResultUi";

function installMemoryLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

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

  it("preserves the real series key when continuing a learned series", () => {
    const ui = manhuaLearnResultFromStart({
      channel: "cloud",
      url: "https://www.douyin.com/video/123",
      seriesKey: "douyin_kimi_abc123",
    });
    const live = mergeManhuaLearnLiveProgress(ui, {
      status: "running",
      output: {
        seriesKey: "douyin_kimi_abc123",
        learnedCount: 9,
        listedEpisodeCount: 99,
      },
    });
    expect(live.seriesKey).toBe("douyin_kimi_abc123");
    expect(live.learnedCount).toBe(9);
    expect(live.pendingCount).toBe(90);
  });

  it("persists a cloud job so refresh can reattach without re-enqueueing", () => {
    installMemoryLocalStorage();
    writeManhuaLearnActiveJob({
      jobId: "job_episode_10",
      busyKey: "mix_90",
      continuation: {
        row: {
          url: "https://www.douyin.com/video/7658227988223380788",
          mixId: "mix_90",
          mixName: "聚宝仙盆之杂灵根才是真BOSS",
          platform: "douyin",
        },
        rank: 1,
        seriesKey: "douyin_kimi_abc123",
        savedAt: 123,
      },
      savedAt: 456,
    });
    expect(readManhuaLearnActiveJob()).toMatchObject({
      jobId: "job_episode_10",
      continuation: {
        seriesKey: "douyin_kimi_abc123",
        row: { mixId: "mix_90" },
      },
    });
  });

  it("also restores an uploaded GCS learning job", () => {
    installMemoryLocalStorage();
    writeManhuaLearnActiveJob({
      jobId: "job_upload",
      busyKey: "gs://bucket/uploads/u7/long.mp4",
      continuation: {
        row: {
          gcsUri: "gs://bucket/uploads/u7/long.mp4",
          fileName: "long.mp4",
          platform: "upload",
          learnLlm: "claude",
        },
        rank: 0,
        savedAt: 100,
      },
      savedAt: 101,
    });
    expect(readManhuaLearnActiveJob()).toMatchObject({
      jobId: "job_upload",
      continuation: {
        row: {
          gcsUri: "gs://bucket/uploads/u7/long.mp4",
          learnLlm: "claude",
        },
      },
    });
  });

  it("keeps parsed, learned and pending counts across refresh", () => {
    installMemoryLocalStorage();
    const result = manhuaLearnResultFromJobOutput({
      seriesKey: "douyin_kimi_abc123",
      batchLearned: 9,
      learnedCount: 9,
      listedEpisodeCount: 99,
      messageZh: "累计 9 集",
      digestsPreview: [],
      learnChannel: "cloud",
    });
    writeManhuaLearnResult(result);
    expect(readManhuaLearnResult()).toMatchObject({
      seriesKey: "douyin_kimi_abc123",
      learnedCount: 9,
      listedEpisodeCount: 99,
      pendingCount: 90,
    });
  });
});
