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

  it("超时清理阶段的失败仍把逐次模型回执带到外层终态", async () => {
    vi.useFakeTimers();
    try {
      let rejectWork!: (reason: unknown) => void;
      const work = new Promise<never>((_, reject) => { rejectWork = reject; });
      const receipt = {
        callId: "visual-1",
        model: "qwen3.8-max",
        route: "singapore_token_plan",
        stage: "visual_model",
        status: "failed",
        episodeIndexes: [1, 2],
        errorZh: "upstream failed",
      };
      const pending = withTimeout(work, 20, "学习任务时限结束", {
        onTimeout: () => rejectWork(Object.assign(new Error("底层已中止"), {
          nativeModelReceipts: [receipt],
        })),
        cleanupGraceMs: 100,
      });
      const assertion = expect(pending).rejects.toMatchObject({
        nativeModelReceipts: [receipt],
      });
      await vi.advanceTimersByTimeAsync(20);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
