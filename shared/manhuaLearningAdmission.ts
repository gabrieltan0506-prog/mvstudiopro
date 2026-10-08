/** 新建视频学习的资源边界；历史报告与已保存 JSON 读取不适用。 */
export const MANHUA_LEARN_ACTIVE_JOB_LIMIT = 2;
export const MANHUA_LEARN_NEW_VIDEO_MAX_DURATION_SEC = 3600;
export function assertManhuaNewLearningVideoDuration(durationSec: number): void {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > MANHUA_LEARN_NEW_VIDEO_MAX_DURATION_SEC) {
    throw new Error("每部新学习影片必须在一小时内；未建立模型请求，历史学习结果仍可查看。");
  }
}
