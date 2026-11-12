/** 小说工作台 · 各环节计费（1112）：全部 mock，不连库、不调模型。 */
import { it, expect, vi, describe } from "vitest";
vi.mock("./manhuaViralTemplateStore", () => ({
  listMergedApprovedManhuaViralTemplatesGrouped: vi.fn(),
  resolveViralTemplateForExpand: vi.fn(),
}));
vi.mock("./manhuaNovelAdaptationRun", () => ({ callNovelStage: vi.fn() }));
import { TRPCError } from "@trpc/server";
import {
  NOVEL_STEP_NEED_CREDITS,
  NOVEL_STEP_UNPAID,
  novelImitationSkeletonCredits,
  novelStepChargeKey,
  novelStepCredits,
  type NovelStepBillingInput,
} from "../../shared/novelStepBilling";
import { assertNovelStepAffordable, replayNovelStepCharge, settleNovelStep, type NovelStepBillingDeps } from "./novelStepBilling";
import { runNovelImitationSkeleton } from "./novelWorkspaceTest";

/** 模拟 deductCreditsAmount：同 chargeKey 只扣一次；余额不足返回 success=false。 */
function ledger(balance: number) {
  const charged = new Map<string, number>();
  const deps: NovelStepBillingDeps = {
    balance: vi.fn(async () => ({ totalAvailable: balance })),
    charge: vi.fn(async (_u: number, amount: number, _a: string, _d?: string, opts?: { chargeKey?: string }) => {
      const key = opts?.chargeKey ?? "";
      if (charged.has(key)) return { success: true, cost: charged.get(key)!, alreadyCharged: true };
      if (balance < amount) return { success: false, cost: 0 };
      balance -= amount;
      charged.set(key, amount);
      return { success: true, cost: amount };
    }),
  };
  return { deps, charged, left: () => balance };
}

describe("预检", () => {
  it("余额不足拒绝，提示所需积分", async () => {
    const { deps } = ledger(4);
    await expect(assertNovelStepAffordable(1, "user", 5, deps)).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
      message: NOVEL_STEP_NEED_CREDITS(5),
    });
    await expect(assertNovelStepAffordable(1, "user", 4, deps)).resolves.toBeUndefined();
  });
  it("管理员 / supervisor 不预检", async () => {
    const { deps } = ledger(0);
    await assertNovelStepAffordable(1, "admin", 40, deps);
    await assertNovelStepAffordable(1, "supervisor", 40, deps);
    expect(deps.balance).not.toHaveBeenCalled();
  });
});

describe("结算与重放", () => {
  it("成功扣一次，chargeKey 按 requestId", async () => {
    const { deps, left } = ledger(30);
    const settled = await settleNovelStep(7, "req-1", 10, "小说大纲", deps);
    expect(settled).toEqual({ price: 10, cost: 10, chargeKey: novelStepChargeKey(7, "req-1") });
    expect(left()).toBe(20);
    expect(deps.charge).toHaveBeenCalledTimes(1);
  });
  it("同 requestId 重放 / 重复结算不重复扣", async () => {
    const { deps, left } = ledger(30);
    const settled = await settleNovelStep(7, "req-1", 10, "小说大纲", deps);
    await replayNovelStepCharge(7, settled, "小说大纲", deps);
    await settleNovelStep(7, "req-1", 10, "小说大纲", deps);
    expect(left()).toBe(20);
  });
  it("余额不足（未成功或抛不足）→ PAYMENT_REQUIRED 未交付", async () => {
    const { deps } = ledger(3);
    await expect(settleNovelStep(7, "req-2", 10, "小说正文", deps)).rejects.toMatchObject({ code: "PAYMENT_REQUIRED", message: NOVEL_STEP_UNPAID });
    const throwing: NovelStepBillingDeps = {
      balance: async () => ({ totalAvailable: 0 }),
      charge: async () => {
        throw Object.assign(new Error("积分不足"), { name: "InsufficientCreditsError" });
      },
    };
    await expect(settleNovelStep(7, "req-3", 10, "小说正文", throwing)).rejects.toBeInstanceOf(TRPCError);
  });
  it("价格为 0 不调用扣费；重放无记录不扣", async () => {
    const { deps } = ledger(0);
    expect((await settleNovelStep(7, "req-4", 0, "x", deps)).cost).toBe(0);
    await replayNovelStepCharge(7, undefined, "x", deps);
    expect(deps.charge).not.toHaveBeenCalled();
  });
});

describe("审稿改稿三种模式的价格", () => {
  const base: NovelStepBillingInput = { stage: "revise", modelPreference: "auto", reviewModelPreference: "glm", rewriteModelPreference: "deepseek" };
  it("审稿改稿 = 审稿 + 改稿；只审稿 = 审稿；按所选意见改稿 = 改稿", () => {
    expect(novelStepCredits(base)).toBe(15);
    expect(novelStepCredits({ ...base, reviseMode: "review_only" })).toBe(10);
    expect(novelStepCredits({ ...base, reviewOverride: {} as never })).toBe(5);
  });
});

describe("底稿拆解", () => {
  const baseText = "示例底稿".repeat(40);
  const skeleton = { beats: [{ index: 1, name: "开局", function: "钩子", position: "第1章", roles: ["主角"], summary: "功能" }], properNouns: [] };
  const collect = async () => ({ scored: false, wholeCollected: false, highlightCount: 0 });
  it("预检不足不拆；成功扣一次；同底稿同线路再拆不重复扣", async () => {
    const price = novelImitationSkeletonCredits();
    const poor = ledger(price - 1);
    const resolve = vi.fn(async () => skeleton as never);
    await expect(runNovelImitationSkeleton(7, { requestId: "a", baseText }, { resolve, collect, role: "user", billing: poor.deps })).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
    });
    expect(resolve).not.toHaveBeenCalled();
    const rich = ledger(price * 3);
    await runNovelImitationSkeleton(7, { requestId: "a", baseText }, { resolve, collect, role: "user", billing: rich.deps });
    await runNovelImitationSkeleton(7, { requestId: "b", baseText }, { resolve, collect, role: "user", billing: rich.deps });
    expect(rich.left()).toBe(price * 2);
    expect(rich.charged.size).toBe(1);
  });
  it("拆解失败不扣", async () => {
    const { deps } = ledger(1000);
    const resolve = vi.fn(async () => {
      throw new Error("x");
    });
    await expect(runNovelImitationSkeleton(7, { requestId: "c", baseText }, { resolve, collect, billing: deps })).rejects.toBeInstanceOf(TRPCError);
    expect(deps.charge).not.toHaveBeenCalled();
  });
});
