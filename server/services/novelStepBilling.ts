/**
 * 小说工作台 · 各环节计费（1112 对普通登录用户开放；价格真源 shared/novelStepBilling.ts）。
 *
 * 写法照 novelCreativePremiseBilling：
 * - 调模型前预检余额（管理员 / supervisor 跳过；他们由 deductCreditsAmount 内部 0 扣）。
 * - 成功、校验通过后才扣（后扣，失败不扣，无需退款）；chargeKey = novelStepChargeKey(userId, requestId) 幂等。
 * - 扣不成（余额不足 / 未成功）抛 PAYMENT_REQUIRED，调用方把这次记为未交付。
 * - 同 requestId 已成功的重放：按记录的 price + chargeKey 幂等补扣（已扣过直接命中，不重复扣）。
 */
import { TRPCError } from "@trpc/server";
import {
  NOVEL_STEP_CHARGE_ACTION,
  NOVEL_STEP_NEED_CREDITS,
  NOVEL_STEP_UNPAID,
  novelStepChargeKey,
} from "../../shared/novelStepBilling";
import { isNovelPrivilegedRole, type NovelCreativePremiseBillingDeps } from "./novelCreativePremiseBilling";

export type NovelStepBillingDeps = Pick<NovelCreativePremiseBillingDeps, "balance" | "charge">;
export type NovelStepBillingRecord = { price: number; cost: number; chargeKey: string };

/** 扣费说明（用户可见账单里显示）。 */
export const NOVEL_STEP_CHARGE_DESC: Record<string, string> = {
  advice: "小说创作顾问",
  outline: "小说大纲",
  chapter: "小说正文",
  script: "小说剧本",
  revise: "小说审稿改稿",
  skeleton: "底稿结构拆解",
};

/** 调模型前预检：余额不足直接拒绝（不登记、不调用）。 */
export async function assertNovelStepAffordable(
  userId: number,
  role: string | null | undefined,
  credits: number,
  deps: Pick<NovelStepBillingDeps, "balance">
) {
  if (credits <= 0 || isNovelPrivilegedRole(role)) return;
  if ((await deps.balance(userId)).totalAvailable < credits)
    throw new TRPCError({ code: "PAYMENT_REQUIRED", message: NOVEL_STEP_NEED_CREDITS(credits) });
}

/** 成功、校验通过后结算一次；按 requestId 幂等。扣不成抛 PAYMENT_REQUIRED（未交付）。 */
export async function settleNovelStep(
  userId: number,
  requestId: string,
  credits: number,
  description: string,
  deps: Pick<NovelStepBillingDeps, "charge">
): Promise<NovelStepBillingRecord> {
  const chargeKey = novelStepChargeKey(userId, requestId);
  if (credits <= 0) return { price: 0, cost: 0, chargeKey };
  let deduction: Awaited<ReturnType<NovelStepBillingDeps["charge"]>>;
  try {
    deduction = await deps.charge(userId, credits, NOVEL_STEP_CHARGE_ACTION, description, { chargeKey });
  } catch (error) {
    if ((error as Error)?.name === "InsufficientCreditsError" || /不足/.test(String((error as Error)?.message ?? "")))
      throw new TRPCError({ code: "PAYMENT_REQUIRED", message: NOVEL_STEP_UNPAID });
    throw error;
  }
  if (!deduction.success) throw new TRPCError({ code: "PAYMENT_REQUIRED", message: NOVEL_STEP_UNPAID });
  return { price: credits, cost: deduction.cost, chargeKey };
}

/** 同 requestId 已成功的重放：按记录的价格与同 chargeKey 幂等补扣。 */
export async function replayNovelStepCharge(
  userId: number,
  billing: { price?: number; chargeKey?: string } | undefined,
  description: string,
  deps: Pick<NovelStepBillingDeps, "charge">
) {
  if (!billing?.price || !billing.chargeKey) return;
  const deduction = await deps.charge(userId, billing.price, NOVEL_STEP_CHARGE_ACTION, description, {
    chargeKey: billing.chargeKey,
  });
  if (!deduction.success) throw new TRPCError({ code: "PAYMENT_REQUIRED", message: NOVEL_STEP_UNPAID });
}

/** 生产依赖：余额 / 扣费走 server/credits.ts 现有函数。 */
let creditsModule: Promise<typeof import("../credits")> | undefined;
// 同一个 import 承诺共用：并发请求同时首次加载时不各自解析。
const credits = () => (creditsModule ??= import("../credits"));
export function defaultNovelStepBillingDeps(): NovelStepBillingDeps {
  return {
    balance: async userId => (await credits()).getCredits(userId),
    charge: async (...args) => (await credits()).deductCreditsAmount(...args),
  };
}
