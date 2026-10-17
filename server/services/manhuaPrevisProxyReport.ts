import { z } from "zod";
import { previsProxyColorSchema, previsProxyColorAt, type PrevisProxyAppearance } from "../../shared/manhuaPrevisProxy";
export const proxyAppearanceReportSchema = z.array(z.object({
  actorId:z.string().min(1), style:z.literal("ball-cylinder"),
  samples:z.array(z.object({frame:z.number().int().min(1).max(720), color:previsProxyColorSchema,
    meshCount:z.number().int().positive(),sphereHeads:z.literal(1),cylinderBodies:z.number().int().positive(),
  }).strict()).min(48).max(720),
}).strict()).max(6);
export function validateProxyAppearanceReport(raw:z.infer<typeof proxyAppearanceReportSchema>|undefined,spec:{durationSec:number;actors:{id:string;proxyAppearance?:PrevisProxyAppearance}[]}) {
  const expected=spec.actors.filter(a=>a.proxyAppearance);
  if((raw?.length??0)!==expected.length || new Set(raw?.map(r=>r.actorId)).size!==(raw?.length??0))throw Error("球柱白模形态与换色回执缺失或重复");
  for(const actor of expected){
    const row=raw!.find(r=>r.actorId===actor.id);
    if(!row || row.samples.length!==spec.durationSec*24)throw Error("球柱白模缺少完整帧材质轨迹");
    row.samples.forEach((sample,i)=>{
      const color=previsProxyColorAt(actor.proxyAppearance!,i/24);
      if(sample.frame!==i+1 || sample.meshCount!==sample.cylinderBodies+sample.sphereHeads || sample.color.some((v,j)=>Math.abs(v-color[j])>.00001))throw Error("球柱白模的实际形态或材质换色与本次方案不一致");
    });
  }
}
