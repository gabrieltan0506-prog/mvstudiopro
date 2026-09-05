import type { CanvasBlock } from "./canvasTypes";
import { getBlockEpisodeIndex } from "./canvasDramaStudio";
import { resolveClipLocalSegmentIndex } from "@shared/manhuaScriptWorkbench";
import { isManhuaVideoEditBlock } from "./manhuaMediaVersions";

/** 仅当前集当前段、明确单目标的已准备编辑免走续拍检查；不借另一节点绕过。 */
export function isPreparedManhuaVideoEditRun(input: {
  episodeIndex: number;
  fragmentShotIndex?: number;
  targetBlockIds?: readonly string[];
  preparedTargetBlocks?: readonly CanvasBlock[];
  preservePreparedTargetBlocks?: boolean;
}): boolean {
  if (!input.preservePreparedTargetBlocks || input.targetBlockIds?.length !== 1)
    return false;
  const target = input.preparedTargetBlocks?.find(
    block => block.id === input.targetBlockIds![0]
  );
  if (!target || !isManhuaVideoEditBlock(target)) return false;
  if ((getBlockEpisodeIndex(target) ?? 1) !== input.episodeIndex) return false;
  if (
    resolveClipLocalSegmentIndex(
      target.id,
      target.prompt,
      input.episodeIndex
    ) !== input.fragmentShotIndex
  )
    return false;
  const source = String(
    target.seedance25RefVideoUrls?.[0] || target.refVideoUrl || ""
  ).trim();
  return /^https?:\/\//i.test(source);
}
