/** 分段运动的实际根矩阵回执，生成和恢复采用同一轨迹门禁。 */
import { z } from "zod";
import {
  previsShortestAngleDeg,
  type ManhuaPrevisSpec,
} from "../../shared/manhuaPrevis";
const n = z.number().finite();
export const routeReportSchema = z
  .array(
    z
      .object({
        actorId: z.string().min(1),
        samples: z
          .array(
            z
              .object({
                frame: z.number().int().min(1).max(720),
                root: z.tuple([n, n, n]),
                facingDeg: n,
              })
              .strict()
          )
          .min(48)
          .max(720),
      })
      .strict()
  )
  .max(6);
export function validateRouteReport(
  raw: z.infer<typeof routeReportSchema> | undefined,
  spec: ManhuaPrevisSpec
) {
  const actors = spec.actors.filter(a => a.motionRoute);
  if (!actors.length) {
    if (raw?.length) throw Error("无路线配置却返回运动轨");
    return;
  }
  if (
    !raw ||
    raw.length !== actors.length ||
    new Set(raw.map(r => r.actorId)).size !== raw.length
  )
    throw Error("运动轨数量或身份不一致");
  for (const actor of actors) {
    const row = raw.find(r => r.actorId === actor.id),
      nodes = actor.motionRoute!;
    if (!row || row.samples.length !== spec.durationSec * 24)
      throw Error("运动轨逐帧回执缺失");
    for (let i = 0; i < row.samples.length; i++) {
      const s = row.samples[i],
        t = i / 24;
      let k = 0;
      while (k < nodes.length - 2 && t > nodes[k + 1].timeSec) k++;
      const a = nodes[k],
        b = nodes[k + 1];
      let u = Math.max(
        0,
        Math.min(1, (t - a.timeSec) / (b.timeSec - a.timeSec))
      );
      u = u * u * (3 - 2 * u);
      const expected = [
        a.position[0] + (b.position[0] - a.position[0]) * u,
        a.position[1] + (b.position[1] - a.position[1]) * u,
        0,
      ];
      const facing =
        a.facingDeg + previsShortestAngleDeg(a.facingDeg, b.facingDeg) * u;
      if (
        s.frame !== i + 1 ||
        s.root.some((v, j) => Math.abs(v - expected[j]) > 1e-4) ||
        Math.abs(previsShortestAngleDeg(s.facingDeg, facing)) > 1e-3
      )
        throw Error("实际站位或转身与运动轨不一致");
    }
  }
}
