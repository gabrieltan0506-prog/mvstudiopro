import { z } from "zod";
const support = { supportHeight: z.number().finite().min(.25).max(.65), reclineDeg: z.number().finite().min(25).max(70) };
/** 人体坐卧支撑；转换结束保持坐稳，不隐式站起。 */
export const previsHumanPostureSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("hold"), posture: z.enum(["sit", "recline"]), ...support }).strict(),
  z.object({ mode: z.literal("rise_to_sit"), startSec: z.number().finite().nonnegative(), endSec: z.number().finite().nonnegative(), ...support }).strict(),
]);
export type PrevisHumanPosture = z.infer<typeof previsHumanPostureSchema>;
export function humanPostureIssue(actor: { shape: string; humanPosture?: PrevisHumanPosture; riggedModel?: unknown; creature?: unknown; motionRoute?: unknown; visibleRanges?: unknown; start: number[]; end: number[]; actions: {kind:string}[] }, durationSec:number): string|null {
  const p=actor.humanPosture;
  if (!p) return null;
  if(actor.shape!=="human" || actor.creature || actor.motionRoute || actor.visibleRanges || actor.actions.some(a=>a.kind!=="idle") || actor.start.some((v,i)=>Math.abs(v-actor.end[i])>1e-6)) return "坐卧支撑仅支持原地整段在场人体及idle；不叠加运动、隐藏和其他动作，带骨模型须通过逐帧实际网格支撑检查";
  if(p.mode==="rise_to_sit" && ([p.startSec,p.endSec].some(t=>Math.abs(t*24-Math.round(t*24))>1e-6) || p.endSec-p.startSec<.5 || p.endSec>(durationSec*24-1)/24)) return "坐起须24帧对齐，转换至少0.5秒，并在末帧前坐稳保持";
  return null;
}
