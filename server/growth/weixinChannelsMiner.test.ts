import { describe, expect, it, vi } from "vitest";
import type { PlatformTrendCollection } from "./trendCollector";
import {
  buildWeixinChannelsCandidateQueue,
  buildWeixinChannelsSearchQueries,
  cleanWeixinChannelsObservationsLocally,
  invokeWeixinChannelsTerraDirect,
  persistableWeixinChannelsObservation,
  selectWeixinChannelsTerraInput,
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
  it("停止从快手和今日头条产生新任务，但保留其他平台", () => {
    const candidates = buildWeixinChannelsCandidateQueue({
      douyin: collection("douyin"), bilibili: collection("bilibili"), xiaohongshu: collection("xiaohongshu"),
      kuaishou: collection("kuaishou"), toutiao: collection("toutiao"),
    });
    expect(new Set(candidates.map((item) => item.sourcePlatform))).toEqual(new Set(["douyin", "bilibili", "xiaohongshu"]));
  });

  it("从真实热点标题生成垂类与高意图搜索词，不注入无关固定词", () => {
    expect(buildWeixinChannelsSearchQueries("原来可以批量生成 AI 真人短剧，这次卷成这样了")).toEqual([
      "原来可以批量生成 AI 真人短剧，这次卷成这样了", "AI真人短剧", "AI真人短剧教程", "AI真人短剧批量生成",
    ]);
    expect(buildWeixinChannelsSearchQueries("别再说AI漫剧难了")).toEqual([
      "别再说AI漫剧难了", "AI漫剧", "AI漫剧教程", "AI漫剧全流程", "AI漫剧变现",
    ]);
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
  });

  it("高互动但与搜索垂类无关时不进入聚合", () => {
    const item = persistableWeixinChannelsObservation(observation({
      query: "AI漫剧教程", title: "五句话拿下心爱的男孩",
      likes: 20_000, shares: 6_924, favorites: 11_000, comments: 401,
      ocrTexts: ["情感关系建议"],
    }));
    expect(item).toMatchObject({ scanned: true, qualified: false, invalid: false, qualificationReason: "内容与当前搜索垂类不相关，仅记录扫描结果" });
  });

  it("先本地精确与近似去重，再为 Terra 选择 1,000–2,000 条安全输入", () => {
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
    expect(selected.selected.length).toBeGreaterThanOrEqual(1_000);
    expect(selected.selected.length).toBeLessThanOrEqual(2_000);
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
