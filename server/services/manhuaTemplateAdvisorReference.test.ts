import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank";
const { resolve, invoke } = vi.hoisted(() => ({ resolve: vi.fn(), invoke: vi.fn() }));
vi.mock("./manhuaViralTemplateStore.js", () => ({ resolveViralTemplateForExpand: resolve, listMergedApprovedManhuaViralTemplates: async () => [card, { ...card, publicCode: "B456" }, { ...card, publicCode: "C789" }] }));
vi.mock("../_core/llm.js", async (original) => {
  const real = await original<typeof import("../_core/llm.js")>();
  return { ...real, invokeLLM: invoke };
});
vi.mock("../db.js", () => ({ getDb: async () => null }));
import { buildManhuaTemplateAdvisorReference, mentionedManhuaTemplateIds } from "./manhuaTemplateAdvisorReference";
import { buildManhuaCreativeAdvisorLlmMessages, askPlatformSkillQa } from "./platformSkillQa";
import { manhuaCreativeAdvisorContextSchema } from "../../shared/manhuaCreativeAdvisor";
const card = { id: "tpl_private", nameZh: "来源真名", publicCode: "A123", status: "approved", summaryZh: "完整能力哨兵", reusableZh: "完整导演手法哨兵", storyStructure: { episodeProgressionZh: ["跨集推进哨兵"], variationRulesZh: ["变体规则哨兵"] } } as ManhuaViralTemplateCard;
beforeEach(() => { invoke.mockReset(); invoke.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ answer: "结合当前稿保留保护者关系，借鉴冲突升级；不要照搬来源人物。", imageIntent: false, creationRelated: false, suggestedImagePrompt: "", guideMessage: "" }) } }] }); resolve.mockReset(); resolve.mockResolvedValue({ card, appliedTemplate: { publicId: "mt_a123", nameZh: "匿名模板" } }); });
const context = () => manhuaCreativeAdvisorContextSchema.parse({ seriesTitle: "自写新剧", episodeIndex: 1, episodeTitle: "公开证据", stage: "outline", videoModel: "未选择", writerConfirmed: true, episodeBody: "女主决定公开证据，却会牵连一直保护她的人。", assetSummary: "", shotSummary: "", blockers: [] });
describe("模板编号顾问服务端链", () => {
  it("真实顾问ask把完整能力发到模型请求，不可用编号在模型之前失败", async () => {
    const question = "根据当前稿评估模板编号 A123";
    const answer = await askPlatformSkillQa({ userId: 1, isAdmin: true, question, rawQuestion: question, manhuaContext: context() });
    expect(answer.answer).toContain("保护者关系");
    const request = invoke.mock.calls[0]![0];
    expect(JSON.stringify(request.messages)).toContain("完整导演手法哨兵");
    expect(JSON.stringify(request.messages)).toContain(context().episodeBody);
    invoke.mockClear(); resolve.mockResolvedValue({ error: "not_found" });
    await expect(askPlatformSkillQa({ userId: 1, isAdmin: true, question, rawQuestion: question, manhuaContext: context() })).rejects.toThrow("当前不可用");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("本轮明确编号才读，大小写/旧编号/长码边界正确，不从普通镜头问题取编号", () => {
    expect(mentionedManhuaTemplateIds("请看当前A123镜头的FOV变化")).toEqual([]);
    expect(mentionedManhuaTemplateIds("评估模板编号 A123 和 mt_b456；不要混入A1234")).toEqual(["mt_a123", "mt_b456", "mt_a1234"]);
    expect(mentionedManhuaTemplateIds("模板编号 a123适合吗")).toEqual(["mt_a123"]);
  });
  it("真实消息同时读到当前稿和指定完整能力，公开真名/内部ID未装入", async () => {
    const reference = await buildManhuaTemplateAdvisorReference("根据当前稿评估模板编号 A123");
    const context = manhuaCreativeAdvisorContextSchema.parse({ seriesTitle: "自写新剧", episodeIndex: 1, episodeTitle: "公开证据", stage: "outline", videoModel: "未选择", writerConfirmed: true, episodeBody: "女主决定公开证据，却会牵连一直保护她的人。", assetSummary: "", shotSummary: "", blockers: [] });
    const messages = buildManhuaCreativeAdvisorLlmMessages({ question: "根据当前稿评估模板编号 A123", context, templateReference: reference });
    const user = messages.find(m => m.role === "user")!.content;
    for (const text of [context.episodeBody, "完整能力哨兵", "完整导演手法哨兵", "跨集推进哨兵", "变体规则哨兵"]) expect(user).toContain(text);
    expect(user).not.toContain("来源真名"); expect(user).not.toContain("tpl_private");
    expect(resolve).toHaveBeenCalledWith("mt_a123");
  });
  it("不可用或超容量明确拒绝，不用假摘要冒充完整能力", async () => {
    resolve.mockResolvedValue({ error: "not_found" });
    await expect(buildManhuaTemplateAdvisorReference("模板编号 A123")).rejects.toThrow("当前不可用");
    resolve.mockResolvedValue({ card: { ...card, summaryZh: "x".repeat(48001) }, appliedTemplate: { publicId: "mt_a123" } });
    await expect(buildManhuaTemplateAdvisorReference("模板编号 A123")).rejects.toThrow("超过");
    resolve.mockClear(); await expect(buildManhuaTemplateAdvisorReference("模板A123 B456 C789 D012")).rejects.toThrow("最多"); expect(resolve).not.toHaveBeenCalled();
  });
});

it("手法推荐标记读取全部服务端方法，不依赖客户端六张列表", async () => {
 const reference = await buildManhuaTemplateAdvisorReference("【按创作手法推荐模板】请推荐");
 expect(reference).toContain("完整导演手法哨兵");
 expect(reference).toContain("mt_c789");
 expect(reference).not.toContain("来源真名");
});
