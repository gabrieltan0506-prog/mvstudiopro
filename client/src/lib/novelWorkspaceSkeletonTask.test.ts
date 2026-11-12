import { describe, expect, it, vi } from "vitest";
import {
  NOVEL_SKELETON_MAX_RESTARTS,
  NOVEL_SKELETON_POLL_MAX_ERRORS,
  NOVEL_SKELETON_POLL_MS,
  NovelSkeletonTaskError,
  runNovelSkeletonTask,
  type NovelSkeletonTaskView,
} from "./novelWorkspaceSkeletonTask";

type V = NovelSkeletonTaskView<string>;
const running = (done: number, total = 4): V => ({ status: "running", taskId: "t", done, total });
const failed = "底稿结构拆解未完成，底稿与已填内容保留；可稍后重试。";

describe("底稿结构拆解前台轮询", () => {
  it("每 3 秒查一次，报告 n/N 片进度，完成后返回结果", async () => {
    const sleep = vi.fn(async () => {});
    const status = vi
      .fn<(id: string) => Promise<V>>()
      .mockResolvedValueOnce(running(2))
      .mockResolvedValueOnce({ status: "succeeded", taskId: "t", done: 4, total: 4, result: "ok" });
    const progress: unknown[] = [];
    const out = await runNovelSkeletonTask({ start: async () => running(0), status, sleep, onProgress: p => progress.push(p), failedMessage: failed });
    expect(out).toBe("ok");
    expect(sleep).toHaveBeenCalledWith(NOVEL_SKELETON_POLL_MS);
    expect(progress).toEqual([{ done: 0, total: 4 }, { done: 2, total: 4 }, { done: 4, total: 4 }]);
  });
  it("单次查询失败不算拆解失败；连续多次才放弃", async () => {
    const status = vi
      .fn<(id: string) => Promise<V>>()
      .mockRejectedValueOnce(new Error("net"))
      .mockRejectedValueOnce(new Error("net"))
      .mockResolvedValueOnce({ status: "succeeded", taskId: "t", done: 4, total: 4, result: "ok" });
    expect(await runNovelSkeletonTask({ start: async () => running(0), status, sleep: async () => {}, failedMessage: failed })).toBe("ok");
    const always = vi.fn(async (): Promise<V> => {
      throw new Error("net");
    });
    const err = await runNovelSkeletonTask({ start: async () => running(0), status: always, sleep: async () => {}, failedMessage: failed }).catch(e => e);
    expect(err).toBeInstanceOf(NovelSkeletonTaskError);
    expect(err.message).toBe(failed);
    expect(always).toHaveBeenCalledTimes(NOVEL_SKELETON_POLL_MAX_ERRORS);
  });
  it("missing 时用同一底稿重新发起（有上限）", async () => {
    const start = vi.fn(async () => running(0));
    const status = vi
      .fn<(id: string) => Promise<V>>()
      .mockResolvedValueOnce({ status: "missing", taskId: "t" })
      .mockResolvedValueOnce({ status: "succeeded", taskId: "t", done: 4, total: 4, result: "ok" });
    expect(await runNovelSkeletonTask({ start, status, sleep: async () => {}, failedMessage: failed })).toBe("ok");
    expect(start).toHaveBeenCalledTimes(2);
    const gone = vi.fn(async (): Promise<V> => ({ status: "missing", taskId: "t" }));
    const start2 = vi.fn(async () => running(0));
    const err = await runNovelSkeletonTask({ start: start2, status: gone, sleep: async () => {}, failedMessage: failed }).catch(e => e);
    expect(err.kind).toBe("missing");
    expect(start2).toHaveBeenCalledTimes(NOVEL_SKELETON_MAX_RESTARTS + 1);
  });
  it("任务失败抛出服务端的中性提示", async () => {
    const err = await runNovelSkeletonTask({
      start: async () => ({ status: "failed", taskId: "t", error: "底稿结构整理未完成：第2片未成功" }),
      status: async () => running(0),
      failedMessage: failed,
    }).catch(e => e);
    expect(err.kind).toBe("failed");
    expect(err.message).toContain("第2片");
  });
});
