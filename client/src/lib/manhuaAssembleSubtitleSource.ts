import type { CanvasBlock } from "./canvasTypes";
import { getBlockEpisodeIndex, hasExplicitManhuaShotStructure, resolveShotsForEpisodeKeyarts, resolveManhuaEpisodeClipVideoModel, stageKeyFromBlockId } from "./canvasDramaStudio";
import { groupShotsIntoSegments } from "@shared/manhuaScriptWorkbench";
import { MANHUA_DIALOGUE_SILENCE_TOKEN } from "@shared/manhuaShotDialoguePersist";
import type { ManhuaSubtitleSource } from "@shared/manhuaRenderedSubtitle";

/** 只冻结本集已生成分镜正文；缺真源不拿待运行提示词或默认镜骨架凑字幕。 */
export function buildManhuaAssembleSubtitleSource(blocks: CanvasBlock[], episodeIndex: number,
  segmentIndex: number, directorPrompt?: string): ManhuaSubtitleSource | undefined {
  const texts = ["beats", "reverse", "story"].map(stage => String(blocks.find(block =>
    (getBlockEpisodeIndex(block) ?? 1) === episodeIndex && stageKeyFromBlockId(block.id) === stage)?.outputText || "").trim());
  if (!texts.some(hasExplicitManhuaShotStructure)) return undefined;
  const shots = resolveShotsForEpisodeKeyarts(blocks, episodeIndex);
  const videoModel = resolveManhuaEpisodeClipVideoModel(blocks, episodeIndex);
  const selected = groupShotsIntoSegments(shots, { videoModel })
    .find(segment => segment.index === segmentIndex)?.shots || [];
  if (!selected.length) return undefined;
  return { directorPrompt, shots: selected.map(shot => ({ shotIndex: shot.index, durationSec: shot.durationSec,
    textZh: shot.dialogueZh === MANHUA_DIALOGUE_SILENCE_TOKEN ? "" : String(shot.dialogueZh || "") })) };
}
