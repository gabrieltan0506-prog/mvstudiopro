import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./trendStore", () => ({
  mergeTrendCollections: vi.fn().mockResolvedValue({
    mergeStats: { weixin_channels: { addedCount: 1, mergedCount: 1 } },
  }),
  readTrendSchedulerState: vi.fn().mockResolvedValue({}),
  readTrendStore: vi.fn().mockResolvedValue({ collections: {} }),
  updateTrendSchedulerState: vi.fn().mockResolvedValue({}),
}));

import { mergeTrendCollections, updateTrendSchedulerState } from "./trendStore";

import {
  createWeixinChannelsProbeJob,
  awaitWeixinChannelsGrowthMergeIdle,
  getWeixinChannelsMinerState,
  ingestWeixinChannelsObservations,
  pauseWeixinChannelsCaptureForSafetyFuse,
  processWeixinChannelsAggregationJob,
  recordWeixinChannelsHeartbeat,
  refreshWeixinChannelsCandidates,
  setWeixinChannelsCaptureEnabled,
} from "./weixinChannelsMinerStore";

let storeFile = "";

function candidate() {
  return {
    taskId: "task-123", sourcePlatform: "douyin", sourceItemId: "source-1", sourceTitle: "AI 视频",
    category: "AI", sourceGrowthScore: 100, sourceGrowthPercentile: 99, sourceMetrics: {}, searchQueries: ["AI视频"],
    createdAt: "2026-08-14T00:00:00.000Z", status: "pending", updatedAt: "2026-08-14T00:00:00.000Z",
  };
}

function persisted(index: number, runKind: "formal" | "probe" = "formal") {
  return {
    observationId: `obs-${index}`, taskId: "task-123", query: "AI视频", resultRank: index + 1,
    title: `AI视频 ${index}`, author: `作者 ${index}`, observedAt: "2026-08-14T00:00:00.000Z",
    likes: 3_000, shares: 2_000, comments: 10, evidence: "capture" as const, runKind,
    scanned: true as const, qualified: true, invalid: false, qualificationReason: "多个互动指标同时达到高热门槛",
  };
}

function classifiedBatchResult() {
  const item = {
    label: "AI工具使用方法",
    category: "AI与科技",
    evidence: "obs-0互动达到门槛",
    observationIds: ["obs-0"],
  };
  return {
    duplicates: [], categories: [item], keywords: [item], commentTopics: [],
    trends: [item], blueOceanKeywords: [], topicIdeas: [item], weeklySummary: [item],
  };
}

async function seed(observations: ReturnType<typeof persisted>[], jobs: unknown[] = []) {
  await fs.writeFile(storeFile, JSON.stringify({
    version: 2, updatedAt: "2026-08-14T00:00:00.000Z",
    capture: { enabled: true, updatedAt: "2026-08-14T00:00:00.000Z" }, aggregationPaused: false,
    candidates: [candidate()], observations, lunaBatches: [], jobs,
  }));
}

beforeEach(async () => {
  await awaitWeixinChannelsGrowthMergeIdle();
  vi.mocked(mergeTrendCollections).mockReset().mockResolvedValue({
    mergeStats: { weixin_channels: { addedCount: 1, mergedCount: 1 } },
  } as never);
  vi.mocked(updateTrendSchedulerState).mockClear();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wxc-store-"));
  storeFile = path.join(dir, "state.json");
  process.env.WEIXIN_CHANNELS_MINER_STORE_FILE = storeFile;
});

afterEach(async () => {
  await awaitWeixinChannelsGrowthMergeIdle();
  delete process.env.WEIXIN_CHANNELS_MINER_STORE_FILE;
});

