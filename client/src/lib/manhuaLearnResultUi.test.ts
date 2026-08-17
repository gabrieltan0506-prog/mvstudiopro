import { afterEach, describe, expect, it } from "vitest";
import {
  demoteStaleRunningManhuaLearnItems,
  getManhuaLearnContinueControl,
  isManhuaLearnEmptyBatchFailure,
  manhuaLearnResultFromJobOutput,
  manhuaLearnResultFromStart,
  mergeManhuaLearnLiveProgress,
  mergeManhuaLearnServerJobsIntoBasket,
  readManhuaLearnActiveJob,
  readManhuaLearnBasket,
  readManhuaLearnResult,
  removeManhuaLearnBasketItem,
  upsertManhuaLearnBasketItem,
  writeManhuaLearnActiveJob,
  writeManhuaLearnBasket,
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
  it("queued 且尚无 worker 输出时明确显示排队，不冒充学习进行中", () => {
    const ui = mergeManhuaLearnLiveProgress(
      manhuaLearnResultFromStart({
        channel: "cloud",
        url: "https://www.douyin.com/collection/queued",
        title: "排队剧",
      }),
      { status: "queued", output: {} },
    );
    expect(ui.liveStatus).toBe("queued");
    expect(ui.livePhase).toBe("queued");
    expect(ui.liveLabelZh).toContain("等待开始");
    expect(ui.liveLabelZh).not.toContain("学习进行中");
  });

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

  it("keeps multiple dramas separate and removes a completed drama", () => {
    installMemoryLocalStorage();
    const makeItem = (seriesKey: string, title: string, learned: number, pending: number) => ({
      seriesKey,
      continuation: {
        row: { url: `https://www.douyin.com/collection/${seriesKey}`, mixName: title },
        rank: 0,
        seriesKey,
        savedAt: 100,
      },
      result: {
        ...manhuaLearnResultFromStart({ channel: "cloud", seriesKey }),
        learnedCount: learned,
        pendingCount: pending,
      },
      updatedAt: learned,
    });
    let basket = upsertManhuaLearnBasketItem([], makeItem("series_a", "A剧", 9, 90));
    basket = upsertManhuaLearnBasketItem(basket, makeItem("series_b", "B剧", 2, 28));
    expect(basket.map((item) => item.seriesKey).sort()).toEqual(["series_a", "series_b"]);

    basket = upsertManhuaLearnBasketItem(basket, makeItem("series_a", "A剧", 99, 0));
    expect(basket.map((item) => item.seriesKey)).toEqual(["series_b"]);
    expect(removeManhuaLearnBasketItem(basket, "series_b")).toEqual([]);
  });

  it("migrates a temporary key to the real series key and persists per user", () => {
    installMemoryLocalStorage();
    const source = "https://www.douyin.com/collection/abc";
    const base = manhuaLearnResultFromStart({ channel: "cloud", seriesKey: "learn_tmp" });
    let basket = upsertManhuaLearnBasketItem([], {
      seriesKey: "learn_tmp",
      continuation: { row: { url: source, mixName: "测试剧" }, rank: 0, savedAt: 1 },
      result: { ...base, pendingCount: 90 },
      updatedAt: 1,
    });
    basket = upsertManhuaLearnBasketItem(basket, {
      seriesKey: "series_real",
      continuation: {
        row: { url: source, mixName: "测试剧" },
        rank: 0,
        seriesKey: "series_real",
        savedAt: 2,
      },
      result: { ...base, seriesKey: "series_real", learnedCount: 8, pendingCount: 82 },
      updatedAt: 2,
    });
    expect(basket).toHaveLength(1);
    expect(basket[0]?.seriesKey).toBe("series_real");
    writeManhuaLearnBasket("user_7", basket);
    expect(readManhuaLearnBasket("user_7")).toHaveLength(1);
    expect(readManhuaLearnBasket("user_8")).toEqual([]);
  });

  it("allows an unknown pending count to resume from a saved continuation", () => {
    expect(
      getManhuaLearnContinueControl({
        pendingCount: undefined,
        hasContinuation: true,
        busy: false,
        active: false,
      }),
    ).toMatchObject({
      disabled: false,
      labelZh: "继续学习 · 检查剩余集数",
    });
  });

  it("explains an active batch instead of presenting a dead pending button", () => {
    expect(
      getManhuaLearnContinueControl({
        pendingCount: 6,
        hasContinuation: true,
        busy: false,
        active: true,
      }),
    ).toEqual({
      disabled: true,
      labelZh: "当前批次学习中",
      titleZh: "当前任务结束后可继续下一批",
    });
  });

  it("keeps a known positive pending count clickable when idle", () => {
    expect(
      getManhuaLearnContinueControl({
        pendingCount: 82,
        hasContinuation: true,
        busy: false,
        active: false,
      }),
    ).toMatchObject({
      disabled: false,
      labelZh: "待学习 82 · 继续",
    });
  });

  it("restores two running dramas and one queued drama without overwriting each other", () => {
    const jobs = [
      { jobId: "a", status: "running" as const, input: { params: { url: "https://douyin.com/video/a", title: "A剧", seriesKey: "series_a" } }, output: { learnedCount: 1, listedEpisodeCount: 20 } },
      { jobId: "b", status: "running" as const, input: { params: { url: "https://douyin.com/video/b", title: "B剧", seriesKey: "series_b" } }, output: { learnedCount: 2, listedEpisodeCount: 30 } },
      { jobId: "c", status: "queued" as const, input: { params: { url: "https://douyin.com/video/c", title: "C剧", seriesKey: "series_c" } } },
    ];
    const basket = mergeManhuaLearnServerJobsIntoBasket([], jobs, 100);
    expect(basket).toHaveLength(3);
    expect(basket.map((item) => item.jobStatus).sort()).toEqual(["queued", "running", "running"]);
    expect(basket.find((item) => item.seriesKey === "series_b")?.result.learnedCount).toBe(2);
  });

  it("shows persisted episode frames while a job is still running", () => {
    const ui = mergeManhuaLearnLiveProgress(null, {
      status: "running",
      output: {
        learnedCount: 1,
        digestsPreview: [{
          episodeIndex: 1,
          title: "第一集",
          complete: true,
          learnedThroughSec: 180,
          durationSec: 180,
          hookNoteZh: "开场冲突",
          transcriptPreview: "家庭聚餐",
          previewFrameUrls: ["https://storage.googleapis.com/a.jpg", "https://storage.googleapis.com/b.jpg"],
        }],
      },
    });
    expect(ui.digestsPreview[0]).toMatchObject({
      episodeIndex: 1,
      complete: true,
      previewFrameUrls: ["https://storage.googleapis.com/a.jpg", "https://storage.googleapis.com/b.jpg"],
    });
  });
});

