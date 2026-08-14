import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  automaticRecoveryDelayMs,
  extractCommentSamples,
  captureBudgetMsForVideo,
  collectorSeenContains,
  collectorWatchdogDecision,
  collectorVideoStateAfterCapture,
  loadCollectorSearchTabState,
  loadCollectorSeenRegistry,
  rememberCollectorSeen,
  buildDiverseCollectorSearchQueries,
  deriveVideoDurationSeconds,
  detectVisibleProgressTrack,
  extractVisibleTitleAndAuthor,
  extractWeixinChannelsMetrics,
  findCommentsClosePoint,
  findCommentsOpenPoint,
  findMediaViewerClosePoint,
  findFirstSearchVideoPoint,
  findExactSearchSuggestionPoint,
  findSearchInputPoint,
  hasFourVisibleMetrics,
  isWeixinChannelsAuxiliaryPage,
  isWeixinChannelsMediaViewer,
  hasTypedSearchKeyword,
  metricsRemainOnSameVideo,
  nextCollectorSearchQueryIndex,
  parseVisibleMetric,
  parseVisibleVideoClockSeconds,
  parseVisibleVideoTotalDurationSeconds,
  pendingObservationHasRequiredComments,
  restoreEligibleQuarantinedObservations,
  retryPendingObservations,
  scoreRepresentativeFrameCandidate,
  selectReusableCollectorCandidate,
  shouldReuseExistingSearchTab,
  shouldLaunchdRestartCollector,
  shouldSwitchRecommendationToSearch,
  shouldRotateSearchQuery,
  syncPersistedCollectorIdentities,
  uploadPendingObservation,
  visibleVideoIdentityFingerprint,
  WEIXIN_CHANNELS_CONTENT_SAMPLE_POINTS,
  WEIXIN_CHANNELS_RECOMMENDATION_WINDOW_MS,
  WEIXIN_CHANNELS_SEARCH_BUTTON_POINT,
  WEIXIN_CHANNELS_SEARCH_INPUT_POINT,
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
    expect(nextCollectorSearchQueryIndex(0, 21)).toBe(1);
    expect(nextCollectorSearchQueryIndex(20, 21)).toBe(0);
    expect(nextCollectorSearchQueryIndex(0, 1)).toBe(0);
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

  it("稳定视频身份忽略字幕变化，但指标、标题或作者变化都会改变", () => {
    const lines = (subtitle: string, likes = "3000", title = "AI工作流实测", author = "工具研究所") => [
      { text: title, confidence: 0.99, x: 0.05, y: 0.12, width: 0.42, height: 0.04 },
      { text: author, confidence: 0.99, x: 0.05, y: 0.07, width: 0.18, height: 0.03 },
      { text: subtitle, confidence: 0.99, x: 0.2, y: 0.5, width: 0.6, height: 0.04 },
      { text: likes, confidence: 0.99, x: 0.52, y: 0.08, width: 0.06, height: 0.03 },
      { text: "2000", confidence: 0.99, x: 0.65, y: 0.08, width: 0.06, height: 0.03 },
      { text: "1500", confidence: 0.99, x: 0.77, y: 0.08, width: 0.06, height: 0.03 },
      { text: "120", confidence: 0.99, x: 0.89, y: 0.08, width: 0.06, height: 0.03 },
    ];
    const ocr = (value: ReturnType<typeof lines>) => ({ width: 483, height: 769, lines: value });
    const first = visibleVideoIdentityFingerprint(ocr(lines("第一句字幕")));
    expect(first).toBe(visibleVideoIdentityFingerprint(ocr(lines("第二句字幕"))));
    expect(first).not.toBe(visibleVideoIdentityFingerprint(ocr(lines("第二句字幕", "3001"))));
    expect(first).not.toBe(visibleVideoIdentityFingerprint(ocr(lines("第二句字幕", "3000", "AI智能体教程"))));
    expect(first).not.toBe(visibleVideoIdentityFingerprint(ocr(lines("第二句字幕", "3000", "AI工作流实测", "另一作者"))));
    expect(visibleVideoIdentityFingerprint(ocr(lines("字幕").slice(0, 4)))).toBeUndefined();
  });

  it("七天身份与 observationId 去重跨监督器重启仍生效", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wxc-seen-"));
    const first = await loadCollectorSeenRegistry(dir, Date.parse("2026-08-14T00:00:00.000Z"));
    await rememberCollectorSeen(first, {
      videoIdentity: "a".repeat(64), observationId: "wxco_restart", seenAt: "", state: "persisted",
    }, Date.parse("2026-08-14T00:00:00.000Z"));
    const restarted = await loadCollectorSeenRegistry(dir, Date.parse("2026-08-14T01:00:00.000Z"));
    expect(collectorSeenContains(restarted, "a".repeat(64))).toBe(true);
    expect(collectorSeenContains(restarted, "b".repeat(64), "wxco_restart")).toBe(true);
    const expired = await loadCollectorSeenRegistry(dir, Date.parse("2026-08-22T00:00:01.000Z"));
    expect(collectorSeenContains(expired, "a".repeat(64))).toBe(false);
  });

  it("旧 seen 和可重试失败都不能把达标视频当重复跳过", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wxc-seen-migrate-"));
    await fs.writeFile(path.join(dir, "weixin-channels-seen-videos-v1.json"), JSON.stringify({ entries: [{
      videoIdentity: "c".repeat(64), observationId: "wxco_unverified", seenAt: "2026-08-14T00:00:00.000Z",
    }] }));
    const registry = await loadCollectorSeenRegistry(dir, Date.parse("2026-08-14T01:00:00.000Z"));
    expect(collectorSeenContains(registry, "c".repeat(64), "wxco_unverified")).toBe(false);
    await rememberCollectorSeen(registry, {
      videoIdentity: "d".repeat(64), observationId: "wxco_failed", seenAt: "", state: "retryable_failed",
    }, Date.parse("2026-08-14T01:00:00.000Z"));
    expect(collectorSeenContains(registry, "d".repeat(64), "wxco_failed")).toBe(false);
  });

  it("达标视频只有 Fly persisted=true 才允许进入终态", () => {
    expect(collectorVideoStateAfterCapture({ qualified: true, persisted: true })).toEqual({ state: "persisted", stopWithoutAdvance: false });
    expect(collectorVideoStateAfterCapture({ qualified: true, persisted: false })).toEqual({ state: "retryable_failed", stopWithoutAdvance: true });
    expect(collectorVideoStateAfterCapture({ qualified: false, persisted: false })).toEqual({ state: "terminal_unqualified", stopWithoutAdvance: false });
  });

  it("夜间自动恢复使用有上限的指数退避，不要求人工重启", () => {
    expect(automaticRecoveryDelayMs(1)).toBe(5_000);
    expect(automaticRecoveryDelayMs(2)).toBe(10_000);
    expect(automaticRecoveryDelayMs(7)).toBe(300_000);
    expect(automaticRecoveryDelayMs(100)).toBe(300_000);
    expect(shouldLaunchdRestartCollector("player_state_unconfirmed")).toBe(true);
    expect(shouldLaunchdRestartCollector("capture_disabled")).toBe(false);
    expect(shouldLaunchdRestartCollector("hourly_target_missed")).toBe(false);
    expect(shouldLaunchdRestartCollector("max_scanned_reached", 1)).toBe(false);
  });

  it("只有 Fly persistedAt 同步结果会升级为跨重启重复", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wxc-seen-sync-"));
    const registry = await loadCollectorSeenRegistry(dir, Date.parse("2026-08-14T01:00:00.000Z"));
    await syncPersistedCollectorIdentities({
      server: "https://example.test",
      token: "token",
      registry,
      now: Date.parse("2026-08-14T01:00:00.000Z"),
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ records: [{
        videoIdentity: "e".repeat(64), observationId: "wxco_fly", persistedAt: "2026-08-14T00:30:00.000Z",
      }] }), { status: 200 })) as typeof fetch,
    });
    expect(collectorSeenContains(registry, "e".repeat(64), "wxco_fly")).toBe(true);
  });

  it("代表画面评分避开加载黑屏，并偏好清晰且有叙事文本的中段", () => {
    const loading = scoreRepresentativeFrameCandidate({ progress: 0.5, ocrText: "网络加载中", entropy: 1, sharpness: 1, mean: 10 });
    const narrative = scoreRepresentativeFrameCandidate({ progress: 0.5, ocrText: "AI工作流拆解 第三步生成分镜", entropy: 5, sharpness: 8, mean: 120 });
    expect(narrative).toBeGreaterThan(loading);
  });

  it("跨进程只允许一个新增搜索标签，总数最多两个", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wxc-tabs-"));
    await fs.writeFile(path.join(dir, "weixin-channels-search-tabs-v1.json"), JSON.stringify({
      windowId: 42, openedTabs: 99, updatedAt: "2026-08-14T00:00:00.000Z",
    }));
    const state = await loadCollectorSearchTabState(42, dir, Date.parse("2026-08-14T01:00:00.000Z"));
    expect(state.openedTabs).toBe(1);
    expect(shouldReuseExistingSearchTab(state.openedTabs)).toBe(true);
    expect(shouldReuseExistingSearchTab(0)).toBe(false);
  });

  it("播放器只接受明确总时长，小时看门狗低于五十会停采", () => {
    expect(parseVisibleVideoTotalDurationSeconds("01:12 / 03:40")).toBe(220);
    expect(parseVisibleVideoTotalDurationSeconds("总时长 02:06")).toBe(126);
    expect(parseVisibleVideoTotalDurationSeconds("当前 01:12")).toBeUndefined();
    expect(collectorWatchdogDecision(15 * 60_000, 11)).toBe("checkpoint_15");
    expect(collectorWatchdogDecision(30 * 60_000, 24)).toBe("checkpoint_30");
    expect(collectorWatchdogDecision(60 * 60_000, 49)).toBe("stop");
    expect(collectorWatchdogDecision(60 * 60_000, 50)).toBe("rollover");
  });

  it("识别视频号半透明蓝灰进度轨道，不把可见轨道误报为缺失", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wxc-track-"));
    const file = path.join(dir, "blue-gray-track.png");
    await sharp({ create: { width: 966, height: 1538, channels: 3, background: { r: 0, g: 49, b: 83 } } })
      .composite([
        { input: { create: { width: 560, height: 5, channels: 3, background: { r: 94, g: 123, b: 146 } } }, left: 120, top: 1262 },
        { input: { create: { width: 110, height: 5, channels: 3, background: { r: 255, g: 255, b: 255 } } }, left: 120, top: 1262 },
      ])
      .png()
      .toFile(file);
    const track = await detectVisibleProgressTrack(file);
    expect(track.startX).toBeGreaterThanOrEqual(0.08);
    expect(track.endX).toBeGreaterThan(0.65);
    expect(track.y).toBeCloseTo(1262 / 1538, 2);
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

  it("横排 OCR 漏掉一项时按真实槽位保留其余指标", () => {
    const metrics = extractWeixinChannelsMetrics([
      { text: "2.7万", confidence: 0.99, x: 0.52, y: 0.05, width: 0.05, height: 0.03 },
      { text: "8315", confidence: 0.99, x: 0.76, y: 0.05, width: 0.05, height: 0.03 },
      { text: "2319", confidence: 0.99, x: 0.88, y: 0.05, width: 0.05, height: 0.03 },
    ]);
    expect(metrics).toMatchObject({ likes: 27_000, favorites: 8_315, comments: 2_319 });
    expect(metrics.shares).toBeUndefined();
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
    expect(WEIXIN_CHANNELS_SEARCH_INPUT_POINT).toEqual({ x: 0.58, y: 0.026 });
  });

  it("视频号只保留一个可复用搜索标签", () => {
    expect(shouldReuseExistingSearchTab(0)).toBe(false);
    expect(shouldReuseExistingSearchTab(1)).toBe(true);
    expect(shouldReuseExistingSearchTab(2)).toBe(true);
    expect(shouldReuseExistingSearchTab(3)).toBe(true);
  });

  it("回车停在联想下拉框时只点击完全匹配的搜索词", () => {
    const point = findExactSearchSuggestionPoint([
      { text: "Al拥抱自由，找准普通人搞钱方向", confidence: 1, x: 0.42, y: 0.965, width: 0.36, height: 0.02 },
      { text: "AI拥抱自由，找准普通人搞钱方向", confidence: 1, x: 0.42, y: 0.907, width: 0.37, height: 0.02 },
      { text: "AI多少钱", confidence: 1, x: 0.42, y: 0.78, width: 0.2, height: 0.02 },
    ], "AI拥抱自由，找准普通人搞钱方向");
    expect(point?.x).toEqual(expect.any(Number));
    expect(point?.y).toBeCloseTo(0.083, 2);
    expect(findExactSearchSuggestionPoint([], "AI拥抱自由")).toBeNull();
    expect(hasTypedSearchKeyword([
      { text: "找Al拥抱自由，找准普通人搞钱方向", confidence: 1, x: 0.42, y: 0.965, width: 0.36, height: 0.02 },
    ], "AI拥抱自由，找准普通人搞钱方向")).toBe(true);
    expect(hasTypedSearchKeyword([
      { text: "Q Al漫剧教程", confidence: 0.3, x: 0.4, y: 0.963, width: 0.2, height: 0.02 },
    ], "AI漫剧教程")).toBe(true);
    expect(hasTypedSearchKeyword([
      { text: "• AI漫剧教程", confidence: 0.3, x: 0.4, y: 0.963, width: 0.2, height: 0.02 },
    ], "AI漫剧教程")).toBe(true);
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
      { text: "评论 1.5万", confidence: 0.99, x: 0.08, y: 0.86, width: 0.18, height: 0.04 },
      { text: "×", confidence: 0.99, x: 0.92, y: 0.86, width: 0.03, height: 0.04 },
    ];
    expect(findCommentsClosePoint(panel)).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(findCommentsClosePoint([])).toBeNull();
    const metrics = ["2985", "6234", "2641", "80"].map((text, index) => ({ text, confidence: 0.99, x: 0.55 + index * 0.1, y: 0.1, width: 0.04, height: 0.03 }));
    expect(findCommentsOpenPoint(metrics)?.x).toBeGreaterThan(0.8);
    expect(findCommentsOpenPoint(metrics.slice(0, 3))).toBeNull();
    expect(hasFourVisibleMetrics(metrics)).toBe(true);
  });

  it("识别赞和收藏及搜索结果辅助页，禁止当成视频扫描", () => {
    expect(isWeixinChannelsAuxiliaryPage([
      { text: "赞和收藏", confidence: 0.99, x: 0.07, y: 0.9, width: 0.15, height: 0.04 },
      { text: "浏览记录", confidence: 0.99, x: 0.07, y: 0.8, width: 0.15, height: 0.04 },
    ])).toBe(true);
    expect(isWeixinChannelsAuxiliaryPage([
      { text: "全部", confidence: 0.99, x: 0.2, y: 0.8, width: 0.1, height: 0.04 },
      { text: "影片", confidence: 0.99, x: 0.4, y: 0.8, width: 0.1, height: 0.04 },
      { text: "朋友圈", confidence: 0.99, x: 0.6, y: 0.8, width: 0.1, height: 0.04 },
    ])).toBe(true);
    expect(isWeixinChannelsAuxiliaryPage([
      { text: "客房没有捷径", confidence: 0.99, x: 0.1, y: 0.2, width: 0.3, height: 0.04 },
    ])).toBe(false);
  });

  it("识别图片查看器并只用同排 OCR 关闭点退出", () => {
    const viewer = [
      { text: "用新視窗開啟", confidence: 1, x: 0.69, y: 0.926, width: 0.15, height: 0.018 },
      { text: "X", confidence: 0.3, x: 0.86, y: 0.924, width: 0.04, height: 0.02 },
      { text: "45", confidence: 1, x: 0.63, y: 0.019, width: 0.03, height: 0.014 },
      { text: "90", confidence: 1, x: 0.72, y: 0.019, width: 0.03, height: 0.014 },
      { text: "35", confidence: 1, x: 0.81, y: 0.019, width: 0.03, height: 0.014 },
      { text: "15", confidence: 1, x: 0.90, y: 0.019, width: 0.03, height: 0.014 },
    ];
    expect(isWeixinChannelsMediaViewer(viewer)).toBe(true);
    expect(isWeixinChannelsAuxiliaryPage(viewer)).toBe(true);
    expect(findMediaViewerClosePoint(viewer)?.x).toBeGreaterThan(0.85);
    expect(findMediaViewerClosePoint(viewer.slice(0, 1))).toBeNull();
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

  it("Fly 响应正文不结束时按总截止时间退出并保留待传文件", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wxc-upload-timeout-"));
    const pending = path.join(dir, "pending.json");
    await fs.writeFile(pending, JSON.stringify({ observationId: "obs-timeout" }));
    const hangingFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => new Promise<string>(() => undefined),
    });
    await expect(uploadPendingObservation({
      server: "https://example.invalid",
      token: "token",
      taskId: "task-timeout",
      pendingFile: pending,
      deadlineAt: Date.now() + 30,
      fetchImpl: hangingFetch as unknown as typeof fetch,
    })).rejects.toThrow("upload_timeout");
    await expect(fs.stat(pending)).resolves.toBeTruthy();
  });

  it("评论达到 80 的旧待传记录缺真实评论时隔离且不再请求 Fly", async () => {
    expect(pendingObservationHasRequiredComments({ comments: 79 })).toBe(true);
    expect(pendingObservationHasRequiredComments({ comments: 80, commentSamples: [] })).toBe(false);
    expect(pendingObservationHasRequiredComments({ comments: 80, commentSamples: [{ text: "真实评论" }] })).toBe(true);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wxc-missing-comments-"));
    const pending = path.join(dir, "weixin-channels-pending-invalid.json");
    await fs.writeFile(pending, JSON.stringify({
      taskId: "task-invalid", comments: 558, commentSamples: [], captureElapsedMs: 1_000, videoDurationSec: 60,
    }));
    const fetchImpl = vi.fn();
    const recovery = await retryPendingObservations({
      server: "https://example.invalid", token: "token", tempDir: dir, fetchImpl,
    });
    expect(recovery).toEqual({ found: 1, persisted: 0, persistedUnique: 0, duplicatePersistRejected: 0, failed: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(fs.stat(pending)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(dir, "weixin-channels-quarantine", path.basename(pending)))).resolves.toBeTruthy();
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
    expect(recovery).toEqual({ found: 2, persisted: 1, persistedUnique: 0, duplicatePersistRejected: 0, failed: 0 });
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

  it("热词剔除空泛教程并把 AI 新手长句压成具体主题", () => {
    const queries = buildDiverseCollectorSearchQueries({
      candidates: [{
        taskId: "ai",
        category: "AI工具",
        searchQueries: ["内有教程", "AI漫剧新手小白教程", "AI工作流"],
      }],
      limit: 10,
    });
    expect(queries).toEqual(["AI漫剧教程", "AI工作流"]);
  });

  it("不会只取每个类目前三个热词，后续七天新词也进入轮换", () => {
    const queries = buildDiverseCollectorSearchQueries({
      candidates: [{
        taskId: "ai",
        category: "AI工具",
        searchQueries: ["词一", "词二", "词三", "词四", "词五", "词六"],
      }],
      recentlyUsed: ["词一", "词二"],
      limit: 6,
    });
    expect(queries).toEqual(["词三", "词四", "词五", "词六", "词一", "词二"]);
  });

  it("进度抽查时四项指标必须仍属于同一视频", () => {
    const base = { likes: 4_855, shares: 1_766, favorites: 1_997, comments: 254, rawText: [] };
    expect(metricsRemainOnSameVideo(base, { likes: 4_856, shares: 1_766, favorites: 1_997, comments: 254, rawText: [] })).toBe(true);
    expect(metricsRemainOnSameVideo(base, { likes: 34_000, shares: 27_000, favorites: 9_726, comments: 2_147, rawText: [] })).toBe(false);
    expect(metricsRemainOnSameVideo(base, { likes: 4_856, shares: 1_766, favorites: undefined, comments: undefined, rawText: [] })).toBe(true);
    expect(metricsRemainOnSameVideo(base, { likes: 4_856, shares: undefined, favorites: undefined, comments: undefined, rawText: [] })).toBe(false);
  });
});
