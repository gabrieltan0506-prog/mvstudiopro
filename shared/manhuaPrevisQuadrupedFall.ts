import { z } from "zod";
/** 倒地明确保持至片尾；后续镜头用 hold 延续，不隐式起身。 */
export const previsQuadrupedFallSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("collapse"), side: z.enum(["left", "right"]), startSec: z.number().finite().nonnegative(), foldSec: z.number().finite().nonnegative(), groundSec: z.number().finite().nonnegative() }).strict(),
  z.object({ mode: z.literal("hold"), side: z.enum(["left", "right"]) }).strict(),
]);
export type PrevisQuadrupedFall = z.infer<typeof previsQuadrupedFallSchema>;
type FallActor = { shape:string; quadrupedFall?:PrevisQuadrupedFall; start:number[]; end:number[]; moveStartSec?:number; moveEndSec?:number; motionRoute?:unknown; actions:{kind:string}[]; creature?:unknown; hitReaction?:unknown; visibleRanges?:unknown };
export function quadrupedFallIssue(actor: FallActor, durationSec:number): string | null {
  const fall=actor.quadrupedFall;
  if (!fall) return null;
  if (actor.shape!=="horse" || actor.creature || actor.hitReaction || actor.motionRoute || actor.visibleRanges || actor.actions.some(a=>a.kind!=="idle")) return "倒地与保持须为整段在场四足，仅保留idle；不得与跛行、路线、受击或其他动作叠加";
  if (fall.mode==="collapse" && ([fall.startSec,fall.foldSec,fall.groundSec].some(t=>Math.abs(t*24-Math.round(t*24))>1e-6) || fall.foldSec-fall.startSec<.25 || fall.groundSec-fall.foldSec<.5 || fall.groundSec>(durationSec*24-1)/24)) return "倒地须按24帧对齐，屈腿至少0.25秒、侧落至少0.5秒，并在最后一帧前触地保持";
  if (actor.start.some((v,i)=>Math.abs(v-actor.end[i])>1e-6)) {
    const start=actor.moveStartSec, end=actor.moveEndSec;
    if(fall.mode!=="collapse" || !Number.isFinite(start) || !Number.isFinite(end)
      || start!<0 || !(start!<fall.startSec && fall.startSec<end! && end!<=fall.groundSec)
      || [start!,end!].some(t=>Math.abs(t*24-Math.round(t*24))>1e-6)) return "移动倒地须在行进中开始屈腿，移动秒位对齐24帧，且触地前停止；保持侧卧不可位移";
    const distance=Math.hypot(...actor.end.map((v,i)=>v-actor.start[i]));
    if(distance/(fall.startSec-start!+(end!-fall.startSec)/2)>1.2+1e-8) return "移动倒地减速前峰值不能超过每秒1.2米";
  }
  return null;
}
/** 与生产renderer同式：屈腿前匀速，之后用连续速度曲线减速至零。 */
export function quadrupedFallMovementProgress(actor: FallActor,t:number):number {
  const fall=actor.quadrupedFall;
  if(!fall || fall.mode!=="collapse" || !actor.start.some((v,i)=>Math.abs(v-actor.end[i])>1e-6)) return 0;
  const start=actor.moveStartSec!, end=actor.moveEndSec!;
  if(t<=start)return 0;
  if(t>=end)return 1;
  const cruise=fall.startSec-start, brake=end-fall.startSec;
  const elapsed=t<=fall.startSec?t-start:(()=>{const u=(t-fall.startSec)/brake;return cruise+brake*(u-u*u*u+.5*u*u*u*u);})();
  return elapsed/(cruise+brake/2);
}
export function quadrupedFallProgress(fall:PrevisQuadrupedFall,t:number) {
  const smooth=(v:number)=>{const u=Math.max(0,Math.min(1,v));return u*u*(3-2*u);};
  if(fall.mode==="hold") return {fold:1,roll:1,held:true};
  return {fold:smooth((t-fall.startSec)/(fall.foldSec-fall.startSec)),roll:smooth((t-fall.foldSec)/(fall.groundSec-fall.foldSec)),held:t>=fall.groundSec};
}
