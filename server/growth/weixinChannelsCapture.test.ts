import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  extractCommentSamples,
  captureBudgetMsForVideo,
  buildDiverseCollectorSearchQueries,
  deriveVideoDurationSeconds,
  extractVisibleTitleAndAuthor,
  extractWeixinChannelsMetrics,
  findCommentsClosePoint,
  findCommentsOpenPoint,
  findFirstSearchVideoPoint,
  findSearchInputPoint,
  hasFourVisibleMetrics,
  metricsRemainOnSameVideo,
  parseVisibleMetric,
  parseVisibleVideoClockSeconds,
  restoreEligibleQuarantinedObservations,
  retryPendingObservations,
  selectReusableCollectorCandidate,
  shouldSwitchRecommendationToSearch,
  shouldRotateSearchQuery,
  uploadPendingObservation,
  WEIXIN_CHANNELS_CONTENT_SAMPLE_POINTS,
  WEIXIN_CHANNELS_RECOMMENDATION_WINDOW_MS,
  WEIXIN_CHANNELS_SEARCH_BUTTON_POINT,
  waitForVisibleVideoLoad,
} from "../../scripts/weixin-channels-capture.mts";

describe("weixin channels OCR", () => {
  it("推荐页十分钟内不足五条达标时才切换到搜索", () => {
    const startedAt = 1_000;
    expect(shouldSwitchRecommendationToSearch({
      startedAt,
      now: startedAt + WEIXIN_CHANNELS_RECOMMENDATION_WINDOW_MS - 1,
      qualifiedCount: 0,
    })).toBe(false);
    expect(shouldSwitchRecommendationToSearch({
      startedAt,
      now: startedAt + WEIXIN_CHANNELS_RECOMMENDATION_WINDOW_MS,
      qualifiedCount: 4,
    })).toBe(true);
    expect(shouldSwitchRecommendationToSearch({
      startedAt,
      now: startedAt + WEIXIN_CHANNELS_RECOMMENDATION_WINDOW_MS,
      qualifiedCount: 5,
    })).toBe(false);
  });

  it("每十条按四成命中率止损推荐流并轮换七天热词", () => {
    const startedAt = 1_000;
    expect(shouldSwitchRecommendationToSearch({
      startedAt, now: startedAt + 30_000, scannedCount: 10, qualifiedCount: 2,
    })).toBe(true);
    expect(shouldSwitchRecommendationToSearch({
      startedAt, now: startedAt + 30_000, scannedCount: 10, qualifiedCount: 4,
    })).toBe(false);
    expect(shouldRotateSearchQuery({ scannedCount: 10, qualifiedCount: 3 })).toBe(true);
    expect(shouldRotateSearchQuery({ scannedCount: 10, qualifiedCount: 4 })).toBe(false);
  });

  it("从多点播放时钟推导时长，并将总采集预算限制为视频时长十分之一加两秒", () => {
    expect(parseVisibleVideoClockSeconds("当前 0:12")).toBe(12);
    expect(deriveVideoDurationSeconds([
      { progress: 0.1, text: "0:06" },
      { progress: 0.3, text: "0:18" },
      { progress: 0.5, text: "0:30" },
      { progress: 0.7, text: "0:42" },
      { progress: 0.9, text: "0:54" },
    ])).toBe(60);
    expect(WEIXIN_CHANNELS_CONTENT_SAMPLE_POINTS).toEqual([0.1, 0.3, 0.5, 0.7, 0.9]);
    expect(captureBudgetMsForVideo(60)).toBe(8_000);
    expect(captureBudgetMsForVideo(600)).toBe(62_000);
  });

  it("解析中文万单位且不伪造缺失数据", () => {
    expect(parseVisibleMetric("1.2万+")).toBe(12_000);
    expect(parseVisibleMetric("没有数字")).toBeUndefined();
  });

  it("从底部横排真实数字识别四个公开指标", () => {
    const metrics = extractWeixinChannelsMetrics([
      { text: "2985", confidence: 0.99, x: 0.55, y: 0.1, width: 0.04, height: 0.03 },
      { text: "6234", confidence: 0.99, x: 0.65, y: 0.1, width: 0.04, height: 0.03 },
      { text: "2641", confidence: 0.99, x: 0.75, y: 0.1, width: 0.04, height: 0.03 },
      { text: "17", confidence: 0.99, x: 0.85, y: 0.1, width: 0.04, height: 0.03 },
    ]);
    expect(metrics).toMatchObject({ likes: 2985, shares: 6234, favorites: 2641, comments: 17 });
  });

  it("忽略画面中的 F 键和正文数字，只读取底部四项及真实标题作者", () => {
    const lines = [
      { text: "F7", confidence: 0.99, x: 0.75, y: 0.18, width: 0.03, height: 0.02 },
      { text: "AI圈都藏着掖着的好事", confidence: 0.99, x: 0.05, y: 0.11, width: 0.7, height: 0.03 },
      { text: "苏大讲AI", confidence: 0.99, x: 0.16, y: 0.07, width: 0.12, height: 0.02 },
      ...["1666", "5054", "1237", "37"].map((text, index) => ({ text, confidence: 0.99, x: 0.51 + index * 0.125, y: 0.035, width: 0.06, height: 0.02 })),
    ];
    expect(extractWeixinChannelsMetrics(lines)).toMatchObject({ likes: 1666, shares: 5054, favorites: 1237, comments: 37 });
    expect(extractVisibleTitleAndAuthor(lines)).toEqual({ title: "AI圈都藏着掖着的好事", author: "苏大讲AI" });
  });

  it("通过 OCR 文本定位搜索框而非写死屏幕坐标", () => {
    const point = findSearchInputPoint([
      { text: "搜一搜中搜索或输入网址", confidence: 0.98, x: 0.35, y: 0.92, width: 0.3, height: 0.04 },
    ]);
    expect(point?.x).toBeCloseTo(0.43);
    expect(point?.y).toBeCloseTo(0.06);
    expect(findSearchInputPoint([])).toBeNull();
    expect(WEIXIN_CHANNELS_SEARCH_BUTTON_POINT).toEqual({ x: 0.785, y: 0.026 });
  });

  it("搜索结果优先定位带时长的自然视频卡，避开广告与账号卡", () => {
    const point = findFirstSearchVideoPoint([
      { text: "广告", confidence: 0.99, x: 0.54, y: 0.72, width: 0.08, height: 0.03 },
      { text: "02:28", confidence: 0.99, x: 0.07, y: 0.43, width: 0.08, height: 0.03 },
      { text: "大麦AI漫剧", confidence: 0.99, x: 0.2, y: 0.08, width: 0.2, height: 0.03 },
    ]);
    expect(point).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(point!.x).toBeLessThan(0.5);
    expect(findFirstSearchVideoPoint([{ text: "广告", confidence: 0.99, x: 0.54, y: 0.72, width: 0.08, height: 0.03 }])).toBeNull();
    expect(findFirstSearchVideoPoint([
      { text: "02:28", confidence: 0.99, x: 0.07, y: 0.43, width: 0.08, height: 0.03 },
      { text: "没怎么，就是想抱抱你 #漫剧 #原创动画 #男频爽文", confidence: 0.99, x: 0.06, y: 0.31, width: 0.4, height: 0.04 },
    ])).toBeNull();
    expect(findFirstSearchVideoPoint([
      { text: "03:18", confidence: 0.99, x: 0.07, y: 0.43, width: 0.08, height: 0.03 },
      { text: "AI漫剧制作教程：新手工作流拆解", confidence: 0.99, x: 0.06, y: 0.31, width: 0.4, height: 0.04 },
    ])).not.toBeNull();
  });

  it("每次切换至少等待两秒且不超过三秒", async () => {
    const startedAt = Date.now();
    const delay = await waitForVisibleVideoLoad();
    const elapsed = Date.now() - startedAt;
    expect(delay).toBeGreaterThanOrEqual(2_000);
    expect(delay).toBeLessThanOrEqual(3_000);
    expect(elapsed).toBeGreaterThanOrEqual(1_950);
  }, 4_000);

  it("由 OCR 评论标题同行推导关闭点，并在关闭后要求四项指标重新出现", () => {
    const panel = [
      { text: "评论 361", confidence: 0.99, x: 0.08, y: 0.86, width: 0.18, height: 0.04 },
      { text: "×", confidence: 0.99, x: 0.92, y: 0.86, width: 0.03, height: 0.04 },
    ];
    expect(findCommentsClosePoint(panel)).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(findCommentsClosePoint([])).toBeNull();
    const metrics = ["2985", "6234", "2641", "80"].map((text, index) => ({ text, confidence: 0.99, x: 0.55 + index * 0.1, y: 0.1, width: 0.04, height: 0.03 }));
    expect(findCommentsOpenPoint(metrics)?.x).toBeGreaterThan(0.8);
    expect(hasFourVisibleMetrics(metrics)).toBe(true);
  });

  it("只提取真实评论文本并标记用户问题", () => {
    const samples = extractCommentSamples([
      { text: "评论 361", confidence: 0.99, x: 0.1, y: 0.9, width: 0.2, height: 0.04 },
      { text: "这个方法为什么有效？", confidence: 0.99, x: 0.1, y: 0.6, width: 0.5, height: 0.04 },
      { text: "回复", confidence: 0.99, x: 0.1, y: 0.5, width: 0.1, height: 0.03 },
    ]);
    expect(samples).toEqual([{ text: "这个方法为什么有效？", likeCount: undefined, signals: ["question"] }]);
  });

  it("过滤评论面板按钮和时间戳，不把 UI 噪音送入分析", () => {
    const lines = ["赞和收藏", "推荐", "12:35", "8月14日 12:35", "这个方法确实省了很多时间"]
      .map((text, index) => ({ text, confidence: 0.99, x: 0.1, y: 0.8 - index * 0.08, width: 0.5, height: 0.04 }));
    expect(extractCommentSamples(lines)).toEqual([{
      text: "这个方法确实省了很多时间",
      likeCount: undefined,
      signals: undefined,
    }]);
  });

  it("Fly 未确认 persisted=true 时保留待传文件，确认后才删除", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wxc-upload-"));
    const pending = path.join(dir, "pending.json");
    await fs.writeFile(pending, JSON.stringify({ observationId: "obs-1" }));
    const failedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, persisted: false }), { status: 200 }));
    await expect(uploadPendingObservation({ server: "https://example.invalid", token: "token", taskId: "task-123", pendingFile: pending, fetchImpl: failedFetch })).rejects.toThrow("upload_not_persisted");
    await expect(fs.stat(pending)).resolves.toBeTruthy();
    const successFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, persisted: true }), { status: 200 }));
    await uploadPendingObservation({ server: "https://example.invalid", token: "token", taskId: "task-123", pendingFile: pending, fetchImpl: successFetch });
    await expect(fs.stat(pending)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("按新容差救回旧隔离记录，并在单次心跳只补传一条", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wxc-recovery-"));
    const quarantine = path.join(dir, "weixin-channels-quarantine");
    await fs.mkdir(quarantine);
    const eligibleName = "weixin-channels-pending-eligible.json";
    const excessiveName = "weixin-channels-pending-excessive.json";
    await fs.writeFile(path.join(quarantine, eligibleName), JSON.stringify({
      taskId: "task-eligible", videoDurationSec: 274, captureBudgetMs: 27_400, captureElapsedMs: 27_442,
    }));
    await fs.writeFile(path.join(quarantine, excessiveName), JSON.stringify({
      taskId: "task-excessive", videoDurationSec: 60, captureBudgetMs: 6_000, captureElapsedMs: 8_001,
    }));
    expect(await restoreEligibleQuarantinedObservations(dir)).toEqual({ found: 2, restored: 1 });
    await expect(fs.stat(path.join(dir, eligibleName))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(quarantine, excessiveName))).resolves.toBeTruthy();

    await fs.writeFile(path.join(dir, "weixin-channels-pending-second.json"), JSON.stringify({
      taskId: "task-second", videoDurationSec: 60, captureBudgetMs: 8_000, captureElapsedMs: 7_000,
    }));
    const persistedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ persisted: true }), { status: 200 }));
    const recovery = await retryPendingObservations({
      server: "https://example.invalid", token: "token", tempDir: dir, fetchImpl: persistedFetch,
    });
    expect(recovery).toEqual({ found: 2, persisted: 1, failed: 0 });
    expect(persistedFetch).toHaveBeenCalledTimes(1);
    const remaining = (await fs.readdir(dir)).filter((name) => name.startsWith("weixin-channels-pending-"));
    expect(remaining).toHaveLength(1);
  });

  it("候选任务耗尽时优先复用 AI 或漫剧主题，不返回空壳任务", () => {
    expect(selectReusableCollectorCandidate([
      { taskId: "general", searchQueries: ["家常菜"], category: "生活", createdAt: "2026-08-14T01:00:00Z" },
      { taskId: "drama", searchQueries: ["AI短剧", "漫剧免费看"], category: "娱乐", createdAt: "2026-08-14T02:00:00Z" },
      { taskId: "ai", searchQueries: ["AI工作流", "AI工具实测"], category: "科技", createdAt: "2026-08-13T01:00:00Z" },
    ])).toMatchObject({ taskId: "ai", searchQueries: ["AI工作流", "AI工具实测"] });
    expect(selectReusableCollectorCandidate([])).toBeUndefined();
  });

  it("最近七天热词跨类目轮换，短剧作品词剔除且已用词沉底", () => {
    const queries = buildDiverseCollectorSearchQueries({
      candidates: [
        { taskId: "ai", category: "AI工具", searchQueries: ["AI工作流", "AI工具实测"], sourceTitle: "普通人AI工作流" },
        { taskId: "career", category: "职场", searchQueries: ["普通人副业方法", "升职方法"], sourceTitle: "职场方法" },
        { taskId: "drama", category: "娱乐", searchQueries: ["短剧免费看", "男频爽文全集"], sourceTitle: "短剧" },
      ],
      seedQueries: ["AI工作流"],
      recentlyUsed: ["AI工作流"],
      limit: 10,
    });
    expect(queries).toEqual(["普通人副业方法", "AI工具实测", "升职方法", "AI工作流"]);
    expect(queries.join(" ")).not.toMatch(/短剧|爽文|免费看/);
  });

  it("进度抽查时四项指标必须仍属于同一视频", () => {
    const base = { likes: 4_855, shares: 1_766, favorites: 1_997, comments: 254, rawText: [] };
    expect(metricsRemainOnSameVideo(base, { likes: 4_856, shares: 1_766, favorites: 1_997, comments: 254, rawText: [] })).toBe(true);
    expect(metricsRemainOnSameVideo(base, { likes: 34_000, shares: 27_000, favorites: 9_726, comments: 2_147, rawText: [] })).toBe(false);
  });
});
