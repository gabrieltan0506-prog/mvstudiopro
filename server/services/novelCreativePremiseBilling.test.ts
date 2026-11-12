import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  NOVEL_CREATIVE_PREMISE_CREDITS,
  NOVEL_CREATIVE_PREMISE_FREE_RUNS,
  NOVEL_CREATIVE_PREMISE_UI,
  novelCreativePremiseRunCost,
} from "../../shared/novelCreativePremise";
import { novelTestInputSchema } from "../../shared/novelWorkspace";
import {
  NOVEL_CREATIVE_PREMISE_NEED_CREDITS,
  NOVEL_CREATIVE_PREMISE_UNPAID,
  assertNovelCreativePremiseAffordable,
  countNovelCreativePremiseRuns,
  novelCreativePremiseChargeKey,
  novelCreativePremiseWorkId,
  readNovelCreativePremiseUsage,
  replayNovelCreativePremiseCharge,
  settleNovelCreativePremiseRun,
  type NovelCreativePremiseBillingDeps,
  type NovelCreativePremiseRunRow,
} from "./novelCreativePremiseBilling";

const W1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const W2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** 假账本：成功交付的记录 + 余额 + 按 chargeKey 幂等的扣费（照 deductCreditsAmount 的语义）。 */
function ledger(balance = 100) {
  const rows: NovelCreativePremiseRunRow[] = [];
  const charges = new Map<string, number>();
  const state = { balance };
  const deps: NovelCreativePremiseBillingDeps = {
    listRuns: async () => rows,
    balance: async () => ({ totalAvailable: state.balance }),
    charge: vi.fn(async (_u, amount, _a, _d, opts) => {
      const key = opts?.chargeKey ?? "";
      if (charges.has(key)) return { success: true, cost: charges.get(key)!, alreadyCharged: true };
      if (state.balance < amount) {
        const e = new Error(`Credits 不足。需要: ${amount}`);
        e.name = "InsufficientCreditsError";
        throw e;
      }
      state.balance -= amount;
      charges.set(key, amount);
      return { success: true, cost: amount };
    }),
  };
  let n = 0;
  /** 模拟一次成功交付：结算通过才登记为 succeeded。 */
  const run = async (workId: string, rid?: string) => {
    n += 1;
    const requestId = rid ?? `req-${n}`;
    const self = { id: `job-${String(n).padStart(3, "0")}`, createdAt: new Date(1_000 + n), requestId, workId };
    const settled = await settleNovelCreativePremiseRun(7, self, deps);
    rows.push({ id: self.id, createdAt: self.createdAt, request: { roundId: W1, workId } });
    return settled;
  };
  return { rows, charges, state, deps, run };
}

describe("创意环节计费常量与价格", () => {
  it("前两次免费，第三次起每次 20 积分（单处常量）", () => {
    expect(NOVEL_CREATIVE_PREMISE_FREE_RUNS).toBe(2);
    expect(NOVEL_CREATIVE_PREMISE_CREDITS).toBe(20);
    expect([1, 2, 3, 4, 9].map(novelCreativePremiseRunCost)).toEqual([0, 0, 20, 20, 20]);
    expect(NOVEL_CREATIVE_PREMISE_UI.usage(1)).toBe("本作品已用 1 次，前 2 次免费");
    expect(NOVEL_CREATIVE_PREMISE_UI.usageCost).toBe("本次 20 积分");
  });
  it("作品身份：请求带 workId 用它，旧请求按 roundId；workId 只随创意请求携带", () => {
    expect(novelCreativePremiseWorkId({ roundId: W1 })).toBe(W1);
    expect(novelCreativePremiseWorkId({ roundId: W1, workId: W2 })).toBe(W2);
    const base = { requestId: W1, roundId: W1, stage: "advice", topic: "t", direction: "d", templates: [], episodeCount: 1 };
    expect(novelTestInputSchema.safeParse({ ...base, advisorIntent: "creative_premises", workId: W2 }).success).toBe(true);
    expect(novelTestInputSchema.safeParse({ ...base, workId: W2 }).success).toBe(false);
  });
});

