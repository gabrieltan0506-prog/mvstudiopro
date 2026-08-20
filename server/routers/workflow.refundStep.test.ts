import { describe, expect, it } from "vitest";
import { workflowRouter } from "./workflow";

/**
 * 七审 P0-1 攻防:refundStep 对所有用户一律 FORBIDDEN——
 * 成功订单不能自退、他人扣款不能退、任何 chargeKey 都不放行。
 */
function caller(userId: number) {
  return workflowRouter.createCaller({ user: { id: userId, role: "user" } } as never);
}

describe("workflow.refundStep · 客户端退款能力下线", () => {
  it("用户不能退自己的(成功)扣款:任何 chargeKey 一律 FORBIDDEN", async () => {
    await expect(
      caller(7).refundStep({ chargeKey: "workflowStep/7/scene_image/abc-123-def-456" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("用户不能退他人扣款:同样 FORBIDDEN(资格判定根本不进业务逻辑)", async () => {
    await expect(
      caller(7).refundStep({ chargeKey: "workflowStep/8/scene_video/zzz-999" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("空参也 FORBIDDEN:路由已无任何退款分支", async () => {
    await expect(caller(7).refundStep({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
