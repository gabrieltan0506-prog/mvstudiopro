/**
 * stale 任务清理测试:
 * - 停止更新的 post_prod 行改判 failed 保留记录(getPostProdJob 仍可查询);
 * - 通用 DELETE 不再触及 post_prod;
 * - 其他任务保持当前清理规则(running/queued 两次删除照常执行)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDb = vi.fn();
const ledger = vi.hoisted(() => ({ readActiveJob: vi.fn(async () => null), refundCreditsOnFailure: vi.fn(async () => ({})) }));
vi.mock("../db", () => ({ getDb: () => getDb() }));
vi.mock("../services/paidJobLedger.js", () => ledger);

import { reapStaleJobsOnce } from "./staleJobsReaper";

type Call = {
  kind: "update" | "delete";
  payload?: Record<string, unknown>;
  condition?: unknown;
};

function fakeDb(calls: Call[], staleAssembles: unknown[] = [], changed = true) {
  return {
    select: () => ({ from: () => ({ where: async () => staleAssembles }) }),
    update: () => ({
      set: (payload: Record<string, unknown>) => ({
        where: (condition: unknown) => {
          calls.push({ kind: "update", payload, condition });
          return { returning: async () => changed ? [{ id: "asm-7" }] : [] };
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
  beforeEach(() => { getDb.mockReset(); ledger.readActiveJob.mockReset().mockResolvedValue(null); ledger.refundCreditsOnFailure.mockClear(); });

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
    for (const deletion of deletes) expect(sqlStringValues(deletion.condition).join("\n")).toContain("manhua_assemble_final");
    expect(r).toEqual({ runningCleared: 1, queuedCleared: 1 });
  });

  it("失活合成只改状态并触发原任务退款，保留input/output与字幕回执", async () => {
    const calls: Call[] = [];
    getDb.mockResolvedValue(fakeDb(calls, [{ id: "asm-7", userId: "7", status: "running", updatedAt: new Date(0) }]));
    ledger.readActiveJob.mockResolvedValue({ userId: 7, status: "active", lastHeartbeatAt: new Date(0).toISOString() } as never);
    await reapStaleJobsOnce({ bypassDisable: true });
    const assembleUpdate = calls.filter(call => call.kind === "update")[1];
    expect(assembleUpdate.payload).toEqual({ status: "failed", error: expect.stringContaining("回执已保留"), updatedAt: expect.any(Date) });
    expect(assembleUpdate.payload).not.toHaveProperty("input"); expect(assembleUpdate.payload).not.toHaveProperty("output");
    expect(ledger.refundCreditsOnFailure).toHaveBeenCalledWith("asm-7", "manhuaFinalAssemble", "process_crashed", expect.any(String));
  });

  it("真实worker心跳仍新鲜时不把长合成误判失败", async () => {
    const calls: Call[] = [];
    getDb.mockResolvedValue(fakeDb(calls, [{ id: "asm-7", userId: "7", status: "running", updatedAt: new Date(0) }]));
    ledger.readActiveJob.mockResolvedValue({ userId: 7, status: "active", lastHeartbeatAt: new Date().toISOString() } as never);
    await reapStaleJobsOnce({ bypassDisable: true });
    expect(calls.filter(call => call.kind === "update")).toHaveLength(1);
    expect(ledger.refundCreditsOnFailure).not.toHaveBeenCalled();
  });

  it("扫描后任务已改变，CAS未命中时不退款", async () => {
    const calls: Call[] = [];
    getDb.mockResolvedValue(fakeDb(calls, [{ id: "asm-7", userId: "7", status: "running", updatedAt: new Date(0) }], false));
    ledger.readActiveJob.mockResolvedValue({ userId: 7, status: "active", lastHeartbeatAt: new Date(0).toISOString() } as never);
    await reapStaleJobsOnce({ bypassDisable: true });
    expect(ledger.refundCreditsOnFailure).not.toHaveBeenCalled();
  });

  it("数据库不可用时安静返回零计数", async () => {
    getDb.mockResolvedValue(null);
    await expect(reapStaleJobsOnce({ bypassDisable: true })).resolves.toEqual({
      runningCleared: 0,
      queuedCleared: 0,
    });
  });
});
