import { expect, it } from "vitest";
import { topicPeriod, TOPIC_DIGEST_INTERVAL_MS, verifyTopicCandidates, selectTopicCards, topicCreationBrief, topicRecommendationCount } from "./topicDigest";
it.each([
  [{role:"free",plan:"free"},1], [{role:"beta",plan:"free"},1],
  [{role:"paid",plan:"free"},2], [{role:"free",plan:"pro"},2], [{role:"free",plan:"enterprise"},2],
] as const)("会员身份%j每期只得到%s条，不由积分余额推断",(input,count)=>expect(topicRecommendationCount(input)).toBe(count));

export function fictionalDigestCandidates() {
  return { topics: Array.from({length:5},(_,i)=>({ title:`测试选题${i}：妈妈道歉后的小动作`,angle:"用具体的小动作表现家长与孩子的关系修复，让正文兑现标题里的反差。",
    hook:"妈妈蹲下来后，孩子把那张画递给了她。",format:"图文",outline:["先写道歉前双方的距离","再写家长蹲下来倾听的动作","用孩子递画的行为结束故事"],tags:["亲子","绘本"],sourceIds:[] as string[] })) };
}
it("按连续48小时分期，跨日不误生成两次",()=>{
  expect(topicPeriod(TOPIC_DIGEST_INTERVAL_MS-1)).toBe(0);expect(topicPeriod(TOPIC_DIGEST_INTERVAL_MS)).toBe(1);
});
it("无来源明确常青，编造或过期来源拒绝入库",()=>{
  const now=Date.now(),raw=fictionalDigestCandidates();
  expect(verifyTopicCandidates(raw,[],now).every(t=>t.kind==="常青选题")).toBe(true);
  raw.topics[0].sourceIds=["real"];
  expect(()=>verifyTopicCandidates(raw,[],now)).toThrow("来源不存在");
  const source={id:"real",title:"真实来源标题",url:"https://example.com/source",platform:"测试",observedAt:new Date(now-1000).toISOString()};
  expect(verifyTopicCandidates(raw,[source],now)[0]).toMatchObject({kind:"热点灵感",sources:[source]});
  expect(()=>verifyTopicCandidates(raw,[{...source,observedAt:new Date(now-TOPIC_DIGEST_INTERVAL_MS-1).toISOString()}],now)).toThrow("已过期");
});
it("去重、关键词匹配与隐藏后，选题正文真正进入创作需求",()=>{
  const raw=fictionalDigestCandidates();raw.topics[2].tags.push("倾听");
  const topics=verifyTopicCandidates(raw,[]),chosen=selectTopicCards(topics,"倾听",["topic-1"]);
  expect(chosen[0].id).toBe("topic-3");expect(chosen.some(t=>t.id==="topic-1")).toBe(false);
  const brief=topicCreationBrief({id:"test",lane:"parenting",topics,createdAt:"",expiresAt:""},chosen[0]);
  expect(brief).toContain(chosen[0].title);expect(brief).toContain(chosen[0].outline[1]);
  raw.topics[1].title=raw.topics[0].title;expect(()=>verifyTopicCandidates(raw,[])).toThrow("重复");
});
