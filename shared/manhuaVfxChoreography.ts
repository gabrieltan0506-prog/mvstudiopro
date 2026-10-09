import { z } from "zod";
import { manhuaPrevisSpecSchema, previsMotionRouteNodeSchema, type ManhuaPrevisSpec } from "./manhuaPrevis";

/** 路线属于角色身份；骨架类型、资产及接触动作只能从本人原场景读取。 */
export const manhuaVfxChoreographySchema = z.object({
  clearanceMeters: z.number().finite().min(.01).max(.5),
  routes: z.array(z.object({
    actorId: z.string().min(1).max(100),
    points: z.array(previsMotionRouteNodeSchema).min(2).max(12),
  }).strict()).min(1).max(6),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  value.routes.forEach((route, index) => {
    if (ids.has(route.actorId)) ctx.addIssue({ code: "custom", path: ["routes", index], message: "同一角色只能设置一条路线" });
    ids.add(route.actorId);
    route.points.forEach((point, i) => {
      if (Math.abs(point.timeSec * 24 - Math.round(point.timeSec * 24)) > 1e-6 ||
        (i > 0 && point.timeSec <= route.points[i - 1].timeSec))
        ctx.addIssue({ code: "custom", path: ["routes", index, "points", i], message: "路线秒位须按24帧对齐并依次递增" });
    });
    if (!route.points.some(point => point.position.some((v, axis) => Math.abs(v - route.points[0].position[axis]) > .01)))
      ctx.addIssue({ code: "custom", path: ["routes", index], message: "穿行路线必须包含实际位移" });
  });
});
export type ManhuaVfxChoreography = z.infer<typeof manhuaVfxChoreographySchema>;

export const manhuaVfxWorldRenderSchema = z.object({
  quality: z.enum(["preview", "beauty"]),
  samples: z.number().int().min(16).max(64),
  exposure: z.number().finite().min(-2).max(2),
  keyEnergy: z.number().finite().min(100).max(3000),
  fillRatio: z.number().finite().min(0).max(1),
  exportLayers: z.boolean(),
}).strict().refine(value => !value.exportLayers || value.quality === "beauty", "分层输出须选择精细受光");
export const MANHUA_VFX_WORLD_RENDER_DEFAULTS = {
  quality: "preview" as const, samples: 32, exposure: 0, keyEnergy: 1000, fillRatio: .35, exportLayers: false,
};

/** 重建源白模的步态与脚底约束；不会平移已烘焙网格冒充自然行走。 */
export function deriveManhuaVfxChoreographySpec(raw: ManhuaPrevisSpec, choreography: ManhuaVfxChoreography): ManhuaPrevisSpec {
  const source = manhuaPrevisSpecSchema.parse(raw);
  const plan = manhuaVfxChoreographySchema.parse(choreography);
  if (source.timeMap) throw new Error("穿行路线暂须使用常速源动画，请先保留原版并另存常速场景");
  const byId = new Map(source.actors.map(actor => [actor.id, actor]));
  for (const route of plan.routes) {
    const actor = byId.get(route.actorId);
    if (!actor) throw new Error("穿行角色不属于所选已保存场景");
    const last = route.points.at(-1)!;
    if (last.timeSec > source.durationSec - 1 / 24 + 1e-8) throw new Error("角色路线超出源动画最后一帧");
    if (route.points[0].timeSec !== 0 || Math.abs(last.timeSec - (source.durationSec - 1 / 24)) > 1e-8)
      throw new Error("路线须从0秒覆盖至源动画最后一帧；停留区间请用相同位置的途经点表示");
    if (actor.humanPosture || actor.quadrupedFall || actor.hitReaction ||
      source.interactions?.some(item => item.actorId === actor.id || item.targetActorId === actor.id) ||
      source.handContacts?.some(item => item.actorId === actor.id || item.targetActorId === actor.id) ||
      (source.piggyback && [source.piggyback.carrierId, source.piggyback.passengerId].includes(actor.id)) ||
      source.waterEmergence?.events.some(item => item.actorId === actor.id))
      throw new Error(`${actor.nameZh}含接触、坐卧或出水动作，请在原动作工序调整，不能用穿行路线覆盖`);
    if (actor.actions.some(action => !["idle", "walk", "limp_front_left"].includes(action.kind)))
      throw new Error(`${actor.nameZh}含独立表演动作，请先在原场景安排该段穿行`);
  }
  return manhuaPrevisSpecSchema.parse({
    ...source,
    actors: source.actors.map(actor => {
      const route = plan.routes.find(item => item.actorId === actor.id);
      if (!route) return actor;
      const first = route.points[0], last = route.points.at(-1)!;
      return { ...actor, motionRoute: route.points, start: first.position, end: last.position,
        facingDeg: first.facingDeg, moveStartSec: first.timeSec, moveEndSec: last.timeSec,
        actions: actor.shape === "horse" ? actor.actions : [{ kind: "walk", startSec: first.timeSec, endSec: last.timeSec }],
      };
    }),
  });
}

export function manhuaVfxSceneActorBindings(spec: ManhuaPrevisSpec) {
  return spec.actors.map(actor => ({ actorId: actor.id, nameZh: actor.nameZh, shape: actor.shape,
    rigKind: actor.riggedModel?.rigKind ?? (actor.shape === "horse" ? "quadruped" : "human"),
    rigName: actor.riggedModel ? `${actor.id}_角色骨架` : actor.id,
    binding: actor.riggedModel ? "model" as const : "source" as const,
    ...(actor.assetRef ? { assetRef: actor.assetRef } : {}),
    ...(actor.riggedModel ? { sourceJobId: actor.riggedModel.sourceJobId } : {}),
  }));
}
