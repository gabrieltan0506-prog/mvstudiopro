import { describe, expect, it } from "vitest";
import { buildMarketingPrompt, isMarketingContext, MARKETING_METHODS, MARKETING_SOURCES, MARKETING_UPSTREAM_SHA } from "./marketingSkills";
import { buildViralMethodPlan, compileViralCreatorInput, VIRAL_CREATION_METHODS } from "./viralCreationMethods";
import { auditXhsCreationPackage } from "./xhsCreationPackage";
import { fictionalViralBlueprint } from "./viralCreation.fixture";

describe("营销方法只进入明确商业背景", () => {
  it.each(["亲子关系儿童绘本、动画", "给家长写儿童情绪科普", "暂无产品，只分享睡前故事", "我有绘本产品，但不要营销，只做科普", "讲亲子沟通，不以获客为目标"])("不把%s改成销售", context => {
    expect(isMarketingContext(context)).toBe(false);
    expect(buildMarketingPrompt({stage:"shortlist",context})).toBe("");
    expect(buildViralMethodPlan(context).marketing.methods).toEqual([]);
    const compiled = compileViralCreatorInput({ profile: context });
    expect(JSON.parse(compiled.user).methodLibrary.some((m: {id: string}) => m.id.startsWith("marketing-"))).toBe(false);
  });
  it.each(["为亲子绘本获客", "设计引流品、利润品和高价产品", "产品：亲子动画；售价待补", "我们经营儿童书店", "pricing for a parenting book"])("识别%s的显式商业要求", context => {
    expect(isMarketingContext(context)).toBe(true);
  });
  it.each(["shortlist", "expand", "optimize", "research"] as const)("%s保留经济与亲子边界", stage => {
    const prompt = buildMarketingPrompt({stage,context:"亲子关系儿童绘本和动画，需要获客，成本未知"});
    expect(prompt).toContain("缺售价/成本不算利润");
    expect(prompt).toContain("分母为零");
    expect(prompt).toContain("净利还须扣除");
    expect(prompt).toContain("不得承诺诊断、治疗、治愈");
    expect(prompt).toContain("不新增JSON字段");
    expect(prompt).toContain(MARKETING_UPSTREAM_SHA);
  });
  it("搜索方法按需要出现，不给普通销售任务硬加SEO", () => {
    expect(buildMarketingPrompt({stage:"expand",context:"绘本获客"})).not.toContain("[marketing-ai-seo]");
    expect(buildMarketingPrompt({stage:"research",context:"绘本获客网站的搜索内容"})).toContain("[marketing-ai-seo]");
  });
  it("独立编译与方法计划共用同一方法来源", () => {
    const result=compileViralCreatorInput({profile:"做亲子绘本",requirements:"需要获客，售价未知"});
    expect(result.system).toContain("[marketing-offer-ladder]");
    const plan=JSON.parse(result.user).methodPlan.marketing;
    expect(plan.enabled).toBe(true);
    expect(plan.methods.map((m:{id:string})=>m.id)).toContain("marketing-copy-proof");
    expect(MARKETING_METHODS.every(m => m.sourceIds.every(id => MARKETING_SOURCES.some(s=>s.id===id)))).toBe(true);
    expect(new Set(VIRAL_CREATION_METHODS.map(m=>m.id)).size).toBe(VIRAL_CREATION_METHODS.length);
  });
  it("营销方法ID沿用原审核，假引用仍被拒绝", () => {
    const bp=fictionalViralBlueprint();
    bp.methodApplications[0].methodId="marketing-copy-proof";
    expect(auditXhsCreationPackage(bp).passed).toBe(true);
    bp.methodApplications[0].quote="从未在正文分页或分镜里出现的虚构引用";
    expect(auditXhsCreationPackage(bp).findings.map(f=>f.code)).toContain("method_application");
  });
});
