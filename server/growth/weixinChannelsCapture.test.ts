import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  hasWeixinChannelsHighHeatSignals,
  qualifyWeixinChannelsObservationLocally,
  WEIXIN_CHANNELS_HIGH_HEAT_BANDS,
} from "../../shared/weixinChannelsRules";
import {
  automaticRecoveryDelayMs,
  extractCommentSamples,
  extractCommentPanelContentLines,
  captureBudgetMsForVideo,
  collectorSeenContains,
  compactCollectorSearchQuery,
  collectorSearchQueryVariants,
  collectorAdvanceAllowed,
  collectorCaptureActivityIsOverdue,
  collectorControlStopReason,
  collectorSamplingModeForComments,
  commentsPanelClosedOnSameVideo,
  collectorWatchdogDecision,
  collectorVideoStateAfterCapture,
  loadCollectorSearchTabState,
  loadCollectorSeenRegistry,
  rememberCollectorSeen,
  buildDiverseCollectorSearchQueries,
  classifyLiveFrameBeforeAdvance,
  deriveVideoDurationSeconds,
  dedupIdentityFingerprint,
  detectVisibleProgressTrack,
  extractVisibleTitleAndAuthor,
  extractWeixinChannelsMetrics,
  findCommentsClosePoint,
  findCommentsOpenPoint,
  findAnySearchTabPoint,
  findChannelsTabPoint,
  findMediaViewerClosePoint,
  mergeSearchSortSummaries,
  findPersonalDataTabClosePoint,
  findFirstSearchVideoPoint,
  findExactSearchSuggestionPoint,
  findSearchInputPoint,
  findSearchSubmitPoint,
  findSearchVideosTabPoint,
  findSearchButtonPoint,
  findSearchTabClosePoint,
  hasFourVisibleMetrics,
  hasDefinitiveVisibleUnqualifiedMetrics,
  hasConfirmedVideoTransition,
  interactionMetricsConfirmed,
  isCollectorWindowBindingFailure,
  isWeixinChannelsAuxiliaryPage,
  isWeixinChannelsPersonalDataPage,
  isWeixinChannelsMediaViewer,
  hasTypedSearchKeyword,
  metricsRemainOnSameVideo,
  sameVideoContinuity,
  nextCollectorSearchQueryIndex,
  nextCollectorRecoveryState,
  parseVisibleMetric,
  parseCollectorFormalPoolOptions,
  parseVisibleVideoClockSeconds,
  parseVisibleVideoTotalDurationSeconds,
  planSearchResultSelection,
  pendingObservationHasRequiredComments,
  qualifiedCaptureHasAdvanceEvidence,
  restoreEligibleQuarantinedObservations,
  retryPendingObservations,
  representativeFrameNeedsSingleRetry,
  scoreRepresentativeFrameCandidate,
  sampledCapturePersistenceDisposition,
  selectCurrentHottestSearchResultPoint,
  selectReusableCollectorCandidate,
  shouldReuseExistingSearchTab,
  shouldOpenVisibleComments,
  shouldLaunchdRestartCollector,
  shouldRestartCollectorSupervisorAfterStop,
  shouldSwitchRecommendationToSearch,
  shouldUseWeixinChannelsSearchAtHour,
  resolveCollectorWindowStartupMode,
  shouldRotateSearchQuery,
  shouldReturnToRecommendationAfterSearchError,
  summarizeSearchSort,
  syncPersistedCollectorIdentities,
  uploadPendingObservation,
  visibleVideoIdentityFingerprint,
  WEIXIN_CHANNELS_CONTENT_SAMPLE_POINTS,
  WEIXIN_CHANNELS_COMMENT_PANEL_SCREEN_COUNT,
  WEIXIN_CHANNELS_RECOMMENDATION_WINDOW_MS,
  WEIXIN_CHANNELS_SEARCH_BUTTON_POINT,
  WEIXIN_CHANNELS_SEARCH_HIGH_PLAY_THRESHOLD,
  WEIXIN_CHANNELS_SEARCH_INPUT_POINT,
  WEIXIN_CHANNELS_SINGLE_VIDEO_HARD_TIMEOUT_MS,
  WEIXIN_CHANNELS_UNKNOWN_DURATION_CAPTURE_BUDGET_MS,
  waitForVisibleVideoLoad,
} from "../../scripts/weixin-channels-capture.mts";

