import { z } from "zod";
import type { PrevisHumanPosture } from "./manhuaPrevisHumanPosture";
const n=z.number().finite();
export const PREVIS_HAND_CONTACT_BONES=["head","neck","upper_arm-1","upper_arm1"] as const;
const contactTimes=["startSec","contactSec","releaseSec","endSec"] as const;
export const previsHandContactSchema=z.object({
 id:z.string().min(1).max(80),actorId:z.string().min(1).max(80),hand:z.enum(["hand-1","hand1"]),
 targetActorId:z.string().min(1).max(80),bone:z.enum(PREVIS_HAND_CONTACT_BONES),along:n.min(0).max(1).default(.5),
 offset:z.tuple([n.min(-1).max(1),n.min(-1).max(1),n.min(-1).max(1)]).default([0,0,0]),
 startSec:n.nonnegative(),contactSec:n.nonnegative(),releaseSec:n.nonnegative(),endSec:n.nonnegative(),
}).strict();
export const previsHandContactsSchema=z.array(previsHandContactSchema).max(16);
export type PrevisHandContact=z.infer<typeof previsHandContactSchema>;
export function handContactAmount(c:PrevisHandContact,t:number):number {
 const smooth=(v:number)=>{const u=Math.max(0,Math.min(1,v));return u*u*(3-2*u);};
 if(t<c.startSec || t>c.endSec)return 0;
 const into=c.contactSec===c.startSec?1:smooth((t-c.startSec)/(c.contactSec-c.startSec));
 const out=c.endSec===c.releaseSec?1:smooth((c.endSec-t)/(c.endSec-c.releaseSec));
 return into*out;
}
type HandSpec={durationSec:number;handContacts?:PrevisHandContact[];actors:{id:string;shape:string;riggedModel?:unknown;humanPosture?:PrevisHumanPosture;visibleRanges?:{startSec:number;endSec:number}[];actions?:{kind:string;startSec:number;endSec:number}[]}[];storyProps?:{grip?:{actorId:string;hand:string}}[];piggyback?:{carrierId:string;passengerId:string};interactions?:{actorId:string;targetActorId:string}[]};
export function handContactsIssue(spec:HandSpec):string|null {
 const seen=new Set<string>();
 const contacts=spec.handContacts??[];
 for(const c of contacts){
  if(seen.has(c.id))return "人马手部接触 ID 重复";seen.add(c.id);
  const actor=spec.actors.find(a=>a.id===c.actorId),target=spec.actors.find(a=>a.id===c.targetActorId);
  if(!actor || actor.shape!=="human" || !target || !["horse","human"].includes(target.shape) || actor.id===target.id)return "手部接触必须指向另一匹马或已有坐卧支撑的另一人体";
  if(target.shape==="horse" && !["head","neck"].includes(c.bone))return "扶颈只允许马的头颈锚点";
  if(target.shape==="human"){
   const posture=target.humanPosture;
   if(!actor.riggedModel || !target.riggedModel || !posture || (posture.mode==="hold"&&posture.posture!=="sit") || !["upper_arm-1","upper_arm1"].includes(c.bone))return "扶坐须双方真实模型、坐起或坐稳的目标及两侧上臂锚点";
   if(Math.hypot(...c.offset)>.2)return "扶坐上臂表面定位偏移不得超过0.2米";
   const pair=contacts.filter(other=>other.actorId===c.actorId&&other.targetActorId===c.targetActorId&&contactTimes.every(key=>other[key]===c[key]));
   if(pair.length!==2 || contacts.filter(row=>row.targetActorId===target.id).length!==2 || new Set(pair.map(row=>row.hand)).size!==2 || new Set(pair.map(row=>row.bone)).size!==2 || pair.some(row=>!["upper_arm-1","upper_arm1"].includes(row.bone)))return "扶坐须由同一人双手分别接两侧上臂，使用同一完整接触窗口";
   if(posture.mode==="rise_to_sit"&&(c.contactSec>posture.startSec||c.releaseSec<posture.endSec))return "双手扶坐的保持窗口须覆盖完整坐起过程";
   if(spec.piggyback&&[spec.piggyback.carrierId,spec.piggyback.passengerId].some(id=>[actor.id,target.id].includes(id)))return "扶坐双方不能同时背负";
   if(spec.interactions?.some(e=>[e.actorId,e.targetActorId].some(id=>[actor.id,target.id].includes(id))))return "扶坐双方不能叠加其他双人接触";
   if(spec.storyProps?.some(p=>p.grip?.actorId===target.id))return "被扶坐者不能同时持握道具改变上臂接触";
  }
  const times=[c.startSec,c.contactSec,c.releaseSec,c.endSec];
  if(times.some(t=>Math.abs(t*24-Math.round(t*24))>1e-6) || c.startSec>c.contactSec || c.releaseSec-c.contactSec<.25 || c.endSec<c.releaseSec || c.endSec>spec.durationSec || (c.startSec===c.contactSec && c.startSec!==0) || (c.releaseSec===c.endSec && c.endSec!==spec.durationSec))return "扶颈须24帧对齐并依次伸手、保持、收手；跨段保持仅允许片首/片尾";
  if((c.contactSec>c.startSec && c.contactSec-c.startSec<.25)||(c.endSec>c.releaseSec && c.endSec-c.releaseSec<.25))return "扶颈伸手和收手各需至少0.25秒";
  if([actor,target].some(a=>a.visibleRanges&&!a.visibleRanges.some(r=>r.startSec<=c.startSec&&r.endSec>=c.endSec)))return "扶颈双方须在整个接触窗口内在场";
  if(spec.storyProps?.some(p=>p.grip?.actorId===c.actorId&&p.grip.hand===c.hand))return "同一只手不能同时端碗与扶颈";
  if(spec.piggyback && [spec.piggyback.carrierId,spec.piggyback.passengerId].includes(c.actorId))return "背负双方的手不能叠加扶颈约束";
  if(spec.interactions?.some(e=>[e.actorId,e.targetActorId].includes(c.actorId)))return "扶颈演员不能叠加其他双人接触约束";
  if(actor.actions?.some(a=>!["idle","walk","look"].includes(a.kind)&&a.startSec<c.endSec&&a.endSec>c.startSec))return "扶颈窗口不能叠加独立手臂动作";
  if(contacts.some(other=>other.id!==c.id&&other.actorId===c.actorId&&other.hand===c.hand&&other.startSec<c.endSec&&other.endSec>c.startSec))return "同一只手的扶颈窗口不能重叠";
 }
 return null;
}
