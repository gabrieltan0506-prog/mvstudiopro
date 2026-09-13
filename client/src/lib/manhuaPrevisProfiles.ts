import type { CanvasBlock } from "./canvasTypes";
import {
  previsRiggedModelSchema,
  type PrevisRiggedModel,
} from "@shared/manhuaPrevisRig";

type PreparedRigModel = Omit<PrevisRiggedModel, "performance"> & {
  controller?: NonNullable<PrevisRiggedModel["performance"]>["controller"];
};
export type PreparedRigProfile = {
  assetRef: string;
  sourceJobId: string;
  label: string;
  riggedModel: PreparedRigModel;
  originLabel: string;
};

/** 仅复用本项目同一模型的准备配置；历史表演时段不跨段带入。 */
export function collectPreparedRigProfiles(
  blocks: CanvasBlock[],
  characters: Array<{ id: string; label: string; model?: { taskId: string } }>
): PreparedRigProfile[] {
  const current = new Map(characters.map(row => [row.id, row]));
  const found = new Map<string, PreparedRigProfile>();
  for (const block of blocks) {
    if (block.archivedFromPreviousScript || !block.previsStudio) continue;
    const studio = block.previsStudio;
    const sources = [
      { spec: studio.spec, origin: "当前段已保存配置" },
      ...[...(studio.specHistory || [])]
        .reverse()
        .map(row => ({ spec: row.spec, origin: "历史准备配置" })),
      ...[...studio.history]
        .reverse()
        .map(row => ({ spec: row.spec, origin: "历史预览配置（仍需审看）" })),
    ];
    for (const source of sources)
      for (const actor of source.spec.actors) {
        const character = actor.assetRef
          ? current.get(actor.assetRef)
          : undefined;
        const parsed = previsRiggedModelSchema.safeParse(actor.riggedModel);
        if (
          !character?.model ||
          !parsed.success ||
          parsed.data.sourceJobId !== character.model.taskId
        )
          continue;
        const rig = parsed.data;
        const riggedModel: PreparedRigModel = {
          sourceJobId: rig.sourceJobId,
          forwardAxis: rig.forwardAxis,
          targetHeight: rig.targetHeight,
          ...(rig.boneMap ? { boneMap: { ...rig.boneMap } } : {}),
          // 这是内存候选，不直接写回spec；应用方为本段创建有效时段。
          ...(rig.performance
            ? { controller: structuredClone(rig.performance.controller) }
            : {}),
        };
        const key = JSON.stringify([character.id, riggedModel]);
        if (!found.has(key))
          found.set(key, {
            assetRef: character.id,
            sourceJobId: rig.sourceJobId,
            label: character.label,
            riggedModel,
            originLabel: `${block.episodeIndex ? `第${block.episodeIndex}集 · ` : ""}${source.origin}`,
          });
      }
  }
  return Array.from(found.values());
}
