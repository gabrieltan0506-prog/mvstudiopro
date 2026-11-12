import { describe, expect, it, vi } from "vitest";
import {
  NOVEL_IMITATION_SKELETON_TASK_FALLBACK_ERROR,
  createNovelImitationSkeletonTasks,
  novelImitationSkeletonTaskKey,
  type NovelImitationSkeletonTaskResult,
} from "./novelImitationSkeletonTasks";

const result: NovelImitationSkeletonTaskResult = {
  skeleton: { beats: [{ index: 1, name: "开局", function: "钩子", position: "第1章", roles: ["主角"], summary: "功能" }], properNouns: [] },
  library: { scored: false, wholeCollected: false, highlightCount: 0 },
} as NovelImitationSkeletonTaskResult;
const input = (over: Partial<{ requestId: string; baseText: string; modelPreference: "glm" | "carbon" }> = {}) => ({
  requestId: "11111111-1111-4111-8111-111111111111",
  baseText: "第1章 开局\n" + "正文".repeat(60),
  modelPreference: "glm" as const,
  ...over,
});

function deferred() {
  let resolve!: (v: NovelImitationSkeletonTaskResult) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<NovelImitationSkeletonTaskResult>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

describe("底稿结构拆解后台任务", () => {
  it("发起即返回 running + 进度；分片进度随 onShard 更新；完成后返回结果", async () => {
    const d = deferred();
    let report!: (p: { done: number; total: number }) => void;
    const run = vi.fn(async ({ onShard }: { onShard: (p: { done: number; total: number }) => void }) => {
      report = onShard;
      return d.promise;
    });
    const tasks = createNovelImitationSkeletonTasks({ run });
    const started = tasks.start(7, input());
    expect(started).toMatchObject({ status: "running", done: 0, total: 0 });
    expect(started.taskId).toBe(novelImitationSkeletonTaskKey(7, input().baseText, "glm"));
    await Promise.resolve();
    await Promise.resolve();
    report({ done: 0, total: 4 });
    report({ done: 2, total: 4 });
    expect(tasks.status(7, started.taskId)).toMatchObject({ status: "running", done: 2, total: 4 });
    d.resolve(result);
    await tasks.settled(started.taskId);
    expect(tasks.status(7, started.taskId)).toMatchObject({ status: "succeeded", done: 4, total: 4, result });
  });

  it("同一账号 + 底稿 + 线路重复发起复用进行中 / 已完成任务；换线路或换账号是新任务", async () => {
    const d = deferred();
    const run = vi.fn(() => d.promise);
    const tasks = createNovelImitationSkeletonTasks({ run });
    const a = tasks.start(7, input());
    const b = tasks.start(7, input({ requestId: "22222222-2222-4222-8222-222222222222" }));
    expect(b.taskId).toBe(a.taskId);
    d.resolve(result);
    await tasks.settled(a.taskId);
    expect(tasks.start(7, input()).status).toBe("succeeded");
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    const c = tasks.start(7, input({ modelPreference: "carbon" }));
    const other = tasks.start(8, input());
    expect(new Set([a.taskId, c.taskId, other.taskId]).size).toBe(3);
  });

  it("只返回本人任务；未知任务返回 null（路由回 missing）", () => {
    const tasks = createNovelImitationSkeletonTasks({ run: () => new Promise(() => {}) });
    const a = tasks.start(7, input());
    expect(tasks.status(8, a.taskId)).toBeNull();
    expect(tasks.status(7, "0".repeat(32))).toBeNull();
  });

  it("失败：记下服务端的中性提示；失败任务不复用，重新发起即重跑", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("底稿结构整理未完成：第3片未成功，可重新提交，已完成部分不会重做。"))
      .mockRejectedValueOnce(new Error(""))
      .mockResolvedValueOnce(result);
    const tasks = createNovelImitationSkeletonTasks({ run });
    const a = tasks.start(7, input());
    await tasks.settled(a.taskId);
    expect(tasks.status(7, a.taskId)).toMatchObject({ status: "failed", error: expect.stringContaining("第3片") });
    const b = tasks.start(7, input());
    expect(b.status).toBe("running");
    await tasks.settled(b.taskId);
    expect(tasks.status(7, b.taskId)).toMatchObject({ status: "failed", error: NOVEL_IMITATION_SKELETON_TASK_FALLBACK_ERROR });
    const c = tasks.start(7, input());
    await tasks.settled(c.taskId);
    expect(tasks.status(7, c.taskId)?.status).toBe("succeeded");
    expect(run).toHaveBeenCalledTimes(3);
  });
});
