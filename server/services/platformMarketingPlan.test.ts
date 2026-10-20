import { describe, expect, it, vi } from "vitest";
import { newMarketingPlan, MARKETING_PLAN_MODELS, marketingPlanReady } from "../../shared/marketingPlan";
import { runMarketingPlan, callMarketingPlanModel } from "./platformMarketingPlan";
import { invokeLLM } from "../_core/llm";
vi.mock("../_core/llm", () => ({ invokeLLM: vi.fn(), extractJsonString: (v: string) => v,
  extractFirstChoicePlainText: (v: any) => v.choices[0].message.content }));

const integration = { knownFacts: "已经确认只有第一页绘本，尚无家长群。", hypotheses: "免费共读是可测试候选，报名人数待验证。",
  actions: "从公开账号发布一页故事，以妈妈道歉后的修复为切口，邀请读者反馈；先看收藏与真实留言，再决定是否做下一页。",
  creativeAlternatives: "GLM建议免费共读，DeepSeek建议公开招募，两种路线都保留。",
  mergeNotes: "共同的试读建议合并，未验证优惠保留为实验，不当作已提供服务。",
  adoptionBrief: "事实：只有第一页。假设：免费共读能吸引读者。建议：以妈妈道歉后的修复为反差，正文兑现；发布标题和亲子标签须对应故事。" };
const original = "这是测试用完整营销原稿。".repeat(10);
const completion = (step: string) => ({ text: step === "integrated" ? JSON.stringify(integration) : `${step}\n${original}`, finishReason: "stop",
  receipt: { id: `test-${step}`, model: MARKETING_PLAN_MODELS[step as keyof typeof MARKETING_PLAN_MODELS], elapsedMs: 5 } });
function dependencies() {
  return { call: vi.fn(async ({ step }: Parameters<typeof callMarketingPlanModel>[0]) => completion(step)), save: vi.fn(async () => {}), settle: vi.fn(async () => 3) };
}
describe("三次营销模型调用的恢复与结算", () => {
  it("先保存两原稿再整合、只结算一次，重读已成功任务不再调用", async () => {
    const deps = dependencies();
    const result = await runMarketingPlan("test-job", newMarketingPlan("亲子绘本推广，尚无家长群资源"), deps);
    expect(deps.call.mock.calls.map(c => c[0].step)).toEqual(["deepseek", "glm", "integrated"]);
    expect(deps.call.mock.calls[2][0]).toMatchObject({ originals: { deepseek: `deepseek\n${original}`, glm: `glm\n${original}` } });
    expect(result.steps.integrated.text).toContain(integration.creativeAlternatives);
    expect(marketingPlanReady(result)).toBe(true);
    await runMarketingPlan("test-job", result, deps);
    expect(deps.call).toHaveBeenCalledTimes(3); expect(deps.settle).toHaveBeenCalledTimes(1);
  });
  it("一路异常保留另一原稿，不整合不扣费；重试仅恢复该路", async () => {
    const deps = dependencies();
    deps.call.mockImplementation(async ({ step }) => { if (step === "glm") throw new Error("connection lost"); return completion(step); });
    const first = await runMarketingPlan("test-job", newMarketingPlan("亲子绘本推广，尚无家长群资源"), deps);
    expect(first.steps.glm.status).toBe("unknown"); expect(first.steps.deepseek.status).toBe("succeeded");
    expect(deps.settle).not.toHaveBeenCalled(); expect(deps.call).toHaveBeenCalledTimes(2);
    first.steps.glm.status = "pending";
    deps.call.mockClear().mockImplementation(async ({step}) => completion(step));
    const recovered = await runMarketingPlan("test-job", first, deps);
    expect(deps.call.mock.calls.map(c => c[0].step)).toEqual(["glm", "integrated"]);
    expect(marketingPlanReady(recovered)).toBe(true);
  });
  it("恢复中的running改为unknown，不重发；已成功整合遇结算故障只补账", async () => {
    const deps = dependencies();
    const saved = newMarketingPlan("推广中文创作网站，价格待核实");
    saved.steps.deepseek.status = "running";
    const unknown = await runMarketingPlan("test-job", saved, deps);
    expect(unknown.steps.deepseek.status).toBe("unknown");
    expect(deps.call.mock.calls.map(c => c[0].step)).toEqual(["glm"]);
    deps.call.mockClear(); deps.settle.mockRejectedValueOnce(new Error("db unavailable"));
    const failed = await runMarketingPlan("test-other", newMarketingPlan("推广中文创作网站，价格待核实"), deps);
    expect(failed.billing).toBe("failed"); expect(failed.steps.integrated.status).toBe("succeeded");
    deps.call.mockClear(); await runMarketingPlan("test-other", failed, deps);
    expect(deps.call).not.toHaveBeenCalled(); expect(deps.settle).toHaveBeenCalledTimes(2);
  });
  it("持久化失败立刻中止，不继续下一次付费调用", async () => {
    const deps = dependencies(); deps.save.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("save failed"));
    await expect(runMarketingPlan("test-job", newMarketingPlan("推广中文创作网站，价格待核实"), deps)).rejects.toThrow("save failed");
    expect(deps.call).toHaveBeenCalledTimes(1); expect(deps.settle).not.toHaveBeenCalled();
  });
  it.each(["length", "stop"])("拒绝%s的截断或无效整合并保留原始返回", async finishReason => {
    const deps = dependencies(); deps.call.mockImplementation(async ({step}) => step === "integrated"
      ? { ...completion(step), text: "无效整合内容".repeat(30), finishReason } : completion(step));
    const result = await runMarketingPlan("test-job", newMarketingPlan("推广中文创作网站，价格待核实"), deps);
    expect(result.steps.integrated.status).toBe("failed"); expect(result.steps.integrated.text).toContain("无效整合内容");
    expect(deps.settle).not.toHaveBeenCalled();
  });
  it("实际模型适配器发送精确ID、high及完整两原稿，不走Qwen回退", async () => {
    vi.mocked(invokeLLM).mockResolvedValue({ id: "test", created: 1, model: MARKETING_PLAN_MODELS.integrated,
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(integration) }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } });
    await callMarketingPlanModel({ step: "integrated", context: "原始用户需求", originals: { deepseek: original, glm: original + "另一份" }, requestId: "test/merge" });
    const args = vi.mocked(invokeLLM).mock.calls.at(-1)![0];
    expect(args).toMatchObject({ modelName: MARKETING_PLAN_MODELS.integrated, reasoningEffort: "high", max_tokens: 24000 });
    expect(JSON.parse(args.messages[1].content as string)).toMatchObject({ originalRequirement: "原始用户需求", drafts: { glm: original + "另一份" } });
  });
});
