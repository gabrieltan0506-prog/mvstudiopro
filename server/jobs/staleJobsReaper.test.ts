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

type Call = {
  kind: "update" | "delete";
  payload?: Record<string, unknown>;
  condition?: unknown;
};

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
      where: (condition: unknown) => ({
        returning: async () => {
          calls.push({ kind: "delete", condition });
          return [{ id: "x" }];
        },
      }),
    }),
  };
}

function sqlStringValues(value: unknown): string[] {
  const values: string[] = [];
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown) => {
    if (typeof candidate === "string") {
      values.push(candidate);
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) return;
    seen.add(candidate);
    const row = candidate as { queryChunks?: unknown; value?: unknown };
    if (row.queryChunks !== undefined) visit(row.queryChunks);
    if (row.value !== undefined) visit(row.value);
  };
  visit(value);
  return values;
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
    const deletes = calls.filter((c) => c.kind === "delete");
    expect(deletes).toHaveLength(2);
    // running 顾问必须留给专用退款/成功证据回收；未确认 queued 可按时清理。
    expect(sqlStringValues(deletes[0]?.condition).join("\n")).toContain(
      "manhua_advisor_qa",
    );
    expect(sqlStringValues(deletes[1]?.condition).join("\n")).not.toContain(
      "manhua_advisor_qa",
    );
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