describe("创意环节计次与扣费", () => {
  it("前两次免费不扣，第三次起每次 20；按 requestId 生成幂等键", async () => {
    const l = ledger();
    expect((await l.run(W1)).cost).toBe(0);
    expect((await l.run(W1)).cost).toBe(0);
    const third = await l.run(W1);
    expect(third).toMatchObject({ ordinal: 3, price: 20, cost: 20, chargeKey: novelCreativePremiseChargeKey(7, "req-3") });
    expect((await l.run(W1)).cost).toBe(20);
    expect(l.state.balance).toBe(60);
    expect(l.deps.charge).toHaveBeenCalledTimes(2);
    expect(l.deps.charge).toHaveBeenCalledWith(7, 20, "novelCreativePremise", "小说核心创意", { chargeKey: "novel-creative-premise:7:req-3" });
  });
  it("按作品隔离：另一部作品重新从免费开始", async () => {
    const l = ledger();
    await l.run(W1);
    await l.run(W1);
    await l.run(W1);
    expect((await l.run(W2)).cost).toBe(0);
    expect((await l.run(W2)).cost).toBe(0);
    expect((await l.run(W2)).cost).toBe(20);
    expect(countNovelCreativePremiseRuns(l.rows, W1)).toBe(3);
    expect(countNovelCreativePremiseRuns(l.rows, W2)).toBe(3);
  });
  it("失败（未结算 / 积分不足未交付）不计次、不扣费", async () => {
    const l = ledger(10);
    await l.run(W1);
    await l.run(W1);
    // 第三次：余额不足 → PAYMENT_REQUIRED，未登记成功
    const err = await l.run(W1).catch(e => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("PAYMENT_REQUIRED");
    expect(err.message).toBe(NOVEL_CREATIVE_PREMISE_UNPAID);
    expect(countNovelCreativePremiseRuns(l.rows, W1)).toBe(2);
    expect(l.state.balance).toBe(10);
    // 模型失败的请求根本不走结算：计次不变
    expect((await readNovelCreativePremiseUsage(7, W1, "user", l.deps)).used).toBe(2);
  });
  it("幂等：同 requestId 重复结算 / 重放只扣一次", async () => {
    const l = ledger();
    await l.run(W1);
    await l.run(W1);
    const third = await l.run(W1, "same-req");
    await replayNovelCreativePremiseCharge(7, third, l.deps);
    await replayNovelCreativePremiseCharge(7, third, l.deps);
    expect(l.state.balance).toBe(80);
    expect(l.charges.size).toBe(1);
    // 免费那次的重放不扣
    await replayNovelCreativePremiseCharge(7, { price: 0, chargeKey: "x" }, l.deps);
    expect(l.charges.size).toBe(1);
  });
  it("第几次按创建先后算：排在前面的成功记录才计入", () => {
    const rows: NovelCreativePremiseRunRow[] = [
      { id: "b", createdAt: new Date(10), request: { roundId: W1 } },
      { id: "c", createdAt: new Date(30), request: { roundId: W1 } },
      { id: "a", createdAt: new Date(10), request: { roundId: W1, workId: W1 } },
    ];
    expect(countNovelCreativePremiseRuns(rows, W1, { id: "x", createdAt: new Date(20) })).toBe(2);
    expect(countNovelCreativePremiseRuns(rows, W1, { id: "b", createdAt: new Date(10) })).toBe(1);
    expect(countNovelCreativePremiseRuns(rows, W1)).toBe(3);
  });
  it("提交前预检：要收费且余额不足才拒绝；管理者豁免；免费次数内不查余额", async () => {
    const l = ledger(5);
    const balance = vi.spyOn(l.deps, "balance");
    await assertNovelCreativePremiseAffordable(7, W1, "user", l.deps);
    expect(balance).not.toHaveBeenCalled();
    l.rows.push({ id: "1", createdAt: 1, request: { roundId: W1 } }, { id: "2", createdAt: 2, request: { roundId: W1 } });
    const err = await assertNovelCreativePremiseAffordable(7, W1, "user", l.deps).catch(e => e);
    expect(err.code).toBe("PAYMENT_REQUIRED");
    expect(err.message).toBe(NOVEL_CREATIVE_PREMISE_NEED_CREDITS);
    await expect(assertNovelCreativePremiseAffordable(7, W1, "admin", l.deps)).resolves.toBeUndefined();
    await expect(assertNovelCreativePremiseAffordable(7, W1, "supervisor", l.deps)).resolves.toBeUndefined();
  });
  it("用量：已用次数、下一次价格、是否豁免", async () => {
    const l = ledger();
    expect(await readNovelCreativePremiseUsage(7, W1, "admin", l.deps)).toMatchObject({ used: 0, nextCost: 0, exempt: true });
    await l.run(W1);
    await l.run(W1);
    expect(await readNovelCreativePremiseUsage(7, W1, "user", l.deps)).toMatchObject({ used: 2, nextCost: 20, freeRuns: 2, credits: 20, exempt: false });
  });
});
