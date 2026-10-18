import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ llm: vi.fn(), trends: vi.fn() }));
vi.mock("../_core/llm.js", () => ({ invokeLLM: mocks.llm, extractJsonString: (s: string) => s, extractFirstChoicePlainText: (r: any) => r.choices[0].message.content }));
vi.mock("../growth/trendStore.js", () => ({ readTrendStoreForPlatforms: mocks.trends }));
vi.mock("../db.js", () => ({ getDb: async () => null }));
import { askPlatformSkillQa } from "./platformSkillQa";
import { manhuaCreativeAdvisorContextSchema } from "../../shared/manhuaCreativeAdvisor";
import { digitalHumanPublicationPlanSchema, parseDigitalHumanPublicationPlan } from "../../shared/digitalHumanPublication";
const target = { id: "draft-1", script: "用AI整理工作资料。" };
const context = () => manhuaCreativeAdvisorContextSchema.parse({ seriesTitle: "数字人", episodeIndex: 1, episodeTitle: "当前稿件", stage: "final", videoModel: "未选择", writerConfirmed: true, episodeBody: target.script, assetSummary: "", shotSummary: "", blockers: [], digitalHumanPublication: target });
const plan = () => ({ kind: "digital_human_publication_v1", targetId: target.id, platforms: ["douyin", "xiaohongshu", "weixin_channels"].map(platform => ({ platform, titles: ["资料太乱怎么办", "这样整理工作资料", "让资料有条理"], tags: ["资料整理", "工作方法", "AI工具"] })) });
const reply = (answer: unknown) => ({ choices: [{ message: { content: JSON.stringify({ answer, imageIntent: true }) } }] });
beforeEach(() => { vi.clearAllMocks(); mocks.trends.mockResolvedValue({ collections: {} }); mocks.llm.mockResolvedValue(reply(plan())); });
describe("数字人发布建议", () => {
  it("完整读取三个真实平台，B站参考保留，返回结构不被通用顾问追加说明", async () => {
    const collections = Object.fromEntries(["douyin", "xiaohongshu", "bilibili"].map(platform => [platform, { items: Array.from({ length: 18 }, (_, i) => ({ title: `${platform}真实条目${i}`, tags: ["整理"], likes: 100 - i })) }]));
    mocks.trends.mockResolvedValue({ collections, truthSource: "test-only" });
    const result = await askPlatformSkillQa({ userId: 7, isAdmin: true, question: "推荐标题标签", manhuaContext: context() });
    expect(mocks.trends).toHaveBeenCalledWith(["douyin", "xiaohongshu", "bilibili"], expect.objectContaining({ preferDerivedFiles: true }));
    const messages = JSON.stringify(mocks.llm.mock.calls[0][0].messages);
    expect(messages).toContain(target.script); expect(messages).toContain("bilibili真实条目17");
    expect(messages).toContain("不得说它是视频号数据"); expect(messages).not.toContain("生产编译器事实");
    expect(JSON.parse(result.answer)).toEqual(plan()); expect(result.imageOffer).toBeNull();
  });
  it.each(["empty", "failure"])("%s时只基于文稿建议，禁止冒称热点", async mode => {
    if (mode === "failure") mocks.trends.mockRejectedValue(Error("test-only offline"));
    await askPlatformSkillQa({ userId: 7, isAdmin: true, question: "推荐标题标签", manhuaContext: context() });
    expect(JSON.stringify(mocks.llm.mock.calls[0][0].messages)).toContain("仅根据文稿推荐，不声称热点或趋势");
  });
  it("普通数字人顾问仍不读取Growth", async () => {
    const { digitalHumanPublication, ...plain } = context();
    mocks.llm.mockResolvedValue(reply("保持现在的文稿与构图。"));
    await askPlatformSkillQa({ userId: 7, isAdmin: true, question: "检查抖音场景构图", manhuaContext: { ...plain, digitalHumanProduction: { direction: "正面讲述" } } });
    expect(mocks.trends).not.toHaveBeenCalled();
  });
  it("拒绝混入其他工序或文稿版本不一致", () => {
    expect(() => manhuaCreativeAdvisorContextSchema.parse({ ...context(), templateRecommendation: true })).toThrow();
    expect(() => manhuaCreativeAdvisorContextSchema.parse({ ...context(), episodeBody: "另一版" })).toThrow();
  });
  it("拒绝空标题、重复平台、来源字段和跨作品回包", () => {
    const value = plan(); value.platforms[0].titles[0] = ""; expect(() => digitalHumanPublicationPlanSchema.parse(value)).toThrow();
    const repeated = plan(); repeated.platforms[2].platform = "douyin"; expect(() => digitalHumanPublicationPlanSchema.parse(repeated)).toThrow();
    expect(() => digitalHumanPublicationPlanSchema.parse({ ...plan(), sources: ["外链"] })).toThrow();
    expect(() => parseDigitalHumanPublicationPlan(JSON.stringify({ ...plan(), targetId: "other" }), target)).toThrow();
  });
  it("错误作品回包按既有路由重试并严格校验，最终仅交回正确结构", async () => {
    mocks.llm.mockResolvedValueOnce(reply({ ...plan(), targetId: "other" })).mockResolvedValueOnce(reply(plan()));
    const result = await askPlatformSkillQa({ userId: 7, isAdmin: true, question: "推荐标题标签", manhuaContext: context() });
    expect(mocks.llm).toHaveBeenCalledTimes(2); expect(JSON.parse(result.answer)).toEqual(plan());
    expect(JSON.stringify(mocks.llm.mock.calls[1][0].messages)).toContain(target.script);
  });
  it("付费未确认在读取Growth与模型之前阻断", async () => {
    await expect(askPlatformSkillQa({ userId: 7, question: "推荐标题标签", manhuaContext: context(), projectQuotaUsed: 99, freeQuotaReserved: false })).rejects.toThrow("请确认");
    expect(mocks.llm).not.toHaveBeenCalled(); expect(mocks.trends).not.toHaveBeenCalled();
  });
});
