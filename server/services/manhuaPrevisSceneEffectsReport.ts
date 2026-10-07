import { z } from "zod";
import type { ManhuaPrevisSpec } from "../../shared/manhuaPrevis";
export const previsSceneEffectsReportSchema = z.array(z.object({
  id: z.string(), kind: z.enum(["cape", "explode", "hologram", "attribute_color", "label"]), actorId: z.string(),
  boundaryZh: z.string().min(1),
  samples: z.array(z.object({ frame: z.number().int().min(1).max(192),
    finiteBounds: z.literal(true), meshVertices: z.number().int().positive(),
    minimum: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    maximum: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    targetMeshes: z.array(z.string().min(1)).min(1),
  }).passthrough()).min(48).max(192),
}).passthrough()).max(4);
export function validatePrevisSceneEffectsReport(raw: unknown, spec: ManhuaPrevisSpec) {
  const expected = spec.sceneEffects || [];
  if (!expected.length) {
    if (Array.isArray(raw) && raw.length) throw new Error("场景特效报告与本次配置不一致");
    return;
  }
  const reports = previsSceneEffectsReportSchema.parse(raw);
  if (reports.length !== expected.length || new Set(reports.map(row => row.id)).size !== expected.length)
    throw new Error("场景特效报告缺项或重复");
  for (const effect of expected) {
    const row = reports.find(item => item.id === effect.id);
    if (!row || row.kind !== effect.kind || row.actorId !== effect.actorId || row.samples.length !== spec.durationSec * 24 ||
      row.samples.some((sample, index) => sample.frame !== index + 1))
      throw new Error("场景特效全帧证据不完整或绑定不一致");
    for (const sample of row.samples) {
      if (sample.minimum.some((value, i) => value > sample.maximum[i])) throw new Error("场景特效几何范围不正确");
      if (effect.kind === "cape") {
        z.object({ pinError: z.number().finite().nonnegative().max(0.03), bakedPlayback: z.literal(true),
          bakedShapeKeyCount: z.number().int().min(spec.durationSec * 24), collisionMeshes: z.number().int().nonnegative(),
          closedCollisionMeshes: z.number().int().nonnegative(), estimatedInsideVertices: z.number().int().nonnegative(),
          estimatedPenetration: z.number().finite().nonnegative() }).parse(sample);
      } else if (effect.kind === "explode") {
        const parts = z.array(z.object({ mesh: z.string().min(1),
          requestedOffset: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
          actualOffset: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
          maxVertexOffsetError: z.number().finite().nonnegative().max(0.005),
        })).min(2).max(64).parse(sample.parts);
        if (new Set(parts.map(part => part.mesh)).size !== sample.targetMeshes.length ||
            parts.some(part => !sample.targetMeshes.includes(part.mesh))) throw new Error("分件展开的模型证据不完整");
      } else if (effect.kind === "label") {
        const point = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
        const label = z.object({ anchor: point, labelPosition: point, lineEndpoints: z.tuple([point, point]),
          attachmentError: z.number().finite().nonnegative().max(0.005), cameraFacingDot: z.number().finite().min(0.999),
          font: z.object({ name: z.string().min(1), bytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/), packed: z.literal(true), glyphCoverageVerified: z.literal(true) }),
          text: z.literal(effect.text), bone: z.literal(effect.bone),
        }).parse(sample);
        const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v,i) => v-b[i]));
        if (distance(label.anchor, label.lineEndpoints[0]) > .005 || distance(label.labelPosition, label.lineEndpoints[1]) > .005)
          throw new Error("标注引线与绑定位置不一致");
      } else {
        const materials = z.array(z.object({ mesh: z.string().min(1), materials: z.array(z.string().min(1)).min(1),
          nodeTypes: z.array(z.array(z.string()).min(1)).min(1), attributes: z.array(z.string()) })).min(1).parse(sample.materials);
        const node = effect.kind === "hologram" ? "ShaderNodeLayerWeight" : "ShaderNodeVertexColor";
        if (materials.length !== sample.targetMeshes.length || materials.some(item => !sample.targetMeshes.includes(item.mesh) ||
          item.nodeTypes.some(nodes => !nodes.includes(node)) || (effect.kind === "attribute_color" && !item.attributes.length)))
          throw new Error("场景材质未实际绑定到全部目标模型");
      }
    }
  }
}
