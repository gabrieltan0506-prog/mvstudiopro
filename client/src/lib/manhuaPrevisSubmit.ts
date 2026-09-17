import type { ManhuaPrevisSpec } from "@shared/manhuaPrevis";

export type PrevisCharacterModel = {
  id: string;
  /** assetRef：模型所在 ref（可能是 A-pose 候选图，与人物 id 不同） */
  model?: { taskId: string; assetRef?: string };
};

/** 0917：带骨模型可能挂在同一人物的候选图上；提交前按当前人物表补 riggedModel.sourceAssetRef，服务端按它核回执。 */
export function withRiggedModelSourceAssetRefs(
  spec: ManhuaPrevisSpec,
  characters: readonly PrevisCharacterModel[]
): ManhuaPrevisSpec {
  let changed = false;
  const actors = spec.actors.map(actor => {
    if (!actor.riggedModel || !actor.assetRef) return actor;
    const model = characters.find(c => c.id === actor.assetRef)?.model;
    if (
      !model ||
      model.taskId !== actor.riggedModel.sourceJobId ||
      !model.assetRef ||
      model.assetRef === actor.riggedModel.sourceAssetRef
    )
      return actor;
    changed = true;
    return {
      ...actor,
      riggedModel: { ...actor.riggedModel, sourceAssetRef: model.assetRef },
    };
  });
  return changed ? { ...spec, actors } : spec;
}

/** tRPC PRECONDITION_FAILED＝服务端校验明确拒绝、任务未创建；网络/超时等歧义错误不算，仍保留请求编号。 */
export function isDefiniteRejection(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error as { data?: { code?: unknown } }).data?.code === "PRECONDITION_FAILED"
  );
}
