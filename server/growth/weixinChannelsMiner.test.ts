import { describe, expect, it, vi } from "vitest";
import type { PlatformTrendCollection } from "./trendCollector";
import { makeWeixinChannelsObservationId } from "../../shared/weixinChannelsRules";
import {
  buildWeixinChannelsCandidateQueue,
  buildWeixinChannelsSearchQueries,
  cleanWeixinChannelsObservationsLocally,
  invokeWeixinChannelsDeepSeekBatch,
  invokeWeixinChannelsTerraCleanup,
  invokeWeixinChannelsTerraDirect,
  persistableWeixinChannelsObservation,
  selectWeixinChannelsTerraInput,
  WEIXIN_CHANNELS_SEARCH_WINDOW_DAYS,
  WEIXIN_CHANNELS_TERRA_MAX_COMPLETION_TOKENS,
  type FinalAnalysisJob,
  type WeixinChannelsObservation,
} from "./weixinChannelsMiner";

function collection(platform: PlatformTrendCollection["platform"]): PlatformTrendCollection {
  const now = new Date().toISOString();
  return {
    platform, source: "live", collectedAt: now, windowDays: 18,
    items: [{ id: `${platform}-1`, title: `${platform} AI 爆款`, author: "作者", publishedAt: now, likes: 8_000, comments: 700, shares: 1_500, views: 100_000, contentType: "video" }],
    notes: [],
    stats: { platform, itemCount: 1, uniqueAuthorCount: 1, bucketCounts: {}, requestCount: 1, pageDepth: 1, targetPerRun: 1, referenceMinItems: 1, referenceMaxItems: 10, collectorMode: "public_feed", industryCounts: {}, ageCounts: {}, contentCounts: {} },
  };
}

function observation(overrides: Partial<WeixinChannelsObservation> = {}): WeixinChannelsObservation {
  return {
    observationId: overrides.observationId || "observation-1",
    taskId: "task-123",
    query: "真实视频",
    resultRank: 1,
    title: "真实视频",
    author: "作者",
    observedAt: "2026-08-14T00:00:00.000Z",
    evidence: "capture",
    ...overrides,
  };
}

