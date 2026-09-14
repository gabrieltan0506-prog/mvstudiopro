/** 有界数字特效事件；只描述预演，不承诺物理破坏或流体模拟。 */
import { z } from "zod";

export const previsEffectSchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: z.enum(["explosion", "smoke"]),
    startSec: z.number().finite().min(0).max(8),
    durationSec: z.number().finite().min(0.5).max(8),
    origin: z.tuple([
      z.number().finite().min(-12).max(12),
      z.number().finite().min(-12).max(12),
      z.number().finite().min(0).max(6),
    ]),
    radius: z.number().finite().min(0.2).max(3),
    height: z.number().finite().min(0.2).max(4),
    wind: z.tuple([
      z.number().finite().min(-1).max(1),
      z.number().finite().min(-1).max(1),
    ]),
  })
  .strict();
export const previsEffectsSchema = z.array(previsEffectSchema).max(4);
// 草稿容许输入暂时为空时的0值，严格范围与时序在提交时校验。
const draftNumber = z.number().finite().min(-10000).max(10000);
export const previsEffectsDraftSchema = z
  .array(
    previsEffectSchema.extend({
      startSec: draftNumber,
      durationSec: draftNumber,
      origin: z.tuple([draftNumber, draftNumber, draftNumber]),
      radius: draftNumber,
      height: draftNumber,
      wind: z.tuple([draftNumber, draftNumber]),
    })
  )
  .max(4);
export type PrevisEffect = z.infer<typeof previsEffectSchema>;
export function validatePrevisEffects(
  spec: { durationSec: number; actors: unknown[]; effects?: PrevisEffect[] },
  ctx: z.RefinementCtx
) {
  if (!spec.effects?.length) return;
  const issue = (message: string, path: (string | number)[] = ["effects"]) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
  if (spec.durationSec > 8 || spec.actors.length > 3)
    issue("特效预演限8秒、3个角色以内");
  const ids = new Set<string>();
  spec.effects.forEach((event, i) => {
    if (ids.has(event.id)) issue("特效事件ID不可重复", ["effects", i, "id"]);
    ids.add(event.id);
    if (
      [event.startSec, event.durationSec].some(
        t => Math.abs(t * 24 - Math.round(t * 24)) > 1e-7
      )
    )
      issue("特效时刻必须对齐24帧时间轴", ["effects", i]);
    if (
      event.startSec + event.durationSec >
      (spec.durationSec * 24 - 1) / 24 + 1e-8
    )
      issue("特效必须在视频最后一帧前结束", ["effects", i]);
  });
}
