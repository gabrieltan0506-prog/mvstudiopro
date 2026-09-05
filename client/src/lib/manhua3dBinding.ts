import { evaluateManhuaAsset3dEligibility, type ManhuaAsset3dRef } from "@shared/manhuaAsset3d";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";

/** 提交和导入共用同步锁，避免连续点击在 React 更新前发出第二个请求。 */
export function createManhua3dOperationGuard() {
  const pending = new Map<string, symbol>();
  return {
    begin(assetId: string): symbol | null {
      if (pending.has(assetId)) return null;
      const token = Symbol(assetId);
      pending.set(assetId, token);
      return token;
    },
    end(assetId: string, token: symbol) {
      if (pending.get(assetId) === token) pending.delete(assetId);
    },
    assetIds(): string[] {
      return Array.from(pending.keys());
    },
  };
}

/**
 * 新提交比较点击时的旧任务；轮询比较当前任务本身。
 * 人物图、任务身份、时间版本任一已变化时，迟到结果只留在服务端记录，不覆盖当前选择。
 */
export function applyManhua3dBinding(
  refs: ManhuaCustomAssetRef[],
  assetId: string,
  model: ManhuaAsset3dRef,
  expectedTaskId: string | null = model.taskId,
): ManhuaCustomAssetRef[] {
  return refs.map((ref) => {
    if (
      ref.id !== assetId ||
      !evaluateManhuaAsset3dEligibility(ref).eligible ||
      (ref.gcsUri || ref.url) !== model.sourceVersion ||
      (ref.model3d?.taskId || null) !== expectedTaskId ||
      (ref.model3d?.taskId === model.taskId && ref.model3d.updatedAt > model.updatedAt)
    )
      return ref;
    return { ...ref, model3d: model };
  });
}
