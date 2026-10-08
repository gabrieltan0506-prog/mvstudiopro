/** 学习最多两部并发；整片时长不作为准入或并发条件。 */
export const MANHUA_LEARN_ACTIVE_JOB_LIMIT = 2;
export function assertManhuaNewLearningVideoDuration(durationSec: number): void {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("未取得有效影片时长，未建立模型请求。");
  }
}
