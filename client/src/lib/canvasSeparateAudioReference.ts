import { applyCanvasAudioMixPlan, assertCanvasAudioMixCapacity } from "@shared/canvasAudioMixPlan";
import { canvasAudioReferenceSource, validateCanvasAudioCue, type CanvasAudioCue } from "@shared/canvasAudioStudio";

export const SEPARATE_AUDIO_PREFIX = "separate-audio:";
/** 每个任务仅处理同一条原音频，不将BGM与对白混合，也不裁短整曲。 */
export function buildSeparateAudioClips(cue: CanvasAudioCue, cues: readonly CanvasAudioCue[], durationSec: number) {
  const issues = validateCanvasAudioCue(cue, durationSec);
  if (!cue.enabled || !cue.approved || issues.length) throw new Error(issues.join("；") || "音轨尚未采用或已停用");
  const source = canvasAudioReferenceSource(cue);
  if (cue.fadeInSec + cue.fadeOutSec > source.durationSec) throw new Error("独立音轨淡入淡出超过原件时长");
  const clips = applyCanvasAudioMixPlan(cue, {
    audioUri: source.gcsUri, sourceStartSec: 0, sourceEndSec: source.durationSec,
    startSec: cue.startSec, volume: cue.volume, fadeInSec: cue.fadeInSec, fadeOutSec: cue.fadeOutSec,
  }, cues).map(clip => ({ ...clip, startSec: clip.startSec - cue.startSec }));
  assertCanvasAudioMixCapacity(clips);
  return { durationSec: source.durationSec, clips };
}