describe("demoteStaleRunningManhuaLearnItems（僵尸进行中降级）", () => {
  const runningItem = {
    seriesKey: "k1",
    continuation: {
      row: { url: "https://www.douyin.com/collection/1", mixName: "剧A", mixId: "1", platform: "douyin" },
      rank: 0,
      seriesKey: "k1",
      savedAt: 0,
    },
    result: {
      ...manhuaLearnResultFromStart({ channel: "cloud", url: "https://www.douyin.com/collection/1", title: "剧A", seriesKey: "k1" }),
      liveStatus: "running" as const,
    },
    updatedAt: 0,
    jobId: "job-gone",
    jobStatus: "running" as const,
  };

  it("jobId 不在服务端列表 → 掉到可继续态，不再显示进行中", () => {
    const [out] = demoteStaleRunningManhuaLearnItems([runningItem], []);
    expect(out.jobStatus).toBeUndefined();
    expect(out.result.liveStatus).toBeUndefined();
    expect(out.result.messageZh).toContain("继续");
  });

  it("jobId 仍在列表 → 原样保留", () => {
    const [out] = demoteStaleRunningManhuaLearnItems(
      [runningItem],
      [{ jobId: "job-gone", status: "running" }],
    );
    expect(out.jobStatus).toBe("running");
    expect(out.result.liveStatus).toBe("running");
  });

  it("无 jobId 的乐观占位（入队请求未返回）不动", () => {
    const optimistic = { ...runningItem, jobId: undefined };
    const [out] = demoteStaleRunningManhuaLearnItems([optimistic], []);
    expect(out.result.liveStatus).toBe("running");
  });
});
