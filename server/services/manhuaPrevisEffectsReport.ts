/** 数字特效的实际根对象与爆点灯回执；不是物理破坏报告。 */
import { z } from "zod";
import type { ManhuaPrevisSpec } from "../../shared/manhuaPrevis";
const n = z.number().finite(),
  point = z.tuple([n, n, n]);
export const effectsReportSchema = z
  .array(
    z
      .object({
        id: z.string().min(1),
        kind: z.enum(["explosion", "smoke"]),
        samples: z
          .array(
            z
              .object({
                frame: z.number().int().min(1).max(720),
                visible: z.boolean(),
                center: point,
                scale: point,
                lightEnergy: n.nonnegative(),
                lightPosition: point,
              })
              .strict()
          )
          .min(48)
          .max(720),
        boundaryZh: z.string().min(1),
      })
      .strict()
  )
  .max(4);
export function validateEffectsReport(
  rows: z.infer<typeof effectsReportSchema> | undefined,
  spec: ManhuaPrevisSpec
) {
  const effects = spec.effects ?? [];
  if (!effects.length) {
    if (rows?.length) throw Error("无特效配置却返回特效报告");
    return;
  }
  if (
    !rows ||
    rows.length !== effects.length ||
    new Set(rows.map(e => e.id)).size !== rows.length
  )
    throw Error("特效事件报告缺失或重复");
  for (const event of effects) {
    const row = rows.find(r => r.id === event.id);
    if (
      !row ||
      row.kind !== event.kind ||
      row.samples.length !== spec.durationSec * 24
    )
      throw Error("特效事件与完整帧数不一致");
    for (let i = 0; i < row.samples.length; i++) {
      const s = row.samples[i],
        u =
          (i - Math.round(event.startSec * 24)) /
          Math.round(event.durationSec * 24),
        active = u >= 0 && u < 1,
        q = Math.max(0, Math.min(1, u));
      const size = active
        ? (0.15 + 0.85 * Math.sin((Math.PI * q) / 2)) * Math.min(1, (1 - q) * 8)
        : 0;
      const center = [
        event.origin[0] + event.wind[0] * q,
        event.origin[1] + event.wind[1] * q,
        event.origin[2] + event.height * 0.55 * q,
      ];
      const scale = [
        event.radius * size,
        event.radius * size,
        event.height * size,
      ];
      const energy =
        active && event.kind === "explosion"
          ? 1400 * Math.max(0, 1 - q * 5) ** 2
          : 0;
      if (
        s.frame !== i + 1 ||
        s.visible !== active ||
        s.center.some((v, j) => Math.abs(v - center[j]) > 1e-4) ||
        s.scale.some((v, j) => Math.abs(v - scale[j]) > 1e-4) ||
        Math.abs(s.lightEnergy - energy) > 1e-3 ||
        (energy > 0 &&
          s.lightPosition.some((v, j) => Math.abs(v - event.origin[j]) > 1e-4))
      )
        throw Error("实际特效触发、尺寸、漂移或爆点受光与事件不一致");
    }
  }
}