describe("weixinChannelsMinerStore", () => {
  it("原始 observation 先响应，慢趋势合并在后台完成且可恢复标记", async () => {
    await seed([]);
    let releaseMerge!: () => void;
    vi.mocked(mergeTrendCollections).mockImplementationOnce(() => new Promise((resolve) => {
      releaseMerge = () => resolve({
        mergeStats: { weixin_channels: { addedCount: 1, mergedCount: 1 } },
      } as never);
    }));
    const result = await ingestWeixinChannelsObservations({
      taskId: "task-123",
      observations: [persisted(100)],
    });
    expect(result).toMatchObject({
      persisted: true,
      newlyPersisted: true,
      growthMerged: false,
    });
    expect((await getWeixinChannelsMinerState()).observations[0]).toMatchObject({
      observationId: "obs-100",
    });
    expect((await getWeixinChannelsMinerState()).observations[0]?.growthMergedAt).toBeUndefined();
    releaseMerge();
    await awaitWeixinChannelsGrowthMergeIdle();
    expect((await getWeixinChannelsMinerState()).observations[0]?.growthMergedAt).toBeTruthy();
    expect(updateTrendSchedulerState).toHaveBeenCalledWith("weixin_channels", expect.objectContaining({
      lastAddedCount: 1,
      lastNewDataAt: expect.any(String),
      lastFrequencyLabel: "本机双窗持续采集",
    }));
  });

  it("重复 observationId 只首次计入真实新增，并保留首次持久化时间", async () => {
    await seed([]);
    const first = await ingestWeixinChannelsObservations({ taskId: "task-123", observations: [persisted(1)] });
    const firstPersistedAt = (await getWeixinChannelsMinerState()).observations[0]?.persistedAt;
    const duplicate = await ingestWeixinChannelsObservations({
      taskId: "task-123",
      observations: [{ ...persisted(1), observedAt: "2026-08-14T01:00:00.000Z", likes: 9_999 }],
    });
    const state = await getWeixinChannelsMinerState();
    expect(first).toMatchObject({ persisted: true, newlyPersisted: true, newlyQualifiedPersisted: true });
    expect(duplicate).toMatchObject({ persisted: true, newlyPersisted: false, newlyQualifiedPersisted: false });
    expect(state.observations).toHaveLength(1);
    expect(state.observations[0]).toMatchObject({ observedAt: "2026-08-14T00:00:00.000Z", persistedAt: firstPersistedAt, likes: 9_999 });
    expect(state.recentDuplicatePersistEvents).toHaveLength(1);
  });

  it("同一本机连续心跳续租原任务，不会误占多个七天热词候选", async () => {
    await seed([]);
    const first = await recordWeixinChannelsHeartbeat("mac-client-1");
    const second = await recordWeixinChannelsHeartbeat("mac-client-1");
    expect(first.nextTask?.taskId).toBe("task-123");
    expect(second.nextTask?.taskId).toBe("task-123");
    expect(first.controlRevision).toBe(0);
    expect(second.controlRevision).toBe(0);
    expect(first.formalQualifiedTotal).toBe(0);
    expect((await getWeixinChannelsMinerState()).candidates.filter((item) => item.status === "claimed")).toHaveLength(1);
  });

  it("心跳正式有效总数排除 probe，供悬浮面板显示真实资产数", async () => {
    await seed([persisted(1), persisted(2, "probe")]);
    const heartbeat = await recordWeixinChannelsHeartbeat("mac-client-1");
    expect(heartbeat.formalQualifiedTotal).toBe(1);
  });

  it("每次网页开关都递增控制版本，关后立刻再开也不会被本机心跳漏掉", async () => {
    await seed([]);
    const before = await recordWeixinChannelsHeartbeat("mac-client-1");
    const disabled = await setWeixinChannelsCaptureEnabled(false);
    const enabled = await setWeixinChannelsCaptureEnabled(true);
    const after = await recordWeixinChannelsHeartbeat("mac-client-1");

    expect(disabled.capture.controlRevision).toBe(before.controlRevision + 1);
    expect(enabled.capture.controlRevision).toBe(before.controlRevision + 2);
    expect(after).toMatchObject({
      enabled: true,
      controlRevision: before.controlRevision + 2,
    });
  });

  it("只有安全熔断会把网页采集开关暂停并留下原因", async () => {
    await seed([]);
    const state = await pauseWeixinChannelsCaptureForSafetyFuse("persistent_black_screen");
    expect(state.capture).toMatchObject({
      enabled: false,
      pausedBy: "collector_safety_fuse",
      pauseReason: "persistent_black_screen",
    });
  });

  it("安全熔断后改为人工暂停会清除旧原因，重新开启会清空全部暂停元数据", async () => {
    await seed([]);
    await pauseWeixinChannelsCaptureForSafetyFuse("persistent_same_content");

    const userPaused = await setWeixinChannelsCaptureEnabled(false);
    expect(userPaused.capture).toMatchObject({ enabled: false, pausedBy: "user" });
    expect(userPaused.capture.pauseReason).toBeUndefined();

    const enabled = await setWeixinChannelsCaptureEnabled(true);
    expect(enabled.capture).toMatchObject({ enabled: true });
    expect(enabled.capture.pausedAt).toBeUndefined();
    expect(enabled.capture.pausedBy).toBeUndefined();
    expect(enabled.capture.pauseReason).toBeUndefined();
  });

  it("刷新七天候选后丢弃无历史数据的过期待办，避免继续领取旧热词", async () => {
    await seed([]);
    await refreshWeixinChannelsCandidates();
    expect((await getWeixinChannelsMinerState()).candidates).toHaveLength(0);
  });

  it("999 条不建任务，第 1000 条并发 ingest 也只建一个正式任务且单条模型调用为零", async () => {
    await seed(Array.from({ length: 999 }, (_, index) => persisted(index)));
    const final = { ...persisted(999), resultRank: 1_000 };
    const [left, right] = await Promise.all([
      ingestWeixinChannelsObservations({ taskId: "task-123", observations: [final] }),
      ingestWeixinChannelsObservations({ taskId: "task-123", observations: [final] }),
    ]);
    expect(left.modelCalls).toBe(0);
    expect(right.modelCalls).toBe(0);
    const state = await getWeixinChannelsMinerState();
    expect(state.jobs.filter((job) => job.kind === "formal")).toHaveLength(1);
    expect(state.jobs.find((job) => job.kind === "formal")?.analysisObservationIds).toHaveLength(1_000);
    expect(state.jobs[0]).toMatchObject({ stage: "deepseek_batch", terraModel: "deepseek/deepseek-v4-pro-0813", threshold: 1_000 });
    expect(state.lunaBatches).toHaveLength(0);
  }, 20_000);

  it("语义重复不计入千条门槛，必须本地去重后严格满一千条才建 DeepSeek 任务", async () => {
    const unique = Array.from({ length: 999 }, (_, index) => persisted(index));
    const duplicate = {
      ...persisted(10_000),
      observationId: "obs-duplicate",
      title: unique[0]!.title,
      author: unique[0]!.author,
    };
    await seed([...unique, duplicate]);
    const before = await ingestWeixinChannelsObservations({
      taskId: "task-123",
      observations: [duplicate],
    });
    expect(before.accumulatedQualifiedCount).toBe(999);
    expect((await getWeixinChannelsMinerState()).jobs).toHaveLength(0);

    await ingestWeixinChannelsObservations({
      taskId: "task-123",
      observations: [persisted(999)],
    });
    const state = await getWeixinChannelsMinerState();
    expect(state.jobs).toHaveLength(1);
    expect(state.jobs[0]).toMatchObject({
      threshold: 1_000,
      locallyDedupedCount: 1_000,
      reasoningEffort: "medium",
    });
    expect(state.jobs[0]!.analysisObservationIds).toHaveLength(1_000);
    expect(state.jobs[0]!.observationIds).toContain("obs-duplicate");
  }, 20_000);

  it("5 条 probe 照常持久化，只调用一次 DeepSeek，且不计入正式额度", async () => {
    await seed(Array.from({ length: 5 }, (_, index) => persisted(index, "probe")));
    const { job } = await createWeixinChannelsProbeJob();
    const result = classifiedBatchResult();
    const invoke = vi.fn().mockResolvedValueOnce({ id: "deepseek", created: 1, model: "deepseek/deepseek-v4-pro-0813", provider: "DeepSeek", choices: [{ message: { content: JSON.stringify(result) } }] });
    const completed = await processWeixinChannelsAggregationJob(job.jobId, { invoke: invoke as never });
    expect(completed.status).toBe("completed");
    expect(invoke).toHaveBeenCalledTimes(1);
    const state = await getWeixinChannelsMinerState();
    expect(state.observations).toHaveLength(5);
    expect(state.observations.every((item) => item.runKind === "probe" && !item.consumedAt)).toBe(true);
    expect(state.jobs.filter((item) => item.kind === "formal")).toHaveLength(0);
    const repeated = await createWeixinChannelsProbeJob();
    expect(repeated.job.jobId).toBe(job.jobId);
    expect((await getWeixinChannelsMinerState()).jobs.filter((item) => item.kind === "probe")).toHaveLength(1);
  });

  it("DeepSeek 两次返回非法结构后丢弃该批并保留已付调用用量", async () => {
    await seed(Array.from({ length: 5 }, (_, index) => persisted(index, "probe")));
    const { job } = await createWeixinChannelsProbeJob();
    const invalid = { categories: [{ category: "自造类目" }] };
    const invoke = vi.fn()
      .mockResolvedValueOnce({ provider: "DeepSeek", usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.01 }, choices: [{ message: { content: JSON.stringify(invalid) }, finish_reason: "stop" }] })
      .mockResolvedValueOnce({ provider: "DeepSeek", usage: { prompt_tokens: 11, completion_tokens: 21, cost: 0.02 }, choices: [{ message: { content: JSON.stringify(invalid) }, finish_reason: "stop" }] });
    await expect(processWeixinChannelsAggregationJob(job.jobId, { invoke: invoke as never }))
      .rejects.toThrow("weixin_channels_deepseek_validation_failed");
    const state = await getWeixinChannelsMinerState();
    expect(state.jobs[0]).toMatchObject({
      status: "discarded",
      usage: { inputTokens: 21, outputTokens: 41, costUsd: 0.03 },
    });
    await expect(processWeixinChannelsAggregationJob(job.jobId, { invoke: invoke as never }))
      .rejects.toThrow("weixin_channels_aggregation_job_discarded");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("累计八个千条 DeepSeek 结果后只创建一个 Terra 清洗任务，且不重新发送原始记录", async () => {
    const eightFields = classifiedBatchResult();
    const oldJobs = Array.from({ length: 7 }, (_, index) => ({
      jobId: `ds-old-${index}`, kind: "formal", stage: "deepseek_batch", threshold: 1_000,
      rawCount: 1_000, locallyDedupedCount: 1_000, observationIds: [], analysisObservationIds: [], lunaBatchIds: [],
      status: "completed", terraProvider: "openrouter", terraModel: "deepseek/deepseek-v4-pro-0813", reasoningEffort: "high",
      finalResult: eightFields, createdAt: `2026-08-0${index + 1}T00:00:00.000Z`, updatedAt: `2026-08-0${index + 1}T00:00:00.000Z`, completedAt: `2026-08-0${index + 1}T00:00:00.000Z`,
    }));
    const observations = Array.from({ length: 1_000 }, (_, index) => persisted(index));
    await seed(observations, oldJobs);
    await ingestWeixinChannelsObservations({ taskId: "task-123", observations: [{ ...persisted(0), resultRank: 1 }] });
    let state = await getWeixinChannelsMinerState();
    expect(state.jobs.filter((job) => job.stage === "terra_cleanup")).toHaveLength(0);
    const eighth = state.jobs.find((job) => job.stage === "deepseek_batch" && job.status === "pending")!;
    const cleanResult = { ...eightFields, cleaningReport: { removedNoise: ["UI"], downgradedClaims: [], preservedEvidence: ["obs"] } };
    const invoke = vi.fn()
      .mockResolvedValueOnce({ id: "ds-8", model: "deepseek/deepseek-v4-pro-0813", provider: "DeepSeek", choices: [{ message: { content: JSON.stringify(eightFields) } }] })
      .mockResolvedValueOnce({ id: "terra-clean", model: "gpt-5.6-terra", provider: "evolink", choices: [{ message: { content: JSON.stringify(cleanResult) } }] });
    await processWeixinChannelsAggregationJob(eighth.jobId, { invoke: invoke as never });
    state = await getWeixinChannelsMinerState();
    const cleanupJobs = state.jobs.filter((job) => job.stage === "terra_cleanup");
    expect(cleanupJobs).toHaveLength(1);
    expect(cleanupJobs[0]).toMatchObject({ threshold: 8_000, rawCount: 8_000, terraModel: "gpt-5.6-terra" });
    expect(cleanupJobs[0]?.sourceJobIds).toHaveLength(8);
    expect(cleanupJobs[0]?.observationIds).toHaveLength(0);
    await processWeixinChannelsAggregationJob(cleanupJobs[0]!.jobId, { invoke: invoke as never });
    state = await getWeixinChannelsMinerState();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(state.jobs.filter((job) => job.stage === "terra_cleanup")).toHaveLength(1);
    expect(state.jobs.filter((job) => job.stage === "deepseek_batch").every((job) => job.cleanedByJobId === cleanupJobs[0]!.jobId)).toBe(true);
  }, 20_000);
});
