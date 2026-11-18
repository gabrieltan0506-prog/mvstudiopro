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

  it("旧累计值只清一次，保留调度退避与后续新增失败", async () => {
    const { resetLegacyGrowthFailureTotals, readTrendSchedulerState, updateTrendSchedulerState } = await import("./trendStore");
    await fs.writeFile(path.join(tempRoot, "runtime-scheduler.json"), JSON.stringify({
      value: { douyin: { platform: "douyin", failureCount: 3, totalFailures: 85, totalRuns: 120 } },
    }));
    await resetLegacyGrowthFailureTotals();
    expect((await readTrendSchedulerState()).douyin).toMatchObject({ failureCount: 3, totalFailures: 0, totalRuns: 120 });
    await Promise.all([
      updateTrendSchedulerState("douyin", {}, { incrementFailureTotal: true }),
      updateTrendSchedulerState("douyin", {}, { incrementFailureTotal: true }),
    ]);
    await resetLegacyGrowthFailureTotals();
    expect((await readTrendSchedulerState()).douyin?.totalFailures).toBe(2);
  });

  it("启动迁移晚于首次失败时保留新失败", async () => {
    const { resetLegacyGrowthFailureTotals, readTrendSchedulerState, updateTrendSchedulerState } = await import("./trendStore");
    await fs.writeFile(path.join(tempRoot, "runtime-scheduler.json"), JSON.stringify({
      value: { weixin_channels: { platform: "weixin_channels", failureCount: 3, totalFailures: 85 } },
    }));
    await updateTrendSchedulerState("weixin_channels", {}, { incrementFailureTotal: true });
    await resetLegacyGrowthFailureTotals();
    expect((await readTrendSchedulerState()).weixin_channels?.totalFailures).toBe(1);
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
