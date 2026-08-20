/**
 * stale 任务清理测试:
 * - 停止更新的 post_prod 行改判 failed 保留记录(getPostProdJob 仍可查询);
 * - 通用 DELETE 不再触及 post_prod;
 * - 其他任务保持当前清理规则(running/queued 两次删除照常执行)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDb = vi.fn();
vi.mock("../db", () => ({ getDb: () => getDb() }));

import { reapStaleJobsOnce } from "./staleJobsReaper";

type Call = { kind: "update" | "delete"; payload?: Record<string, unknown> };

function fakeDb(calls: Call[]) {
  return {
    update: () => ({
      set: (payload: Record<string, unknown>) => ({
        where: async () => {
          calls.push({ kind: "update", payload });
        },
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: async () => {
          calls.push({ kind: "delete" });
          return [{ id: "x" }];
        },
      }),
    }),
  };
}

describe("reapStaleJobsOnce 与 post_prod 记录保留", () => {
  beforeEach(() => getDb.mockReset());

  it("先把停止更新的 post_prod 改判 failed,再执行两次通用删除", async () => {
    const calls: Call[] = [];
    getDb.mockResolvedValue(fakeDb(calls));

    const r = await reapStaleJobsOnce({ bypassDisable: true });

    expect(calls[0]).toMatchObject({
      kind: "update",
      payload: { status: "failed", error: "后期任务已停止,请重新提交" },
    });
    // 其他任务保持当前清理规则:running + queued 两次删除照常
    expect(calls.filter((c) => c.kind === "delete")).toHaveLength(2);
    expect(r).toEqual({ runningCleared: 1, queuedCleared: 1 });
  });

  it("数据库不可用时安静返回零计数", async () => {
    getDb.mockResolvedValue(null);
    await expect(reapStaleJobsOnce({ bypassDisable: true })).resolves.toEqual({
      runningCleared: 0,
      queuedCleared: 0,
    });
  });
});
