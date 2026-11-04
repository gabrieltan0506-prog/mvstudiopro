import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ get: vi.fn(), publicJobs: vi.fn(), create: vi.fn(), existing: vi.fn(), deduct: vi.fn(), refund: vi.fn(), refundDeduct: vi.fn(), ledger: vi.fn(), llm: vi.fn(), store: vi.fn() }));
vi.mock("./growth/guaikei/automation",()=>({guaikeiAutomation:{publicJobs:m.publicJobs}}));
vi.mock("./growth/guaikei/service", () => ({ guaikeiService: { get: m.get } }));
vi.mock("./credits", async original => ({ ...await original<Record<string, unknown>>(), deductCreditsAmount: m.deduct, refundCreditsForDeductAmount: m.refundDeduct }));
vi.mock("./jobs/repository", async original => ({ ...await original<Record<string, unknown>>(), createJob: m.create, getJobById: m.existing }));
vi.mock("./services/paidJobLedger", async original => ({ ...await original<Record<string, unknown>>(), registerActiveJob: m.ledger, refundCreditsOnFailure: m.refund }));
vi.mock("./growth/trendStore", async original => ({ ...await original<Record<string, unknown>>(), readTrendStoreForPlatforms: m.store }));
vi.mock("./services/visualReportDeepSeek",()=>({runVisualReportDeepSeek:m.llm}));
vi.mock("./services/platformOfficialCampaigns", async original => ({ ...await original<Record<string, unknown>>(), ensureOfficialCampaignSeedsLoaded: vi.fn(), listOfficialCampaignLinesForReport: async () => ({ globalTrafficSupport: [], topicExamples: [], byPlatform: {} }) }));
import { appRouter } from "./routers";
const jobId = "11111111-1111-4111-8111-111111111111";
const input = { windowDays: "7" as const, theme: "light" as const, platforms: ["xiaohongshu" as const], billingRequestId: "guaikei-trend-integration", externalEvidenceRefs: [{ jobId, itemIds: ["paid-a"] }] };
const externalJob = { id: jobId, owner: 7, status: "completed", input: { platform: "xiaohongshu", operation: "search", query: "AI", limit: 20 }, updatedAt: "2026-11-04T13:00:00Z", items: [{ id: "paid-a", platform: "xiaohongshu", title: "外部AI工作流案例", description: "完整的外部资料", publishedAt: "2026-11-03T08:00:00Z", url: "https://example.com/a", author: "测试作者", authorId: "a", likes: 9, comments: null, shares: null, views: null }] };
const editorialFor=(sources:any[])=>({
 insights:[{title:"一",detail:"具体内容"},{title:"二",detail:"另一个内容"}],
 themes:[{primary:"一",secondary:["子"]},{primary:"二",secondary:["子"]}],
 examples:sources.slice(0,8).map(s=>({id:s.id,title:s.title,description:"事实",angle:"切口",structure:"建议",adaptation:"建议应用"})),
 audiences:[{name:"一",need:"一",direction:"一"},{name:"二",need:"二",direction:"二"}],
 suggestions:Array.from({length:8},(_,i)=>({title:`选题${i}`,detail:"具体执行方向"})),assignments:sources.map(s=>({id:s.id,topic:"主题"})),
});
const caller = (extra = {}) => appRouter.createCaller({ user: { id: 7, role: "admin" }, clientDisconnected: new AbortController().signal, ...extra } as any);
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-04T13:00:00Z"));
  m.publicJobs.mockResolvedValue([]);
  m.existing.mockResolvedValue(null); m.create.mockResolvedValue(undefined);
  m.deduct.mockImplementation(async (_user, cost) => ({ cost, source: "personal", alreadyCharged: false }));
  m.refundDeduct.mockResolvedValue({ refunded: true });
  m.refund.mockResolvedValue({ refunded: true });
  m.get.mockResolvedValue(structuredClone(externalJob));
  m.store.mockResolvedValue({ collections: { xiaohongshu: { items: [
    { id: "native-a", author:"原库作者",title: "原库内容", publishedAt: "2026-11-03T08:00:00Z", industryLabels: ["知识观点"] },
    { id: "native-b", title: "原库旧窗", publishedAt: "2026-10-23T08:00:00Z", industryLabels: ["知识观点"] },
  ] } } });
  m.llm.mockImplementation(async (args:any)=>({engine:"openrouter_deepseek",modelName:"deepseek/deepseek-v4.1-flash-1017",attempt:1,parsed:{insightSummary:[],trackGrowth:[],platformDetails:[],concreteReport:editorialFor(args.reportContract.concreteSources)}}));
});
afterEach(() => vi.useRealTimers());
it("真实入队入口先校验归属，再扣费并持久化快照和引用", async () => {
  await caller().mvAnalysis.enqueueVisualReport(input);
  expect(m.get).toHaveBeenCalledWith(7, jobId);
  expect(m.get.mock.invocationCallOrder[0]).toBeLessThan(m.deduct.mock.invocationCallOrder[0]);
  const saved = m.create.mock.calls[0][0].input;
  expect(saved.params.externalEvidenceRefs).toEqual(input.externalEvidenceRefs);
  expect(saved.externalEvidenceSnapshot.items[0].description).toBe("完整的外部资料");
  expect(m.deduct).toHaveBeenCalledTimes(1); expect(m.llm).not.toHaveBeenCalled();
});
it("作品过期不扣费不建单", async () => {
  const old = structuredClone(externalJob); old.items[0].publishedAt = "2025-01-01T00:00:00Z"; m.get.mockResolvedValue(old);
  await expect(caller().mvAnalysis.enqueueVisualReport(input)).rejects.toThrow("时间范围");
  expect(m.deduct).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
});
it("工作机使用冻结证据，原库与外部内容同进模型，增长不计补采", async () => {
  await caller().mvAnalysis.enqueueVisualReport(input);
  const snapshot = JSON.parse(JSON.stringify(m.create.mock.calls[0][0].input.externalEvidenceSnapshot));
  m.get.mockRejectedValue(new Error("工作机没有正式机采集卷")); m.get.mockClear(); m.deduct.mockClear();
  const result = await caller({ prepaidPlatformTrendJobId: "test-job", platformTrendExternalEvidence: snapshot }).mvAnalysis.generateVisualReport(input);
  const payload = JSON.parse(m.llm.mock.calls[0][0].userPrompt.split("\n\n")[0]);
  expect(payload.sources.map((s:any)=>s.title)).toEqual(["外部AI工作流案例", "原库内容"]);
  expect(payload.sources[0].description).toBe("完整的外部资料");
  expect(payload.growthHints).toEqual({});
  expect(result.report?.externalEvidenceAudit?.usedItems).toEqual([{ jobId, id: "paid-a" }]);
  expect(m.get).not.toHaveBeenCalled(); expect(m.deduct).not.toHaveBeenCalled();
});
it("同任务恢复直接复用，不重新读取外部任务或扣费", async () => {
  m.existing.mockResolvedValue({ id: "saved", userId: "7", status: "succeeded" });
  await caller().mvAnalysis.enqueueVisualReport(input);
  expect(m.get).not.toHaveBeenCalled(); expect(m.deduct).not.toHaveBeenCalled();
});
it("建单失败沿原账本退回报告积分，不重新采集", async () => {
  m.create.mockRejectedValue(new Error("模拟写入失败"));
  await expect(caller().mvAnalysis.enqueueVisualReport(input)).rejects.toThrow("模拟写入失败");
  expect(m.refund).toHaveBeenCalledTimes(1); expect(m.llm).not.toHaveBeenCalled();
});

