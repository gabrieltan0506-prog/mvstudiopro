import {expect,it,vi} from "vitest";
vi.mock("../_core/llm",()=>({invokeLLM:vi.fn(),extractFirstChoicePlainText:vi.fn(),extractJsonString:vi.fn()}));
vi.mock("./paidJobLedger",()=>({registerActiveJob:vi.fn(),heartbeatActiveJob:vi.fn(),unregisterActiveJob:vi.fn()}));
import {runPaidTopicPipeline} from "./topicDigestPipeline";
import {newTopicWorkflow,normalizeTopicIntegration,verifyTopicIntegration} from "../../shared/topicDigestWorkflow";
const draft=()=>({topics:Array.from({length:5},(_,i)=>({title:`独立测试候选${i}的具体情节`,angle:"根据亲子互动中的具体场景和动作展开，不虚构实际效果和个人经历。",hook:"孩子悄悄把一张画放到了桌子上。",format:"图文",outline:["交代真实事件发生的情景","呈现人物具体行动与回应","用小变化收束完整的故事"],tags:["亲子"],sourceIds:[]}))});
const workflow=()=>newTopicWorkflow("parenting",[],[],{raw:draft(),receipt:{provider:"DeepSeek"}});
const merged=()=>({topics:draft().topics.map((t,i)=>({...t,draftRefs:[`deepseek:${i+1}`]})),mergeNotes:["将同一问题的候选归并，保留不同场景。"]});
it("付费只追加GLM和整合，按先存running再调用再存success，不重跑基础稿",async()=>{
  const events:string[]=[];
  const call=vi.fn(async(step:string)=>{events.push(step);return {raw:step==="glm"?draft():merged(),receipt:{provider:step==="glm"?"Z.AI":"DeepSeek"}};});
  const result=await runPaidTopicPipeline("one",workflow(),{call,save:async w=>{events.push(`${w.glm.status}/${w.integrated.status}`);}});
  expect(events).toEqual(["running/pending","glm","succeeded/pending","succeeded/running","integrated","succeeded/succeeded"]);
  expect(result.deepseek).toEqual(workflow().deepseek);expect(result.integrated.status).toBe("succeeded");
  await runPaidTopicPipeline("one",result,{call,save:vi.fn()});expect(call).toHaveBeenCalledTimes(2);
});
it("失败、未知和保存失败不追加付费调用，不将基础稿假装整合",async()=>{
  const call=vi.fn(async()=>{throw Error("unknown upstream");});
  const failed=await runPaidTopicPipeline("one",workflow(),{call,save:async()=>{}});
  expect(failed.glm.status).toBe("failed");expect(failed.deepseek.status).toBe("succeeded");
  await runPaidTopicPipeline("one",failed,{call,save:async()=>{}});expect(call).toHaveBeenCalledTimes(1);
  call.mockClear();await expect(runPaidTopicPipeline("two",workflow(),{call,save:async()=>{throw Error("db unavailable");}})).rejects.toThrow("db unavailable");expect(call).not.toHaveBeenCalled();
});
it("整合失败保留GLM原稿与原始不合格正文；不重试且不降级",async()=>{
  const call=vi.fn(async(step:string)=>({raw:step==="glm"?draft():{topics:[]},receipt:{provider:step==="glm"?"Z.AI":"DeepSeek"}}));
  const result=await runPaidTopicPipeline("one",workflow(),{call,save:async()=>{}});
  expect(result.glm.status).toBe("succeeded");expect(result.integrated).toMatchObject({status:"failed",raw:{topics:[]}});
  await runPaidTopicPipeline("one",result,{call,save:async()=>{}});expect(call).toHaveBeenCalledTimes(2);
});
it("错误供应商不能冒充双路成功",async()=>{
  const result=await runPaidTopicPipeline("one",workflow(),{call:vi.fn(async()=>({raw:draft(),receipt:{provider:"other"}})),save:async()=>{}});
  expect(result.glm.status).toBe("failed");expect(result.integrated.status).toBe("pending");
});
it("整合排版修复保留全部非空原文并记录；无效引用、过长内容仍拒绝",()=>{
  const w=workflow();w.glm={status:"succeeded",raw:draft(),receipt:{provider:"Z.AI"}};
  const raw=merged();raw.topics[0].outline.push("", "补充第四段具体内容", "补充第五段具体内容", "补充第六段具体内容");
  const original=structuredClone(raw);
  const normalized=normalizeTopicIntegration(raw);expect(normalized.repairs).toHaveLength(2);
  const topics=verifyTopicIntegration(raw,w);expect(topics[0].outline).toHaveLength(5);
  for(const line of original.topics[0].outline.filter(Boolean))expect(topics[0].outline.join("；")).toContain(line);
  expect(raw).toEqual(original);
  raw.topics[0].draftRefs=["glm:8"];expect(()=>verifyTopicIntegration(raw,w)).toThrow();
  raw.topics[0].draftRefs=["deepseek:1"];raw.topics[0].outline.push("很".repeat(301));expect(()=>verifyTopicIntegration(raw,w)).toThrow();
});
