import { expect, it } from "vitest";
import { adoptMarketingPlan, buildMarketingPlanPrompt, buildMarketingIntegrationPrompt } from "./marketingPlan";
import { compileViralCreatorInput } from "./viralCreationMethods";
import { buildMarketingPrompt } from "./marketingSkills";
it.each(["网站mvstudiopro.com需要推广", "亲子绘本《妈妈今天也大声了》需要营销推广"])("%s采用后真实进入创作编译与扩写", context => {
  const brief = "事实：产品仍在准备。假设：共读试用。建议：妈妈道歉后的反差，正文兑现，封面突出小动作，发布标题与亲子标签对应内容。";
  const adopted = adoptMarketingPlan(context, brief);
  expect(adopted.value).toContain(context);
  const compiled = compileViralCreatorInput({ profile: adopted.value });
  expect(compiled.user).toContain(brief);
  expect(compiled.system).toContain("marketing-");
  expect(buildMarketingPrompt({stage:"expand",context:adopted.value})).toContain("封面");
  expect(adoptMarketingPlan(adopted.value, brief).value).toBe(adopted.value);
});
it("超限明确拒绝而非截断原需求或方案", () => {
  expect(adoptMarketingPlan("原".repeat(7990), "方案摘要".repeat(30))).toMatchObject({ value: "原".repeat(7990), error: expect.any(String) });
});
it("保留未验证创意且贯穿制作发布，不把假设删成禁止清单", () => {
  for (const prompt of [buildMarketingPlanPrompt("推广亲子绘本产品"),buildMarketingIntegrationPrompt()]) {
    expect(prompt).toContain("免费试用"); expect(prompt).toContain("假设");
    expect(prompt).toContain("正文"); expect(prompt).toContain("分镜"); expect(prompt).toContain("标签");
  }
});
it("专门的营销分析按钮为未写商业词的需求应用方法，仍尊重明确不营销", () => {
  expect(buildMarketingPlanPrompt("亲子关系儿童绘本和动画")).toContain("[marketing-offer-ladder]");
  expect(buildMarketingPlanPrompt("亲子关系儿童绘本，本轮不要营销")).not.toContain("[marketing-offer-ladder]");
});