it("抖音真实作品参与内容分析，旧漫剧分类不再传给模型或报告", async () => {
  m.store.mockResolvedValue({ collections: { douyin: { items: [{id:"d2",title:"另一抖音作品",author:"另一作者",publishedAt:"2026-11-03T08:00:00Z"},{ id: "d1",author:"抖音作者", title: "抖音真实作品", publishedAt: "2026-11-03T08:00:00Z", isDrama: true, dramaKind: "ai_manhua", dramaInfo: { mixName: "不准的旧分类" } }] } } });
  const result = await caller().mvAnalysis.generateVisualReport({ ...input, platforms: ["douyin"], externalEvidenceRefs: [] });
  const payload = JSON.parse(m.llm.mock.calls[0][0].userPrompt.split("\n\n")[0]);
  expect(payload.sources.map((s:any)=>s.title)).toContain("抖音真实作品");
  expect(JSON.stringify(payload)).not.toContain("不准的旧分类");
  expect(payload.sources[0]).not.toHaveProperty("dramaRising");
  expect(result.report?.aiManhuaRising).toBeNull();
});

it("具体报告从冻结双作品经真实assembler回填作者和比例；坏来源不能作为成功结果",async()=>{
 m.store.mockResolvedValue({collections:{}});
 const second={...externalJob.items[0],id:"paid-b",author:"第二作者",likes:27};
 const snapshot={owner:7,anchorMs:Date.now(),windowDays:7,platforms:["xiaohongshu"],items:[externalJob.items[0],second].map(item=>({...item,reportPlatform:"xiaohongshu",jobId,query:"生活",collectedAt:externalJob.updatedAt}))};
 const editorial={insights:[{title:"一",detail:"一"},{title:"二",detail:"二"}],themes:[{primary:"一",secondary:["子"]},{primary:"二",secondary:["子"]}],examples:snapshot.items.map(s=>({id:s.id,title:"概述",description:"文案",angle:"角度",structure:"建议",adaptation:"应用"})),audiences:[{name:"一",need:"一",direction:"一"},{name:"二",need:"二",direction:"二"}],suggestions:Array.from({length:8},(_,i)=>({title:`选题${i}`,detail:"具体执行"})),assignments:snapshot.items.map(s=>({id:s.id,topic:"生活"}))};
 m.llm.mockResolvedValue({engine:"test",modelName:"test",attempt:1,parsed:{insightSummary:[],trackGrowth:[],platformDetails:[],concreteReport:editorial}});
 const result=await caller({prepaidPlatformTrendJobId:"test-job",platformTrendExternalEvidence:snapshot}).mvAnalysis.generateVisualReport(input);
 expect(result.success).toBe(true);expect(result.report?.concreteReport?.examples.map((e:any)=>e.author)).toEqual(["测试作者","第二作者"]);
 expect(result.report?.concreteReport?.metrics?.map((e:any)=>e.rate)).toEqual([]);
 expect(m.llm.mock.calls[0][0].reportContract.concreteSources).toHaveLength(2);
 const prompts=m.llm.mock.calls[0][0];
 const payload=JSON.parse(prompts.userPrompt);
 expect(payload.sources.map((s:any)=>s.id)).toEqual(["paid-b","paid-a"]);
 expect(payload.outputShape.concreteReport.assignments.map((s:any)=>s.id)).toEqual(["paid-b","paid-a"]);
 expect(prompts.systemPrompt).toContain("insights和suggestions每条必须同时有title与detail");
 expect(prompts.systemPrompt).not.toContain("现金奖励任务，每个平台至少");

 editorial.examples[0].id="unknown";
 const bad=await caller({prepaidPlatformTrendJobId:"test-job",platformTrendExternalEvidence:snapshot}).mvAnalysis.generateVisualReport(input);
 expect(bad.success).toBe(false);expect(bad.report).toBeNull();if (!bad.success) expect(bad.error).toContain("来源");
});


