import { describe, it, expect } from "vitest";
import { advisorWorldCandidateSchema, advisorWorldSourceRevision, parseAdvisorWorldPlan, type AdvisorWorldTarget } from "./manhuaAdvisorWorld";
const target: AdvisorWorldTarget = { sceneRefId: "scene-clinic", labelZh: "露天诊台", sourceRevision: "a".repeat(64), hintZh: "山村药庐" };
const plan = { kind: "world_plan_v1", sceneRefId: target.sceneRefId, summaryZh: "诊台在树下，入口与等候处分开。", textPrompt: "露天诊台位于大树下，木桌在药庐门前，晨光从入口照入。" };
describe("顾问场景方案合同", () => {
  it("生成前接受可审查的非空场景方案", () => expect(parseAdvisorWorldPlan(JSON.stringify(plan), target)).toEqual(plan));
  it("不能换目标场景", () => {
    expect(() => parseAdvisorWorldPlan(JSON.stringify({ ...plan, sceneRefId: "other" }), target)).toThrow("不一致");
    expect(advisorWorldCandidateSchema.safeParse({ target, plan: { ...plan, sceneRefId: "other" } }).success).toBe(false);
  });
  it("拒绝空提示词、额外执行参数和媒体URL", () => {
    for (const invalid of [{ ...plan, textPrompt: "" }, { ...plan, model: "unapproved" }, { ...plan, textPrompt: "参考 https://example.invalid/image" }]) expect(() => parseAdvisorWorldPlan(JSON.stringify(invalid), target)).toThrow();
  });
  it("换图得到新版本标识，标识不包含对象地址", async () => {
    const old = await advisorWorldSourceRevision("gs://test.invalid/original");
    expect(old).toMatch(/^[a-f0-9]{64}$/);
    expect(await advisorWorldSourceRevision("gs://test.invalid/replacement")).not.toBe(old);
    expect(await advisorWorldSourceRevision("gs://test.invalid/original")).toBe(old);
  });
});
