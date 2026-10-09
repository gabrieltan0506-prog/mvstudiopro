import type { ManhuaPrevisStudio } from "./manhuaPrevis";
import { previsAnimationReceipt } from "./manhuaPrevisAnimation";

/** 从已保存且与当前配置一致的回执构造来源；服务端仍核验用户、任务与片段归属。 */
export function manhuaPrevisAnimationSource(studio: ManhuaPrevisStudio | undefined, clipId: string | undefined) {
  if (!studio || !clipId) return undefined;
  const take = studio.history.find(row => row.jobId === studio.selectedJobId);
  if (!take || !previsAnimationReceipt(take.animation, take.jobId) ||
    JSON.stringify(take.spec) !== JSON.stringify(studio.spec)) return undefined;
  return {
    previsJobId: take.jobId,
    scopeId: take.sourceScopeId ?? studio.scopeId,
    clipId,
    duration: take.durationSec,
    aspect: take.spec.aspect,
  };
}
