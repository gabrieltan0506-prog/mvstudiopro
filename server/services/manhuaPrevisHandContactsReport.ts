import { z } from "zod";
import { handContactAmount, PREVIS_HAND_CONTACT_BONES, type PrevisHandContact } from "../../shared/manhuaPrevisHandContacts";
const n=z.number().finite(),vec=z.tuple([n,n,n]);
const source=z.discriminatedUnion("kind",[z.object({kind:z.literal("sourceRig")}).strict(),z.object({kind:z.literal("riggedModel"),sourceJobId:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()]);
export const handContactsReportSchema=z.array(z.object({
 id:z.string().min(1),actorId:z.string().min(1),targetActorId:z.string().min(1),hand:z.enum(["hand-1","hand1"]),bone:z.enum(PREVIS_HAND_CONTACT_BONES),source,targetSource:source,
 samples:z.array(z.object({frame:z.number().int().min(1).max(720),amount:n.min(0).max(1),wrist:vec,original:vec,target:vec,desired:vec,residual:n.min(0).max(.005),surface:z.object({original:vec,target:vec,desired:vec,hand:vec,residual:n.min(0).max(.005)}).strict().optional()}).strict()).min(48).max(720),
}).strict()).max(16);
export function validateHandContactsReport(raw:z.infer<typeof handContactsReportSchema>|undefined,spec:{durationSec:number;handContacts?:PrevisHandContact[];actors:{id:string;riggedModel?:{sourceJobId:string}}[]},models:readonly {actorId:string;sourceJobId:string;sha256:string}[]=[]){
 const contacts=spec.handContacts??[];
 if((raw?.length??0)!==contacts.length || new Set(raw?.map(r=>r.id)).size!==(raw?.length??0))throw Error("人马接触报告数量或身份不一致");
 for(const c of contacts){
  const row=raw!.find(r=>r.id===c.id);
  if(!row || row.actorId!==c.actorId || row.targetActorId!==c.targetActorId || row.hand!==c.hand || row.bone!==c.bone || row.samples.length!==spec.durationSec*24)throw Error("人马接触报告缺帧或对象错配");
  const human=c.bone==="upper_arm-1"||c.bone==="upper_arm1";
  if(human){
   const pair=contacts.filter(other=>other.actorId===c.actorId&&other.targetActorId===c.targetActorId&&(["startSec","contactSec","releaseSec","endSec"] as const).every(key=>other[key]===c[key]));
   if(pair.length!==2||contacts.filter(p=>p.targetActorId===c.targetActorId).length!==2||new Set(pair.map(p=>p.hand)).size!==2||new Set(pair.map(p=>p.bone)).size!==2||pair.some(p=>!["upper_arm-1","upper_arm1"].includes(p.bone)))throw Error("扶坐接触报告须对应同一人同窗双手两侧上臂");
  }
  for(const [actorId,evidence] of [[c.actorId,row.source],[c.targetActorId,row.targetSource]] as const){
   const actor=spec.actors.find(a=>a.id===actorId);if(!actor)throw Error("人马接触角色不存在");
   if(human&&!actor.riggedModel)throw Error("扶坐接触缺少真实模型来源");
   if(actor.riggedModel){const model=models.filter(m=>m.actorId===actorId);if(evidence.kind!=="riggedModel"||model.length!==1||model[0].sourceJobId!==actor.riggedModel.sourceJobId||evidence.sourceJobId!==model[0].sourceJobId||evidence.sha256!==model[0].sha256)throw Error("人马接触没有读取同一真实模型");}
   else if(evidence.kind!=="sourceRig")throw Error("基础角色接触来源不一致");
  }
  row.samples.forEach((s,i)=>{
   const amount=handContactAmount(c,i/24),residual=Math.hypot(...s.wrist.map((v,j)=>v-s.desired[j]));
   if(s.frame!==i+1||Math.abs(s.amount-amount)>1e-6||Math.abs(s.residual-residual)>.00001||residual>.005||(!human&&s.desired.some((v,j)=>Math.abs(v-(s.original[j]+(s.target[j]-s.original[j])*amount))>1e-5)))throw Error("人马接触逐帧时序或实际手腕误差不一致");
   if(human){
    const surface=s.surface;if(!surface)throw Error("扶坐缺少逐帧真实蒙皮表面接触");
    const error=Math.hypot(...surface.hand.map((v,j)=>v-surface.desired[j]));
    if(Math.abs(surface.residual-error)>1e-5||error>.005||surface.desired.some((v,j)=>Math.abs(v-(surface.original[j]+(surface.target[j]-surface.original[j])*amount))>1e-5))throw Error("扶坐实际蒙皮接触误差或表面时序不一致");
   }else if(s.surface)throw Error("扶颈报告不能混用扶坐表面契约");
  });
 }
}