describe("weixin channels OCR", () => {
  it("右窗只在零点至六点前启用搜索", () => {
    expect(shouldUseWeixinChannelsSearchAtHour(0)).toBe(true);
    expect(shouldUseWeixinChannelsSearchAtHour(5)).toBe(true);
    expect(shouldUseWeixinChannelsSearchAtHour(6)).toBe(false);
    expect(shouldUseWeixinChannelsSearchAtHour(23)).toBe(false);
  });

  it("正式启动旗标必须在 pool 模式成套生效，且不能混用固定窗口 ID", () => {
    expect(parseCollectorFormalPoolOptions([
      "--pool",
      "--auto-bind-exact-two-windows",
      "--calibrate-search-buttons",
      "--supervise-web-toggle",
    ])).toEqual({
      autoBindExactTwoWindows: true,
      calibrateSearchButtons: true,
      superviseWebToggle: true,
      windowIds: [],
    });
    expect(() => parseCollectorFormalPoolOptions([
      "--auto-bind-exact-two-windows",
    ])).toThrow("weixin_channels_formal_pool_flags_require_pool_mode");
    expect(() => parseCollectorFormalPoolOptions([
      "--pool",
      "--auto-bind-exact-two-windows",
      "--window-id=58442",
    ])).toThrow("weixin_channels_window_binding_mode_conflict");
  });

  it("网页开关即使关后立刻再开，也会以控制版本终止旧轮次并重新校准", () => {
    expect(collectorControlStopReason(7, {
      enabled: true,
      controlRevision: 7,
    })).toBeNull();
    expect(collectorControlStopReason(7, {
      enabled: false,
      controlRevision: 8,
    })).toBe("capture_disabled");
    expect(collectorControlStopReason(7, {
      enabled: true,
      controlRevision: 9,
    })).toBe("capture_control_changed");
    expect(shouldRestartCollectorSupervisorAfterStop("capture_control_changed")).toBe(true);
    expect(shouldRestartCollectorSupervisorAfterStop("capture_disabled_during_recovery")).toBe(true);
    expect(shouldRestartCollectorSupervisorAfterStop("dual_window_fail_closed")).toBe(false);
  });

  it("夜间右窗先保住已达标当前视频，否则首次直接搜索；恢复重启不盲搜", () => {
    expect(resolveCollectorWindowStartupMode({
      isRightSearchWindow: true, hour: 0, startupQualified: true, restart: 0,
    })).toEqual({ captureCurrentBeforeSearch: true, startInSearch: false });
    expect(resolveCollectorWindowStartupMode({
      isRightSearchWindow: true, hour: 5, startupQualified: false, restart: 0,
    })).toEqual({ captureCurrentBeforeSearch: false, startInSearch: true });
    expect(resolveCollectorWindowStartupMode({
      isRightSearchWindow: true, hour: 5, startupQualified: false, restart: 1,
    })).toEqual({ captureCurrentBeforeSearch: false, startInSearch: false });
    expect(resolveCollectorWindowStartupMode({
      isRightSearchWindow: true, hour: 6, startupQualified: false, restart: 0,
    })).toEqual({ captureCurrentBeforeSearch: false, startInSearch: false });
    expect(resolveCollectorWindowStartupMode({
      isRightSearchWindow: false, hour: 0, startupQualified: false, restart: 0,
    })).toEqual({ captureCurrentBeforeSearch: false, startInSearch: false });
  });

  it("新版爆款区间以区间下沿为门槛，1932 与 2000 同属达标", () => {
    expect(WEIXIN_CHANNELS_HIGH_HEAT_BANDS).toEqual({
      likes: { min: 1_000, referenceHigh: 2_000 },
      shares: { min: 500, referenceHigh: 1_000 },
      favorites: { min: 500, referenceHigh: 1_000 },
    });
    expect(hasWeixinChannelsHighHeatSignals({
      likes: 1_932,
      shares: 2_085,
      favorites: 631,
    })).toBe(true);
    expect(qualifyWeixinChannelsObservationLocally({
      likes: 1_932,
      shares: 2_085,
      favorites: 631,
      comments: 71,
    })).toEqual(expect.objectContaining({
      qualified: true,
      requiresComments: false,
    }));
    expect(hasWeixinChannelsHighHeatSignals({
      likes: 999,
      shares: 499,
      favorites: 499,
    })).toBe(false);
    expect(hasWeixinChannelsHighHeatSignals({
      likes: 1_000,
      shares: 500,
      favorites: 0,
    })).toBe(true);
  });

  it("评论不足 80 只保留单帧，达到 80 才进入五点与评论链", () => {
    expect(collectorSamplingModeForComments(0)).toBe("single_representative_frame");
    expect(collectorSamplingModeForComments(79)).toBe("single_representative_frame");
    expect(collectorSamplingModeForComments(80)).toBe("five_point_comments");
  });

  it("顶栏标签只返回文字安全区，搜索结束只识别右侧搜索标签 X", () => {
    const top = [
      { text: "X 视频号", confidence: 0.3, x: 0.401, y: 0.963, width: 0.145, height: 0.02 },
      { text: "小猪看病", confidence: 1, x: 0.60, y: 0.965, width: 0.08, height: 0.016 },
      { text: "X", confidence: 0.3, x: 0.668, y: 0.965, width: 0.023, height: 0.015 },
    ];
    expect(findChannelsTabPoint(top)).toEqual(expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number),
    }));
    expect(findChannelsTabPoint(top)!.x).toBeLessThan(0.5);
    expect(findChannelsTabPoint(top)!.y).toBeGreaterThanOrEqual(0.02);
    expect(findAnySearchTabPoint(top)!.x).toBeLessThan(0.66);
    expect(findAnySearchTabPoint(top)!.y).toBeLessThanOrEqual(0.05);
    expect(findSearchTabClosePoint(top)!.x).toBeGreaterThanOrEqual(0.66);
    expect(findSearchTabClosePoint(top)!.x).toBeLessThanOrEqual(0.72);
  });

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

  it("从多点播放时钟推导时长，短视频保留真实评论最低预算", () => {
    expect(parseVisibleVideoClockSeconds("当前 0:12")).toBe(12);
    expect(deriveVideoDurationSeconds([
      { progress: 0.1, text: "0:06" },
      { progress: 0.3, text: "0:18" },
      { progress: 0.5, text: "0:30" },
      { progress: 0.7, text: "0:42" },
      { progress: 0.9, text: "0:54" },
    ])).toBe(60);
    expect(WEIXIN_CHANNELS_CONTENT_SAMPLE_POINTS).toEqual([0.1, 0.3, 0.5, 0.7, 0.9]);
    expect(WEIXIN_CHANNELS_COMMENT_PANEL_SCREEN_COUNT).toBe(3);
    expect(captureBudgetMsForVideo(60)).toBe(25_000);
    expect(captureBudgetMsForVideo(600)).toBe(62_000);
    expect(WEIXIN_CHANNELS_UNKNOWN_DURATION_CAPTURE_BUDGET_MS).toBe(40_000);
    expect(WEIXIN_CHANNELS_SINGLE_VIDEO_HARD_TIMEOUT_MS).toBe(60_000);
    expect(collectorCaptureActivityIsOverdue({ startedAtMs: 1_000 }, 61_000)).toBe(false);
    expect(collectorCaptureActivityIsOverdue({ startedAtMs: 1_000 }, 61_001)).toBe(true);
  });

  it("历史去重身份忽略字幕与互动增长，播放器连续性容忍小幅增长", () => {
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
    expect(first).toBe(visibleVideoIdentityFingerprint(ocr(lines("第二句字幕", "3001"))));
    expect(first).toBe(dedupIdentityFingerprint(ocr(lines("第二句字幕", "3001"))));
    expect(first).toBe(visibleVideoIdentityFingerprint(ocr(lines(
      "第二句字幕", "3001", "AI工作流实测⋯展开", "工具研究所⋯",
    ))));
    expect(sameVideoContinuity(ocr(lines("第一句字幕")), ocr(lines("第二句字幕", "3001")))).toBe(true);
    expect(first).not.toBe(visibleVideoIdentityFingerprint(ocr(lines("第二句字幕", "3000", "AI智能体教程"))));
    expect(first).not.toBe(visibleVideoIdentityFingerprint(ocr(lines("第二句字幕", "3000", "AI工作流实测", "另一作者"))));
    expect(visibleVideoIdentityFingerprint(ocr(lines("字幕").slice(2)))).toBeUndefined();
  });

  it("滑动前发现推荐流已经自动换页时禁止再滑一次", () => {
    const makeVideo = (title: string, author: string, metrics: string[]) => ({
      width: 483,
      height: 769,
      lines: [
      { text: title, confidence: 0.99, x: 0.05, y: 0.12, width: 0.42, height: 0.04 },
      { text: author, confidence: 0.99, x: 0.05, y: 0.07, width: 0.18, height: 0.03 },
      ...metrics.map((text, index) => ({
        text,
        confidence: 0.99,
        x: 0.55 + index * 0.1,
        y: 0.05,
        width: 0.06,
        height: 0.03,
      })),
      ],
    });
    const decided = makeVideo("上一条爆款", "作者甲", ["3.6万", "6057", "1.1万", "1381"]);
    const same = makeVideo("上一条爆款", "作者甲", ["3.6万", "6058", "1.1万", "1381"]);
    const autoAdvanced = makeVideo("当前新爆款", "作者乙", ["8.8万", "7.4万", "6.3万", "6024"]);

    expect(classifyLiveFrameBeforeAdvance(decided, same)).toBe("same_video");
    expect(classifyLiveFrameBeforeAdvance(decided, autoAdvanced)).toBe("already_transitioned");
  });

  it("两项前置互动明确低于门槛时无需等缺失项即可安全淘汰", () => {
    const partial = [
      { text: "低热视频", confidence: 0.99, x: 0.05, y: 0.12, width: 0.42, height: 0.04 },
      { text: "作者", confidence: 0.99, x: 0.05, y: 0.07, width: 0.18, height: 0.03 },
      { text: "144", confidence: 1, x: 0.472, y: 0.036, width: 0.058, height: 0.016 },
      { text: "66", confidence: 1, x: 0.744, y: 0.036, width: 0.043, height: 0.016 },
      { text: "302", confidence: 1, x: 0.865, y: 0.036, width: 0.063, height: 0.018 },
    ];
    expect(hasFourVisibleMetrics(partial)).toBe(false);
    expect(hasDefinitiveVisibleUnqualifiedMetrics(partial)).toBe(true);
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

  it("前置达标且评论达到 80 时，没有真实评论证据绝不允许滑下一条", () => {
    const base = {
      qualified: true,
      persisted: true,
      observation: { likes: 3_000, shares: 2_000, favorites: 100, comments: 80 },
    };
    expect(qualifiedCaptureHasAdvanceEvidence(base)).toBe(false);
    expect(qualifiedCaptureHasAdvanceEvidence({
      ...base,
      observation: {
        ...base.observation,
        commentSamples: [{ text: "真实评论" }],
      },
    })).toBe(true);
    expect(qualifiedCaptureHasAdvanceEvidence({
      qualified: true,
      persisted: true,
      observation: { likes: 3_000, shares: 2_000, favorites: 100, comments: 79 },
    })).toBe(true);
  });

  it("夜间自动恢复使用有上限的指数退避，不要求人工重启", () => {
    expect(automaticRecoveryDelayMs(1)).toBe(5_000);
    expect(automaticRecoveryDelayMs(2)).toBe(10_000);
    expect(automaticRecoveryDelayMs(7)).toBe(300_000);
    expect(automaticRecoveryDelayMs(100)).toBe(300_000);
    expect(shouldLaunchdRestartCollector("player_state_unconfirmed")).toBe(true);
    expect(shouldLaunchdRestartCollector("capture_disabled")).toBe(false);
    expect(shouldLaunchdRestartCollector("capture_disabled_during_recovery")).toBe(false);
    expect(shouldLaunchdRestartCollector("hourly_target_missed")).toBe(true);
    expect(shouldLaunchdRestartCollector("max_scanned_reached", 1)).toBe(false);
    expect(isCollectorWindowBindingFailure("weixin_channels_window_not_found")).toBe(true);
    expect(isCollectorWindowBindingFailure("weixin_channels_required_window_not_found")).toBe(true);
    expect(isCollectorWindowBindingFailure("weixin_channels_comments_close_not_found")).toBe(false);
  });

  it("普通双窗失败自动重启，只有连续三次黑屏或同内容才触发网页暂停熔断", () => {
    const empty = { consecutiveBlackScreens: 0, consecutiveSameContent: 0, lastIdentityByWindow: {}, updatedAt: new Date(0).toISOString() };
    const first = nextCollectorRecoveryState(empty, {
      allBlack: true, allSameContent: false, identities: {}, stopReason: "window_failed",
    }, 1);
    const second = nextCollectorRecoveryState(first.state, {
      allBlack: true, allSameContent: false, identities: {}, stopReason: "window_failed",
    }, 2);
    const third = nextCollectorRecoveryState(second.state, {
      allBlack: true, allSameContent: false, identities: {}, stopReason: "window_failed",
    }, 3);
    expect(first.fuseReason).toBeUndefined();
    expect(second.fuseReason).toBeUndefined();
    expect(third.fuseReason).toBe("persistent_black_screen");
    expect(shouldLaunchdRestartCollector("dual_window_recoverable_failure")).toBe(true);
    expect(shouldLaunchdRestartCollector("capture_disabled_safety_fuse")).toBe(false);
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
    expect(representativeFrameNeedsSingleRetry({ ocrText: "网络加载中", entropy: 1, sharpness: 1, mean: 10 })).toBe(true);
    expect(representativeFrameNeedsSingleRetry({ ocrText: "AI工作流拆解", entropy: 5, sharpness: 8, mean: 120 })).toBe(false);
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

  it("播放器只接受明确总时长，小时看门狗低于五十会停止当前窗口并自动换源", () => {
    expect(parseVisibleVideoTotalDurationSeconds("01:12 / 03:40")).toBe(220);
    expect(parseVisibleVideoTotalDurationSeconds("总时长 02:06")).toBe(126);
    expect(parseVisibleVideoTotalDurationSeconds("当前 01:12")).toBeUndefined();
    expect(collectorWatchdogDecision(15 * 60_000, 11)).toBe("checkpoint_15");
    expect(collectorWatchdogDecision(30 * 60_000, 24)).toBe("checkpoint_30");
    expect(collectorWatchdogDecision(60 * 60_000, 49)).toBe("remediate");
    expect(collectorWatchdogDecision(60 * 60_000, 101)).toBe("rollover");
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
    expect(track.startX).toBeGreaterThanOrEqual(0.12);
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

  it("四项指标必须由连续两张截图确认，单次 OCR 高值不能触发采集", () => {
    const makeOcr = (values: string[]) => ({
      width: 483,
      height: 769,
      lines: values.map((text, index) => ({ text, confidence: 0.99, x: 0.52 + index * 0.12, y: 0.08, width: 0.06, height: 0.03 })),
    });
    const first = makeOcr(["8998", "12000", "3981", "361"]);
    expect(interactionMetricsConfirmed(first, makeOcr(["8999", "12000", "3981", "361"]))).toBe(true);
    expect(interactionMetricsConfirmed(first, makeOcr(["103", "80", "42", "14"]))).toBe(false);
    expect(interactionMetricsConfirmed(first, makeOcr(["8998", "12000", "3981"]))).toBe(false);
  });

  it("评论关闭后必须在四项恢复的同时证明仍是打开前的同一视频", () => {
    const makeOcr = (values: string[], title = "同一条视频", author = "同一作者") => ({
      width: 483,
      height: 769,
      lines: [
        ...values.map((text, index) => ({
          text, confidence: 0.99, x: 0.52 + index * 0.12, y: 0.08, width: 0.06, height: 0.03,
        })),
        { text: title, confidence: 0.99, x: 0.05, y: 0.12, width: 0.5, height: 0.03 },
        { text: author, confidence: 0.99, x: 0.12, y: 0.06, width: 0.16, height: 0.02 },
      ],
    });
    const base = makeOcr(["8998", "12000", "3981", "361"]);
    expect(commentsPanelClosedOnSameVideo(
      base,
      makeOcr(["8999", "12000", "3981", "361"]),
    )).toBe(true);
    expect(commentsPanelClosedOnSameVideo(
      base,
      makeOcr(["103", "80", "42", "14"], "下一条视频", "另一作者"),
    )).toBe(false);
    expect(commentsPanelClosedOnSameVideo(
      base,
      makeOcr(["8998", "12000", "3981"]),
    )).toBe(false);
  });

  it("五点抽查检出广告时在 pending 和上传前终止", () => {
    expect(sampledCapturePersistenceDisposition({
      advertisementDetected: true,
      qualified: false,
    })).toBe("reject_without_persist");
    expect(sampledCapturePersistenceDisposition({
      advertisementDetected: true,
      qualified: true,
    })).toBe("reject_without_persist");
    expect(sampledCapturePersistenceDisposition({
      advertisementDetected: false,
      qualified: true,
    })).toBe("persist");
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
    expect(findSearchSubmitPoint([
      { text: "搜尋", confidence: 1, x: 0.807, y: 0.878, width: 0.074, height: 0.024 },
    ])).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(findSearchButtonPoint([
      { text: "X视频号", confidence: 0.99, x: 0.44, y: 0.955, width: 0.12, height: 0.025 },
      { text: "X", confidence: 0.99, x: 0.67, y: 0.955, width: 0.025, height: 0.025 },
      { text: "Q", confidence: 0.7, x: 0.75, y: 0.952, width: 0.03, height: 0.03 },
    ])).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(findSearchButtonPoint([])).toBeNull();
    expect(WEIXIN_CHANNELS_SEARCH_BUTTON_POINT).toEqual({ x: 0.765, y: 0.026 });
    expect(WEIXIN_CHANNELS_SEARCH_INPUT_POINT).toEqual({ x: 0.58, y: 0.026 });
  });

  it("视频号只保留一个可复用搜索标签", () => {
    expect(shouldReuseExistingSearchTab(0)).toBe(false);
    expect(shouldReuseExistingSearchTab(1)).toBe(true);
    expect(shouldReuseExistingSearchTab(2)).toBe(true);
    expect(shouldReuseExistingSearchTab(3)).toBe(true);
  });

  it("主视频号组合标签不冒充搜索标签，搜索关闭点始终符合 Swift 硬门", () => {
    const line = (text: string, x: number, width = 0.08) => ({
      text, confidence: 0.99, x, y: 0.95, width, height: 0.03,
    });
    expect(findAnySearchTabPoint([line("视×", 0.58)])).toBeNull();
    expect(findAnySearchTabPoint([line("视频号×", 0.58)])).toBeNull();
    expect(findAnySearchTabPoint([line("三角洲×", 0.58)])).toMatchObject({
      x: expect.any(Number), y: expect.any(Number),
    });
    const close = findSearchTabClosePoint([line("×", 0.67, 0.02)]);
    expect(close?.x).toBeGreaterThanOrEqual(0.66);
    expect(close?.x).toBeLessThanOrEqual(0.72);
    expect(findSearchTabClosePoint([line("×", 0.58, 0.02)])).toBeNull();
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

  it("右窗窄布局仍能定位 x≈0.69 的影片标签", () => {
    expect(findSearchVideosTabPoint([
      { text: "影片", confidence: 0.99, x: 0.68, y: 0.82, width: 0.08, height: 0.03 },
    ])).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
  });

  it("页面切换采用短等待，把是否加载成功交给 OCR 轮询", async () => {
    const startedAt = Date.now();
    const delay = await waitForVisibleVideoLoad();
    const elapsed = Date.now() - startedAt;
    expect(delay).toBeGreaterThanOrEqual(450);
    expect(delay).toBeLessThanOrEqual(900);
    expect(elapsed).toBeGreaterThanOrEqual(400);
  }, 2_000);

  it("搜索首屏无高播时合并后续页面，不会把后页近期高播漏掉", () => {
    const merged = mergeSearchSortSummaries([
      {
        matchingCount: 2,
        recentMatchingCount: 0,
        newestMatchingAgeDays: 730,
        maxVisiblePlayCount: 50_000,
        recentHighPlayCount: 0,
        firstRecentHighPlayPoint: undefined,
        firstHighPlayPoint: undefined,
        firstMatchingPoint: { x: 0.2, y: 0.5 },
      },
      {
        matchingCount: 2,
        recentMatchingCount: 2,
        newestMatchingAgeDays: 5,
        maxVisiblePlayCount: 116_000,
        recentHighPlayCount: 1,
        firstRecentHighPlayPoint: { x: 0.7, y: 0.5 },
        firstHighPlayPoint: { x: 0.7, y: 0.5 },
        firstMatchingPoint: { x: 0.7, y: 0.5 },
      },
    ]);
    expect(merged).toMatchObject({
      matchingCount: 4,
      recentMatchingCount: 2,
      newestMatchingAgeDays: 5,
      maxVisiblePlayCount: 116_000,
      recentHighPlayCount: 1,
      firstRecentHighPlayPoint: { x: 0.7, y: 0.5 },
      firstHighPlayPoint: { x: 0.7, y: 0.5 },
    });
  });

  it("最热门数千播放的老视频可召回，但只点击当前页坐标", () => {
    expect(WEIXIN_CHANNELS_SEARCH_HIGH_PLAY_THRESHOLD).toBe(1_000);
    const current = summarizeSearchSort([
      { text: "2年前", confidence: 0.99, x: 0.06, y: 0.40, width: 0.12, height: 0.03 },
      { text: "6936", confidence: 0.99, x: 0.28, y: 0.46, width: 0.10, height: 0.03 },
    ], "陕西女人");
    expect(current.firstHighPlayPoint).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(selectCurrentHottestSearchResultPoint(current)).toEqual(current.firstHighPlayPoint);
    const staleMerged = { ...current, firstHighPlayPoint: { x: 0.2, y: 0.5 } };
    const emptyCurrent = { ...current, firstHighPlayPoint: undefined };
    expect(selectCurrentHottestSearchResultPoint(emptyCurrent)).toBeNull();
    expect(staleMerged.firstHighPlayPoint).not.toEqual(selectCurrentHottestSearchResultPoint(emptyCurrent));
    const advertisement = summarizeSearchSort([
      { text: "2年前", confidence: 0.99, x: 0.06, y: 0.40, width: 0.12, height: 0.03 },
      { text: "6936", confidence: 0.99, x: 0.28, y: 0.46, width: 0.10, height: 0.03 },
      { text: "广告", confidence: 0.99, x: 0.08, y: 0.44, width: 0.08, height: 0.03 },
    ], "陕西女人");
    expect(selectCurrentHottestSearchResultPoint(advertisement)).toBeNull();
  });

  it("搜索严格按最新优先、低流量再最热门、都无候选回推荐", () => {
    const empty = {
      matchingCount: 1,
      recentMatchingCount: 1,
      newestMatchingAgeDays: 2,
      maxVisiblePlayCount: 500,
      recentHighPlayCount: 0,
      firstRecentHighPlayPoint: undefined,
      firstHighPlayPoint: undefined,
      firstMatchingPoint: { x: 0.2, y: 0.5 },
    };
    const latest = {
      ...empty,
      maxVisiblePlayCount: 5_000,
      recentHighPlayCount: 1,
      firstRecentHighPlayPoint: { x: 0.3, y: 0.4 },
      firstHighPlayPoint: { x: 0.3, y: 0.4 },
    };
    expect(planSearchResultSelection({ latestCurrentPage: latest })).toEqual({
      action: "open",
      sourceSort: "latest",
      point: { x: 0.3, y: 0.4 },
    });
    expect(planSearchResultSelection({ latestCurrentPage: empty })).toEqual({ action: "inspect_hottest" });
    const hottest = { ...empty, firstHighPlayPoint: { x: 0.7, y: 0.6 }, maxVisiblePlayCount: 6_936 };
    expect(planSearchResultSelection({ latestCurrentPage: empty, hottestCurrentPage: hottest })).toEqual({
      action: "open",
      sourceSort: "hottest",
      point: { x: 0.7, y: 0.6 },
    });
    expect(planSearchResultSelection({ latestCurrentPage: empty, hottestCurrentPage: empty })).toEqual({
      action: "return_to_recommendation",
    });
    expect(shouldReturnToRecommendationAfterSearchError("weixin_channels_search_video_sorts_not_confirmed")).toBe(true);
    expect(shouldReturnToRecommendationAfterSearchError("weixin_channels_comments_open_not_confirmed")).toBe(false);
  });

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
    expect(findCommentsOpenPoint([{ text: "评论", confidence: 0.99, x: 0.1, y: 0.6, width: 0.1, height: 0.03 }])).toBeNull();
    expect(hasFourVisibleMetrics(metrics)).toBe(true);
    expect(shouldOpenVisibleComments(metrics)).toBe(true);
    expect(shouldOpenVisibleComments(metrics.map((line, index) => index === 3 ? { ...line, text: "3" } : line))).toBe(false);
    expect(shouldOpenVisibleComments(metrics.slice(0, 3))).toBe(false);
    const commentsOnly = ["822", "32", "321", "152"].map((text, index) => ({
      text,
      confidence: 0.99,
      x: 0.55 + index * 0.1,
      y: 0.1,
      width: 0.04,
      height: 0.03,
    }));
    expect(shouldOpenVisibleComments(commentsOnly)).toBe(false);
  });

  it("识别赞和收藏及搜索结果辅助页，禁止当成视频扫描", () => {
    const personalDataPage = [
      { text: "赞和收藏", confidence: 0.99, x: 0.07, y: 0.9, width: 0.15, height: 0.04 },
      { text: "浏览记录", confidence: 0.99, x: 0.07, y: 0.8, width: 0.15, height: 0.04 },
      { text: "我的视频号", confidence: 0.99, x: 0.07, y: 0.7, width: 0.15, height: 0.04 },
      { text: "视频号", confidence: 0.99, x: 0.4, y: 0.96, width: 0.12, height: 0.03 },
      { text: "赞", confidence: 0.99, x: 0.58, y: 0.96, width: 0.04, height: 0.03 },
    ];
    expect(isWeixinChannelsPersonalDataPage(personalDataPage)).toBe(true);
    expect(isWeixinChannelsAuxiliaryPage(personalDataPage)).toBe(true);
    expect(findPersonalDataTabClosePoint(personalDataPage)).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
    });
    expect(isWeixinChannelsPersonalDataPage([
      { text: "赞和收藏", confidence: 0.99, x: 0.07, y: 0.9, width: 0.15, height: 0.04 },
      { text: "浏览记录", confidence: 0.99, x: 0.07, y: 0.8, width: 0.15, height: 0.04 },
    ])).toBe(false);
    expect(findPersonalDataTabClosePoint([
      { text: "视频号", confidence: 0.99, x: 0.4, y: 0.96, width: 0.12, height: 0.03 },
    ])).toBeNull();
    expect(isWeixinChannelsAuxiliaryPage([
      { text: "全部", confidence: 0.99, x: 0.2, y: 0.8, width: 0.1, height: 0.04 },
      { text: "影片", confidence: 0.99, x: 0.4, y: 0.8, width: 0.1, height: 0.04 },
      { text: "问答", confidence: 0.99, x: 0.6, y: 0.8, width: 0.1, height: 0.04 },
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

  it("评论样本只来自右侧评论抽屉，左侧视频字幕不能冒充评论", () => {
    const lines = [
      { text: "评论 361", confidence: 0.99, x: 0.34, y: 0.92, width: 0.18, height: 0.04 },
      { text: "左侧视频字幕不是评论", confidence: 0.99, x: 0.05, y: 0.55, width: 0.22, height: 0.04 },
      { text: "这个工具怎么安装？", confidence: 0.99, x: 0.43, y: 0.55, width: 0.35, height: 0.04 },
      { text: "谭博 发表评论：", confidence: 0.99, x: 0.47, y: 0.03, width: 0.3, height: 0.04 },
    ];
    const panelLines = extractCommentPanelContentLines(lines);
    expect(panelLines.map((line) => line.text)).toEqual(["这个工具怎么安装？"]);
    expect(extractCommentSamples(panelLines)).toEqual([{ text: "这个工具怎么安装？", likeCount: undefined, signals: ["question"] }]);
  });

  it("评论作者的地区时间不是评论或点赞数", () => {
    const samples = extractCommentSamples([
      { text: "Magic 雲南 2天前", confidence: 0.99, x: 0.43, y: 0.61, width: 0.24, height: 0.03 },
      { text: "这是什么软件？", confidence: 0.99, x: 0.43, y: 0.57, width: 0.2, height: 0.03 },
    ]);
    expect(samples).toEqual([{ text: "这是什么软件？", likeCount: undefined, signals: ["question"] }]);
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
    expect(pendingObservationHasRequiredComments({
      likes: 3_000, shares: 2_000, favorites: 100, comments: 79,
    })).toBe(true);
    expect(pendingObservationHasRequiredComments({
      likes: 3_000, shares: 2_000, favorites: 100, comments: 80, commentSamples: [],
    })).toBe(false);
    expect(pendingObservationHasRequiredComments({
      likes: 3_000, shares: 2_000, favorites: 100, comments: 80,
      commentSamples: [{ text: "真实评论" }],
    })).toBe(true);
    expect(pendingObservationHasRequiredComments({
      likes: 822, shares: 32, favorites: 321, comments: 152,
    })).toBe(false);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wxc-missing-comments-"));
    const pending = path.join(dir, "weixin-channels-pending-invalid.json");
    await fs.writeFile(pending, JSON.stringify({
      taskId: "task-invalid", likes: 3_000, shares: 2_000, favorites: 100,
      comments: 558, commentSamples: [], captureElapsedMs: 1_000, videoDurationSec: 60,
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
      taskId: "task-eligible", likes: 3_000, shares: 2_000, favorites: 100, comments: 12,
      videoDurationSec: 274, captureBudgetMs: 27_400, captureElapsedMs: 27_442,
    }));
    await fs.writeFile(path.join(quarantine, excessiveName), JSON.stringify({
      taskId: "task-excessive", likes: 3_000, shares: 2_000, favorites: 100, comments: 12,
      videoDurationSec: 60, captureBudgetMs: 25_000, captureElapsedMs: 25_001,
    }));
    expect(await restoreEligibleQuarantinedObservations(dir)).toEqual({ found: 2, restored: 1 });
    await expect(fs.stat(path.join(dir, eligibleName))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(quarantine, excessiveName))).resolves.toBeTruthy();

    await fs.writeFile(path.join(dir, "weixin-channels-pending-second.json"), JSON.stringify({
      taskId: "task-second", videoDurationSec: 60, captureBudgetMs: 25_000, captureElapsedMs: 7_000,
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
        { taskId: "ai", sourcePlatform: "xiaohongshu", category: "AI工具", searchQueries: ["AI工作流", "AI工具实测"], sourceTitle: "普通人AI工作流" },
        { taskId: "career", sourcePlatform: "douyin", category: "职场", searchQueries: ["普通人副业方法", "升职方法"], sourceTitle: "职场方法" },
        { taskId: "drama", sourcePlatform: "douyin", category: "娱乐", searchQueries: ["短剧免费看", "男频爽文全集"], sourceTitle: "短剧" },
      ],
      seedQueries: ["AI工作流"],
      recentlyUsed: ["AI工作流"],
      limit: 10,
    });
    expect(queries).toEqual(["副业方法", "AI工具实测", "升职方法", "AI工作流"]);
    expect(queries.join(" ")).not.toMatch(/短剧|爽文|免费看/);
  });

  it("热词剔除空泛教程并把 AI 新手长句压成具体主题", () => {
    const queries = buildDiverseCollectorSearchQueries({
      candidates: [{
        taskId: "ai",
        sourcePlatform: "xiaohongshu",
        category: "AI工具",
        searchQueries: ["内有教程", "AI漫剧新手小白教程", "AI工作流"],
      }],
      limit: 10,
    });
    expect(queries).toEqual(["AI漫剧教程", "AI工作流"]);
  });

  it("热词硬拒绝平台内部哈希和纯数字 ID", () => {
    expect(buildDiverseCollectorSearchQueries({
      candidates: [{
        taskId: "bad-id",
        sourcePlatform: "douyin",
        category: "娱乐",
        sourceTitle: "素材 (6)_760989efc2",
        searchQueries: ["_760989efc2", "1234567890", "小猪看病"],
      }],
    })).toEqual(["小猪看病"]);
  });

  it("搜索词统一压缩为四至六字核心名词", () => {
    expect(compactCollectorSearchQuery("聊聊这家公司的价值观")).toBe("公司价值观");
    expect(compactCollectorSearchQuery("陕西女人真牛")).toBe("陕西女人牛");
    expect(compactCollectorSearchQuery("AI工具实测")).toBe("AI工具实测");
    expect(compactCollectorSearchQuery("谁考虑过鱼感")).toBeUndefined();
    expect(compactCollectorSearchQuery("无所谓")).toBeUndefined();
    expect(compactCollectorSearchQuery("词一")).toBeUndefined();
    expect(collectorSearchQueryVariants("陕西女人真牛")).toEqual(["陕西女人牛", "陕西女人"]);
    expect(collectorSearchQueryVariants("聊聊这家公司的价值观")).toEqual([
      "公司价值观", "企业价值观", "企业文化",
    ]);
  });

  it("未取得 OCR 和终态证据时底层禁止滑到下一条", () => {
    expect(collectorAdvanceAllowed({ metricsOcrConfirmed: false, captureState: "persisted" })).toBe(false);
    expect(collectorAdvanceAllowed({ metricsOcrConfirmed: true, captureState: "retryable_failed" })).toBe(false);
    expect(collectorAdvanceAllowed({ metricsOcrConfirmed: true, captureState: "persisted" })).toBe(true);
    expect(collectorAdvanceAllowed({ metricsOcrConfirmed: true, captureState: "terminal_unqualified" })).toBe(true);
  });

  it("不会只取每个类目前三个热词，后续七天新词也进入轮换", () => {
    const queries = buildDiverseCollectorSearchQueries({
      candidates: [{
        taskId: "ai",
        sourcePlatform: "xiaohongshu",
        category: "AI工具",
        searchQueries: ["热词一号", "热词二号", "热词三号", "热词四号", "热词五号", "热词六号"],
      }],
      recentlyUsed: ["热词一号", "热词二号"],
      limit: 6,
    });
    expect(queries).toEqual(["热词三号", "热词四号", "热词五号", "热词六号", "热词一号", "热词二号"]);
  });

  it("进度抽查时四项指标必须仍属于同一视频", () => {
    const base = { likes: 4_855, shares: 1_766, favorites: 1_997, comments: 254, rawText: [] };
    expect(metricsRemainOnSameVideo(base, { likes: 4_856, shares: 1_766, favorites: 1_997, comments: 254, rawText: [] })).toBe(true);
    expect(metricsRemainOnSameVideo(base, { likes: 34_000, shares: 27_000, favorites: 9_726, comments: 2_147, rawText: [] })).toBe(false);
    expect(metricsRemainOnSameVideo(base, { likes: 4_856, shares: 1_766, favorites: undefined, comments: undefined, rawText: [] })).toBe(true);
    expect(metricsRemainOnSameVideo(base, { likes: 4_856, shares: undefined, favorites: undefined, comments: undefined, rawText: [] })).toBe(false);
  });

  it("切换视频需排除同一高热视频互动数的自然小幅增长", () => {
    const makeOcr = (title: string, likes: string, comments = "254") => ({
      width: 483,
      height: 769,
      lines: [
        { text: title, confidence: 0.99, x: 0.05, y: 0.12, width: 0.42, height: 0.04 },
        { text: "工具研究所", confidence: 0.99, x: 0.05, y: 0.07, width: 0.18, height: 0.03 },
        ...[likes, "1766", "1997", comments].map((text, index) => ({ text, confidence: 0.99, x: 0.52 + index * 0.12, y: 0.08, width: 0.06, height: 0.03 })),
      ],
    });
    const before = makeOcr("AI工作流实测", "4855");
    expect(hasConfirmedVideoTransition(before, makeOcr("AI工作流实测", "4856"))).toBe(false);
    expect(hasConfirmedVideoTransition(before, makeOcr("另一条视频", "34000", "2147"))).toBe(true);
  });
});
