import { describe, expect, it } from "vitest";
import {
  GROWTH_BURST_PLATFORMS,
  GROWTH_DEBUG_PLATFORMS,
  getGrowthNoNewDataState,
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

  it("按真实新增时间在满 24 小时后告警", () => {
    const now = Date.parse("2026-08-16T02:40:00.000Z");
    expect(getGrowthNoNewDataState("2026-08-15T02:40:01.000Z", now)).toEqual({
      status: "fresh",
      ageMs: 86_399_000,
      basis: "new-data",
    });
    expect(getGrowthNoNewDataState("2026-08-15T02:40:00.000Z", now)).toEqual({
      status: "stale",
      ageMs: 86_400_000,
      basis: "new-data",
    });
  });

  it("缺少或异常基线时明确返回 unknown，不制造假告警", () => {
    const now = Date.parse("2026-08-16T02:40:00.000Z");
    expect(getGrowthNoNewDataState(undefined, now)).toEqual({ status: "unknown", ageMs: null, basis: "none" });
    expect(getGrowthNoNewDataState("invalid", now)).toEqual({ status: "unknown", ageMs: null, basis: "none" });
    expect(getGrowthNoNewDataState("2026-08-17T02:40:00.000Z", now)).toEqual({
      status: "unknown",
      ageMs: null,
      basis: "none",
    });
  });

  it("从未记录真实新增时也按固定监测起点在 24 小时后告警", () => {
    const now = Date.parse("2026-08-16T02:40:00.000Z");
    expect(getGrowthNoNewDataState(undefined, now, undefined, "2026-08-15T02:40:00.000Z")).toEqual({
      status: "stale",
      ageMs: 86_400_000,
      basis: "monitoring",
    });
  });
});
