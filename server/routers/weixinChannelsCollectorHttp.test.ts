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
});
