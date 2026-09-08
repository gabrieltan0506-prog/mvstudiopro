import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

const h = vi.hoisted(() => ({ balance: 3, prior: null as null | { action: string; creditsCost: number }, executes: 0 }));
vi.mock("../db", () => ({
  isBillingChargeKeyIndexReady: () => true,
  reverifyBillingChargeKeyIndex: async () => true,
  getDb: async () => ({
    select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => ({ where: () => ({ limit: async () => {
      const name = getTableName(table);
      if (name === "stripe_usage_logs") return h.prior ? [h.prior] : [];
      if (name === "users") return [{ role: "user", email: "test@example.invalid" }];
      if (name === "credit_balances") return [{ userId: 7, balance: h.balance }];
      return [];
    } }) }) }),
    execute: async () => {
      h.executes++;
      if (h.balance < 3) return { rows: [] };
      h.balance -= 3;
      h.prior = { action: "manhuaDialogueTts", creditsCost: 3 };
      return { rows: [{ balance: h.balance }] };
    },
  }),
}));
import { settleCanvasDialogueCharge } from "./canvasDialogueCharge";

describe("原配音账恢复（使用实际扣费函数，数据库边界离线）", () => {
  beforeEach(() => { h.balance = 3; h.prior = null; h.executes = 0; });
  it("首次恰好扣光3积分，完成状态丢失后重放不再尝试余额扣减", async () => {
    await settleCanvasDialogueCharge(7, "original-request");
    expect(h.balance).toBe(0);
    expect(h.executes).toBe(1);
    await settleCanvasDialogueCharge(7, "original-request");
    expect(h.balance).toBe(0);
    expect(h.executes).toBe(1);
  });
  it("扣费回包中断后二次权威读账成功，不谎报不足", async () => {
    let recorded = false;
    const deduct = vi.fn(async () => { recorded = true; throw Error("数据库回包中断"); });
    await settleCanvasDialogueCharge(7, "original-request", { read: async () => recorded ? { action: "manhuaDialogueTts", creditsCost: 3 } : null, deduct });
    expect(deduct).toHaveBeenCalledTimes(1);
  });
  it("无原账且确实不足或账目金额不符不能冒充恢复成功", async () => {
    const deduct = vi.fn(async () => { throw Error("不足"); });
    await expect(settleCanvasDialogueCharge(7, "original-request", { read: async () => null, deduct })).rejects.toThrow("不足");
    await expect(settleCanvasDialogueCharge(7, "original-request", { read: async () => ({ action: "manhuaDialogueTts", creditsCost: 2 }), deduct })).rejects.toThrow("不一致");
    expect(deduct).toHaveBeenCalledTimes(1);
  });
});
