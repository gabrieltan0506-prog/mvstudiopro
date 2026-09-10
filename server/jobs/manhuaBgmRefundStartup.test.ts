/**
 * 库层回归（终审 P1）：
 * - 启动恢复要把「待补退」的 running 行放回队列，尝试次数用尽才转人工并说清要人工核对；
 * - 补退专用重排必须 CAS 到「running 且待补退」，写不进去要抛错，不能吞；
 *   上一次其实写成功、只是回执断了，要能幂等识别。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDb = vi.fn();
vi.mock("../db", () => ({ getDb: () => getDb() }));

import { recoverInterruptedManhuaBgmJobsOnStartup, requeueManhuaBgmRefundStrict } from "./repository";

type Update = { payload: Record<string, unknown>; returning: number };

function dbForStartup(rows: unknown[], updates: Update[]) {
  return {
    select: () => ({ from: () => ({ where: async () => rows }) }),
    update: () => ({
      set: (payload: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            updates.push({ payload, returning: 1 });
            return [{ id: "bgm-1" }];
          },
        }),
      }),
    }),
  };
}

const pendingRow = (attempts: number) => ({
  id: "bgm-1",
  attempts,
  output: { bgmStage: "refund_pending", bgmDeduct: { success: true, cost: 20, source: "personal", remainingBalance: 80 }, bgmRefundKey: "k" },
});

beforeEach(() => getDb.mockReset());

describe("启动恢复：待补退回队列，用尽转人工", () => {
  it("尝试次数未用尽 → 置回 queued，并写明只恢复退款", async () => {
    const updates: Update[] = [];
    getDb.mockResolvedValue(dbForStartup([pendingRow(1)], updates));
    const r = await recoverInterruptedManhuaBgmJobsOnStartup();
    expect(updates[0]!.payload).toMatchObject({ status: "queued", error: "服务重启，仅恢复原配乐退款" });
    expect(r.resumed).toBe(1);
    expect(r.manual).toBe(0);
  });

  it("尝试次数用尽 → 落 failed，文案明确要人工核对退款，不再承诺自动补退", async () => {
    const updates: Update[] = [];
    getDb.mockResolvedValue(dbForStartup([pendingRow(4)], updates));
    const r = await recoverInterruptedManhuaBgmJobsOnStartup();
    expect(updates[0]!.payload).toMatchObject({ status: "failed", error: "自动补退未成功，请人工核对退款" });
    expect(String(updates[0]!.payload.error)).not.toContain("自动补退中");
    expect(r.manual).toBe(1);
    expect(r.resumed).toBe(0);
  });

  it("凭据不全（团队缺身份）→ 不当作待补退，按人工核对处理", async () => {
    const updates: Update[] = [];
    getDb.mockResolvedValue(
      dbForStartup([{ id: "bgm-1", attempts: 0, output: { bgmStage: "refund_pending", bgmDeduct: { success: true, cost: 20, source: "team" }, bgmRefundKey: "k" } }], updates),
    );
    const r = await recoverInterruptedManhuaBgmJobsOnStartup();
    expect(updates[0]!.payload).toMatchObject({ status: "failed" });
    expect(String(updates[0]!.payload.error)).toContain("人工核对");
    expect(r.manual).toBe(1);
  });
});

describe("补退专用重排：写不进去要抛，回执丢失要幂等识别", () => {
  function dbForRequeue(updated: unknown[], current: unknown) {
    return {
      update: () => ({ set: () => ({ where: () => ({ returning: async () => updated }) }) }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => (current ? [current] : []) }) }) }),
    };
  }

  it("CAS 命中 → 正常返回", async () => {
    getDb.mockResolvedValue(dbForRequeue([{ id: "bgm-1" }], null));
    await expect(requeueManhuaBgmRefundStrict("bgm-1", "退款待补")).resolves.toBeUndefined();
  });

  it("CAS 未命中但库里已是「queued 且待补退」→ 认作上次写成功，幂等通过", async () => {
    getDb.mockResolvedValue(
      dbForRequeue([], { id: "bgm-1", status: "queued", output: { bgmStage: "refund_pending" }, input: null, type: "audio", userId: "7" }),
    );
    await expect(requeueManhuaBgmRefundStrict("bgm-1", "退款待补")).resolves.toBeUndefined();
  });

  it("CAS 未命中且状态对不上 → 抛错，不许静默当成功", async () => {
    getDb.mockResolvedValue(
      dbForRequeue([], { id: "bgm-1", status: "running", output: { bgmStage: "polling" }, input: null, type: "audio", userId: "7" }),
    );
    await expect(requeueManhuaBgmRefundStrict("bgm-1", "退款待补")).rejects.toThrow(/未持久化/);
  });

  it("数据库不可用 → 抛错，不静默", async () => {
    getDb.mockResolvedValue(null);
    await expect(requeueManhuaBgmRefundStrict("bgm-1", "退款待补")).rejects.toThrow(/Database unavailable/);
  });
});
