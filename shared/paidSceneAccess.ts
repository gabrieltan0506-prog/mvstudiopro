export type PaidSceneAccess = {
  canGenerate: boolean;
  paidMember: boolean;
  reason: "internal_access" | "membership_required" | "member_launch_pending";
  message: string;
};

/** 会员资格不等于生成授权；普通会员须等本站收费链开放，内部验收沿用原权限。 */
export function resolvePaidSceneAccess(role: string, plan: unknown): PaidSceneAccess {
  const paidMember = plan === "pro" || plan === "enterprise";
  if (role === "admin" || role === "supervisor") {
    return { canGenerate: true, paidMember, reason: "internal_access", message: "当前为内部验收入口，生成及重试仍须按本次内容与费用确认。" };
  }
  if (!paidMember) {
    return { canGenerate: false, paidMember: false, reason: "membership_required", message: "3D 场景建模仅限付费会员；普通会员入口尚未开放。邀请码或积分余额不代表会员资格。" };
  }
  return { canGenerate: false, paidMember: true, reason: "member_launch_pending", message: "已确认付费会员身份。3D 场景建模的会员入口尚未开放，当前不能提交生成或重试。" };
}