it.each([["3",50],["7",80],["15",120]] as const)("近%s天入队扣%s积分并登记原额",async(windowDays,cost)=>{
 await caller().mvAnalysis.enqueueVisualReport({...input,windowDays});
 expect(m.deduct).toHaveBeenCalledWith(7,cost,"platformTrend",expect.any(String),expect.any(Object));
 expect(m.ledger).toHaveBeenCalledWith(expect.objectContaining({creditsBilled:cost,deduct:expect.objectContaining({cost})}));
});
it("已有已付任务恢复不会按新价再次扣费",async()=>{
 m.existing.mockResolvedValue({userId:"7",status:"running"});
 await caller().mvAnalysis.enqueueVisualReport({...input,windowDays:"15"});
 expect(m.deduct).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
});
it.each([["3",50],["7",80],["15",120]] as const)("近%s天直接生成失败按实扣%s退款",async(windowDays,cost)=>{
 m.llm.mockRejectedValue(new Error("测试模型失败"));
 await caller().mvAnalysis.generateVisualReport({...input,windowDays});
 expect(m.deduct).toHaveBeenCalledWith(7,cost,"platformTrend",expect.any(String),expect.any(Object));
 expect(m.refundDeduct.mock.calls[0][2]).toEqual(expect.objectContaining({cost}));
});
it("已预付旧任务由worker执行不再次按新价扣费",async()=>{
 await caller({prepaidPlatformTrendJobId:"old-paid-job"}).mvAnalysis.generateVisualReport({...input,windowDays:"15"});
 expect(m.deduct).not.toHaveBeenCalled();
});

