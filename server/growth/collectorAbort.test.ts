import { describe, expect, it } from "vitest";
import {
  buildTimeoutCooldownMs,
  formatTimeoutCooldownLabel,
  getCollectorAbortSignal,
  isSchedulerTimeoutOrAbortError,
  runWithCollectorAbort,
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

  it("AsyncLocalStorage 在采集上下文中可取到 signal", async () => {
    const controller = new AbortController();
    const seen = await runWithCollectorAbort(controller.signal, async () => {
      return getCollectorAbortSignal() === controller.signal;
    });
    expect(seen).toBe(true);
  });

  it("超时冷却随连续次数加长，并识别超时错误", () => {
    expect(buildTimeoutCooldownMs(1)).toBe(45 * 60 * 1000);
    expect(buildTimeoutCooldownMs(2)).toBe(2 * 60 * 60 * 1000);
    expect(buildTimeoutCooldownMs(3)).toBe(4 * 60 * 60 * 1000);
    expect(formatTimeoutCooldownLabel(45 * 60 * 1000)).toContain("45 分钟");
    expect(
      isSchedulerTimeoutOrAbortError(
        new Error("[growth.scheduler] douyin timed out after 90000ms"),
      ),
    ).toBe(true);
    expect(isSchedulerTimeoutOrAbortError(new Error("growth_collector_aborted"))).toBe(true);
    expect(isSchedulerTimeoutOrAbortError(new Error("network boom"))).toBe(false);
  });
});
