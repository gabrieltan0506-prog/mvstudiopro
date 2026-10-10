import { z } from "zod";
import type { ManhuaPrevisSpec } from "../../shared/manhuaPrevis";
const foot = z.enum(["frontLeft", "frontRight", "hindLeft", "hindRight"]);
export const groundedRouteReportSchema = z.object({
  actorId: z.string().min(1), rigKind: z.enum(["human", "quadruped"]), frames: z.number().int().min(48).max(720),
  footVertices: z.partialRecord(foot, z.number().int().min(3).max(250_000)),
  samples: z.array(z.object({ frame: z.number().int().min(1).max(720), minimumHeight: z.number().finite().min(-.005),
    feet: z.array(z.object({ foot, stance: z.boolean(), soleHeight: z.number().finite().min(-.005),
      stanceSlip: z.number().finite().min(0).max(.015), ankleResidual: z.number().finite().min(0).max(.005),
    }).strict()).min(2).max(4),
  }).strict()).min(48).max(720),
  meshMeasured: z.literal(true), normalSpeedValidated: z.literal(false), finalMeshVerified: z.literal(true),
}).strict();
export function validateGroundedRouteReport(raw: z.infer<typeof groundedRouteReportSchema> | undefined, actor: ManhuaPrevisSpec["actors"][number], durationSec: number) {
  if (!actor.riggedModel || !actor.motionRoute) {
    if (raw) throw new Error("无真实模型路线却出现落脚回执");
    return;
  }
  if (!raw) throw new Error("真实模型路线缺少逐帧足底网格证据");
  const report = groundedRouteReportSchema.parse(raw), quadruped = actor.shape === "horse";
  const feet = quadruped ? ["frontLeft", "frontRight", "hindLeft", "hindRight"] : ["hindLeft", "hindRight"];
  const limp = actor.actions.some(action => action.kind === "limp_front_left");
  if (report.actorId !== actor.id || report.rigKind !== (quadruped ? "quadruped" : "human") || report.frames !== durationSec * 24 || report.samples.length !== report.frames ||
    JSON.stringify(Object.keys(report.footVertices).sort()) !== JSON.stringify([...feet].sort())) throw new Error("落脚证据角色、骨架类型或帧数不一致");
  for (let index = 0; index < report.samples.length; index++) {
    const row = report.samples[index];
    if (row.frame !== index + 1 || JSON.stringify(row.feet.map(item => item.foot).sort()) !== JSON.stringify([...feet].sort())) throw new Error("足底逐帧身份重复或缺失");
    const support = row.feet.filter(item => item.stance);
    if (support.length < feet.length - 1 - Number(limp) || support.some(item => item.soleHeight > .03)) throw new Error("真实模型丢失应有地面支撑");
    if (limp) {
      const injured = row.feet.find(item => item.foot === "frontLeft")!;
      if (injured.stance || injured.soleHeight < .035 * actor.riggedModel.targetHeight / 1.7) throw new Error("墨屠伤腿实际蹄面没有保持卸载");
    }
  }
}
