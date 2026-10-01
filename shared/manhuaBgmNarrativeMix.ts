import { z } from "zod";

/** 音乐叙事工作单：由创作者确认片内秒位和强弱，代码只执行，不推断听感。 */
export const BGM_NARRATIVE_ROLES = ["支持表演", "反衬", "暗示", "主观感受", "留白"] as const;
const gain = z.number().finite().min(0).max(1);
const second = z.number().finite().min(0).max(3600);
export const bgmNarrativeCueSchema = z.object({
  startSec: second, endSec: second,
  gainStart: gain, gainEnd: gain,
  role: z.enum(BGM_NARRATIVE_ROLES),
  noteZh: z.string().max(500),
}).strict().superRefine((cue, ctx) => {
  if (cue.endSec - cue.startSec < 0.01) ctx.addIssue({code:"custom",message:"音乐段至少需要0.01秒"});
  if (cue.role === "留白" && (cue.gainStart !== 0 || cue.gainEnd !== 0))
    ctx.addIssue({code:"custom",message:"留白段音量须为零"});
});
export const bgmNarrativeMixSchema = z.array(bgmNarrativeCueSchema).max(20).superRefine((cues, ctx) => {
  const ordered = [...cues].sort((a,b) => a.startSec - b.startSec);
  for (let i=1;i<ordered.length;i++) if (ordered[i].startSec < ordered[i-1].endSec)
    ctx.addIssue({code:"custom",message:"音乐强弱段不能重叠，请合并或调整秒位"});
});
export type BgmNarrativeCue = z.infer<typeof bgmNarrativeCueSchema>;

/** 输出仅含已校验数字；音乐强弱渐变，未设置区间沿用原增益/留白表达式。 */
export function compileBgmNarrativeMix(cues: BgmNarrativeCue[], baseGain: number, fallback?: string): string {
  gain.parse(baseGain);
  const parsed = bgmNarrativeMixSchema.parse(cues);
  const number = (value: number) => value.toFixed(6).replace(/\.?0+$/, "") || "0";
  return [...parsed].sort((a,b)=>a.startSec-b.startSec).reduceRight((tail, cue) => {
    const value = cue.gainStart === cue.gainEnd ? number(cue.gainStart)
      : `${number(cue.gainStart)}+(${number(cue.gainEnd)}-${number(cue.gainStart)})*(t-${number(cue.startSec)})/${number(cue.endSec-cue.startSec)}`;
    return `if(between(t,${number(cue.startSec)},${number(cue.endSec)}),${value},${tail})`;
  }, fallback || number(baseGain));
}
