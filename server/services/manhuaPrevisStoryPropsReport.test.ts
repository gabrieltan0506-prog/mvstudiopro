import { it, expect } from "vitest";
import { previsStoryPropsSchema } from "../../shared/manhuaPrevisStoryProps";
import { storyPropsReportSchema, validateStoryPropsReport } from "./manhuaPrevisStoryPropsReport";
const props=previsStoryPropsSchema.parse([{id:"n",kind:"needle",keyframes:[{timeSec:0,anchor:{type:"bone",actorId:"mom",bone:"spine"},visible:false},{timeSec:2,anchor:{type:"bone",actorId:"mom",bone:"spine"},visible:false}]}]);
const spec={durationSec:2,storyProps:props,actors:[{id:"mom"}]};
function report(){return storyPropsReportSchema.parse([{id:"n",kind:"needle",samples:Array.from({length:48},(_,i)=>({frame:i+1,position:[0,0,1],visible:false,fromAnchor:props[0].keyframes[0].anchor,toAnchor:props[0].keyframes[1].anchor,progress:i/48}))}]);}
it("拒绝缺失、漏帧、错演员和提前袖光",()=>{expect(()=>validateStoryPropsReport(undefined,spec)).toThrow(/数量/);const r=report();expect(()=>validateStoryPropsReport(r,spec)).not.toThrow();r[0].samples.pop();expect(()=>validateStoryPropsReport(r,spec)).toThrow(/缺失/);const wrong=report();wrong[0].samples[1].fromAnchor={type:"bone",actorId:"other",bone:"spine",along:1,offset:[0,0,0]};expect(()=>validateStoryPropsReport(wrong,spec)).toThrow(/骨锚点/);const flash=report();flash[0].samples[1].visible=true;expect(()=>validateStoryPropsReport(flash,spec)).toThrow(/提前/);});
it("拒绝NaN与伪造插值进度",()=>{const r=report();r[0].samples[1].progress=.8;expect(()=>validateStoryPropsReport(r,spec)).toThrow(/时间/);r[0].samples[1].position[0]=NaN;expect(()=>storyPropsReportSchema.parse(r)).toThrow();});
it.each(["bowl","needle"] as const)("%s握持可见帧必须带真实握点误差",(kind)=>{
 const gripped=structuredClone(spec);gripped.storyProps[0].kind=kind;gripped.storyProps[0].grip={actorId:"mom",hand:"hand1",offset:[0,0,-.02],startSec:0,endSec:1};gripped.storyProps[0].keyframes.forEach(k=>k.visible=true);
 const r=report();r[0].kind=kind;r[0].samples.forEach(s=>{s.visible=true;if(kind==="bowl")s.fillLevel=0;});
 expect(()=>validateStoryPropsReport(r,gripped)).toThrow(/手腕/);
 r[0].samples.slice(0,24).forEach(s=>s.gripResidual=0.001);expect(()=>validateStoryPropsReport(r,gripped)).not.toThrow();
});

it("可见演员的道具不能用全隐藏回执假通过",()=>{const visible=structuredClone(spec);visible.storyProps[0].keyframes.forEach(k=>k.visible=true);expect(()=>validateStoryPropsReport(report(),visible)).toThrow(/消失/);});
it("血坛放回台面后保持固定位置与半坛量，释放后不伪需握点",()=>{
 const world={type:"world",position:[.5,0,1]};
 const p=previsStoryPropsSchema.parse([{id:"jar",kind:"jar",grip:{actorId:"mom",hand:"hand1",startSec:0,endSec:1},keyframes:[{timeSec:0,anchor:world,fill:.5},{timeSec:2,anchor:world,fill:.5}]}]);
 const r=storyPropsReportSchema.parse([{id:"jar",kind:"jar",samples:Array.from({length:48},(_,i)=>({frame:i+1,position:[.5,0,1],visible:true,fromAnchor:p[0].keyframes[0].anchor,toAnchor:p[0].keyframes[1].anchor,progress:i/48,fillLevel:.5,...(i<24?{gripResidual:0}:{})}))}]);
 const s={durationSec:2,storyProps:p,actors:[{id:"mom"}]};expect(()=>validateStoryPropsReport(r,s)).not.toThrow();
 r[0].samples[40].position[0]=.6;expect(()=>validateStoryPropsReport(r,s)).toThrow(/固定世界锚点/);
});

