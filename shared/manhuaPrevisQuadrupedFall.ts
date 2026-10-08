import { z } from "zod";
/** 倒地明确保持至片尾；后续镜头用 hold 延续，不隐式起身。 */
export const previsQuadrupedFallSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("collapse"), side: z.enum(["left", "right"]), startSec: z.number().finite().nonnegative(), foldSec: z.number().finite().nonnegative(), groundSec: z.number().finite().nonnegative() }).strict(),
  z.object({ mode: z.literal("hold"), side: z.enum(["left", "right"]) }).strict(),
]);
export type PrevisQuadrupedFall = z.infer<typeof previsQuadrupedFallSchema>;
export function quadrupedFallIssue(actor: { shape:string; quadrupedFall?:PrevisQuadrupedFall; start:number[]; end:number[]; motionRoute?:unknown; actions:{kind:string}[]; creature?:unknown; hitReaction?:unknown; visibleRanges?:unknown }, durationSec:number): string | null {
  const fall=actor.quadrupedFall;
  if (!fall) return null;
  if (actor.shape!=="horse" || actor.creature || actor.hitReaction || actor.motionRoute || actor.visibleRanges || actor.actions.some(a=>a.kind!=="idle") || actor.start.some((v,i)=>Math.abs(v-actor.end[i])>1e-6)) return "倒地与保持须为原地四足、整段在场，仅保留idle；不得与跛行、位移、受击或其他动作叠加";
  if (fall.mode==="collapse" && ([fall.startSec,fall.foldSec,fall.groundSec].some(t=>Math.abs(t*24-Math.round(t*24))>1e-6) || fall.foldSec-fall.startSec<.25 || fall.groundSec-fall.foldSec<.5 || fall.groundSec>(durationSec*24-1)/24)) return "倒地须按24帧对齐，屈腿至少0.25秒、侧落至少0.5秒，并在最后一帧前触地保持";
  return null;
}
export function quadrupedFallProgress(fall:PrevisQuadrupedFall,t:number) {
  const smooth=(v:number)=>{const u=Math.max(0,Math.min(1,v));return u*u*(3-2*u);};
  if(fall.mode==="hold") return {fold:1,roll:1,held:true};
  return {fold:smooth((t-fall.startSec)/(fall.foldSec-fall.startSec)),roll:smooth((t-fall.foldSec)/(fall.groundSec-fall.foldSec)),held:t>=fall.groundSec};
}
