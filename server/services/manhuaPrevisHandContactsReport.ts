import { z } from "zod";
import { handContactAmount, type PrevisHandContact } from "../../shared/manhuaPrevisHandContacts";
const n=z.number().finite(),vec=z.tuple([n,n,n]);
const source=z.discriminatedUnion("kind",[z.object({kind:z.literal("sourceRig")}).strict(),z.object({kind:z.literal("riggedModel"),sourceJobId:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()]);
export const handContactsReportSchema=z.array(z.object({
 id:z.string().min(1),actorId:z.string().min(1),targetActorId:z.string().min(1),hand:z.enum(["hand-1","hand1"]),bone:z.enum(["head","neck"]),source,targetSource:source,
 samples:z.array(z.object({frame:z.number().int().min(1).max(720),amount:n.min(0).max(1),wrist:vec,original:vec,target:vec,desired:vec,residual:n.min(0).max(.005)}).strict()).min(48).max(720),
}).strict()).max(16);
export function validateHandContactsReport(raw:z.infer<typeof handContactsReportSchema>|undefined,spec:{durationSec:number;handContacts?:PrevisHandContact[];actors:{id:string;riggedModel?:{sourceJobId:string}}[]},models:readonly {actorId:string;sourceJobId:string;sha256:string}[]=[]){
 const contacts=spec.handContacts??[];
 if((raw?.length??0)!==contacts.length || new Set(raw?.map(r=>r.id)).size!==(raw?.length??0))throw Error("人马接触报告数量或身份不一致");
 for(const c of contacts){
  const row=raw!.find(r=>r.id===c.id);
  if(!row || row.actorId!==c.actorId || row.targetActorId!==c.targetActorId || row.hand!==c.hand || row.bone!==c.bone || row.samples.length!==spec.durationSec*24)throw Error("人马接触报告缺帧或对象错配");
  for(const [actorId,evidence] of [[c.actorId,row.source],[c.targetActorId,row.targetSource]] as const){
   const actor=spec.actors.find(a=>a.id===actorId);if(!actor)throw Error("人马接触角色不存在");
   if(actor.riggedModel){const model=models.filter(m=>m.actorId===actorId);if(evidence.kind!=="riggedModel"||model.length!==1||model[0].sourceJobId!==actor.riggedModel.sourceJobId||evidence.sourceJobId!==model[0].sourceJobId||evidence.sha256!==model[0].sha256)throw Error("人马接触没有读取同一真实模型");}
   else if(evidence.kind!=="sourceRig")throw Error("基础角色接触来源不一致");
  }
  row.samples.forEach((s,i)=>{
   const amount=handContactAmount(c,i/24),residual=Math.hypot(...s.wrist.map((v,j)=>v-s.desired[j]));
   if(s.frame!==i+1||Math.abs(s.amount-amount)>1e-6||Math.abs(s.residual-residual)>.00001||residual>.005||s.desired.some((v,j)=>Math.abs(v-(s.original[j]+(s.target[j]-s.original[j])*amount))>1e-5))throw Error("人马接触逐帧时序或实际手腕误差不一致");
  });
 }
}
