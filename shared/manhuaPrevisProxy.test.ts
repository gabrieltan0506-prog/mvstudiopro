import { describe, expect, it } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema, previsRenderCostUnits, formatPrevisMotionGuide } from "./manhuaPrevis";
import { previsProxyColorAt } from "./manhuaPrevisProxy";
import { applyAdvisorPrevisPatch, parseAdvisorPrevisPatch } from "./manhuaAdvisorPrevisEdit";
import { proxyAppearanceReportSchema, validateProxyAppearanceReport } from "../server/services/manhuaPrevisProxyReport";
import { storyPropsReportSchema, validateStoryPropsReport } from "../server/services/manhuaPrevisStoryPropsReport";
function fixture(){
 const s=createManhuaPrevisStudio(2,"11111111-1111-4111-8111-111111111111").spec;
 s.actors[0].actions=[];s.actors[0].proxyAppearance={style:"ball-cylinder",colors:[{timeSec:0,color:[.3,.4,.5]},{timeSec:1,color:[0,0,0]},{timeSec:2,color:[0,0,0]}]};
 s.storyProps=[{id:"task",kind:"task_avatar",proxy:{size:[.6,.6,1.6],color:[.5,.5,.5]},keyframes:[{timeSec:0,anchor:{type:"world",position:[0,0,0]},visible:true,scale:1,rotation:[0,0,0],fill:0},{timeSec:2,anchor:{type:"world",position:[1,0,0]},visible:true,scale:1,rotation:[0,0,0],fill:0}]}];
 return manhuaPrevisSpecSchema.parse(s);
}
describe("完整几何故事对象真实生产与恢复合同",()=>{
 it("完整几何配置可保存恢复并从导入候选进入同一渲染规格",()=>{
  const s=fixture(),old=structuredClone(s);delete old.storyProps;delete old.actors[0].proxyAppearance;
  const patch=parseAdvisorPrevisPatch(JSON.stringify({kind:"previs_edit_v1",summaryZh:"任务化身进场并转换",unsupportedZh:[],actors:[{id:s.actors[0].id,proxyAppearance:s.actors[0].proxyAppearance}],storyProps:s.storyProps}));
  expect(applyAdvisorPrevisPatch(old,patch)).toEqual(s);
  expect(manhuaPrevisSpecSchema.parse(JSON.parse(JSON.stringify(s)))).toEqual(s);
  expect(previsRenderCostUnits(s)).toBe(96);
  expect(formatPrevisMotionGuide(s)).toContain("任务化身");
 });
 it("没有真实几何配置、错演员、逆序换色和真实模型混搭时提交前拒绝",()=>{
  const s=fixture();delete s.storyProps![0].proxy;expect(()=>manhuaPrevisSpecSchema.parse(s)).toThrow("尺寸与颜色");
  const wrong=fixture();wrong.actors[0].proxyAppearance!.colors[1].timeSec=3;expect(()=>manhuaPrevisSpecSchema.parse(wrong)).toThrow("递增");
  const rig=fixture();rig.actors[0].shape="horse";expect(()=>manhuaPrevisSpecSchema.parse(rig)).toThrow("无真实模型");
 });
 it("拒绝空报告、漏帧及只回传输入颜色冒充实际换色",()=>{
  const s=fixture();const samples=Array.from({length:48},(_,i)=>({frame:i+1,color:previsProxyColorAt(s.actors[0].proxyAppearance!,i/24),meshCount:8,sphereHeads:1,cylinderBodies:7}));
  const report=proxyAppearanceReportSchema.parse([{actorId:s.actors[0].id,style:"ball-cylinder",samples}]);
  expect(()=>validateProxyAppearanceReport(report,s)).not.toThrow();
  expect(()=>validateProxyAppearanceReport(undefined,s)).toThrow("缺失");
  report[0].samples[30].color=[.3,.4,.5];expect(()=>validateProxyAppearanceReport(report,s)).toThrow("换色");
 });
 it("可见任务化身必须有真实非空网格，位置与整段轨迹一致",()=>{
  const s=fixture(),keys=s.storyProps![0].keyframes;
  const report=storyPropsReportSchema.parse([{id:"task",kind:"task_avatar",samples:Array.from({length:48},(_,i)=>({frame:i+1,position:[i/48,0,0],visible:true,fromAnchor:keys[0].anchor,toAnchor:i===0?keys[0].anchor:keys[1].anchor,progress:i/48,proxyGeometry:{meshVertices:100,meshes:["body","head"],minimum:[i/48-.3,-.3,0],maximum:[i/48+.3,.3,1.6],color:[.5,.5,.5]}}))}]);
  expect(()=>validateStoryPropsReport(report,s)).not.toThrow();delete report[0].samples[0].proxyGeometry;
  expect(()=>validateStoryPropsReport(report,s)).toThrow("实际网格");
 });
});
