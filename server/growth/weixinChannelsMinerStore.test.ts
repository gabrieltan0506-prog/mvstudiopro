import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./trendStore", () => ({
  mergeTrendCollections: vi.fn().mockResolvedValue(undefined),
  readTrendStore: vi.fn().mockResolvedValue({ collections: {} }),
}));

import {
  createWeixinChannelsProbeJob,
  getWeixinChannelsMinerState,
  ingestWeixinChannelsObservations,
  processWeixinChannelsAggregationJob,
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

async function seed(observations: ReturnType<typeof persisted>[]) {
  await fs.writeFile(storeFile, JSON.stringify({
    version: 2, updatedAt: "2026-08-14T00:00:00.000Z",
    capture: { enabled: true, updatedAt: "2026-08-14T00:00:00.000Z" }, aggregationPaused: false,
    candidates: [candidate()], observations, lunaBatches: [], jobs: [],
  }));
}

beforeEach(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wxc-store-"));
  storeFile = path.join(dir, "state.json");
  process.env.WEIXIN_CHANNELS_MINER_STORE_FILE = storeFile;
});

afterEach(() => {
  delete process.env.WEIXIN_CHANNELS_MINER_STORE_FILE;
});

describe("weixinChannelsMinerStore", () => {
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
    expect(state.lunaBatches).toHaveLength(0);
  }, 20_000);

  it("5 条 probe 照常持久化，只调用一次 Terra，且不计入正式额度", async () => {
    await seed(Array.from({ length: 5 }, (_, index) => persisted(index, "probe")));
    const { job } = await createWeixinChannelsProbeJob();
    const result = Object.fromEntries(["duplicates", "categories", "keywords", "commentTopics", "trends", "blueOceanKeywords", "topicIdeas", "weeklySummary"].map((key) => [key, [key]]));
    const invoke = vi.fn().mockResolvedValueOnce({ id: "terra", created: 1, model: "gpt-5.6-terra", provider: "evolink", choices: [{ message: { content: JSON.stringify(result) } }] });
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
});
