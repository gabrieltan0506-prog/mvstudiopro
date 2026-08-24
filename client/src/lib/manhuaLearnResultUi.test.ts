import { afterEach, describe, expect, it } from "vitest";
import {
  demoteStaleRunningManhuaLearnItems,
  getManhuaLearnContinueControl,
  isManhuaLearnEmptyBatchFailure,
  manhuaLearnResultFromJobOutput,
  manhuaLearnResultFromSnapshot,
  manhuaLearnResultFromStart,
  mergeManhuaLearnLiveProgress,
  mergeManhuaLearnServerJobsIntoBasket,
  nativeLearnTerminalProposalRefreshSignature,
  readManhuaLearnActiveJob,
  readManhuaLearnBasket,
  readManhuaLearnResult,
  readManhuaLearnMissingDismissedKeys,
  removeManhuaLearnBasketItem,
  resolveManhuaLearnBasketFocusKey,
  upsertManhuaLearnBasketItem,
  writeManhuaLearnActiveJob,
  writeManhuaLearnBasket,
  writeManhuaLearnResult,
  writeManhuaLearnMissingDismissedKeys,
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
  it("刷新后按原生待审卡恢复模式与数量，不显示旧系列分析话术", () => {
    const ui = manhuaLearnResultFromSnapshot({
      seriesKey: "native-series",
      progress: { listedEpisodeCount: 12, titleHint: "示例剧" },
      digestsPreview: [],
      completedCount: 6,
      pipelineMode: "native_deep_read",
      analysisReady: false,
      proposal: null,
    });
    expect(ui).toMatchObject({
      pipelineMode: "native_deep_read",
      learnedCount: 6,
      analysisReady: false,
      proposal: null,
    });
    expect(ui.messageZh).toContain("6 张原生精读待审卡");
    expect(ui.messageZh).not.toContain("分析门槛");
  });

  it("同账号 Fly 原生任务进入终态时生成稳定的待审刷新签名", () => {
    const jobs = [
      {
        jobId: "native-ok",
        status: "succeeded" as const,
        input: { params: { nativeDeepReadConfirmed: true } },
        updatedAt: "2026-08-25T01:00:00.000Z",
      },
      {
        jobId: "native-partial",
        status: "failed" as const,
        input: { params: { nativeDeepReadConfirmed: true } },
        updatedAt: "2026-08-25T01:01:00.000Z",
      },
      {
        jobId: "native-running",
        status: "running" as const,
        input: { params: { nativeDeepReadConfirmed: true } },
        updatedAt: "2026-08-25T01:02:00.000Z",
      },
      {
        jobId: "legacy-ok",
        status: "succeeded" as const,
        input: { params: {} },
        updatedAt: "2026-08-25T01:03:00.000Z",
      },
    ];
    const signature = nativeLearnTerminalProposalRefreshSignature(jobs);
    expect(signature).toContain("native-ok:succeeded");
    expect(signature).toContain("native-partial:failed");
    expect(signature).not.toContain("native-running");
    expect(signature).not.toContain("legacy-ok");
    expect(nativeLearnTerminalProposalRefreshSignature([...jobs].reverse())).toBe(signature);
  });

  it("保留原生精读模式与费用回执", () => {
    const ui = manhuaLearnResultFromJobOutput({
      seriesKey: "s1",
      pipelineMode: "native_deep_read",
      learnedCount: 2,
      batchLearned: 2,
      messageZh: "已生成待审卡",
      nativeUsage: {
        model: "qwen3.8-max",
        billingMode: "plan_quota",
        inputTokens: 1200,
        outputTokens: 300,
        priceEquivalentCny: 1.25,
        elapsedMs: 9000,
        receiptComplete: true,
      },
    });
    expect(ui.pipelineMode).toBe("native_deep_read");
    expect(ui.nativeUsage).toMatchObject({
      billingMode: "plan_quota",
      priceEquivalentCny: 1.25,
      receiptComplete: true,
    });
  });

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

  it("running native job keeps its mode and incomplete usage receipt visible", () => {
    const ui = mergeManhuaLearnLiveProgress(null, {
      status: "running",
      output: {
        pipelineMode: "native_deep_read",
        nativeUsage: {
          model: "qwen3.8-max",
          billingMode: "plan_quota",
          inputTokens: 88,
          outputTokens: 21,
          priceEquivalentCny: 0.18,
          elapsedMs: 3000,
          receiptComplete: false,
        },
      },
    });
    expect(ui.pipelineMode).toBe("native_deep_read");
    expect(ui.nativeUsage).toMatchObject({
      billingMode: "plan_quota",
      priceEquivalentCny: 0.18,
      receiptComplete: false,
    });
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

  it("付费缺集不算普通待学，并可持久删除缺集提示", () => {
    installMemoryLocalStorage();
    const result = manhuaLearnResultFromJobOutput({
      seriesKey: "paid_series",
      learnedCount: 13,
      listedEpisodeCount: 72,
      paywallStartEpisodeIndex: 14,
      paywallEpisodeIndexes: Array.from({ length: 59 }, (_, i) => i + 14),
      missingEpisodeCount: 59,
      digestsPreview: [],
      messageZh: "免费段已学完",
    });
    expect(result.pendingCount).toBe(0);
    expect(result.missingEpisodeCount).toBe(59);
    expect(result.paywallStartEpisodeIndex).toBe(14);
    writeManhuaLearnMissingDismissedKeys(["paid_series"]);
    expect(readManhuaLearnMissingDismissedKeys()).toEqual(["paid_series"]);
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

  it("后台轮询更新已有剧集时保持原位置，不按更新时间重排下拉选项", () => {
    const makeItem = (seriesKey: string, updatedAt: number) => ({
      seriesKey,
      continuation: {
        row: { url: `https://www.douyin.com/collection/${seriesKey}` },
        rank: 0,
        seriesKey,
        savedAt: 1,
      },
      result: {
        ...manhuaLearnResultFromStart({ channel: "cloud", seriesKey }),
        pendingCount: 10,
      },
      updatedAt,
    });
    const original = [makeItem("series_a", 10), makeItem("series_b", 20)];
    const updated = upsertManhuaLearnBasketItem(original, makeItem("series_b", 999));
    expect(updated.map((item) => item.seriesKey)).toEqual(["series_a", "series_b"]);
  });

  it("持久化往返保持界面顺序，不按 updatedAt 再排序", () => {
    installMemoryLocalStorage();
    const makeItem = (seriesKey: string, updatedAt: number) => ({
      seriesKey,
      continuation: {
        row: { url: `https://www.douyin.com/collection/${seriesKey}` },
        rank: 0,
        seriesKey,
        savedAt: 1,
      },
      result: {
        ...manhuaLearnResultFromStart({ channel: "cloud", seriesKey }),
        pendingCount: 1,
      },
      updatedAt,
    });
    writeManhuaLearnBasket("stable_user", [
      makeItem("series_old", 1),
      makeItem("series_new", 999),
    ]);
    expect(readManhuaLearnBasket("stable_user").map((item) => item.seriesKey))
      .toEqual(["series_old", "series_new"]);
  });

  it("临时 key 升级后按同一来源续接焦点，不闪回空选项", () => {
    const source = "https://www.douyin.com/collection/focus";
    const result = manhuaLearnResultFromStart({ channel: "cloud", seriesKey: "series_real" });
    const items = [{
      seriesKey: "series_real",
      continuation: { row: { url: source }, rank: 0, seriesKey: "series_real", savedAt: 1 },
      result: { ...result, pendingCount: 8 },
      updatedAt: 2,
    }];
    expect(resolveManhuaLearnBasketFocusKey(items, "learn_tmp", source)).toBe("series_real");
    expect(resolveManhuaLearnBasketFocusKey(items, "series_real", source)).toBe("series_real");
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

  it("相同服务端快照重复轮询时复用原数组，不强制重绘下拉选项", () => {
    const jobs = [{
      jobId: "stable",
      status: "running" as const,
      input: {
        params: {
          url: "https://douyin.com/video/stable",
          title: "稳定剧集",
          seriesKey: "series_stable",
        },
      },
      output: { learnedCount: 1, listedEpisodeCount: 10 },
      updatedAt: "2026-08-25T00:00:00.000Z",
    }];
    const first = mergeManhuaLearnServerJobsIntoBasket([], jobs, 100);
    const second = mergeManhuaLearnServerJobsIntoBasket(first, jobs, 999);
    expect(second).toBe(first);
    expect(second[0]?.continuation.savedAt).toBe(100);
  });

  it("failed native job keeps server progress and usage instead of collapsing to an error string", () => {
    const [item] = mergeManhuaLearnServerJobsIntoBasket([], [{
      jobId: "native-failed",
      status: "failed" as const,
      input: {
        params: {
          url: "https://douyin.com/video/native",
          title: "原生剧",
          seriesKey: "series_native",
        },
      },
      output: {
        seriesKey: "series_native",
        pipelineMode: "native_deep_read",
        learnedCount: 1,
        learnProgressLog: [{
          atIso: "2026-08-25T00:00:00.000Z",
          stage: "persist",
          detailZh: "第 1 集已入库 · 累计 1 集",
        }],
        nativeUsage: {
          model: "qwen3.8-max",
          billingMode: "plan_quota",
          inputTokens: 500,
          outputTokens: 100,
          priceEquivalentCny: 0.9,
          elapsedMs: 12000,
          receiptComplete: false,
        },
      },
      error: "第二集处理中止",
    }]);
    expect(item.result).toMatchObject({
      liveStatus: "failed",
      learnedCount: 1,
      pipelineMode: "native_deep_read",
      nativeUsage: { priceEquivalentCny: 0.9, receiptComplete: false },
    });
    expect(item.result.progressLines?.at(-1)?.detailZh).toContain("第二集处理中止");
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
