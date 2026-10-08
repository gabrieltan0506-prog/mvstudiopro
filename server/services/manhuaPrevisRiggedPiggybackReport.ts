import { z } from "zod";
import type { ManhuaPrevisRequest } from "../../shared/manhuaPrevis";
import { piggybackBlockAmount, previsPiggybackBlockBowlSchema } from "../../shared/manhuaPrevisPiggyback";

const sourceSchema = z.object({actorId:z.string().min(1),sourceJobId:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const error = z.number().finite().min(0).max(.005);
export const riggedPiggybackReportSchema = z.object({
  blockBowl:previsPiggybackBlockBowlSchema.optional(),
  carrier:sourceSchema, passenger:sourceSchema, meshMeasured:z.literal(true),normalSpeedValidated:z.literal(false),boundaryZh:z.string().min(1),
  samples:z.array(z.object({
    frame:z.number().int().min(1).max(720),supportError:error,gripError:error,
    carrierSoleHeights:z.tuple([z.number().finite().min(-.005).max(.18),z.number().finite().min(-.005).max(.18)]),
    passengerSoleHeights:z.tuple([z.number().finite().min(.1),z.number().finite().min(.1)]),
    maxBoneLengthError:z.number().finite().min(0).max(.001),blockAmount:z.number().finite().min(0).max(1),blockError:error,
  }).strict()).min(48).max(720),
}).strict();

export function validateRiggedPiggybackReport(
  report:z.infer<typeof riggedPiggybackReportSchema>|undefined,
  spec:ManhuaPrevisRequest["spec"],
  models:Array<{actorId:string;sourceJobId:string;sha256:string}>, frames:number,
) {
  const pair=spec.piggyback;
  const expected=pair && spec.actors.some(actor=>[pair.carrierId,pair.passengerId].includes(actor.id)&&actor.riggedModel);
  if (!expected) {
    if(report) throw new Error("未配置真实背负却返回模型接触报告");
    return;
  }
  if(!report || !pair || pair.slipCatch || pair.setDown) throw new Error("真实背负逐帧报告缺失或组合未支持");
  if(JSON.stringify(report.blockBowl)!==JSON.stringify(pair.blockBowl)) throw new Error("真实背负挡碗配置与回执不一致");
  for(const [role,id] of [["carrier",pair.carrierId],["passenger",pair.passengerId]] as const) {
    const source=models.find(model=>model.actorId===id), actual=report[role];
    if(!source || !spec.actors.find(actor=>actor.id===id)?.riggedModel || actual.actorId!==id
      || actual.sourceJobId!==source.sourceJobId || actual.sha256!==source.sha256)
      throw new Error("真实背负模型来源或角色不一致");
  }
  if(report.samples.length!==frames) throw new Error("真实背负逐帧报告不完整");
  for(let index=0;index<report.samples.length;index++) {
    const row=report.samples[index];
    const amount=pair.blockBowl ? piggybackBlockAmount(pair.blockBowl,index+1) : 0;
    if(row.frame!==index+1 || Math.min(...row.carrierSoleHeights)>.03
      || Math.abs(row.blockAmount-amount)>1e-6 || (!pair.blockBowl && row.blockError!==0))
      throw new Error("真实背负足底或挡碗时序不一致");
  }
}
