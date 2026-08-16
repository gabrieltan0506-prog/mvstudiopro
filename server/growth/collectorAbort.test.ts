import { describe, expect, it } from "vitest";
import {
  buildTimeoutCooldownMs,
  formatTimeoutCooldownLabel,
  getCollectorAbortSignal,
  getCollectorTimeRemainingMs,
  isSchedulerTimeoutOrAbortError,
  runWithCollectorAbort,
  runWithOptionalCollectorAbortSignal,
  withAbortableTimeout,
} from "./collectorAbort";

describe("collectorAbort", () => {
  it("超时后 abort signal，并停止后续等待", async () => {
    let sawAbort = false;
    const started = Date.now();
    await expect(
      withAbortableTimeout(async (signal) => {
        signal.addEventListener("abort", () => {
          sawAbort = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return "late";
      }, 80, "[test] slow"),
    ).rejects.toThrow(/timed out after 80ms/);
    expect(sawAbort).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("运行模式切换可以主动中止尚未完成的 backfill 采集", async () => {
    const external = new AbortController();
    const running = withAbortableTimeout(
      async (signal) => {
        await new Promise<void>((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted by mode switch")), { once: true });
          setTimeout(resolve, 10_000);
        });
        return "unexpected";
      },
      20_000,
      "backfill",
      { signal: external.signal },
    );
    external.abort();
    await expect(running).rejects.toThrow(/aborted/i);
  });

  it("前台平台指令出现后会中止后台采集并让出资源", async () => {
    let foregroundActive = false;
    const running = withAbortableTimeout(
      async (signal) => {
        await new Promise<void>((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("collector stopped")), { once: true });
          setTimeout(resolve, 10_000);
        });
        return "unexpected";
      },
      20_000,
      "scheduler",
      {
        abortWhen: () => foregroundActive,
        abortPollMs: 10,
      },
    );
    foregroundActive = true;
    await expect(running).rejects.toThrow(/interactive_workload/);
  });

  it("前台租约探针异常时安全暂停后台，不产生未处理 rejection", async () => {
    const running = withAbortableTimeout(
      async (signal) => {
        await new Promise<void>((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("collector stopped")), { once: true });
          setTimeout(resolve, 10_000);
        });
        return "unexpected";
      },
      20_000,
      "scheduler",
      {
        abortWhen: async () => {
          throw new Error("lease directory unavailable");
        },
        abortPollMs: 10,
      },
    );
    await expect(running).rejects.toThrow(/priority_probe_failed/);
  });

  it("AsyncLocalStorage 在采集上下文中可取到 signal", async () => {
    const controller = new AbortController();
    const seen = await runWithCollectorAbort(controller.signal, async () => {
      return getCollectorAbortSignal() === controller.signal;
    });
    expect(seen).toBe(true);
  });

  it("公共采集入口的显式 signal 会进入取消上下文", async () => {
    const controller = new AbortController();
    const seen = await runWithOptionalCollectorAbortSignal(controller.signal, async () => (
      getCollectorAbortSignal() === controller.signal
    ));
    expect(seen).toBe(true);
  });

  it("向采集器暴露剩余预算，供可选路由给核心结果让路", async () => {
    const controller = new AbortController();
    const now = Date.now();
    const remaining = await runWithCollectorAbort(
      controller.signal,
      async () => getCollectorTimeRemainingMs(now),
      { deadlineMs: now + 180_000 },
    );
    expect(remaining).toBe(180_000);
    expect(getCollectorTimeRemainingMs(now)).toBeUndefined();
  });

  it("连续超时只冷却固定 10 分钟，并识别超时错误", () => {
    expect(buildTimeoutCooldownMs(1)).toBe(10 * 60 * 1000);
    expect(buildTimeoutCooldownMs(2)).toBe(10 * 60 * 1000);
    expect(buildTimeoutCooldownMs(3)).toBe(10 * 60 * 1000);
    expect(buildTimeoutCooldownMs(99)).toBe(10 * 60 * 1000);
    expect(formatTimeoutCooldownLabel(10 * 60 * 1000)).toContain("10 分钟");
    expect(
      isSchedulerTimeoutOrAbortError(
        new Error("[growth.scheduler] douyin timed out after 90000ms"),
      ),
    ).toBe(true);
    expect(isSchedulerTimeoutOrAbortError(new Error("growth_collector_aborted"))).toBe(true);
    expect(isSchedulerTimeoutOrAbortError(new Error("network boom"))).toBe(false);
  });
});
