import type { ManhuaLearnServerJob } from "./jobs";
import { parseNativeStructuringModel, type ManhuaNativeStructuringModelId } from "@shared/manhuaNativeDeepReadJob";

/** 只重做选中集的整形，保留原任务读片参数，不把页面当前设置带进来。 */
export function buildManhuaRestructureParams(job: ManhuaLearnServerJob, episodeIndex: number, model: ManhuaNativeStructuringModelId): Record<string, unknown> {
  const original = job.input?.params;
  if (!original || original.nativeDeepReadConfirmed !== true || !original.url) throw new Error("原任务缺少原生学习参数，无法只重新整形");
  if (!Number.isInteger(episodeIndex) || episodeIndex < 1 || episodeIndex > 999) throw new Error("请输入有效集号");
  // 0920：整形模型换 GLM-5.3 Flash；解析交给 shared 的唯一判据，别在前端再写一份阈值
  parseNativeStructuringModel(model);
  parseNativeStructuringModel(original.nativeStructuringModel);
  const params = { ...original, nativeStructuringOnly: true, nativeStructuringEpisodeIndex: episodeIndex,
    nativeStructuringPreviousJobId: job.jobId, nativeStructuringModel: model,
    nativePlanLimit: 1, batchSize: 1, refreshPreviewFrames: false, retrySkippedEpisodes: false };
  // 旧计划哈希绑定旧批次，新单集计划由服务端依据原任务重新验证。
  delete (params as Record<string, unknown>).nativePlanHash;
  delete (params as Record<string, unknown>).nativePlanSeriesKey;
  return params;
}
