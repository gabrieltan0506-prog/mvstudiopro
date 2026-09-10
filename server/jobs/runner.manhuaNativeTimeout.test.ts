import { describe, expect, it, vi } from "vitest";
import { resolveJobGrowthInteractiveLeaseLabel, withTimeout } from "./runner.js";

describe("原生学习墙钟中止", () => {
  it("模板学习 Job 会持有 Growth 互动租约，其他视频 Job 不会", () => {
    expect(resolveJobGrowthInteractiveLeaseLabel({
      id: "learn-1",
      type: "video",
      status: "running",
      userId: "42",
      input: { action: "manhua_template_learn" },
    })).toBe("manhua-learn-job:learn-1");
    expect(resolveJobGrowthInteractiveLeaseLabel({
      id: "video-1",
      type: "video",
      status: "running",
      userId: "42",
      input: { action: "other_video" },
    })).toBeUndefined();
    expect(resolveJobGrowthInteractiveLeaseLabel({
      id: "learn-public",
      type: "video",
      status: "running",
      userId: "public",
      input: { action: "manhua_template_learn" },
    })).toBeUndefined();
  });

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

describe("withTimeout heartbeat（0910：知识卡提炼不设总时长上限，只按无进度判卡死）", () => {
  it("有心跳就不超时：总时长远超 timeoutMs 也照常完成", async () => {
    const { touchJobHeartbeat } = await import("./runner.js");
    const jobId = "hb-alive";
    const work = new Promise<string>((resolve) => {
      let n = 0;
      const t = setInterval(() => {
        touchJobHeartbeat(jobId);
        if (++n >= 6) { clearInterval(t); resolve("done"); }
      }, 20);
    });
    // timeoutMs=10 远小于实际 120ms；stallMs=200 > 心跳间隔 → 不应超时
    await expect(withTimeout(work, 10, "should-not-fire", { heartbeat: { jobId, stallMs: 200 } })).resolves.toBe("done");
  }, 5_000);

  it("连续无心跳超过 stallMs 才判卡死，文案说明是卡死不是总时长", async () => {
    const jobId = "hb-stalled";
    const never = new Promise<never>(() => {});
    const onTimeout = vi.fn();
    const started = Date.now();
    await expect(withTimeout(never, 60_000, "提炼任务", { heartbeat: { jobId, stallMs: 50 }, onTimeout, cleanupGraceMs: 0 })).rejects.toThrow(/判为卡死/);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    // 判死发生在 stall 检查节拍上（15 s 一查），不是 60 s 总时长
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 40_000);
});
