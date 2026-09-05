// 入口与编排核使用同一判断，保留旧导入路径，避免两份规则或循环导入。
export { isPreparedManhuaVideoEditRun } from "./canvasDramaStudio";
import { getBlockEpisodeIndex } from "./canvasDramaStudio";
import type { CanvasBlock } from "./canvasTypes";

/** 失败的编辑不能被普通续跑转成整集生成；先核对任务，再经原片编辑入口明确确认。 */
export function hasFailedManhuaVideoEdit(
  blocks: readonly CanvasBlock[],
  episodeIndexes: readonly number[],
): boolean {
  return blocks.some((block) =>
    block.id.startsWith("clip-") && block.kind === "video" &&
    block.seedance25WorkMode === "video_edit" && block.status === "error" &&
    episodeIndexes.includes(getBlockEpisodeIndex(block) ?? 1),
  );
}

export const MANHUA_EDIT_RESUME_HINT_ZH =
  "有片段的视频编辑尚未确认结果；请先核对任务记录，再从原片的「视频编辑」入口确认重试，不能按整集重新生成。";