describe("weixinChannelsMiner", () => {
  it("内容身份存在时 observationId 不随互动指标变化，无内容身份时才回退到视频身份", () => {
    const stableA = makeWeixinChannelsObservationId({
      taskId: "task-123",
      title: "AI 视频教程",
      author: "作者",
      videoIdentity: "a".repeat(64),
    });
    const stableB = makeWeixinChannelsObservationId({
      taskId: "task-123",
      title: "AI 视频教程",
      author: "作者",
      videoIdentity: "b".repeat(64),
    });
    expect(stableA).toBe(stableB);
    expect(makeWeixinChannelsObservationId({ taskId: "task-123", title: "", videoIdentity: "a".repeat(64) }))
      .not.toBe(makeWeixinChannelsObservationId({ taskId: "task-123", title: "", videoIdentity: "b".repeat(64) }));
  });

  it("停止从快手和今日头条产生新任务，但保留其他平台", () => {
    const candidates = buildWeixinChannelsCandidateQueue({
      douyin: collection("douyin"), bilibili: collection("bilibili"), xiaohongshu: collection("xiaohongshu"),
      kuaishou: collection("kuaishou"), toutiao: collection("toutiao"),
    });
    expect(new Set(candidates.map((item) => item.sourcePlatform))).toEqual(new Set(["douyin", "bilibili", "xiaohongshu"]));
  });

  it("视频号搜索候选严格只使用最近七天热点", () => {
    const source = collection("douyin");
    source.items.push({
      ...source.items[0]!,
      id: "douyin-old",
      title: "八天前的旧热词",
      publishedAt: new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString(),
    });
    const candidates = buildWeixinChannelsCandidateQueue({ douyin: source });
    expect(WEIXIN_CHANNELS_SEARCH_WINDOW_DAYS).toBe(7);
    expect(candidates.some((item) => item.sourceItemId === "douyin-old")).toBe(false);
  });

  it("从真实热点标题生成垂类与高意图搜索词，不注入无关固定词", () => {
    expect(buildWeixinChannelsSearchQueries("原来可以批量生成 AI 真人短剧，这次卷成这样了")).toEqual([]);
    expect(buildWeixinChannelsSearchQueries("别再说AI漫剧难了")).toEqual(["AI漫剧"]);
    expect(buildWeixinChannelsSearchQueries("2026年8月全价位好物选购指南20款益生菌全价位实测")).toEqual([]);
    expect(buildWeixinChannelsSearchQueries("#AI工作流 新手实测")).toEqual(["AI工作流", "新手实测"]);
  });

  it("低质样本只落扫描记录且模型调用条件为零", () => {
    const item = persistableWeixinChannelsObservation(observation({ likes: 103, shares: 80, favorites: 42, comments: 14 }));
    expect(item).toMatchObject({ scanned: true, qualified: false, invalid: false });
  });

  it("高质样本达标且评论数达到 80 时保留真实评论", () => {
    const item = persistableWeixinChannelsObservation(observation({
      likes: 8_998, shares: 12_000, favorites: 3_981, comments: 361,
      commentSamples: [{ text: "为什么这个做法有效？", signals: ["question"] }],
    }));
    expect(item).toMatchObject({ scanned: true, qualified: true, invalid: false });
    expect(item.commentSamples).toHaveLength(1);
  });

  it("OCR 含广告时强制无效，不进入正式聚合", () => {
    const item = persistableWeixinChannelsObservation(observation({
      likes: 99_999, shares: 20_000, favorites: 20_000, comments: 500,
      ocrTexts: ["本内容包含 广告 推广"],
    }));
    expect(item).toMatchObject({ scanned: true, qualified: false, invalid: true });
    const traditional = persistableWeixinChannelsObservation(observation({
      likes: 99_999, shares: 20_000, favorites: 20_000, comments: 500,
      ocrTexts: ["本內容包含 廣告 推廣"],
    }));
    expect(traditional).toMatchObject({ scanned: true, qualified: false, invalid: true });
  });

  it("高互动但与搜索垂类无关时不进入聚合", () => {
    const item = persistableWeixinChannelsObservation(observation({
      query: "AI漫剧教程", title: "五句话拿下心爱的男孩",
      likes: 20_000, shares: 6_924, favorites: 11_000, comments: 401,
      ocrTexts: ["情感关系建议"],
    }));
    expect(item).toMatchObject({ scanned: true, qualified: false, invalid: false, qualificationReason: "内容与当前搜索垂类不相关，仅记录扫描结果" });
  });

  it("先本地精确与近似去重，再将单个 DeepSeek 批次严格限制为 1,000 条", () => {
    const rows = Array.from({ length: 2_000 }, (_, index) => persistableWeixinChannelsObservation(observation({
      observationId: `o-${index}`,
      title: `视频 ${index}`,
      author: `作者 ${index}`,
      likes: 3_000,
      shares: 2_000,
      comments: 10,
    })));
    const cleaned = cleanWeixinChannelsObservationsLocally(rows);
    const selected = selectWeixinChannelsTerraInput(cleaned.kept);
    expect(selected.selected).toHaveLength(1_000);
  });

  it("千条批次固定使用 DeepSeek 0813 High、JSON、100K 与价格帽", async () => {
    const result = Object.fromEntries(["duplicates", "categories", "keywords", "commentTopics", "trends", "blueOceanKeywords", "topicIdeas", "weeklySummary"].map((key) => [key, [key]]));
    const invoke = vi.fn().mockResolvedValueOnce({ provider: "DeepSeek", usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.01, completion_tokens_details: { reasoning_tokens: 5 } }, choices: [{ message: { content: JSON.stringify(result) } }] });
    const persisted = persistableWeixinChannelsObservation(observation({ likes: 3_000, shares: 2_000, comments: 10 }));
    const job: FinalAnalysisJob = { jobId: "ds-1", kind: "formal", stage: "deepseek_batch", threshold: 1_000, rawCount: 1_000, locallyDedupedCount: 1_000, observationIds: [persisted.observationId], analysisObservationIds: [persisted.observationId], lunaBatchIds: [], status: "processing", terraModel: "deepseek/deepseek-v4-pro-0813", reasoningEffort: "high", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" };
    const output = await invokeWeixinChannelsDeepSeekBatch({ job, observations: [persisted], invoke: invoke as never });
    expect(invoke.mock.calls[0][0]).toMatchObject({
      modelName: "deepseek/deepseek-v4-pro-0813", reasoningEffort: "high", requestId: "ds-1",
      max_tokens: WEIXIN_CHANNELS_TERRA_MAX_COMPLETION_TOKENS, temperature: 1,
      response_format: { type: "json_object" },
      openRouterProviderPreferences: { require_parameters: true, data_collection: "allow", max_price: { prompt: 0.5, completion: 1 } },
    });
    expect(output).toMatchObject({ provider: "openrouter", usage: { reasoningTokens: 5, costUsd: 0.01 } });
  });

  it("Terra High 只读取八个 DeepSeek 结果并输出清洗报告", async () => {
    const base = Object.fromEntries(["duplicates", "categories", "keywords", "commentTopics", "trends", "blueOceanKeywords", "topicIdeas", "weeklySummary"].map((key) => [key, [key]]));
    const result = { ...base, cleaningReport: { removedNoise: ["UI"], downgradedClaims: [], preservedEvidence: ["obs-1"] } };
    const invoke = vi.fn().mockResolvedValueOnce({ provider: "evolink", choices: [{ message: { content: JSON.stringify(result) } }] });
    const job: FinalAnalysisJob = { jobId: "clean-1", kind: "formal", stage: "terra_cleanup", threshold: 8_000, rawCount: 8_000, locallyDedupedCount: 7_900, observationIds: [], sourceJobIds: Array.from({ length: 8 }, (_, i) => `ds-${i}`), lunaBatchIds: [], status: "processing", terraModel: "gpt-5.6-terra", reasoningEffort: "high", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" };
    await invokeWeixinChannelsTerraCleanup({ job, batchResults: job.sourceJobIds!.map((jobId) => ({ jobId, rawCount: 1_000, result: base })), invoke: invoke as never });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toMatchObject({ modelName: "gpt-5.6-terra", reasoningEffort: "high", openAiGateway: "evolink_primary", requestId: "clean-1", max_tokens: WEIXIN_CHANNELS_TERRA_MAX_COMPLETION_TOKENS });
    const body = JSON.parse(String(invoke.mock.calls[0][0].messages[1].content));
    expect(body.batchResults).toHaveLength(8);
    expect(body.observations).toBeUndefined();
  });

  it("一次 Terra high 直接产出八项结果，使用同一任务 ID 和 100K 输出上限", async () => {
    const result = Object.fromEntries(["duplicates", "categories", "keywords", "commentTopics", "trends", "blueOceanKeywords", "topicIdeas", "weeklySummary"].map((key) => [key, [key]]));
    const invoke = vi.fn().mockResolvedValueOnce({ provider: "evolink", choices: [{ message: { content: JSON.stringify(result) } }] });
    const persisted = persistableWeixinChannelsObservation(observation({ likes: 3_000, shares: 2_000, comments: 10 }));
    const job: FinalAnalysisJob = { jobId: "job-1", kind: "probe", threshold: 5, rawCount: 5, locallyDedupedCount: 5, observationIds: [persisted.observationId], analysisObservationIds: [persisted.observationId], lunaBatchIds: [], status: "processing", terraModel: "gpt-5.6-terra", reasoningEffort: "high", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" };
    await invokeWeixinChannelsTerraDirect({ job, observations: [persisted], invoke: invoke as never });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toMatchObject({ modelName: "gpt-5.6-terra", reasoningEffort: "high", openAiGateway: "evolink_primary", requestId: "job-1", max_tokens: WEIXIN_CHANNELS_TERRA_MAX_COMPLETION_TOKENS });
  });
});
