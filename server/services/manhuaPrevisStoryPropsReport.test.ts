import { it, expect } from "vitest";
import { previsStoryPropsSchema } from "../../shared/manhuaPrevisStoryProps";
import { storyPropsReportSchema, validateStoryPropsReport } from "./manhuaPrevisStoryPropsReport";
const props=previsStoryPropsSchema.parse([{id:"n",kind:"needle",keyframes:[{timeSec:0,anchor:{type:"bone",actorId:"mom",bone:"spine"},visible:false},{timeSec:2,anchor:{type:"bone",actorId:"mom",bone:"spine"},visible:false}]}]);
const spec={durationSec:2,storyProps:props,actors:[{id:"mom"}]};
function report(){return storyPropsReportSchema.parse([{id:"n",kind:"needle",samples:Array.from({length:48},(_,i)=>({frame:i+1,position:[0,0,1],visible:false,fromAnchor:props[0].keyframes[0].anchor,toAnchor:props[0].keyframes[1].anchor,progress:i/48}))}]);}
it("拒绝缺失、漏帧、错演员和提前袖光",()=>{expect(()=>validateStoryPropsReport(undefined,spec)).toThrow(/数量/);const r=report();expect(()=>validateStoryPropsReport(r,spec)).not.toThrow();r[0].samples.pop();expect(()=>validateStoryPropsReport(r,spec)).toThrow(/缺失/);const wrong=report();wrong[0].samples[1].fromAnchor={type:"bone",actorId:"other",bone:"spine",along:1,offset:[0,0,0]};expect(()=>validateStoryPropsReport(wrong,spec)).toThrow(/骨锚点/);const flash=report();flash[0].samples[1].visible=true;expect(()=>validateStoryPropsReport(flash,spec)).toThrow(/提前/);});
it("拒绝NaN与伪造插值进度",()=>{const r=report();r[0].samples[1].progress=.8;expect(()=>validateStoryPropsReport(r,spec)).toThrow(/时间/);r[0].samples[1].position[0]=NaN;expect(()=>storyPropsReportSchema.parse(r)).toThrow();});
it("端碗可见帧必须带真实握点误差",()=>{
 const gripped=structuredClone(spec);gripped.storyProps[0].kind="bowl";gripped.storyProps[0].grip={actorId:"mom",hand:"hand1",offset:[0,0,-.02]};gripped.storyProps[0].keyframes.forEach(k=>k.visible=true);
 const r=report();r[0].kind="bowl";r[0].samples.forEach(s=>{s.visible=true;s.fillLevel=0;});
 expect(()=>validateStoryPropsReport(r,gripped)).toThrow(/手腕/);
 r[0].samples.forEach(s=>s.gripResidual=0.001);expect(()=>validateStoryPropsReport(r,gripped)).not.toThrow();
});

it("可见演员的道具不能用全隐藏回执假通过",()=>{const visible=structuredClone(spec);visible.storyProps[0].keyframes.forEach(k=>k.visible=true);expect(()=>validateStoryPropsReport(report(),visible)).toThrow(/消失/);});
it("血坛放回台面后保持固定位置与半坛量，释放后不伪需握点",()=>{
 const world={type:"world",position:[.5,0,1]};
 const p=previsStoryPropsSchema.parse([{id:"jar",kind:"jar",grip:{actorId:"mom",hand:"hand1",startSec:0,endSec:1},keyframes:[{timeSec:0,anchor:world,fill:.5},{timeSec:2,anchor:world,fill:.5}]}]);
 const r=storyPropsReportSchema.parse([{id:"jar",kind:"jar",samples:Array.from({length:48},(_,i)=>({frame:i+1,position:[.5,0,1],visible:true,fromAnchor:p[0].keyframes[0].anchor,toAnchor:p[0].keyframes[1].anchor,progress:i/48,fillLevel:.5,...(i<24?{gripResidual:0}:{})}))}]);
 const s={durationSec:2,storyProps:p,actors:[{id:"mom"}]};expect(()=>validateStoryPropsReport(r,s)).not.toThrow();
 r[0].samples[40].position[0]=.6;expect(()=>validateStoryPropsReport(r,s)).toThrow(/固定世界锚点/);
});
