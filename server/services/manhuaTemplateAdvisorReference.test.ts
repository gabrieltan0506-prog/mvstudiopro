import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank";
const { resolve, invoke } = vi.hoisted(() => ({ resolve: vi.fn(), invoke: vi.fn() }));
vi.mock("./manhuaViralTemplateStore.js", () => ({ resolveViralTemplateForExpand: resolve, listMergedApprovedManhuaViralTemplates: async () => [card, { ...card, publicCode: "B456" }, { ...card, publicCode: "C789" }] }));
vi.mock("../_core/llm.js", async (original) => {
  const real = await original<typeof import("../_core/llm.js")>();
  return { ...real, invokeLLM: invoke };
});
vi.mock("./gcs", async original => ({ ...await original<typeof import("./gcs")>(), listGcsObjectVersions: async () => [], downloadGcsObjectVersioned: vi.fn(), getGcsBucketName: () => "test-bucket" }));
vi.mock("../db.js", () => ({ getDb: async () => null }));
import { buildManhuaStoryboardTemplateReference, buildManhuaTemplateAdvisorReference, mentionedManhuaTemplateIds } from "./manhuaTemplateAdvisorReference";
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
    resolve.mockClear(); await expect(buildManhuaTemplateAdvisorReference("模板A123 B456 C789 D012 E345 F678")).rejects.toThrow("最多"); expect(resolve).not.toHaveBeenCalled();
  });
});

it("顾问可一次读取5份明确指定的真实模板能力", async () => {
  resolve.mockImplementation(async id => ({ card: { ...card, summaryZh: `${id}真实特色` }, appliedTemplate: { publicId: id, nameZh: "匿名模板" } }));
  const reference = await buildManhuaTemplateAdvisorReference("模板A123 B456 C789 D012 E345");
  expect(resolve.mock.calls.map(([id]) => id)).toEqual(["mt_a123", "mt_b456", "mt_c789", "mt_d012", "mt_e345"]);
  expect(reference).toContain("mt_e345真实特色");
});

describe("正式分镜3–5份真实模板参考", () => {
  const plans = ["mt_a123", "mt_b456", "mt_c789", "mt_d012", "mt_e345"].map(publicId => ({ publicId,
    reason: `${publicId}本集亮点`, changes: ["本集动作试探", "本集声音留白"], preserve: "保留原人物因果" }));
  it.each([3,5])("%s份顾问方案逐卡解析，特色与完整能力共同注入", async count => {
    resolve.mockImplementation(async id => ({ card: { ...card, summaryZh: `${id}能力全文`, reusableZh: `${id}真实手法` }, appliedTemplate: { publicId: id, nameZh: "匿名模板" } }));
    const result = await buildManhuaStoryboardTemplateReference(plans.slice(0,count));
    expect(result.appliedTemplates).toHaveLength(count);
    for (const plan of plans.slice(0,count)) {
      expect(result.text).toContain(plan.reason);
      expect(result.text).toContain(`${plan.publicId}能力全文`);
      expect(result.text).toContain(`${plan.publicId}真实手法`);
      expect(result.text).toContain(plan.changes[0]);
      expect(result.text).toContain(plan.preserve);
    }
    expect(result.appliedTemplates.every(plan => /^[a-f0-9]{64}$/.test(plan.capabilitySha256))).toBe(true);
    expect(result.text).not.toContain("来源真名");
    expect(result.text).not.toContain("tpl_private");
    expect(JSON.stringify(result.appliedTemplates)).not.toContain("能力全文");
  });
  it("重复别名解析成同一卡时拒绝，不伪装成3份", async () => {
    await expect(buildManhuaStoryboardTemplateReference(plans.slice(0,3))).rejects.toThrow("同一模板");
  });
  it("模板下架失败，不跳过坏卡拼成可执行输入", async () => {
    resolve.mockImplementation(async id => id === "mt_b456" ? { error: "not_found" } : { card, appliedTemplate: { publicId: id, nameZh: "匿名模板" } });
    await expect(buildManhuaStoryboardTemplateReference(plans.slice(0,3))).rejects.toThrow("不可用");
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});

it("手法推荐标记读取全部服务端方法，不依赖客户端六张列表", async () => {
 const reference = await buildManhuaTemplateAdvisorReference("【按创作手法推荐模板】请推荐");
 expect(reference).toContain("完整导演手法哨兵");
 expect(reference).toContain("mt_c789");
 expect(reference).not.toContain("来源真名");
});

it("用户不需要模板编号，普通顾问问题接入审订资料并保留本集正文", async () => {
  const question = "白平衡和色温怎么配合当前剧情";
  await askPlatformSkillQa({ userId: 1, isAdmin: true, question, rawQuestion: question, manhuaContext: context() });
  const request = JSON.stringify(invoke.mock.calls[0]![0].messages);
  expect(request).toContain("调相机还是描述光源");
  expect(request).toContain(context().episodeBody);
  expect(request).toContain("未找到相关原文");
});


it("后续正式分镜只消费用户选中的一个或多个模板亮点，未选内容不自动加入", async () => {
  const { attachLearnedMethodBrief } = await import("./manhuaTemplateMethodBrief");
  const selectedCard = attachLearnedMethodBrief({ ...card, beatGrid: [], laneZh: "悬疑权谋" }, { title: "先留下一个疑问", highlights: ["开场只给一半线索", "对话揭开另一半"], useWhen: "主角查明真相" });
  resolve.mockImplementation(async id => ({ card: { ...selectedCard, publicCode: id.slice(3) }, appliedTemplate: { publicId: id, nameZh: "匿名模板" } }));
  const plans = ["mt_a123", "mt_b456", "mt_c789", "mt_d012"].map((publicId, i) => ({ publicId, reason: "符合本集追查真相", changes: ["先给线索", "再揭答案"], preserve: "人物与因果", selected: i === 0, selectedFeatures: i === 0 ? ["brief:0:开场只给一半线索"] : [] }));
  const one = await buildManhuaStoryboardTemplateReference(plans);
  expect(one.appliedTemplates).toHaveLength(1); expect(one.text).toContain("只采用用户选中的亮点：开场只给一半线索"); expect(one.text).not.toContain("mt_b456");
  plans[2] = { ...plans[2], selected: true, selectedFeatures: ["brief:1:对话揭开另一半"] };
  const mixed = await buildManhuaStoryboardTemplateReference(plans); expect(mixed.appliedTemplates).toHaveLength(2);
  await expect(buildManhuaStoryboardTemplateReference(plans.map(p => ({ ...p, selected: false })))).rejects.toThrow("还没有选定");
});
