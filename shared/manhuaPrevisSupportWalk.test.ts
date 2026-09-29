import {describe,it,expect} from 'vitest';
import {createManhuaPrevisStudio,manhuaPrevisSpecSchema} from './manhuaPrevis';
import {parseAdvisorPrevisPatch,advisorPrevisPatchSchema,applyAdvisorPrevisPatch,advisorPrevisSpecJson} from './manhuaAdvisorPrevisEdit';
function setup(){
 const spec=createManhuaPrevisStudio(4).spec;
 const a={...spec.actors[0],start:[0,0] as [number,number],end:[1,0] as [number,number],moveStartSec:1.25,moveEndSec:3.75,actions:[{kind:'walk' as const,startSec:1.25,endSec:3.75}]};
 spec.actors=[a,{...a,id:'mother',nameZh:'娘',start:[0,.65],end:[1,.65]}];
 const event={id:'support',kind:'support_walk' as const,actorId:a.id,targetActorId:'mother',startSec:0,contactSec:1,endSec:4};
 return {spec,event};
}
describe('顾问搀扶事件完整传递',()=>{
 it('候选到严格规格、模型上下文保留事件且不修改原稿',()=>{
  const {spec,event}=setup();const before=JSON.stringify(spec);
  const patch=advisorPrevisPatchSchema.parse({kind:'previs_edit_v1',summaryZh:'扶稳娘后同行',unsupportedZh:[],interactions:[event]});
  const next=applyAdvisorPrevisPatch(spec,patch);
  expect(next.interactions).toEqual([event]);expect(JSON.parse(advisorPrevisSpecJson(next)).interactions).toEqual([event]);expect(JSON.stringify(spec)).toBe(before);
 });
 it('四位小数帧秒位归一并由路线补齐省略端点，显式冲突与真实非帧值仍拒绝',()=>{
  const {spec}=setup();const raw={kind:'previs_edit_v1',summaryZh:'沿路线同行',unsupportedZh:[],actors:[{id:spec.actors[0].id,motionRoute:[{timeSec:0,position:[0,0],facingDeg:0},{timeSec:3.9583,position:[1,0],facingDeg:0}]}]};
  expect(applyAdvisorPrevisPatch(spec,parseAdvisorPrevisPatch(JSON.stringify(raw))).actors[0].motionRoute?.at(-1)?.timeSec).toBe(95/24);
  const conflict={...raw,actors:[{...raw.actors[0],end:[9,9]}]};expect(()=>applyAdvisorPrevisPatch(spec,parseAdvisorPrevisPatch(JSON.stringify(conflict)))).toThrow();
  raw.actors[0].motionRoute[1].timeSec=3.95;expect(()=>applyAdvisorPrevisPatch(spec,parseAdvisorPrevisPatch(JSON.stringify(raw)))).toThrow();
 });
 it('接受原样身份回传，但拒绝修改身份、造型与出场范围',()=>{
  const {spec,event}=setup();const actor=spec.actors[0];
  const raw={kind:'previs_edit_v1',summaryZh:'扶稳同行',unsupportedZh:[],interactions:[event],actors:[{id:actor.id,nameZh:actor.nameZh,colorIndex:actor.colorIndex,shape:actor.shape,visibleRanges:actor.visibleRanges}]};
  expect(applyAdvisorPrevisPatch(spec,parseAdvisorPrevisPatch(JSON.stringify(raw))).actors).toEqual(spec.actors);
  for(const changed of [{nameZh:'换人'},{shape:'horse'},{colorIndex:5},{visibleRanges:[{startSec:0,endSec:1}]}]){
   expect(()=>applyAdvisorPrevisPatch(spec,parseAdvisorPrevisPatch(JSON.stringify({...raw,actors:[{...raw.actors[0],...changed}]})))).toThrow('锁定字段');
  }
 });
 it('拒绝坐姿叠加、过早松手、过短扶稳、未知人物',()=>{
  for(const variant of ['sit','early','short','missing']){
   const {spec,event}=setup();spec.interactions=[event];
   if(variant==='sit')spec.actors[1].actions=[{kind:'sit',startSec:0,endSec:4}];
   if(variant==='early')event.endSec=3;
   if(variant==='short')event.contactSec=.5;
   if(variant==='missing')event.targetActorId='missing';
   expect(manhuaPrevisSpecSchema.safeParse(spec).success,variant).toBe(false);
  }
 });
});
