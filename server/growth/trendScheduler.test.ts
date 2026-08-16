import { describe, expect, it } from "vitest";

import {
  resolveLastNewDataAt,
  resolveNextRunPlan,
  resolveNewDataMonitoringStartedAt,
  runPostMergeCoverEnhancement,
  resolveTimeoutCooldownGate,
  resolvePlatformRunTimeoutMs,
  resolvePreviousRunCollectedCount,
  shouldClearBurstStatesBecauseDisabled,
} from "./trendScheduler";

describe("trendScheduler burst runtime", () => {
  it("核心数据已 merge 后，前台抢占只跳过封面增强，不把真实采集轮次改记为暂停", async () => {
    const outcome = await runPostMergeCoverEnhancement(async () => {
      throw new Error("growth_background_paused_for_interactive_workload");
    });
    expect(outcome).toMatchObject({
      ok: false,
      priorityAborted: true,
    });
  });

  it("忽略覆盖为 60 秒的旧抖音 secret，保留正式 180 秒下限", () => {
    expect(resolvePlatformRunTimeoutMs("douyin", {
      preferred: "60000",
      fallback: "30000",
    })).toBe(180_000);
    expect(resolvePlatformRunTimeoutMs("douyin", {
      preferred: "240000",
      fallback: "30000",
    })).toBe(240_000);
  });

  it("不改变 B 站和小红书各自已生效的超时配置", () => {
    expect(resolvePlatformRunTimeoutMs("bilibili", {
      preferred: "120000",
      fallback: "30000",
    })).toBe(120_000);
    expect(resolvePlatformRunTimeoutMs("xiaohongshu", {
      preferred: "60000",
      fallback: "30000",
    })).toBe(60_000);
  });

  it("只有显式 off 才清空 burst，auto 和 manual 都不是 disabled", () => {
    expect(shouldClearBurstStatesBecauseDisabled("auto")).toBe(false);
    expect(shouldClearBurstStatesBecauseDisabled("manual")).toBe(false);
    expect(shouldClearBurstStatesBecauseDisabled("off")).toBe(true);
  });

  it("burst 关闭后高增量也不能自动重开，手动模式未选平台同样保持关闭", () => {
    const base = {
      platform: "douyin" as const,
      currentCount: 500,
      previousCount: 100,
      burstMode: false,
      burstStableRuns: 0,
      burstLowYieldRuns: 0,
    };
    expect(resolveNextRunPlan({ ...base, burstControl: "off" })).toMatchObject({
      burstMode: false,
      burstEvent: "none",
    });
    expect(resolveNextRunPlan({ ...base, burstControl: "manual" })).toMatchObject({
      burstMode: false,
      burstEvent: "none",
    });
  });

  it("只有真实新增才刷新 24 小时监测基线，零新增保留旧时间", () => {
    expect(resolveLastNewDataAt({
      addedCount: 3,
      collectedAt: "2026-08-16T10:00:00.000Z",
      lastNewDataAt: "2026-08-15T10:00:00.000Z",
    })).toBe("2026-08-16T10:00:00.000Z");
    expect(resolveLastNewDataAt({
      addedCount: 0,
      collectedAt: "2026-08-16T10:00:00.000Z",
      lastNewDataAt: "2026-08-15T10:00:00.000Z",
    })).toBe("2026-08-15T10:00:00.000Z");
    expect(resolveLastNewDataAt({
      addedCount: 0,
      collectedAt: "2026-08-16T10:00:00.000Z",
      lastAddedCount: 19,
      lastSuccessAt: "2026-08-08T10:00:00.000Z",
    })).toBe("2026-08-08T10:00:00.000Z");
  });

  it("自动 burst 使用相邻两轮采集量，不拿仓库总量作比较", () => {
    expect(resolvePreviousRunCollectedCount({
      lastCollectedCount: 593_829,
      lastAfterWindowFilterCount: 100,
    })).toBe(100);
    expect(resolveNextRunPlan({
      platform: "xiaohongshu",
      currentCount: 125,
      previousCount: 100,
      burstMode: false,
      burstStableRuns: 0,
      burstLowYieldRuns: 0,
    })).toMatchObject({ burstMode: true, burstEvent: "enter", frequencyLabel: "15 分钟一次" });
  });

  it("连续失败时固定无新增监测起点，不随每轮尝试后移", () => {
    expect(resolveNewDataMonitoringStartedAt({
      monitoringStartedAt: "2026-08-15T00:00:00.000Z",
      lastRunAt: "2026-08-16T00:00:00.000Z",
      startedAt: "2026-08-16T01:00:00.000Z",
    })).toBe("2026-08-15T00:00:00.000Z");
    expect(resolveNewDataMonitoringStartedAt({
      lastRunAt: "2026-08-08T00:00:00.000Z",
      startedAt: "2026-08-16T01:00:00.000Z",
    })).toBe("2026-08-08T00:00:00.000Z");
  });

  it("旧四小时超时状态会按失败时间钳位到十分钟，过期后立即放行", () => {
    const failedAtMs = Date.parse("2026-08-16T10:00:00.000Z");
    const legacy = {
      lastError: "[growth.scheduler] douyin timed out after 180000ms",
      lastFailureAt: new Date(failedAtMs).toISOString(),
      nextRunAt: new Date(failedAtMs + 4 * 60 * 60 * 1000).toISOString(),
      timeoutStreak: 3,
    };
    expect(resolveTimeoutCooldownGate(legacy, failedAtMs + 5 * 60 * 1000)).toEqual({
      active: true,
      shouldNormalize: true,
      normalizedUntilMs: failedAtMs + 10 * 60 * 1000,
    });
    expect(resolveTimeoutCooldownGate(legacy, failedAtMs + 11 * 60 * 1000)).toEqual({
      active: false,
      shouldNormalize: true,
      normalizedUntilMs: failedAtMs + 10 * 60 * 1000,
    });

    expect(resolveTimeoutCooldownGate({
      ...legacy,
      lastError: undefined,
      timeoutCooldownUntil: legacy.nextRunAt,
    }, failedAtMs + 5 * 60 * 1000)).toEqual({
      active: true,
      shouldNormalize: true,
      normalizedUntilMs: failedAtMs + 10 * 60 * 1000,
    });
  });
});
