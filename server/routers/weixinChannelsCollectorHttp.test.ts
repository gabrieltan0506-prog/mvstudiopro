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

  it("拒绝超过视频时长十分之一预算的采集记录", () => {
    const base = {
      observationId: "observation-1", taskId: "task-123", query: "AI视频", resultRank: 1,
      title: "AI视频教程", observedAt: "2026-08-14T00:00:00.000Z",
      likes: 3_000, shares: 2_000, comments: 10, evidence: "capture" as const,
      videoDurationSec: 60, captureBudgetMs: 6_000,
    };
    expect(weixinChannelsObservationSchema.safeParse({ ...base, captureElapsedMs: 5_999 }).success).toBe(true);
    expect(weixinChannelsObservationSchema.safeParse({ ...base, captureElapsedMs: 6_001 }).success).toBe(false);
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
});
