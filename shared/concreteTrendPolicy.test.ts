import { expect, it } from "vitest";
import { assembleConcreteTrendReport, concreteReportPolicy, type ConcreteSource } from "./concreteTrendReport";
import { parseVisualReportJson } from "../server/services/visualReportLlm";
import { buildConcreteVisualReportPrompts } from "../server/services/concreteVisualReportPrompt";
const sources: ConcreteSource[]=Array.from({length:8},(_,i)=>({id:`case-${i}`,platform:"douyin",author:`作者${i}`,title:`真实作品${i}`,description:"原文",authorId:"test-author",url:null,publishedAt:"2026-11-04T00:00:00Z",likes:100+i,comments:20,shares:10,views:null}));
const draft=(count=8)=>({insights:Array.from({length:4},(_,i)=>({title:`方向${i}`,detail:"有来源的内容分析"})),themes:Array.from({length:4},(_,i)=>({primary:`主题${i}`,secondary:["具体问题","具体场景"]})),examples:sources.slice(0,count).map(s=>({id:s.id,title:s.title,description:"事实",angle:"切口",structure:"建议结构",adaptation:"建议做法"})),audiences:[{name:"人群甲",need:"需求",direction:"做法"},{name:"人群乙",need:"需求",direction:"做法"}],suggestions:Array.from({length:count},(_,i)=>({title:`选题${i}`,detail:"受众、开头与展开"})),assignments:sources.map(s=>({id:s.id,topic:"内容主题"}))});
const meta={reportTitle:"分析",dateRange:"近7天",platformLabel:"抖音",metricKind:"auto" as const};
it("无播放不画伪长条，八真实案例八选题经正式解析保留",()=>{
 expect(concreteReportPolicy(sources)).toMatchObject({metricKind:"none",exampleCount:8,suggestionCount:8});
 const parsed=parseVisualReportJson(JSON.stringify({concreteReport:draft(),trackGrowth:[{growth:"-99%"}]}),{platforms:["douyin"],concreteSources:sources}).parsed;
 const data=assembleConcreteTrendReport(parsed.concreteReport,sources,meta);expect(data.examples).toHaveLength(8);expect(data.suggestions).toHaveLength(8);expect(data.metrics).toEqual([]);expect(parsed.trackGrowth).toEqual([]);
 expect(data.examples[0]).toMatchObject({likes:100,author:"作者0"});
 expect(()=>assembleConcreteTrendReport(draft(4),sources,meta)).toThrow("数量");
});
it("四位作者完整可比指标才画互动率，比例取真实字段不取模型",()=>{
 const complete=sources.map(s=>({...s,views:1000}));const data=assembleConcreteTrendReport({...draft(4),metrics:[{rate:999}]},complete,meta);
 expect(data.metrics?.[0].rate).toBe(13);expect(data.metricKind).toBe("interactionRate");expect(data.suggestions).toHaveLength(4);
 expect(concreteReportPolicy(complete.map(s=>({...s,author:"同一作者"}))).metricKind).toBe("none");
 expect(()=>assembleConcreteTrendReport(draft(4),complete.map((s,i)=>i===0?{...s,shares:null}:s),meta)).toThrow("完整可比");
});
it("提示不把分类数量增减注入内容潜力，不泄露后台词且无空壳兼容要求",()=>{
 const prompt=buildConcreteVisualReportPrompts({platform:"douyin",platformLabel:"抖音",dateRange:"近7天",sources,growthHints:{宠物:"-90%"}});
 const payload=JSON.parse(prompt.user);expect(payload.growthHints).toEqual({});expect(prompt.user).not.toContain('-90%');expect(prompt.system).toContain('examples精确8');expect(prompt.system).toContain('suggestions精确8');
});
