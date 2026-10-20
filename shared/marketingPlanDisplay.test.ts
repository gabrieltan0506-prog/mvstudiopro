import { expect, it } from "vitest";
import { newMarketingPlan } from "./marketingPlan";
import { publicMarketingPlan, marketingPublicError } from "./marketingPlanDisplay";
it("公开结果不携带供应商回执与历史错误，旧原稿保持不变", () => {
  const raw = newMarketingPlan("亲子绘本与动画推广需求");
  raw.steps.deepseek = { status: "succeeded", text: "DeepSeek 1017 high：完整创意。", receipt: { model: "private-model", provider: "private-route", elapsedMs: 10, reasoningTokens: 123 }, history: [{ error: "private-error" }] };
  raw.steps.glm = { status: "failed", error: "供应商GLM FlashX high失败 https://private" };
  raw.steps.integrated = { status: "succeeded", text: "GLM建议共读，DeepSeek建议公开招募。", adoptionBrief: "GLM FlashX high方案的完整建议" };
  const before = JSON.stringify(raw), result = publicMarketingPlan(raw), json = JSON.stringify(result);
  expect(json).not.toMatch(/DeepSeek|GLM|high|FlashX|private|reasoningTokens|receipt|history/);
  expect(result.steps.deepseek.text).toBe("方案一：完整创意。");
  expect(result.steps.integrated.adoptionBrief).toBe("方案二方案的完整建议");
  expect(JSON.stringify(raw)).toBe(before);
  expect(marketingPublicError(new Error("积分不足，请充值后继续"))).toContain("积分不足");
});
