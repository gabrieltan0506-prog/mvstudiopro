import {
  manhuaSceneSpaceState,
  matchesManhuaSpatialScope,
  type ManhuaSceneSpaceRef,
  type ManhuaSpatialContext,
} from "./manhuaSceneSpace.js";
import type { ManhuaStoryEmotionBgmProjection } from "./manhuaStoryEmotion.js";

/** 路线只提供事件发生的地点；音乐由事件与人工情绪意图决定，不读取坡高或距离。 */
export function projectManhuaSpatialStoryCuesForBgm(
  refs: readonly ManhuaSceneSpaceRef[],
  contexts: readonly (ManhuaSpatialContext & { sceneIds: readonly string[] })[]
) {
  const cues = refs
    .filter(ref => manhuaSceneSpaceState(ref) === "approved")
    .flatMap(ref =>
      (ref.sceneSpace!.storyCues ?? [])
        .filter(cue =>
          contexts.some(
            context =>
              context.sceneIds.includes(ref.id) &&
              matchesManhuaSpatialScope(cue.scope, context) &&
              context.actorIds?.includes(cue.actorId)
          )
        )
        .map(cue => ({
          ...cue,
          sceneId: ref.id,
          revision: ref.sceneSpace!.revision,
        }))
    );
  cues.sort(
    (a, b) =>
      a.scope.episode - b.scope.episode ||
      a.scope.segmentIndex - b.scope.segmentIndex
  );
  const moods: ManhuaStoryEmotionBgmProjection["moods"] = [];
  const labels = {
    rise: "蓄力",
    turn: "反转",
    fall: "收束",
    breath: null,
  } as const;
  for (const cue of cues) {
    const mood = labels[cue.musicCue];
    if (mood && moods.at(-1) !== mood) moods.push(mood);
  }
  return {
    cues,
    moods,
    hasSilenceBreak: cues.some(cue => cue.musicCue === "breath"),
    breathSegmentIndexes: Array.from(
      new Set(
        cues
          .filter(cue => cue.musicCue === "breath")
          .map(cue => cue.scope.segmentIndex)
      ),
    ),
    noteZh: cues
      .map(
        cue =>
          `[场景${cue.sceneId}·v${cue.revision}·事件${cue.id}] 第${cue.scope.episode}集第${cue.scope.segmentIndex}段${cue.scope.shotId ? `·${cue.scope.shotId}` : ""}：${cue.eventZh}；情绪${cue.emotionZh}；音乐${cue.musicCue === "breath" ? "留白，" : ""}${cue.musicNoteZh}（依据：${cue.sourceZh}）`
      )
      .join("\n"),
  };
}
