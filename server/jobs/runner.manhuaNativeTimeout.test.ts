import { describe, expect, it, vi } from "vitest";
import { withTimeout } from "./runner.js";

describe("原生学习墙钟中止", () => {
  it("到时先触发 abort，并等底层收敛后才返回终态", async () => {
    vi.useFakeTimers();
    try {
      let settle!: (value: { output: { nativeUsage: { receiptComplete: boolean } } }) => void;
      const work = new Promise<{ output: { nativeUsage: { receiptComplete: boolean } } }>(
        (resolve) => { settle = resolve; },
      );
      const onTimeout = vi.fn(() => {
        settle({ output: { nativeUsage: { receiptComplete: false } } });
      });
      const pending = withTimeout(work, 20, "学习任务时限结束", {
        onTimeout,
        cleanupGraceMs: 100,
      });
      // 先挂拒绝断言再推进假时钟，避免测试运行器把预期中的超时当成未处理拒绝。
      const assertion = expect(pending).rejects.toMatchObject({
        message: "学习任务时限结束",
        partialResult: { output: { nativeUsage: { receiptComplete: false } } },
      });
      await vi.advanceTimersByTimeAsync(20);
      await assertion;
      expect(onTimeout).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("正常完成不触发 abort", async () => {
    const onTimeout = vi.fn();
    await expect(withTimeout(Promise.resolve("ok"), 100, "timeout", { onTimeout }))
      .resolves.toBe("ok");
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
