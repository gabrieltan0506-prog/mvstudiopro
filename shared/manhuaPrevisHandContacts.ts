import { z } from "zod";
const n=z.number().finite();
export const previsHandContactSchema=z.object({
 id:z.string().min(1).max(80),actorId:z.string().min(1).max(80),hand:z.enum(["hand-1","hand1"]),
 targetActorId:z.string().min(1).max(80),bone:z.enum(["head","neck"]),along:n.min(0).max(1).default(.5),
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
type HandSpec={durationSec:number;handContacts?:PrevisHandContact[];actors:{id:string;shape:string;visibleRanges?:{startSec:number;endSec:number}[];actions?:{kind:string;startSec:number;endSec:number}[]}[];storyProps?:{grip?:{actorId:string;hand:string}}[];piggyback?:{carrierId:string;passengerId:string};interactions?:{actorId:string;targetActorId:string}[]};
export function handContactsIssue(spec:HandSpec):string|null {
 const seen=new Set<string>();
 const contacts=spec.handContacts??[];
 for(const c of contacts){
  if(seen.has(c.id))return "人马手部接触 ID 重复";seen.add(c.id);
  const actor=spec.actors.find(a=>a.id===c.actorId),target=spec.actors.find(a=>a.id===c.targetActorId);
  if(!actor || actor.shape!=="human" || !target || target.shape!=="horse" || actor.id===target.id)return "扶颈接触必须由人形演员指向另一匹马";
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
