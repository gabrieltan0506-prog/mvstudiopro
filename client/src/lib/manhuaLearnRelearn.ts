import type { NativeDeepReadRelearn } from "@shared/manhuaNativeRelearn";

/** 取消返回 null，调用方必须在建立任务/乐观卡片之前返回。 */
export function confirmManhuaLearnSource(
  source: { seriesKey: string; episodeIndex?: number; alreadyLearned: boolean },
  params: Record<string, unknown>,
  confirm: (message: string) => boolean,
  requestId: () => string = () => crypto.randomUUID(),
): Record<string, unknown> | null {
  const next = { ...params };
  if (source.episodeIndex == null) return next;
  next.nativePlanLimit = 1;
  next.batchSize = 1;
  if (!source.alreadyLearned) return next;
  if (!confirm(`第 ${source.episodeIndex} 集已经学过，是否重新学习？\n重学会再次产生模型费用；原正式模板保留，新结果经入库后更新原模板，不增加模板数量。\n本次只学习第 ${source.episodeIndex} 集，不跳到下一集。`)) return null;
  next.nativeRelearn = {
    seriesKey: source.seriesKey, episodeIndex: source.episodeIndex, requestId: requestId(),
  } satisfies NativeDeepReadRelearn;
  return next;
}
