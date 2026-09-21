import type { CanvasBlock } from "./canvasTypes";
import { resolveClipLocalSegmentIndex } from "@shared/manhuaScriptWorkbench";
import { manhuaClipQualityAllowsAssemble } from "@shared/manhuaClipQuality";
import { hasAdoptedManhuaAudio } from "@shared/manhuaSoundPanelSummary";

/** 当前修订节点由调用方筛选；每个计划段最多贡献一次，不选择或改变采用版本。 */
export function summarizeManhuaFinalSegmentEvidence(
  segments: readonly { index: number }[],
  currentClips: readonly CanvasBlock[],
  episode: number,
) {
  const groups = Array.from(new Set(segments.map(segment => segment.index))).map(index =>
    currentClips.filter(clip => resolveClipLocalSegmentIndex(clip.id, clip.prompt, episode) === index),
  );
  const output = (clip: CanvasBlock) => clip.outputUrl || clip.outputUrls?.[0];
  const passed = (clip: CanvasBlock) => clip.status === "done" && Boolean(output(clip)) && clip.manhuaClipQuality?.status === "passed";
  return {
    // 与交付缺口相同：该段有允许使用的产物即就绪，多份节点不能填补另一段。
    readyClips: groups.filter(clips => clips.some(clip => clip.status === "done" && manhuaClipQualityAllowsAssemble({ outputUrl: output(clip), quality: clip.manhuaClipQuality }))).length,
    qualityPassedClips: groups.filter(clips => clips.some(passed)).length,
    qualityFailedClips: groups.filter(clips => !clips.some(passed) && clips.some(clip => clip.manhuaClipQuality?.status === "failed")).length,
    // 对白和配乐须在同一节点中分别采用，不能把两个候选的音轨拼成一份证据。
    segmentsWithAudio: groups.filter(clips => clips.some(clip => {
      const cues = clip.audioStudio?.cues || [];
      return cues.some(cue => cue.kind === "dialogue" && hasAdoptedManhuaAudio(cue)) &&
        cues.some(cue => cue.kind === "bgm" && hasAdoptedManhuaAudio(cue));
    })).length,
  };
}
