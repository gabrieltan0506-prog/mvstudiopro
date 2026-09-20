import type { CanvasBlock } from "./canvasTypes";
import { getBlockEpisodeIndex, queuedManhuaClipBlocks, resolveManhuaEpisodeClipVideoModel, resolveShotsForEpisodeKeyartsResult, stageKeyFromBlockId } from "./canvasDramaStudio";
import { groupShotsIntoSegments, resolveClipLocalSegmentIndex } from "@shared/manhuaScriptWorkbench";
import { manhuaClipQualityAllowsAssemble } from "@shared/manhuaClipQuality";

/** 交付缺口与工作台使用同一原稿分段；尚未建立节点的段也必须计入。 */
export function summarizeManhuaDeliverySegments(blocks: CanvasBlock[], episode: number, videoModel?: string) {
  const model = resolveManhuaEpisodeClipVideoModel(blocks, episode, videoModel);
  const source = resolveShotsForEpisodeKeyartsResult(blocks, episode);
  const existing = blocks.filter(block => !block.archivedFromPreviousScript && stageKeyFromBlockId(block.id) === "clip" && (getBlockEpisodeIndex(block) ?? 1) === episode);
  const planned = source.isFallback ? [] : groupShotsIntoSegments(source.shots, { videoModel: model });
  const current = planned.length ? queuedManhuaClipBlocks(blocks, episode, model) : existing;
  const slots: CanvasBlock[][] = planned.length
    ? planned.map(segment => current.filter(block => resolveClipLocalSegmentIndex(block.id, block.prompt, episode) === segment.index))
    : existing.map(block => [block]);
  let missing = 0;
  let undecided = 0;
  for (const versions of slots) {
    const outputs = versions.filter(block => block.outputUrl && block.status !== "error");
    if (!outputs.length) missing++;
    else if (!outputs.some(block => manhuaClipQualityAllowsAssemble({ outputUrl: block.outputUrl, quality: block.manhuaClipQuality }))) undecided++;
  }
  return { planned: slots.length, missing, undecided };
}
