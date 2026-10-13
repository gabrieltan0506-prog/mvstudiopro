import { expect, it } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema } from "../../shared/manhuaPrevis";
import { validatePrevisSceneEffectsReport } from "./manhuaPrevisSceneEffectsReport";

function fixture(){
 const base=createManhuaPrevisStudio(2).spec,actorId=base.actors[0].id;
 base.actors[0].riggedModel={sourceJobId:"m3d_test",forwardAxis:"+X",targetHeight:1.6};base.actors[0].assetRef="test";
 const bone={type:"bone",actorId,bone:"spine"};
 const spec=manhuaPrevisSpecSchema.parse({...base,storyProps:[{id:"needle",kind:"needle",keyframes:[{timeSec:0,anchor:{type:"world",position:[0,0,1]}},{timeSec:1,anchor:bone},{timeSec:2,anchor:bone}]}],sceneEffects:[
  {id:"tail",actorId,kind:"needle_trail",propId:"needle",startSec:0,endSec:1,color:"#FFFFFF",radius:.003,trailSec:.25},
  {id:"smoke",actorId,kind:"acupoint_smoke",propId:"needle",startSec:1,endSec:1.75,color:"#222222",radius:.03,rise:.2,density:12,offset:[0,0,0]},
  {id:"warm",actorId,kind:"complexion",startSec:1,endSec:1.75,color:"#EFAE99",strength:.2},
 ]});
 const props=[{id:"needle",kind:"needle" as const,samples:Array.from({length:48},(_,i)=>({frame:i+1,position:[i/100,0,1] as [number,number,number],visible:true,fromAnchor:spec.storyProps![0].keyframes[0].anchor,toAnchor:spec.storyProps![0].keyframes[1].anchor,progress:0}))}];
 const rows=spec.sceneEffects!.map(effect=>({id:effect.id,kind:effect.kind,actorId,boundaryZh:"测试用报告，不作为渲染证据",samples:Array.from({length:48},(_,i)=>{
  const t=i/24,start="startSec" in effect?effect.startSec:0,end="endSec" in effect?effect.endSec:0,u=Math.max(0,Math.min(1,(t-start)/(end-start)));
  const basic={frame:i+1,meshVertices:100,finiteBounds:true,minimum:[0,0,0],maximum:[1,1,1],targetMeshes:["mesh"]};
  return effect.kind==="complexion"?{...basic,strength:effect.strength*u*u*(3-2*u),strengthMinimum:effect.strength*u*u*(3-2*u),maskedVertices:20,maskConnected:true,texturePreserved:true,materials:[{mesh:"mesh",material:"real",maskAttribute:"head",maskedVertices:20,sourceNode:"original"}]}:{...basic,propId:"needle",active:t>=start&&t<=end,anchor:props[0].samples[i].position,attachmentError:0,...(effect.kind==="needle_trail"?{trailLength:.1,segmentCount:6,tip:props[0].samples[i].position}:{density:t>start&&t<end?6:0,particleCount:5})};
 })}));
 return {spec,props,rows};
}
it("拒绝报告缺项、错误针位、空烟、空光尾及未接通/整段固定气色",()=>{
 const {spec,props,rows}=fixture();expect(()=>validatePrevisSceneEffectsReport(rows,spec,props)).not.toThrow();
 const rejects=(change:(r:any[])=>void)=>{const altered=structuredClone(rows);change(altered);expect(()=>validatePrevisSceneEffectsReport(altered,spec,props)).toThrow()};
 rejects(r=>r.pop());rejects(r=>r[0].samples.pop());rejects(r=>r[0].samples[12].anchor=[9,0,0]);
 rejects(r=>r[0].samples.forEach((s:any)=>s.trailLength=0));rejects(r=>r[1].samples.forEach((s:any)=>s.density=0));
 rejects(r=>r[1].samples[0].density=5);rejects(r=>r[2].samples[40].maskConnected=false);
 rejects(r=>r[2].samples[40].texturePreserved=false);rejects(r=>r[2].samples.forEach((s:any)=>s.strength=.2));
 rejects(r=>r[2].samples[40].maskedVertices=0);
});
