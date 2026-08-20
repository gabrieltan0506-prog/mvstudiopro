import { describe, expect, it } from "vitest";
import { workflowRouter } from "./workflow";

/**
 * 八审 P0-2:refundScriptGenerationCharge 曾对任意登录用户无条件退 amount(1-10)积分,
 * 反复调用即凭空造币。现一律 FORBIDDEN。
 */
function caller(userId: number) {
  return workflowRouter.createCaller({ user: { id: userId, role: "user" } } as never);
}

describe("workflow.refundScriptGenerationCharge · 造币旁门封禁(八审 P0-2)", () => {
  it("任意 amount 一律 FORBIDDEN,不再增加余额", async () => {
    await expect(caller(7).refundScriptGenerationCharge({ amount: 10 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("空参也 FORBIDDEN", async () => {
    await expect(caller(7).refundScriptGenerationCharge({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
