/**
 * 成片（视频生成）准入：一律限正式会员。
 *
 * 用户 2026-08-05 明文：**视频生成不开放给邀请码用户**。邀请码兑换的只是积分，
 * 账号 plan 仍是 free，所以有余额也不该起片——一段 720p 成本约 $2.3，
 * 1080p 约 $5.1，靠邀请码进来的号一晚上就能把上游账单烧穿。
 *
 * 与 `seedance25Access` 的会员判定同口径（pro / enterprise），但适用面更广：
 * 那边只管成片·加长的上线闸门，这里管所有画布成片档。
 */

export const PAID_VIDEO_MEMBER_ONLY_LABEL_ZH =
  "成片功能仅向正式会员开放，请先升级会员后再生成（邀请码兑换的积分不含成片权限）";

/** 正式会员：邀请码用户 plan 仍是 free，拿不到成片 */
export function canUsePaidVideoByPlan(plan: string | null | undefined): boolean {
  const p = String(plan || "free").trim().toLowerCase();
  return p === "pro" || p === "enterprise";
}

/** supervisor / admin：内部验收随时可用 */
export function isPaidVideoInternalRole(role: string | null | undefined): boolean {
  const r = String(role || "").trim().toLowerCase();
  return r === "supervisor" || r === "admin";
}

export type PaidVideoAccessInput = {
  plan?: string | null;
  role?: string | null;
};

export type PaidVideoAccessResult = {
  allowed: boolean;
  /** 拒绝原因；allowed 时为 null */
  reason: "member_only" | null;
  message: string | null;
};

/** 统一判定：前端灰选项与后端受理都用这一个，避免前端放行后端 402。 */
export function resolvePaidVideoAccess(input: PaidVideoAccessInput): PaidVideoAccessResult {
  if (isPaidVideoInternalRole(input.role)) {
    return { allowed: true, reason: null, message: null };
  }
  if (!canUsePaidVideoByPlan(input.plan)) {
    return { allowed: false, reason: "member_only", message: PAID_VIDEO_MEMBER_ONLY_LABEL_ZH };
  }
  return { allowed: true, reason: null, message: null };
}
