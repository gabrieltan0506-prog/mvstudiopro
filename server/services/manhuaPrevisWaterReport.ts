/** 出水报告由实际骨架和浪花网格产生，生成与恢复共用相同验收。 */
import { z } from "zod";
import type { ManhuaPrevisSpec } from "../../shared/manhuaPrevis";
const n = z.number().finite();
const p3 = z.tuple([n, n, n]);
const p2 = z.tuple([n, n]);
export const waterReportSchema = z
  .object({
    mode: z.enum(["simultaneous", "staggered"]),
    preset: z.literal("geometric_splash_v1"),
    events: z
      .array(
        z
          .object({
            actorId: z.string(),
            crossFrame: z.number().int().min(1).max(720),
            headHeight: n.positive(),
            samples: z
              .array(
                z
                  .object({
                    frame: z.number().int().min(1).max(720),
                    root: p3,
                    head: p3,
                    active: z.boolean(),
                    worldBounds: z
                      .object({ min: p3, max: p3 })
                      .strict()
                      .nullable(),
                    screenBounds: z
                      .object({ min: p2, max: p2 })
                      .strict()
                      .nullable(),
                  })
                  .strict()
              )
              .min(48)
              .max(720),
          })
          .strict()
      )
      .min(1)
      .max(3),
    overlaps: z
      .array(
        z
          .object({
            frame: z.number().int(),
            actorIds: z.tuple([z.string(), z.string()]),
            kind: z.enum(["world", "screen"]),
          })
          .strict()
      )
      .max(4320),
    offscreenFrames: z.array(z.number().int()).max(720),
    boundaryZh: z.string().min(1),
  })
  .strict();
type Report = z.infer<typeof waterReportSchema>;
const close = (a: number, b: number) => Math.abs(a - b) < 1e-4;
const smooth = (u: number) => {
  u = Math.max(0, Math.min(1, u));
  return u * u * (3 - 2 * u);
};
export function validateWaterReport(
  raw: Report | undefined,
  spec: ManhuaPrevisSpec
): void {
  const config = spec.waterEmergence;
  if (!config) {
    if (raw) throw Error("无出水配置却返回浪花报告");
    return;
  }
  if (
    !raw ||
    raw.mode !== config.mode ||
    raw.events.length !== config.events.length ||
    new Set(raw.events.map(e => e.actorId)).size !== raw.events.length
  )
    throw Error("出水报告身份或数量不一致");
  if (raw.overlaps.length || raw.offscreenFrames.length)
    throw Error("独立浪花存在重叠或出画");
  for (const event of config.events) {
    const row = raw.events.find(r => r.actorId === event.actorId);
    const actor = spec.actors.find(a => a.id === event.actorId)!;
    const cross = Math.round(event.crossSec * 24) + 1;
    if (
      !row ||
      row.samples.length !== spec.durationSec * 24 ||
      row.crossFrame !== cross ||
      !close(row.headHeight, 1.65)
    )
      throw Error("出水逐帧证据或破水时刻不一致");
    for (let i = 0; i < row.samples.length; i++) {
      const s = row.samples[i];
      const t = i / 24;
      const root =
        t <= event.crossSec
          ? -row.headHeight - 0.6 * (1 - smooth(t / event.crossSec))
          : -row.headHeight +
            (event.height + row.headHeight) *
              smooth((t - event.crossSec) / event.riseSec);
      const active =
        i >= Math.round(event.crossSec*24) && i < Math.round(event.crossSec*24)+Math.round(event.waveDurationSec*24);
      if (
        s.frame !== i + 1 ||
        !close(s.root[0], actor.start[0]) ||
        !close(s.root[1], actor.start[1]) ||
        !close(s.root[2], root) ||
        !close(s.head[2] - s.root[2], row.headHeight) ||
        !close(s.head[0], s.root[0]) ||
        !close(s.head[1], s.root[1]) ||
        s.active !== active
      )
        throw Error("出水轨迹或浪花触发与真实配置不一致");
      if (!active) {
        if (s.worldBounds || s.screenBounds)
          throw Error("静止水花错误携带可见范围");
        continue;
      }
      const w = s.worldBounds,
        b = s.screenBounds;
      if (
        !w ||
        !b ||
        w.min.some((v, k) => v >= w.max[k]) ||
        b.min.some((v, k) => v >= b.max[k]) ||
        b.min.some(v => v < 0.02) ||
        b.max.some(v => v > 0.98)
      )
        throw Error("浪花网格投影范围不合法");
      const u = (i - Math.round(event.crossSec*24)) / Math.round(event.waveDurationSec*24);
      const radial = event.waveRadius * (0.2 + 0.8 * smooth(u));
      const vertical =
        event.waveHeight *
        (0.08 + 0.92 * Math.sin(Math.PI * u) ** 0.65) *
        (1 - smooth(Math.max(0, (u - 0.75) / 0.25)));
      const expectedMin = [
        actor.start[0] - radial,
        actor.start[1] - radial,
        0.02 * vertical,
      ];
      const expectedMax = [
        actor.start[0] + radial,
        actor.start[1] + radial,
        vertical,
      ];
      if (
        w.min.some((v, k) => !close(v, expectedMin[k])) ||
        w.max.some((v, k) => !close(v, expectedMax[k]))
      )
        throw Error("浪花尺寸与配置和烘焙时序不一致");
      if (
        !close((w.min[0] + w.max[0]) / 2, actor.start[0]) ||
        !close((w.min[1] + w.max[1]) / 2, actor.start[1]) ||
        w.max[0] - w.min[0] > 2 * event.waveRadius + 1e-4 ||
        w.max[1] - w.min[1] > 2 * event.waveRadius + 1e-4 ||
        w.min[2] < -1e-4 ||
        w.max[2] > event.waveHeight + 1e-4
      )
        throw Error("浪花不在本人破水点或超出范围");
    }
    if (
      !close(row.samples[cross - 1].head[2], 0) ||
      row.samples.slice(0, cross - 1).some(s => s.head[2] >= 0)
    )
      throw Error("头部首次破水回执不一致");
  }
  // 从完整逐帧范围重算，不能只相信渲染器给出的空 overlaps。
  for (let f = 0; f < spec.durationSec * 24; f++)
    for (let i = 0; i < raw.events.length; i++)
      for (let j = i + 1; j < raw.events.length; j++) {
        const a = raw.events[i].samples[f],
          b = raw.events[j].samples[f];
        if (!a.active || !b.active) continue;
        for (const key of ["worldBounds", "screenBounds"] as const) {
          const x = a[key]!,
            y = b[key]!;
          if (
            [0, 1].every(
              k =>
                Math.min(x.max[k], y.max[k]) - Math.max(x.min[k], y.min[k]) >
                1e-6
            )
          )
            throw Error("浪花逐帧范围相互重叠");
        }
      }
}
