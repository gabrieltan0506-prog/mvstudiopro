import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_STORE_DIR = process.env.GROWTH_STORE_DIR;

describe("trend scheduler state persistence", () => {
  let tempRoot = "";

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "growth-scheduler-state-"));
    process.env.GROWTH_STORE_DIR = tempRoot;
    process.env.GROWTH_DISABLE_STORE_LAYOUT_MIGRATE = "1";
  });

  afterEach(async () => {
    if (ORIGINAL_STORE_DIR) process.env.GROWTH_STORE_DIR = ORIGINAL_STORE_DIR;
    else delete process.env.GROWTH_STORE_DIR;
    delete process.env.GROWTH_DISABLE_STORE_LAYOUT_MIGRATE;
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("并行控制面写入不会互相覆盖不同平台状态", async () => {
    const { readTrendSchedulerState, updateTrendSchedulerState } = await import("./trendStore");

    await Promise.all([
      updateTrendSchedulerState("douyin", { nextRunAt: "2028-01-01T00:00:00.000Z" }),
      updateTrendSchedulerState("xiaohongshu", { nextRunAt: "2028-01-01T00:04:00.000Z" }),
      updateTrendSchedulerState("bilibili", { nextRunAt: "2028-01-01T00:08:00.000Z" }),
      updateTrendSchedulerState("weixin_channels", { lastAddedCount: 3 }),
    ]);

    const scheduler = await readTrendSchedulerState();
    expect(scheduler.douyin?.nextRunAt).toBe("2028-01-01T00:00:00.000Z");
    expect(scheduler.xiaohongshu?.nextRunAt).toBe("2028-01-01T00:04:00.000Z");
    expect(scheduler.bilibili?.nextRunAt).toBe("2028-01-01T00:08:00.000Z");
    expect(scheduler.weixin_channels?.lastAddedCount).toBe(3);
  });
});
