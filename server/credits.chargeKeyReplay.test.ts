import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as Array<{ creditsCost: number; metadata: string | null }> }));

vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => state.rows }) }) }),
  }),
  isBillingChargeKeyIndexReady: () => true,
  reverifyBillingChargeKeyIndex: async () => true,
}));

import { deductCreditsAmount } from "./credits";

describe("同扣费键恢复", () => {
  it("余额已用尽后直接读取原扣款，不再次尝试扣减", async () => {
    state.rows = [{ creditsCost: 1, metadata: JSON.stringify({ source: "personal" }) }];
    const receipt = await deductCreditsAmount(7, 1, "manhuaWriterExpand", "剧本候选", { chargeKey: "mt_candidate_existing" });
    expect(receipt).toMatchObject({ success: true, cost: 1, source: "personal", alreadyCharged: true });
    expect(receipt.remainingBalance).toBe(-1);
  });
});
