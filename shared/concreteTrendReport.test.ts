import { describe, expect, it } from "vitest";
import { assembleConcreteTrendReport, type ConcreteEditorial, type ConcreteSource } from "./concreteTrendReport";
const sources = ["a", "b"].map((id,i) => ({id,platform:"tiktok",title:`原文${id}`,description:"原文",author:`作者${id}`,authorId:id,publishedAt:"2026-11-03T08:00:00Z",url:null,likes:10+i*10,comments:2,shares:3,views:100,query:"亲子"} as ConcreteSource));
const draft: ConcreteEditorial = {
 insights:[{title:"观察",detail:"具体观察"},{title:"观察二",detail:"具体观察二"}],
 themes:[{primary:"具体问题",secondary:["具体子问题"]},{primary:"具体问题二",secondary:["另一个问题"]}],
 examples:sources.map(s=>({id:s.id,title:"中文概述",description:"原文概述",angle:"内容切口",structure:"编辑结构建议",adaptation:"改编建议"})),
 audiences:[{name:"人群",need:"需要",direction:"方向"},{name:"人群二",need:"需要",direction:"方向"}],
 suggestions:[{title:"选题",detail:"细节"},{title:"选题二",detail:"细节"}], assignments:sources.map(s=>({id:s.id,topic:"话题"})),
};
const meta={reportTitle:"内容观察",dateRange:"2026.10.21—11.04",platformLabel:"TikTok",metricKind:"interactionRate" as const};
describe("具体作品报告同源计算",()=>{
 it("作者从真实来源回填，百分比不接受模型覆盖",()=>{
  const r=assembleConcreteTrendReport({...draft,metrics:[{rate:999}],examples:draft.examples.map(x=>({...x,author:"编造作者"}))},sources,meta);
  expect(r.examples.map(e=>e.author)).toEqual(["作者a","作者b"]);expect(r.metrics?.map(m=>m.rate)).toEqual([15,25]);
 });
 it("缺失播放或互动字段不以0伪造互动率",()=>{
  expect(()=>assembleConcreteTrendReport(draft,[{...sources[0],views:null},sources[1]],meta)).toThrow("互动率");
  expect(()=>assembleConcreteTrendReport(draft,[{...sources[0],shares:null},sources[1]],meta)).toThrow("互动率");
 });
 it("占比覆盖全部去重作品，遗漏或重复分母拒绝",()=>{
  expect(assembleConcreteTrendReport(draft,sources,{...meta,metricKind:"topicShare"}).metrics).toMatchObject([{rate:100}]);
  expect(()=>assembleConcreteTrendReport({...draft,assignments:draft.assignments.slice(0,1)},sources,{...meta,metricKind:"topicShare"})).toThrow("遗漏");
  expect(()=>assembleConcreteTrendReport({...draft,assignments:[draft.assignments[0],draft.assignments[0]]},sources,meta)).toThrow("重复");
 });
 it("未知或重复例子拒绝，不能编造出处",()=>{
  expect(()=>assembleConcreteTrendReport({...draft,examples:[{...draft.examples[0],id:"fake"},draft.examples[1]]},sources,meta)).toThrow("来源");
  expect(()=>assembleConcreteTrendReport({...draft,examples:[draft.examples[0],draft.examples[0]]},sources,meta)).toThrow("重复");
 });
 it("小红书点赞份额以选中作品总点赞为分母，不冒充互动率",()=>{
  const r=assembleConcreteTrendReport(draft,sources,{...meta,metricKind:"likeShare"});
  expect(r.metrics?.[0].rate).toBeCloseTo(100/3);expect(r.metrics?.reduce((n,m)=>n+m.rate,0)).toBeCloseTo(100);
  expect(r.evidenceNote).toContain("不代表全平台");
 });
});
