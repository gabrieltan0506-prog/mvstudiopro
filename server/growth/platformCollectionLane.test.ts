import { describe, expect, it } from "vitest";
import {
  createGrowthPlatformCollectionLane,
  resolveGrowthPlatformCollectionGapMs,
} from "./platformCollectionLane";

describe("growth platform collection lane", () => {
  it("把配置硬限制在三到五分钟，默认四分钟", () => {
    expect(resolveGrowthPlatformCollectionGapMs(undefined)).toBe(4 * 60 * 1000);
    expect(resolveGrowthPlatformCollectionGapMs("1000")).toBe(3 * 60 * 1000);
    expect(resolveGrowthPlatformCollectionGapMs(String(9 * 60 * 1000))).toBe(5 * 60 * 1000);
  });

  it("跨 scheduler/live/backfill 严格串行，并在任务结束后间隔四分钟", async () => {
    let clock = 1_000;
    const events: string[] = [];
    const lane = createGrowthPlatformCollectionLane({
      gapMs: 4 * 60 * 1000,
      now: () => clock,
      sleep: async (delayMs) => {
        events.push(`sleep:${delayMs}`);
        clock += delayMs;
      },
    });

    const first = lane("douyin", "scheduler", async () => {
      events.push("douyin:start");
      clock += 5_000;
      events.push("douyin:end");
    });
    const second = lane("xiaohongshu", "backfill", async () => {
      events.push("xiaohongshu:start");
      clock += 2_000;
      events.push("xiaohongshu:end");
    });
    const third = lane("bilibili", "live", async () => {
      events.push("bilibili:start");
      events.push("bilibili:end");
    });

    await Promise.all([first, second, third]);
    expect(events).toEqual([
      "douyin:start",
      "douyin:end",
      "sleep:240000",
      "xiaohongshu:start",
      "xiaohongshu:end",
      "sleep:240000",
      "bilibili:start",
      "bilibili:end",
    ]);
  });
});

