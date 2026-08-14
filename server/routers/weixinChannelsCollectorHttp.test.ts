import { afterEach, describe, expect, it } from "vitest";
import { verifyWeixinChannelsCollectorToken, weixinChannelsObservationSchema } from "./weixinChannelsCollectorHttp";

describe("weixinChannelsCollectorHttp", () => {
  afterEach(() => {
    delete process.env.WEIXIN_CHANNELS_COLLECTOR_TOKEN;
  });

  it("未配置令牌时安全拒绝", () => {
    expect(verifyWeixinChannelsCollectorToken("anything")).toBe(false);
  });

  it("只接受完全一致的采集令牌", () => {
    process.env.WEIXIN_CHANNELS_COLLECTOR_TOKEN = "real-local-token";
    expect(verifyWeixinChannelsCollectorToken("real-local-token")).toBe(true);
    expect(verifyWeixinChannelsCollectorToken("real-local-token-x")).toBe(false);
  });

  it("允许视频时长十分之一加两秒抖动，并拒绝客户端抬高预算", () => {
    const base = {
      observationId: "observation-1", videoIdentity: "a".repeat(64), taskId: "task-123", query: "AI视频", resultRank: 1,
      title: "AI视频教程", observedAt: "2026-08-14T00:00:00.000Z",
      likes: 3_000, shares: 2_000, comments: 10, evidence: "capture" as const,
      videoDurationSec: 60, captureBudgetMs: 8_000,
    };
    expect(weixinChannelsObservationSchema.safeParse({ ...base, captureElapsedMs: 7_999 }).success).toBe(true);
    expect(weixinChannelsObservationSchema.safeParse({ ...base, videoIdentity: "not-a-stable-id", captureElapsedMs: 7_999 }).success).toBe(false);
    expect(weixinChannelsObservationSchema.safeParse({ ...base, captureElapsedMs: 8_001 }).success).toBe(false);
    expect(weixinChannelsObservationSchema.safeParse({ ...base, captureBudgetMs: 10_000, captureElapsedMs: 7_000 }).success).toBe(false);
  });

  it("广告视频即使评论数达到门槛也不要求打开评论区", () => {
    const result = weixinChannelsObservationSchema.safeParse({
      observationId: "advertisement-1",
      taskId: "task-123",
      query: "AI视频",
      resultRank: 1,
      title: "AI工具推广",
      observedAt: "2026-08-14T00:00:00.000Z",
      likes: 8_998,
      shares: 12_000,
      comments: 361,
      ocrTexts: ["本内容包含 广告 推广"],
      evidence: "capture",
    });

    expect(result.success).toBe(true);
  });

  it("非广告视频评论数达到门槛时仍必须提供真实评论", () => {
    const result = weixinChannelsObservationSchema.safeParse({
      observationId: "organic-video-1",
      taskId: "task-123",
      query: "AI视频",
      resultRank: 1,
      title: "AI视频教程",
      observedAt: "2026-08-14T00:00:00.000Z",
      likes: 8_998,
      shares: 12_000,
      comments: 80,
      ocrTexts: ["AI视频制作教程"],
      evidence: "capture",
    });

    expect(result.success).toBe(false);
  });

  it("接受有真实语义的代表画面元数据，不再假称视频号原始封面", () => {
    const result = weixinChannelsObservationSchema.safeParse({
      observationId: "visual-frame-1", videoIdentity: "a".repeat(64), taskId: "task-123", query: "AI视频", resultRank: 1,
      title: "AI视频教程", observedAt: "2026-08-14T00:00:00.000Z", likes: 3_000, shares: 2_000, comments: 10,
      evidence: "capture", visualImageBase64: "a".repeat(100), visualAssetKind: "representative_frame", visualFrameProgress: 0.5,
    });
    expect(result.success).toBe(true);
  });
});
