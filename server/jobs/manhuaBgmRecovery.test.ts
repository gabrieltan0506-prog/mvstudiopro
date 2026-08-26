import { describe, expect, it } from "vitest";
import {
  isPersistedManhuaBgmTerminalOutput,
  persistManhuaBgmCheckpointWithRetry,
  planInterruptedManhuaBgmRecovery,
} from "./manhuaBgmRecovery";

const terminal = {
  upstreamTaskId: "task-1",
  briefDigest: "a".repeat(64),
  variants: [
    {
      index: 0,
      gcsUri: "gs://bucket/post-prod/42/bgm/task-1-v0.mp3",
      previewUrl: "https://signed.example/one",
      bytes: 3,
      structure: null,
    },
  ],
  elapsedMs: 100,
  providerCost: { unit: "per_call", calls: 1 },
};

describe("漫剧配乐重启恢复判定", () => {
  it("数据库短暂失败时只重试同一份检查点写入", async () => {
    let calls = 0;
    const payload = { upstreamTaskId: "task_same", bgmStage: "polling" };
    const seen: unknown[] = [];
    await persistManhuaBgmCheckpointWithRetry(
      async () => {
        calls += 1;
        seen.push(payload);
        if (calls < 3) throw new Error("数据库暂时不可用");
      },
      { attempts: 4, delayMs: 0 }
    );
    expect(calls).toBe(3);
    expect(seen).toEqual([payload, payload, payload]);
  });

  it("检查点连续失败时抛出最后一次错误，不制造新的模型调用", async () => {
    let calls = 0;
    await expect(
      persistManhuaBgmCheckpointWithRetry(
        async () => {
          calls += 1;
          throw new Error(`写入失败-${calls}`);
        },
        { attempts: 3, delayMs: 0 }
      )
    ).rejects.toThrow("写入失败-3");
    expect(calls).toBe(3);
  });

  it("终态先落 output、status 尚未写成功时直接收敛，不再跑媒体链", () => {
    expect(
      planInterruptedManhuaBgmRecovery({
        bgmStage: "result_persistence_pending",
        upstreamTaskId: "task-1",
        terminalOutput: terminal,
      })
    ).toEqual({ kind: "complete", terminalOutput: terminal });
  });

  it("完整终态直接写在 output 也识别成功", () => {
    expect(planInterruptedManhuaBgmRecovery(terminal)).toEqual({
      kind: "complete",
      terminalOutput: terminal,
    });
  });

  it("只有 task ID 时只恢复轮询，并保留原始起跑时间", () => {
    expect(
      planInterruptedManhuaBgmRecovery({
        bgmStage: "upstream_created",
        upstreamTaskId: "task-1",
        startedAtMs: 1234,
      })
    ).toEqual({ kind: "resume", upstreamTaskId: "task-1", startedAtMs: 1234 });
  });

  it("没有 task ID 时转人工核对，绝不返回可自动重提的决定", () => {
    expect(
      planInterruptedManhuaBgmRecovery({ bgmStage: "submitting" })
    ).toEqual({
      kind: "reconcile_manual",
      reason: "上游任务状态待核对，未自动重新提交",
    });
  });

  it("只有临时 URL、没有 GCS 变体不能冒充终态", () => {
    const invalid = {
      ...terminal,
      variants: [{ index: 0, previewUrl: "https://cdn.example/temporary.mp3" }],
    };
    expect(isPersistedManhuaBgmTerminalOutput(invalid)).toBe(false);
    expect(
      planInterruptedManhuaBgmRecovery({
        bgmStage: "result_persistence_pending",
        upstreamTaskId: "task-1",
        terminalOutput: invalid,
      })
    ).toEqual({ kind: "resume", upstreamTaskId: "task-1" });
  });
});
