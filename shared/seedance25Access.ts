/**
 * Seedance 2.5（成片·加长）产品闸门：仅正式付费会员（Stripe plan pro/enterprise）。
 * 邀请码只加积分、不改 plan → 仍为 free，不可用 2.5，只能用成片·快速等。
 */

export const SEEDANCE_25_PAID_ONLY_LABEL_ZH =
  "成片·加长仅正式会员可用；邀请码用户请使用成片·快速";

export function canAccessSeedance25ByPlan(plan: string | null | undefined): boolean {
  const p = String(plan || "free").trim().toLowerCase();
  return p === "pro" || p === "enterprise";
}