it.each(["information_panel", "bullet"] as const)("%s必须回报完整渐入保持渐出，不能以缺权重残差假通过",async kind=>{
 const {previsPanelGripAmount}=await import("../../shared/manhuaPrevisStoryProps");
 expect([0,.25,.5,1,1.5,1.75,2].map(t=>previsPanelGripAmount(0,2,t))).toEqual([0,.5,1,1,1,.5,0]);
 const gripped=structuredClone(spec);const p=gripped.storyProps[0];p.kind=kind;p.proxy={size:kind==="bullet"?[.12,.025,.025]:[.2,.02,.2],color:[.1,.4,.8]};p.grip={actorId:"mom",hand:"hand1",offset:[0,0,0],startSec:0,endSec:2};p.keyframes.forEach(k=>k.visible=true);
 const r=report();r[0].kind=p.kind;r[0].samples.forEach((s,i)=>{s.visible=true;s.gripResidual=.001;s.proxyGeometry={meshVertices:8,meshes:["panel"],minimum:[0,0,0],maximum:[1,1,1],color:[.1,.4,.8]};s.gripAmount=previsPanelGripAmount(0,2,i/24);});
 expect(()=>validateStoryPropsReport(r,gripped)).not.toThrow();delete r[0].samples[8].gripAmount;expect(()=>validateStoryPropsReport(r,gripped)).toThrow(/权重/);
});

it("小数秒爆椅报告拒绝丢碎片、重现原椅及虚假聚字", () => {
 const durationSec = 4.2, anchor = {type:"world" as const,position:[0,0,0] as [number,number,number]};
 const storyProps = previsStoryPropsSchema.parse([{id:"chair",kind:"chair_burst_text",proxy:{size:[.5,.5,1],color:[.4,.3,.2],burst:{startSec:1.1,burstEndSec:1.7,gatherStartSec:2.1,gatherEndSec:3.3,text:"真人把关",textPosition:[0,0,1],textWidth:1.1}},keyframes:[0,durationSec].map(timeSec=>({timeSec,anchor}))}]);
 const value = {durationSec,storyProps,actors:[]};
 const rows=storyPropsReportSchema.parse([{id:"chair",kind:"chair_burst_text",samples:Array.from({length:101},(_,i)=>({frame:i+1,position:[0,0,0],visible:true,fromAnchor:anchor,toAnchor:i===0?anchor:anchor,progress:i===0?0:i/24/durationSec,proxyGeometry:{meshVertices:200,meshes:["test-only-mesh"],minimum:[0,0,0],maximum:[1,1,1],color:[.4,.3,.2]},workflowState:{fragmentCount:48,fragmentsVisible:i/24>=1.1&&i/24<3.3?48:0,chairPartsVisible:i/24<1.1?6:0,textVisible:i/24>=3.3,targetMaxError:i/24>=3.3?0:1}}))}]);
 expect(()=>validateStoryPropsReport(rows,value)).not.toThrow();
 const lost=structuredClone(rows);lost[0].samples[40].workflowState!.fragmentsVisible=47;expect(()=>validateStoryPropsReport(lost,value)).toThrow(/完整碎片/);
 const double=structuredClone(rows);double[0].samples[40].workflowState!.chairPartsVisible=6;expect(()=>validateStoryPropsReport(double,value)).toThrow(/显隐/);
 const fake=structuredClone(rows);fake[0].samples[90].workflowState!.targetMaxError=.1;expect(()=>validateStoryPropsReport(fake,value)).toThrow(/聚字落点/);
});
