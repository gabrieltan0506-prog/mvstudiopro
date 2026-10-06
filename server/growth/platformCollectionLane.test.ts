import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createGrowthPlatformCollectionLane,
  resolveGrowthPlatformCollectionGapMs,
  runInGrowthPlatformCollectionLane,
  waitForGrowthCollectionGapOrDefer,
} from "./platformCollectionLane";
import {
  beginGrowthInteractiveWorkload,
  GROWTH_BACKGROUND_DEFERRED_BEFORE_COLLECTION_START,
} from "./growthWorkloadPriority";

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

  it("跨进程间隔等待结束后复检前台任务，出现前台任务时不启动后台 work", async () => {
    const checks = [false, true];
    const sleeps: number[] = [];
    const ready = await waitForGrowthCollectionGapOrDefer({
      remainingMs: 4 * 60 * 1000,
      hasActiveWorkload: () => checks.shift() ?? true,
      sleep: async (delayMs) => {
        sleeps.push(delayMs);
      },
    });
    expect(ready).toBe(false);
    expect(sleeps).toEqual([4 * 60 * 1000]);
    expect(checks).toEqual([]);
  });

  it("前台租约探针失败时按未开工让路，而不是冒险启动后台", async () => {
    await expect(waitForGrowthCollectionGapOrDefer({
      remainingMs: 0,
      hasActiveWorkload: async () => {
        throw new Error("lease probe unavailable");
      },
    })).rejects.toThrow(`${GROWTH_BACKGROUND_DEFERRED_BEFORE_COLLECTION_START}:priority_probe_failed`);
  });

  it("真正开工前为前台让路时不伪造完成时间，避免后台任务被反复延后", async () => {
    let clock = 1_000;
    const sleeps: number[] = [];
    const lane = createGrowthPlatformCollectionLane({
      gapMs: 4 * 60 * 1000,
      now: () => clock,
      sleep: async (delayMs) => {
        sleeps.push(delayMs);
        clock += delayMs;
      },
    });
    await lane("douyin", "scheduler", async () => undefined);
    clock += 4 * 60 * 1000;
    await expect(lane("xiaohongshu", "backfill", async () => {
      throw new Error(GROWTH_BACKGROUND_DEFERRED_BEFORE_COLLECTION_START);
    })).rejects.toThrow(GROWTH_BACKGROUND_DEFERRED_BEFORE_COLLECTION_START);
    clock += 1;
    await lane("bilibili", "live", async () => undefined);
    expect(sleeps).toEqual([]);
  });

  it("跨进程锁内发现前台租约时释放锁，且不落盘伪造的 collection 完成状态", async () => {
    const originalStoreDir = process.env.GROWTH_STORE_DIR;
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "growth-lane-priority-"));
    process.env.GROWTH_STORE_DIR = tempRoot;
    const release = await beginGrowthInteractiveWorkload("platform-job:test");
    let workStarted = false;
    try {
      await expect(runInGrowthPlatformCollectionLane("douyin", "scheduler", async () => {
        workStarted = true;
      })).rejects.toThrow(GROWTH_BACKGROUND_DEFERRED_BEFORE_COLLECTION_START);
      expect(workStarted).toBe(false);
      await expect(fs.access(path.join(tempRoot, ".growth-platform-collection.lock"))).rejects.toThrow();
      await expect(fs.access(path.join(tempRoot, ".growth-platform-collection-state.json"))).rejects.toThrow();
    } finally {
      await release();
      if (originalStoreDir) process.env.GROWTH_STORE_DIR = originalStoreDir;
      else delete process.env.GROWTH_STORE_DIR;
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("跨进程完成状态不可读时安全让行，不把未知状态当成零间隔", async () => {
    const originalStoreDir = process.env.GROWTH_STORE_DIR;
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "growth-lane-state-read-"));
    process.env.GROWTH_STORE_DIR = tempRoot;
    const statePath = path.join(tempRoot, ".growth-platform-collection-state.json");
    await fs.mkdir(statePath);
    let workStarted = false;
    try {
      await expect(runInGrowthPlatformCollectionLane("douyin", "scheduler", async () => {
        workStarted = true;
      })).rejects.toThrow(
        `${GROWTH_BACKGROUND_DEFERRED_BEFORE_COLLECTION_START}:collection_state_read_failed`,
      );
      expect(workStarted).toBe(false);
      await expect(fs.access(path.join(tempRoot, ".growth-platform-collection.lock"))).rejects.toThrow();
    } finally {
      if (originalStoreDir) process.env.GROWTH_STORE_DIR = originalStoreDir;
      else delete process.env.GROWTH_STORE_DIR;
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
