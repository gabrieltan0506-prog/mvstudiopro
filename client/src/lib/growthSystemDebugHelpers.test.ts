import { describe, expect, it } from "vitest";
import {
  GROWTH_BURST_PLATFORMS,
  GROWTH_DEBUG_PLATFORMS,
  isRecentGrowthPlatformTimeout,
} from "./growthSystemDebugHelpers";

describe("growth debug platform scope", () => {
  it("只保留三条 Fly 抓取链和四个平台 Debug", () => {
    expect(GROWTH_BURST_PLATFORMS).toEqual(["douyin", "bilibili", "xiaohongshu"]);
    expect(GROWTH_DEBUG_PLATFORMS).toEqual(["douyin", "xiaohongshu", "bilibili", "weixin_channels"]);
    expect(GROWTH_DEBUG_PLATFORMS).not.toContain("kuaishou");
    expect(GROWTH_DEBUG_PLATFORMS).not.toContain("toutiao");
  });

  it("平台超时只显示三十秒，普通失败不显示", () => {
    const now = Date.parse("2026-08-16T02:40:00.000Z");
    expect(isRecentGrowthPlatformTimeout({
      lastFailureAt: "2026-08-16T02:39:45.000Z",
      lastError: "timed out after 120000ms",
    }, now)).toBe(true);
    expect(isRecentGrowthPlatformTimeout({
      lastFailureAt: "2026-08-16T02:39:29.000Z",
      lastError: "timed out after 120000ms",
    }, now)).toBe(false);
    expect(isRecentGrowthPlatformTimeout({
      lastFailureAt: "2026-08-16T02:39:50.000Z",
      lastError: "HTTP 403",
    }, now)).toBe(false);
  });
});
