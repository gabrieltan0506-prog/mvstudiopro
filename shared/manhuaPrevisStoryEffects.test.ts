import { describe, expect, it } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema, type ManhuaPrevisSpec } from "./manhuaPrevis";
import { advisorPrevisPatchSchema, applyAdvisorPrevisPatch, advisorPrevisSpecJson, advisorPrevisTargetSchema, ADVISOR_PREVIS_EDIT_INSTRUCTIONS } from "./manhuaAdvisorPrevisEdit";
import { previsPresentationGuideSpec } from "./manhuaPrevisPlayback";
import { MANHUA_ADVISOR_EFFECTS_HELP, advisorEffectsActionSchema } from "./manhuaAdvisorEffects";
import type { PrevisSceneEffect } from "./manhuaPrevisSceneEffects";

function fixture() {
 const spec=createManhuaPrevisStudio(9).spec;
 const first=spec.actors[0];first.assetRef="test-mother";first.riggedModel={sourceJobId:"m3d_test",forwardAxis:"+X",targetHeight:1.6};
 spec.actors=[first,...Array.from({length:3},(_,i)=>({...structuredClone(first),id:`actor-${i+2}`,start:[i+1,0] as [number,number],end:[i+1,0] as [number,number]}))];
 const props=["needle1","needle2"].map(id=>({id,kind:"needle",keyframes:[
  {timeSec:0,anchor:{type:"world",position:[0,0,1]}},
  {timeSec:4,anchor:{type:"world",position:[.5,0,1]}},
  {timeSec:5,anchor:{type:"bone",actorId:first.id,bone:"spine",along:1,offset:[.1,0,0]}},
  {timeSec:9,anchor:{type:"bone",actorId:first.id,bone:"spine",along:1,offset:[.1,0,0]}}
 ]}));
 return manhuaPrevisSpecSchema.parse({...spec,storyProps:props});
}
function effects(spec:ManhuaPrevisSpec):PrevisSceneEffect[] {
 const actorId=spec.actors[0].id;
 return [
  {id:"trail1",actorId,kind:"needle_trail",propId:"needle1",startSec:4,endSec:5,color:"#FFD477",radius:.003,trailSec:.25},
  {id:"smoke1",actorId,kind:"acupoint_smoke",propId:"needle1",startSec:5,endSec:6,color:"#222222",radius:.035,rise:.2,density:12,offset:[.05,0,0]},
  {id:"warm",actorId,kind:"complexion",startSec:6,endSec:8,color:"#EFAE99",strength:.18},
 ];
}
describe("顾问剧情特效完整规格",()=>{
 it("九秒四人候选保留真实身份/旧配置，进入保存与时间映射合同",()=>{
  const spec=fixture(),fx=effects(spec);
  const patch=advisorPrevisPatchSchema.parse({kind:"previs_edit_v1",summaryZh:"飞针落位后排黑气，脸色渐暖",unsupportedZh:[],sceneEffects:fx});
  const next=applyAdvisorPrevisPatch(spec,patch);
  expect(next.sceneEffects).toEqual(fx);expect(next.actors).toEqual(spec.actors);expect(next.storyProps).toEqual(spec.storyProps);expect(spec.sceneEffects).toBeUndefined();
  const roundtrip=manhuaPrevisSpecSchema.parse(JSON.parse(JSON.stringify(next)));expect(roundtrip).toEqual(next);
  const context=advisorPrevisSpecJson(next);expect(context).not.toContain("m3d_test");expect(context).toContain('"hasRiggedModel":true');
  expect(advisorPrevisTargetSchema.safeParse({clipId:"clip",scopeId:"11111111-1111-4111-8111-111111111111",specJson:context}).success).toBe(true);
  const retimed=previsPresentationGuideSpec({...next,timeMap:{sourceDurationSec:9,spans:[{sourceStartSec:0,sourceEndSec:9,rate:2}]}});
  expect(retimed.sceneEffects?.[0]).toMatchObject({startSec:2,endSec:2.5,trailSec:.125});expect(retimed.sceneEffects?.[2]).toMatchObject({startSec:3,endSec:4});
  expect(applyAdvisorPrevisPatch(next,{...patch,sceneEffects:[]}).sceneEffects).toEqual([]);
 });
 it("两根针各自保留光尾与黑气，不允许同针重复或假引用",()=>{
  const spec=fixture(),fx=effects(spec);
  const both=[...fx,...fx.slice(0,2).map(e=>({...e,id:e.id+"-2",propId:"needle2"}))];
  expect(manhuaPrevisSpecSchema.safeParse({...spec,sceneEffects:both}).success).toBe(true);
  expect(manhuaPrevisSpecSchema.safeParse({...spec,sceneEffects:[...fx,{...fx[0],id:"duplicate"}]}).success).toBe(false);
  for(const propId of ["absent","https://foreign.invalid/model"])
   expect(manhuaPrevisSpecSchema.safeParse({...spec,sceneEffects:[{...fx[0],propId}]}).success).toBe(false);
 });
 it("拒绝落针前冒黑气、隐藏针、无头颈真实模型、越时和超预算旧效果",()=>{
  const spec=fixture(),fx=effects(spec);
  for(const bad of [{...fx[1],startSec:4},{...fx[1],actorId:spec.actors[1].id},{...fx[1],endSec:9},{...fx[1],startSec:5.01},{...fx[1],endSec:5+1/24},{...fx[2],endSec:6+1/24}])
   expect(manhuaPrevisSpecSchema.safeParse({...spec,sceneEffects:[bad]}).success).toBe(false);
  expect(manhuaPrevisSpecSchema.safeParse({...spec,actors:spec.actors.map(({riggedModel,...a})=>a),sceneEffects:[fx[2]]}).success).toBe(false);
  expect(manhuaPrevisSpecSchema.safeParse({...spec,storyProps:spec.storyProps!.map(p=>({...p,keyframes:p.keyframes.map(f=>({...f,visible:false}))})),sceneEffects:[fx[0]]}).success).toBe(false);
  expect(manhuaPrevisSpecSchema.safeParse({...spec,sceneEffects:[...fx,{id:"cape",kind:"cape",actorId:spec.actors[0].id,width:1,length:1,color:"#FFFFFF",wind:[0,0,0]}]}).success).toBe(false);
 });
 it("已有烟尘字段不再漏接，顾问两条工具说明都有真实新合同",()=>{
  const spec=createManhuaPrevisStudio(4).spec;
  const effect={id:"old-smoke",kind:"smoke",startSec:1,durationSec:1,origin:[0,0,0],radius:.3,height:.5,wind:[0,0]};
  const patch=advisorPrevisPatchSchema.parse({kind:"previs_edit_v1",summaryZh:"加入已有烟尘",unsupportedZh:[],effects:[effect]});
  expect(applyAdvisorPrevisPatch(spec,patch).effects).toEqual([effect]);
  expect(applyAdvisorPrevisPatch({...spec,effects:patch.effects},{...patch,effects:[]}).effects).toEqual([]);
  for(const prompt of [ADVISOR_PREVIS_EDIT_INSTRUCTIONS,MANHUA_ADVISOR_EFFECTS_HELP])for(const kind of ["needle_trail","acupoint_smoke","complexion"])expect(prompt).toContain(kind);
  expect(advisorEffectsActionSchema.safeParse({action:"effects",tool:"scene",operation:"configure",sourceKey:"current",clipId:"clip",sceneEffects:effects(fixture())}).success).toBe(true);
 });
});
