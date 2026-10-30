import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({generate:vi.fn(),logFree:vi.fn(),deduct:vi.fn(),refund:vi.fn(),register:vi.fn(),settle:vi.fn(),create:vi.fn()}));
vi.mock("./credits", async original=>({...await original<Record<string,unknown>>(),getCredits:async()=>({totalAvailable:100}),deductCreditsAmount:m.deduct,refundCreditsForDeductAmount:vi.fn()}));
vi.mock("./services/platformTopicShortlist",async original=>({...await original<Record<string,unknown>>(),generatePlatformTopicShortlist:m.generate,countPlatformTopicShortlistFreeEver:async()=>0,countPlatformTopicShortlistFreeToday:async()=>0,logPlatformTopicShortlistFreeUse:m.logFree}));
vi.mock("./services/paidJobLedger",async original=>({...await original<Record<string,unknown>>(),registerActiveJob:m.register,unregisterActiveJob:m.settle,refundCreditsOnFailure:m.refund,heartbeatActiveJob:async()=>true,markSettlementPending:async()=>true}));
vi.mock("./services/platformTopicExpandRetryCredit",()=>({claimFreeExpandRetry:async()=>({free:false})}));
vi.mock("./jobs/repository",async original=>({...await original<Record<string,unknown>>(),createJob:m.create}));
import { appRouter } from "./routers";
const caller=()=>appRouter.createCaller({user:{id:91,role:"user"}} as never);
const input={context:"会议沟通最近七天",count:3,enabledSkillIds:["xhs-content-growth"],windowDays:7};
beforeEach(()=>{vi.clearAllMocks();m.generate.mockReset();m.deduct.mockResolvedValue({success:true,cost:12,source:"personal"});m.settle.mockResolvedValue({ok:true});m.register.mockResolvedValue(undefined);m.refund.mockResolvedValue({refunded:true});});
it("真实付费路由只扣一次12点，生成失败交给同任务退还",async()=>{
 m.generate.mockRejectedValue(Error("选题传达目标未完整结束"));
 await expect(caller().mvAnalysis.generatePlatformTopicShortlist(input)).rejects.toThrow("未完整结束");
 expect(m.deduct).toHaveBeenCalledTimes(1);expect(m.deduct.mock.calls[0][1]).toBe(12);expect(m.refund).toHaveBeenCalledTimes(1);expect(m.logFree).not.toHaveBeenCalled();
});
it("免费入口内容失败不扣费不消耗成功额度",async()=>{
 m.generate.mockRejectedValue(Error("选题传达目标未完整结束"));
 await expect(caller().mvAnalysis.generatePlatformTopicShortlist({...input,freeTrial:true})).rejects.toThrow("未完整结束");
 expect(m.deduct).not.toHaveBeenCalled();expect(m.logFree).not.toHaveBeenCalled();
});
it("免费成功沿原额度计数且返回完整文本",async()=>{
 const full="完整说明。".repeat(100);
 m.generate.mockResolvedValue({topics:[{conveyGoal:full}],diagnostics:{}});
 const result=await caller().mvAnalysis.generatePlatformTopicShortlist({...input,freeTrial:true});
 expect(result.chargedCredits).toBe(0);expect(result.topics[0].conveyGoal).toBe(full);expect(m.logFree).toHaveBeenCalledTimes(1);expect(m.deduct).not.toHaveBeenCalled();
});
it("真实扩写schema与队列保留完整切口、传达目标及逐题证据身份",async()=>{
 const full="完整的会议沟通切口。".repeat(80);
 const pick={id:"topic-complete",title:"会议沟通练习",hookSketch:full,conveyGoal:full,skillsUsed:["xhs-content-growth"],primaryLane:"default" as const,formatHint:"图文" as const,dedupeKey:"meeting",evidenceBindingVersion:"topic-v1" as const};
 const result=await caller().mvAnalysis.enqueuePlatformTopicExpand({picks:[pick]});
 expect(result.chargedCredits).toBe(20);
 const received=m.create.mock.calls[0][0].input.params.picks[0];expect(received.hookSketch).toBe(full);expect(received.conveyGoal).toBe(full);expect(received.evidenceBindingVersion).toBe("topic-v1");
});
