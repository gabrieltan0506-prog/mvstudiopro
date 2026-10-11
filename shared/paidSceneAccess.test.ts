import { expect, it } from "vitest";
import { resolvePaidSceneAccess } from "./paidSceneAccess";

it("免费与未知会员状态均禁止场景建模，积分或邀请码不能替代会员", () => {
  for (const plan of ["free", undefined, "invite", "credits", "student_trial"]) {
    expect(resolvePaidSceneAccess("user", plan)).toMatchObject({ canGenerate: false, paidMember: false, reason: "membership_required" });
  }
});
it("pro/enterprise识别为正式会员，收费链未开放前不承诺可生成", () => {
  for (const plan of ["pro", "enterprise"]) {
    expect(resolvePaidSceneAccess("user", plan)).toMatchObject({ canGenerate: false, paidMember: true, reason: "member_launch_pending" });
  }
});
it("管理员与监管保留原内部验收权限", () => {
  for (const role of ["admin", "supervisor"]) expect(resolvePaidSceneAccess(role, undefined).canGenerate).toBe(true);
});
