import { beforeEach, describe, expect, it, vi } from "vitest";
import { fictionalViralBlueprint } from "../../shared/viralCreation.fixture";
import { XHS_CONTENT_SKILL_ID } from "../../shared/xhsContentStrategy";
import { platformTopicShortlistItemSchema } from "../../shared/platformTopicShortlist";
const mock = vi.hoisted(() => ({ llm: vi.fn(), trends: vi.fn(), campaigns: vi.fn() }));
vi.mock("../_core/llm.js", () => ({ invokeLLM: mock.llm, extractFirstChoicePlainText: (v: string) => v, isTransientLlmError: () => false }));
vi.mock("./platformSkillsService.js", () => ({ listAllPlatformSkillsForUser: async () => [{ id: "xhs-content-growth", defaultEnabled: false }], composePlatformSkillsPromptBlock: () => "用户五份资料的方法" }));
vi.mock("../growth/trendStore.js", () => ({ readLocalTrendCollectionsForPlatforms: mock.trends }));
vi.mock("./platformOfficialCampaigns", () => ({ ensureOfficialCampaignSeedsLoaded: mock.campaigns, listOfficialCampaigns: async () => [], pickLinkedCampaignsForTopic: async () => [] }));
import { generatePlatformTopicShortlist, expandPlatformTopicPicks } from "./platformTopicShortlist";
const rawTopic = (i: number) => ({ title: `会议沟通练习方案${i}`, hookSketch: "开会时先确认问题", conveyGoal: "给出具体可执行的沟通练习", skillsUsed: [XHS_CONTENT_SKILL_ID], primaryLane: "default", formatHint: "图文", dedupeKey: `meeting${i}`, commentHook: "分享", viralScore: 80 });
const pick = platformTopicShortlistItemSchema.parse({ ...rawTopic(1), id: "fiction-topic" });
describe("爆款创作真实服务入口（模型和数据读取隔离）", () => {
 beforeEach(() => { vi.clearAllMocks(); mock.trends.mockImplementation(async ([platform]: string[]) => ({ [platform]: { items: [{ id: `${platform}-sample`, title: "会议沟通表达", publishedAt: new Date(Date.now() - 86400000).toISOString(), likes: 20 }] } })); });
 it("2–3题真实调用带五资料方法和双平台Growth，保留出处", async () => {
  mock.llm.mockResolvedValue(JSON.stringify({ topics: [rawTopic(1), rawTopic(2), rawTopic(3)] }));
  const result = await generatePlatformTopicShortlist({ userId: 1, context: "职场沟通", count: 20, enabledSkillIds: [XHS_CONTENT_SKILL_ID], creationPlatforms: ["xiaohongshu", "douyin"] });
  expect(result.topics).toHaveLength(3);
  const request = mock.llm.mock.calls[0][0]; const input = JSON.parse(request.messages[1].content);
  expect(request.modelName).toBe("z-ai/glm-5.3-flashx"); expect(input.methodPlan.structureLibrary.length).toBe(6);
  expect(input.xhsGrowthEvidence.samples[0].id).toBe("xiaohongshu-sample"); expect(input.douyinGrowthEvidence.samples[0].id).toBe("douyin-sample");
  expect(result.topics[0].douyinGrowthEvidence?.samples[0].id).toBe("douyin-sample"); expect(mock.campaigns).not.toHaveBeenCalled();
 });
 it("无数据库样本也能返回明确无证据的创意", async () => {
  mock.trends.mockResolvedValue({}); mock.llm.mockResolvedValue(JSON.stringify({ topics: [rawTopic(1), rawTopic(2)] }));
  const result = await generatePlatformTopicShortlist({ userId: 1, context: "会议沟通", count: 2, enabledSkillIds: [XHS_CONTENT_SKILL_ID] });
  expect(result.topics).toHaveLength(2); expect(result.topics[0].xhsGrowthEvidence?.samples).toEqual([]);
 });
 it("扩写统一GLM，失败只切同款EvoLink，方案送入最终消费者字段", async () => {
  mock.llm.mockRejectedValueOnce(new Error("渠道不可用")).mockResolvedValueOnce(JSON.stringify({ blueprint: fictionalViralBlueprint() }));
  const result = await expandPlatformTopicPicks({ userId: 1, context: "职场沟通", engine: "qwen3.8-max", enabledSkillIds: [XHS_CONTENT_SKILL_ID], picks: [{ ...pick, targetPlatform: "douyin" }] });
  expect(mock.llm.mock.calls.map(call => call[0].modelName)).toEqual(["z-ai/glm-5.3-flashx", "glm-5.3-flashx"]);
  expect(mock.llm.mock.calls[1][0].openAiGateway).toBe("evolink_flash_only");
  const bp = result.contentBlueprints[0]; expect(bp.viralCreation).toBe(true); expect(bp.targetPlatform).toBe("douyin"); expect(bp.id).toBe(pick.id);
  expect(JSON.stringify(bp.executionDetails)).toContain("封面场景"); expect(bp.commentHooks).toEqual([fictionalViralBlueprint().xhsPackage.conversion.action]);
 });
 it("空分页不能成功，也不会用旧骨架冒充正文", async () => {
  const bp = fictionalViralBlueprint(); bp.graphicNotePages = [];
  mock.llm.mockResolvedValue(JSON.stringify({ blueprint: bp }));
  await expect(expandPlatformTopicPicks({ userId: 1, picks: [pick], enabledSkillIds: [XHS_CONTENT_SKILL_ID] })).rejects.toThrow();
  expect(mock.llm).toHaveBeenCalledTimes(2);
 });
});
