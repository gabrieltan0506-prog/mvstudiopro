import { z } from "zod";
import { manhuaVfxChoreographySchema, manhuaVfxWorldRenderSchema } from "./manhuaVfxChoreography";
import { manhuaVfxEnvironmentSchema } from "./manhuaVfxEnvironment";

/** 道具真实分块几何；爆裂速度独立于原片播放速度。 */
export const MANHUA_VFX_PROP_DEFAULTS = { impactSec: .25, spread: 1.1, slowMotion: .18, gravity: .8, staggerSec: .1, holdStartSec: .8, holdDurationSec: 1.2 };
const n = (min: number, max: number) => z.number().finite().min(min).max(max);
export const manhuaVfxPropSchema = z.object({
  impactSec: n(0, 30), spread: n(.1, 3), slowMotion: n(.03, 1), gravity: n(0, 6), staggerSec: n(0, .5), holdStartSec: n(0, 30), holdDurationSec: n(.1, 10),
}).strict();

export const MANHUA_VFX_WORLD_DEFAULTS = { sceneJobId: "", sceneScopeId: "", clipId: "", sourceStartSec: 0, propKind: "fruit_stall_fracture" as const, position: [0, 0, 1] as [number, number, number], yawDeg: 0, size: 1 };
export const manhuaVfxWorldSchema = z.object({
  sceneJobId: z.string().regex(/^prv_[a-f0-9]{48}$/), sceneScopeId: z.string().uuid(), clipId: z.string().min(1).max(160),
  sourceStartSec: n(0, 30), propKind: z.enum(["cup_fracture", "fruit_stall_fracture"]),
  position: z.tuple([n(-100, 100), n(-100, 100), n(-100, 100)]), yawDeg: n(-180, 180), size: n(.05, 4),
  choreography: manhuaVfxChoreographySchema.optional(),
  render: manhuaVfxWorldRenderSchema.optional(),
  environment: manhuaVfxEnvironmentSchema.optional(),
}).strict().superRefine((world, ctx) => {
  if (world.environment && (world.render?.quality !== "beauty" || world.render.exportLayers))
    ctx.addIssue({ code: "custom", path: ["environment"], message: "正式3DGS场景使用完整材质合成，须选择精细受光并关闭同场分层下载" });
});

export const isManhuaVfxPropKind = (kind: string) => kind === "cup_fracture" || kind === "fruit_stall_fracture";
export const manhuaVfxPropLastImpact = (kind: string, params: z.infer<typeof manhuaVfxPropSchema>) =>
  params.impactSec + (kind === "fruit_stall_fracture" ? 3 * params.staggerSec : 0);