it("B站原库真实案例进入模型输入并由assembler回填作者与话题占比",async()=>{
 const native=[{id:"BV-one",title:"真实硬件测试",author:"硬件作者",publishedAt:"2026-11-02T08:00:00Z",views:200000},{id:"BV-two",title:"真实美食实验",author:"美食作者",publishedAt:"2026-11-01T08:00:00Z",views:100000}];
 m.store.mockResolvedValue({collections:{bilibili:{items:native}}});
 const editorial={insights:[{title:"一",detail:"一"},{title:"二",detail:"二"}],themes:[{primary:"一",secondary:["子"]},{primary:"二",secondary:["子"]}],examples:native.map(s=>({id:s.id,title:s.title,description:"采集标题",angle:"切口",structure:"编辑建议",adaptation:"应用"})),audiences:[{name:"一",need:"一",direction:"一"},{name:"二",need:"二",direction:"二"}],suggestions:Array.from({length:8},(_,i)=>({title:`选题${i}`,detail:"具体执行"})),assignments:native.map(s=>({id:s.id,topic:s.id}))};
 m.llm.mockResolvedValue({engine:"test",modelName:"test",attempt:1,parsed:{insightSummary:[],trackGrowth:[],platformDetails:[],concreteReport:editorial}});
 const result=await caller().mvAnalysis.generateVisualReport({...input,platforms:["bilibili"],externalEvidenceRefs:[]});
 expect(result.success).toBe(true);expect(result.report?.concreteReport?.examples.map(e=>e.author)).toEqual(["硬件作者","美食作者"]);
 expect(result.report?.concreteReport?.metricKind).toBe("none");expect(result.report?.concreteReport?.metrics?.map(m=>m.rate)).toEqual([]);
 const payload=JSON.parse(m.llm.mock.calls[0][0].userPrompt.split("\n")[0]);
 expect(m.llm.mock.calls[0][0].systemPrompt).toContain("examples的id也只选sources中的id");
 expect(payload.sources).toHaveLength(2);expect(payload.sources[0].author).toBe("硬件作者");
 expect(m.llm.mock.calls[0][0].reportContract.concreteSources).toHaveLength(2);

});
it("B站缺真实作者或发布时间时不生成空壳案例，不发起模型扣费",async()=>{
 m.store.mockResolvedValue({collections:{bilibili:{items:[{id:"BV-one",title:"旧作品",author:"作者",observedAt:"2026-11-03T08:00:00Z"}]}}});
 await expect(caller().mvAnalysis.generateVisualReport({...input,platforms:["bilibili"],externalEvidenceRefs:[]})).rejects.toThrow("不足");
 expect(m.deduct).not.toHaveBeenCalled();expect(m.llm).not.toHaveBeenCalled();
});

it("普通用户入队前冻结公共作品，私有任务不读取；空视频号公共池不扣费",async()=>{
 m.publicJobs.mockResolvedValue([externalJob]);
 await caller({user:{id:99,role:"user"}}).mvAnalysis.enqueueVisualReport({...input,externalEvidenceRefs:[]});
 const saved=m.create.mock.calls[0][0].input.externalEvidenceSnapshot;
 expect(saved.owner).toBe(99);expect(saved.items[0].id).toBe("paid-a");expect(m.get).not.toHaveBeenCalled();
 expect(m.publicJobs.mock.invocationCallOrder[0]).toBeLessThan(m.deduct.mock.invocationCallOrder[0]);
 m.deduct.mockClear();m.create.mockClear();m.publicJobs.mockResolvedValue([]);
 await expect(caller({user:{id:99,role:"user"}}).mvAnalysis.enqueueVisualReport({...input,platforms:["weixin_channels"],externalEvidenceRefs:[]})).rejects.toThrow("未扣费");
 expect(m.deduct).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();
});
