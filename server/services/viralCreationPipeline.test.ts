import { beforeEach, describe, expect, it, vi } from "vitest";
import { fictionalViralBlueprint } from "../../shared/viralCreation.fixture";
import { createPlatformExpandEvidenceJournal } from "./platformTopicExpandEvidence";
import { XHS_CONTENT_SKILL_ID } from "../../shared/xhsContentStrategy";
import { platformTopicShortlistItemSchema } from "../../shared/platformTopicShortlist";
const mock = vi.hoisted(() => ({ llm: vi.fn(), trends: vi.fn(), campaigns: vi.fn() }));
vi.mock("../_core/llm.js", () => ({ invokeLLM: mock.llm, extractFirstChoicePlainText: (v: string) => v, isTransientLlmError: () => false }));
vi.mock("./platformSkillsService.js", () => ({ listAllPlatformSkillsForUser: async () => [{ id: "xhs-content-growth", defaultEnabled: false }], composePlatformSkillsPromptBlock: () => "用户五份资料的方法" }));
vi.mock("../growth/trendShortlistQuery", () => ({ queryTrendShortlist: async (_root: string, platform: string) => (await mock.trends([platform]))[platform] }));
vi.mock("../growth/trendShortlistIndex", () => ({ readTrendShortlistIndex: async (_root: string, platform: string) => (await mock.trends([platform]))[platform], ensureTrendShortlistIndex: async () => {} }));
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
 it("选题适配依据完整通过模型归一化和共享契约，不在24字截断", async () => {
  const reason = "适配依据：人群（刚入职年轻人）×高频具体场景（会议被问进度），提供结论、事实和下一步三句表达，方便读者收藏后照着练习。";
  mock.llm.mockResolvedValue(JSON.stringify({ topics: [{ ...rawTopic(1), viralReason: reason }, rawTopic(2)] }));
  const result = await generatePlatformTopicShortlist({ userId: 1, context: "会议沟通", count: 2, enabledSkillIds: [XHS_CONTENT_SKILL_ID] });
  expect(result.topics[0].viralReason).toBe(reason);
  expect(platformTopicShortlistItemSchema.parse(result.topics[0]).viralReason).toBe(reason);
 });
 it("选题主说明与切口不在240及200字硬截断，后续共享契约保留结尾", async () => {
  const conveyGoal = "面对明确人群解决具体问题。".repeat(24) + "承接动作：关注看下一期的完整清单。";
  const hookSketch = "从真实生活场景展开一个问题。".repeat(20) + "最后给出可执行的方法。";
  mock.llm.mockResolvedValue(JSON.stringify({ topics: [{ ...rawTopic(1), conveyGoal, hookSketch }, rawTopic(2)] }));
  const result = await generatePlatformTopicShortlist({ userId: 1, context: "会议沟通", count: 2, enabledSkillIds: [XHS_CONTENT_SKILL_ID] });
  expect(result.topics[0].conveyGoal).toBe(conveyGoal);
  expect(platformTopicShortlistItemSchema.parse(result.topics[0]).hookSketch).toBe(hookSketch);
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
 it("新图文扩写拒绝八页而不截页，并把4–6页要求反馈备用通道", async () => {
  const bp = fictionalViralBlueprint();
  bp.graphicNotePages = Array.from({length:8}, (_, i) => ({...bp.graphicNotePages[i % 4], pageIndex: i + 1}));
  mock.llm.mockResolvedValueOnce(JSON.stringify({blueprint:bp})).mockResolvedValueOnce(JSON.stringify({blueprint:fictionalViralBlueprint()}));
  const result = await expandPlatformTopicPicks({userId:1,picks:[pick],enabledSkillIds:[XHS_CONTENT_SKILL_ID]});
  expect(mock.llm.mock.calls[1][0].messages[1].content).toContain("4–6页");
  expect(result.contentBlueprints[0].graphicNotePages).toHaveLength(4);
 });
 it("空分页不能成功，也不会用旧骨架冒充正文", async () => {
  const bp = fictionalViralBlueprint(); bp.graphicNotePages = [];
  mock.llm.mockResolvedValue(JSON.stringify({ blueprint: bp }));
  await expect(expandPlatformTopicPicks({ userId: 1, picks: [pick], enabledSkillIds: [XHS_CONTENT_SKILL_ID] })).rejects.toThrow();
  expect(mock.llm).toHaveBeenCalledTimes(2);
 });
 it("图文扩写明确字段类型，已有下一通道收到上一通道具体缺项；原文先存再校验", async () => {
  const incomplete = fictionalViralBlueprint() as Record<string, unknown>; delete incomplete.detailedScript;
  const badRaw = JSON.stringify({ blueprint: incomplete });
  const goodRaw = JSON.stringify({ blueprint: fictionalViralBlueprint() });
  const snapshots: unknown[][] = [];
  const journal = createPlatformExpandEvidenceJournal([], async entries => { snapshots.push(entries); });
  mock.llm.mockResolvedValueOnce(badRaw).mockImplementationOnce(async request => {
   expect(request.messages[1].content).toContain("扩写结果缺少可用字段：detailedScript");
   expect(snapshots.at(-1)).toEqual(expect.arrayContaining([expect.objectContaining({ stage: "raw", value: badRaw }), expect.objectContaining({ stage: "rejected" })]));
   return goodRaw;
  });
  const onItem = vi.fn();
  const result = await expandPlatformTopicPicks({ userId: 1, context: "旧要求60秒视频12镜", picks: [pick], onAttemptEvidence: journal.record, onItem });
  const system = mock.llm.mock.calls[0][0].messages[0].content;
  expect(system).toContain("当前界面已选形式为图文笔记");
  expect(system).toContain("detailedScript均为非空字符串，不是数组或对象");
  expect(system).toContain("不要将该字段放在xhsPackage内");
  expect(mock.llm).toHaveBeenCalledTimes(2);
  expect(result.contentBlueprints[0].detailedScript).toBe(fictionalViralBlueprint().detailedScript);
  expect(result.contentBlueprints[0].graphicNotePages).toEqual(fictionalViralBlueprint().graphicNotePages);
  expect(onItem).toHaveBeenCalledTimes(1);
  expect(journal.entries).toEqual(expect.arrayContaining([expect.objectContaining({ stage: "accepted" })]));
 });
 it("两通道都不合格时原文和失败原因保留，不补造正文或交付空壳", async () => {
  mock.llm.mockResolvedValue(JSON.stringify({ xhsPackage: {} }));
  const journal = createPlatformExpandEvidenceJournal([], async () => {}); const onItem = vi.fn();
  await expect(expandPlatformTopicPicks({ userId: 1, picks: [pick], onAttemptEvidence: journal.record, onItem })).rejects.toThrow("title,copywriting,detailedScript");
  expect(journal.entries.filter(e => (e as {stage:string}).stage === "raw")).toHaveLength(2);
  expect(journal.entries.filter(e => (e as {stage:string}).stage === "rejected")).toHaveLength(2);
  expect(onItem).not.toHaveBeenCalled();
 });
 it("回执持久化失败立即停止，不继续已有备用通道", async () => {
  mock.llm.mockResolvedValue(JSON.stringify({ blueprint: fictionalViralBlueprint() }));
  const journal = createPlatformExpandEvidenceJournal([], async () => { throw new Error("数据库不可用"); });
  await expect(expandPlatformTopicPicks({ userId: 1, picks: [pick], onAttemptEvidence: journal.record })).rejects.toThrow("回执未能保存");
  expect(mock.llm).toHaveBeenCalledTimes(1);
 });

 it("课程操作卡到达真实初选与扩写调用，形式由当前选择决定", async () => {
  mock.llm.mockResolvedValueOnce(JSON.stringify({topics:[rawTopic(1),rawTopic(2)]}));
  await generatePlatformTopicShortlist({userId:1,context:"二胎妈妈兼瑜伽老师，开学系列",count:2,enabledSkillIds:[XHS_CONTENT_SKILL_ID]});
  const shortlistInput=JSON.parse(mock.llm.mock.calls[0][0].messages[1].content);
  expect(shortlistInput.methodPlan.courseRules.map((r:{id:string})=>r.id)).toContain("course-persona");
  mock.llm.mockResolvedValueOnce(JSON.stringify({blueprint:fictionalViralBlueprint()}));
  await expandPlatformTopicPicks({userId:1,context:"之前考虑视频，本轮选图文，咖啡器具测评",picks:[pick],enabledSkillIds:[XHS_CONTENT_SKILL_ID]});
  const expandInput=JSON.parse(mock.llm.mock.calls[1][0].messages[1].content);
  expect(expandInput.methodPlan.courseRules.map((r:{id:string})=>r.id)).toContain("course-title-cover");
  expect(expandInput.methodPlan.courseRules.map((r:{id:string})=>r.id)).not.toContain("course-shot-plan");
  const graphicRules = expandInput.methodPlan.courseRules as Array<{id:string;apply:string;outputs:string[]}>;
  expect(graphicRules.find(r=>r.id==="course-cover-layout")?.outputs).toContain("字体与主副标题层级");
  expect(graphicRules.find(r=>r.id==="course-delivery")?.apply).toContain("交付形式/时效");
  expect(graphicRules.find(r=>r.id==="course-product-proof")?.apply).toContain("同维度且可核算");
  expect(graphicRules.find(r=>r.id==="course-measure")?.apply).toContain("打开后有效咨询弱");

 });

 it("已确认视频要求进真实扩写消息且保留逐镜消费者字段", async () => {
  mock.llm.mockResolvedValueOnce(JSON.stringify({blueprint:fictionalViralBlueprint("短视频")}));
  const result=await expandPlatformTopicPicks({userId:1,context:"吧台拍30秒咖啡演示，9:16",picks:[{...pick,id:"video-001",formatHint:"短视频",targetPlatform:"douyin"}],enabledSkillIds:[XHS_CONTENT_SKILL_ID]});
  const messages=mock.llm.mock.calls[0][0].messages;
  expect(messages[0].content).toContain("不把重音/换气标签当成要念出的台词");
  expect(messages[0].content).toContain("每个有口播的镜头都要有表演安排");
  expect(messages[0].content).toContain("手势：…；视线：…");
  expect(messages[0].content).toContain("字体风格/主副标题层级");
  const rule=JSON.parse(messages[1].content).methodPlan.courseRules.find((r:{id:string})=>r.id==="course-shot-plan");
  expect(rule.outputs).toContain("视线对象与试拍自查");
  expect(result.contentBlueprints[0].storyboardCells).toHaveLength(4);
  expect(result.contentBlueprints[0].storyboardCells).toEqual(fictionalViralBlueprint("短视频").storyboardCells);
  expect(result.contentBlueprints[0].executionDetails).toBeTruthy();
 });

 it("平读式镜表拒收，备用通道收到缺失演法而非成功骨架", async () => {
  const bad = fictionalViralBlueprint("短视频");
  bad.storyboardCells[0].editNoteZh = "对白字幕";
  const good = fictionalViralBlueprint("短视频");
  mock.llm.mockResolvedValueOnce(JSON.stringify({blueprint:bad})).mockResolvedValueOnce(JSON.stringify({blueprint:good}));
  const result = await expandPlatformTopicPicks({userId:1,picks:[{...pick,formatHint:"短视频"}],enabledSkillIds:[XHS_CONTENT_SKILL_ID]});
  expect(mock.llm).toHaveBeenCalledTimes(2);
  expect(mock.llm.mock.calls[1][0].messages[1].content).toContain("第1镜口播表演缺少具体语气、重音、停顿");
  expect(result.contentBlueprints[0].copywriting).toBe(good.copywriting);
  expect(result.contentBlueprints[0].storyboardCells).toEqual(good.storyboardCells);
 });

 it("图文正文混入制作说明时原文拒收，备用通道收到具体页码", async () => {
  const bad=fictionalViralBlueprint();bad.graphicNotePages[2].body+="。画面：俯拍菜单，字体：大号黑体。";
  const evidence:Array<{stage:string;value:unknown}>=[];
  mock.llm.mockResolvedValueOnce(JSON.stringify({blueprint:bad})).mockResolvedValueOnce(JSON.stringify({blueprint:fictionalViralBlueprint()}));
  const result=await expandPlatformTopicPicks({userId:1,context:"只写会议沟通方法",picks:[pick],enabledSkillIds:[XHS_CONTENT_SKILL_ID],onAttemptEvidence:async e=>{evidence.push(e)}});
  expect(mock.llm).toHaveBeenCalledTimes(2);
  expect(mock.llm.mock.calls[1][0].messages[1].content).toContain("第3页把画面或排版制作说明混进读者正文");
  expect(evidence.map(e=>e.stage)).toEqual(["raw","parsed","rejected","raw","parsed","accepted"]);
  expect(result.contentBlueprints[0].graphicNotePages).toEqual(fictionalViralBlueprint().graphicNotePages);
 });

});
