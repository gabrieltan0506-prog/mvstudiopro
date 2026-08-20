import { afterEach, describe, expect, it, vi } from "vitest";
import { startPaidJobLedgerReaper, type ReapResult } from "./paidJobLedger";

const EMPTY: ReapResult = { scanned: 0, refunded: 0, errors: 0, cancelled: 0 };

describe("paidJobLedger 常驻 reaper", () => {
  afterEach(() => vi.useRealTimers());

  it("启动立即扫一次，之后按周期补扫", async () => {
    vi.useFakeTimers();
    const reap = vi.fn(async () => EMPTY);
    const runner = startPaidJobLedgerReaper({ intervalMs: 60_000, reap });
    await Promise.resolve();
    expect(reap).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reap).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it("上一轮未结束时跳过重叠 tick，避免双重补退", async () => {
    vi.useFakeTimers();
    let release!: (value: ReapResult) => void;
    const pending = new Promise<ReapResult>((resolve) => { release = resolve; });
    const reap = vi.fn(() => pending);
    const runner = startPaidJobLedgerReaper({ runImmediately: false, reap });
    const first = runner.tick();
    expect(await runner.tick()).toBeNull();
    expect(reap).toHaveBeenCalledTimes(1);
    release(EMPTY);
    await expect(first).resolves.toEqual(EMPTY);
    runner.stop();
  });
});
