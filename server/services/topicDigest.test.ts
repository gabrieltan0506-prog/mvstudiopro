import { expect, it, vi } from "vitest";
import { TOPIC_DIGEST_INTERVAL_MS } from "../../shared/topicDigest";
vi.mock("../_core/llm",()=>({invokeLLM:vi.fn(),extractFirstChoicePlainText:(r:any)=>r.choices[0].message.content,extractJsonString:(s:string)=>s}));
vi.mock("../growth/trendStore",()=>({readTrendStoreForPlatforms:vi.fn()}));
vi.mock("./paidJobLedger",()=>({registerActiveJob:vi.fn(async()=>{}),heartbeatActiveJob:vi.fn(async()=>true),unregisterActiveJob:vi.fn(async()=>({ok:true}))}));
import { runTopicDigestTick, readTopicSources, generateTopicPool } from "./topicDigest";
import { invokeLLM } from "../_core/llm";
import { registerActiveJob, unregisterActiveJob } from "./paidJobLedger";
import { readTrendStoreForPlatforms } from "../growth/trendStore";
const raw=()=>({topics:Array.from({length:5},(_,i)=>({title:`测试独立选题${i}：孩子递画的瞬间`,angle:"这个测试选题关注亲子沟通中的一个具体动作，正文按事件前后展开。",hook:"孩子把刚才藏起来的画递给了妈妈。",format:"图文",outline:["展示事件开始前的位置","描写双方发生的具体动作","用最后的小变化结束场景"],tags:["亲子"],sourceIds:[]}))});
function dependencies(){
  const claimed=new Set<string>();
  return {lanes:vi.fn(async()=>["parenting" as const]),claim:vi.fn(async(id:string)=>{if(claimed.has(id))return false;claimed.add(id);return true;}),
    claimPaid:vi.fn(async()=>null),savePaid:vi.fn(async()=>{}),completePaid:vi.fn(async()=>{}),failPaid:vi.fn(async()=>{}),paidCall:vi.fn(),
    complete:vi.fn(async()=>{}),deliver:vi.fn(async()=>{}),fail:vi.fn(async()=>{}),sources:vi.fn(async()=>[]),previous:vi.fn(async()=>[]),
    generate:vi.fn(async()=>({raw:raw(),receipt:{id:"test-only",model:"test-model",provider:"DeepSeek",usage:undefined}}))};
}
it("同赛道同周期只调用一次，投递失败下次只补消息；48小时后才生成下一期",async()=>{
  const deps=dependencies(),now=TOPIC_DIGEST_INTERVAL_MS*100;
  deps.deliver.mockRejectedValueOnce(new Error("database temporarily offline"));
  await expect(runTopicDigestTick(deps,now)).rejects.toThrow("database");
  await runTopicDigestTick(deps,now+60_000);
  expect(deps.generate).toHaveBeenCalledTimes(1);expect(deps.deliver).toHaveBeenCalledTimes(2);
  await runTopicDigestTick(deps,now+TOPIC_DIGEST_INTERVAL_MS);expect(deps.generate).toHaveBeenCalledTimes(2);
});
it("模型超时或无效内容不自动重投，不向用户投递伪结果",async()=>{
  const deps=dependencies();deps.generate.mockRejectedValueOnce(new Error("timeout"));
  await runTopicDigestTick(deps,100000);await runTopicDigestTick(deps,100001);
  expect(deps.generate).toHaveBeenCalledTimes(1);expect(deps.complete).not.toHaveBeenCalled();expect(deps.fail).toHaveBeenCalledTimes(1);
});
it("没有订阅者不调用模型，已撤回的赛道不会生成",async()=>{
  const deps=dependencies();deps.lanes.mockResolvedValue([]);await runTopicDigestTick(deps);
  expect(deps.generate).not.toHaveBeenCalled();expect(deps.claim).not.toHaveBeenCalled();
});
it("seed、过期和无链接条目不充当实时热点",async()=>{
  const now=Date.now(),item={id:"one",title:"亲子共读讨论",url:"https://example.com/story",observedAt:new Date(now-1000).toISOString()};
  vi.mocked(readTrendStoreForPlatforms).mockResolvedValue({collections:{xiaohongshu:{platform:"xiaohongshu",source:"live",items:[item,{...item,id:"old",observedAt:new Date(now-TOPIC_DIGEST_INTERVAL_MS-1).toISOString()},{...item,id:"url",url:""}]},douyin:{platform:"douyin",source:"seed",items:[item]}}} as any);
  expect((await readTopicSources("parenting",now)).map(s=>s.id)).toEqual(["xiaohongshu:one"]);
});
it("平台推荐进入零用户扣费的在途账本，失败也释放活动记录且不重发",async()=>{
  vi.mocked(invokeLLM).mockResolvedValueOnce({id:"test",provider:"DeepSeek",created:1,model:"deepseek/deepseek-v4.1-flash-1017",choices:[{index:0,message:{role:"assistant",content:JSON.stringify(raw())},finish_reason:"stop"}]});
  await generateTopicPool("parenting",[],[],"test-pool");
  expect(registerActiveJob).toHaveBeenCalledWith(expect.objectContaining({userId:"platform",creditsBilled:0,metadata:{paidBy:"platform",lane:"parenting",step:"deepseek"}}));
  expect(unregisterActiveJob).toHaveBeenCalledWith("test-pool","platformTopicDigest");
  vi.mocked(invokeLLM).mockRejectedValueOnce(new Error("upstream unavailable"));
  await expect(generateTopicPool("parenting",[],[],"test-other")).rejects.toThrow("upstream unavailable");
  expect(unregisterActiveJob).toHaveBeenCalledWith("test-other","platformTopicDigest");
  expect(invokeLLM).toHaveBeenCalledTimes(2);
});
