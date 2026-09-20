import { inferQwenEmotionTags } from "./manhuaDialogueTtsCompile";
import { createCanvasAudioCue, emptyCanvasAudioStudio, canvasAudioStudioSchema } from './canvasAudioStudio';
import { buildManhuaDialogueTimelineBeats, parseManhuaDialogueCues } from './manhuaClipDialogueTimeline';
import type { ManhuaWorkbenchShot } from './manhuaScriptWorkbench';

/** 原镜对白只初始化未建音轨的段；不生成、不猜音色、不覆盖用户已编辑或清空的音轨。 */
export function createManhuaAudioFromShots(shots: ManhuaWorkbenchShot[], durationSec: number) {
  const studio = emptyCanvasAudioStudio();
  for (const beat of buildManhuaDialogueTimelineBeats(shots, durationSec)) {
    const shot = shots.find(s => s.index === beat.shotIndex)!;
    const lines = [
      ...parseManhuaDialogueCues(beat.dialogueZh, beat.speakerAtTag || shot.dialogueSpeakerNameZh),
      ...(shot.dialogueSuppressed ? [] : shot.additionalDialogueCues || []).flatMap(cue =>
        parseManhuaDialogueCues(cue.dialogueZh, cue.speakerAtTag || cue.speakerNameZh)),
    ];
    lines.forEach((line, index) => {
      const span = (beat.endSec - beat.startSec) / lines.length;
      studio.cues.push({
        ...createCanvasAudioCue('dialogue', `script-shot-${beat.shotIndex}-line-${index + 1}`),
        labelZh: `第${beat.shotIndex}镜·第${index + 1}句`,
        shotZh: `第${beat.shotIndex}镜 ${beat.actionZh}${beat.emotionZh ? `；情绪：${beat.emotionZh}` : ""}`,
        speakerZh: line.speakerAtTag,
        textZh: line.dialogueZh,
        emotion: inferQwenEmotionTags(beat.emotionZh).join(""),
        startSec: beat.startSec + index * span,
        endSec: beat.startSec + (index + 1) * span,
      });
    });
  }
  // 过量或过长明确提示，不截断原句，未采用、无付费请求。
  return canvasAudioStudioSchema.parse(studio);
}
