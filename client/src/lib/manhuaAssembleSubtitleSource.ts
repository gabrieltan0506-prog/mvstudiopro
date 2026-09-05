import type { CanvasBlock } from "./canvasTypes";
import { getBlockEpisodeIndex, stageKeyFromBlockId } from "./canvasDramaStudio";
import { parseWorkbenchShotsFromText, resolveSegmentIndexFromShotIndex } from "@shared/manhuaScriptWorkbench";
import { parseManhuaEpisodeSegmentPlanFromMarkdown } from "@shared/manhuaEpisodeSegmentPlan";
import { buildWorkbenchShotsFromSegmentPlan } from "@shared/manhuaStoryDistill";
import { applyShotDialoguesFromText, MANHUA_DIALOGUE_SILENCE_TOKEN } from "@shared/manhuaShotDialoguePersist";
import type { ManhuaSubtitleSource } from "@shared/manhuaRenderedSubtitle";

/** 只冻结本集已生成分镜正文；缺真源不拿待运行提示词或默认镜骨架凑字幕。 */
export function buildManhuaAssembleSubtitleSource(blocks: CanvasBlock[], episodeIndex: number,
  segmentIndex: number, directorPrompt?: string): ManhuaSubtitleSource | undefined {
  const texts = ["beats", "reverse", "story"].map(stage => String(blocks.find(block =>
    (getBlockEpisodeIndex(block) ?? 1) === episodeIndex && stageKeyFromBlockId(block.id) === stage)?.outputText || "").trim());
  const plan = texts.map(parseManhuaEpisodeSegmentPlanFromMarkdown).find(row => row.segments.length);
  const explicit = texts.find(text => /^\s*(?:\d{1,3}[.、)]|镜(?:头)?\s*\d{1,3})\s*/m.test(text) || /^\s*\|\s*镜(?:号|头)?\s*\|/m.test(text));
  let shots = plan ? buildWorkbenchShotsFromSegmentPlan(plan) : explicit ? parseWorkbenchShotsFromText(explicit) : [];
  shots = applyShotDialoguesFromText(shots, texts[1] || "");
  shots = applyShotDialoguesFromText(shots, texts[0] || "");
  const selected = shots.filter(shot => resolveSegmentIndexFromShotIndex(shot.index) === segmentIndex);
  if (!selected.length) return undefined;
  return { directorPrompt, shots: selected.map(shot => ({ shotIndex: shot.index, durationSec: shot.durationSec,
    textZh: shot.dialogueZh === MANHUA_DIALOGUE_SILENCE_TOKEN ? "" : String(shot.dialogueZh || "") })) };
}
