import { z } from "zod";
import { PREVIS_MAX_ACTORS, type ManhuaPrevisSpec } from "../../shared/manhuaPrevis";
import { quadrupedFallProgress, type PrevisQuadrupedFall } from "../../shared/manhuaPrevisQuadrupedFall";
type FallSpec = Omit<ManhuaPrevisSpec,"actors"> & { actors:(ManhuaPrevisSpec["actors"][number] & {quadrupedFall?:PrevisQuadrupedFall})[] };
const n=z.number().finite();
export const quadrupedFallReportSchema=z.array(z.object({
  actorId:z.string().min(1),
  rootSource:z.discriminatedUnion("kind",[z.object({kind:z.literal("sourceRig")}).strict(),z.object({kind:z.literal("riggedModel"),sourceJobId:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()]),
  torsoVertices:z.number().int().min(3),meshMeasured:z.literal(true),normalSpeedValidated:z.literal(false),
  samples:z.array(z.object({frame:z.number().int().min(1).max(720),held:z.boolean(),minimumHeight:n,torsoMinimumHeight:n,torsoTiltDeg:n.min(0).max(180),torsoUp:z.tuple([n,n,n]),legFoldDeg:z.tuple([n.min(0).max(180),n.min(0).max(180),n.min(0).max(180),n.min(0).max(180)]),root:z.tuple([n,n,n])}).strict()).min(48).max(720),
}).strict()).max(PREVIS_MAX_ACTORS);
export function validateQuadrupedFallReport(raw:z.infer<typeof quadrupedFallReportSchema>|undefined,spec:FallSpec,models:readonly {actorId:string;sourceJobId:string;sha256:string}[]=[]) {
  const actors=spec.actors.filter(a=>a.quadrupedFall);
  if((raw?.length??0)!==actors.length || new Set(raw?.map(r=>r.actorId)).size!==(raw?.length??0)) throw Error("倒地逐帧报告数量或身份不一致");
  for(const actor of actors){
    const row=raw!.find(r=>r.actorId===actor.id);
    if(!row || row.samples.length!==spec.durationSec*24) throw Error("倒地逐帧报告缺失");
    if(actor.riggedModel){
      const modelsFor=models.filter(m=>m.actorId===actor.id),source=row.rootSource;
      if(source.kind!=="riggedModel" || modelsFor.length!==1 || source.sourceJobId!==actor.riggedModel.sourceJobId || modelsFor[0].sourceJobId!==source.sourceJobId || modelsFor[0].sha256!==source.sha256) throw Error("倒地报告未读取本角色实际带骨网格");
    } else if(row.rootSource.kind!=="sourceRig") throw Error("倒地基础白模来源不一致");
    let heldRoot:number[]|undefined;
    row.samples.forEach((s,i)=>{
      const progress=quadrupedFallProgress(actor.quadrupedFall!,i/24);
      if(Math.abs(s.root[0]-actor.start[0])>.005 || Math.abs(s.root[1]-actor.start[1])>.005 || s.frame!==i+1 || s.held!==progress.held || s.minimumHeight<-.005 || s.torsoMinimumHeight<s.minimumHeight-.001 || (progress.fold>0 && Math.abs(s.minimumHeight)>.005)) throw Error("倒地实际网格接地或时序不一致");
      if(progress.held){
        const yaw=actor.facingDeg*Math.PI/180, side=actor.quadrupedFall!.side==="left"?1:-1;
        // +X朝前、+Y为左：向左倒时躯干上轴指向+Y。
        const expectedUp=[-Math.sin(yaw)*side,Math.cos(yaw)*side,0];
        if(Math.abs(Math.hypot(...s.torsoUp)-1)>.001 || s.torsoUp.reduce((sum,v,j)=>sum+v*expectedUp[j],0)<.96 || s.torsoMinimumHeight>.08 || s.torsoTiltDeg<75 || s.legFoldDeg.some(v=>v<75)) throw Error("倒地未形成躯干侧卧支撑与四腿折叠");
        if(heldRoot && s.root.some((v,j)=>Math.abs(v-heldRoot![j])>.005)) throw Error("倒地保持位置漂移或自动恢复");
        heldRoot??=s.root;
      }
    });
  }
}
