import { canvasAudioCueInputKey, type CanvasAudioCue, type CanvasAudioStudio } from "@shared/canvasAudioStudio";
import type { ManhuaWorkbenchShot } from "@shared/manhuaScriptWorkbench";
import { createManhuaAudioFromShots } from "@shared/manhuaAudioFromShots";
import { MANHUA_DIALOGUE_SILENCE_TOKEN } from "@shared/manhuaShotDialoguePersist";

/** 分镜台词保存时同步对应镜的音轨；旧候选留作历史，旧采用立即失效。 */
export function syncEditedShotDialoguesToAudio(
  studio: CanvasAudioStudio,
  shots: ManhuaWorkbenchShot[],
  durationSec: number,
  dialogues: Record<number, string>,
): CanvasAudioStudio {
  const changedShots = new Set(Object.keys(dialogues).map(Number));
  if (!changedShots.size) return studio;
  const nextShots = shots.map(shot => {
    if (!changedShots.has(shot.index)) return shot;
    const value = dialogues[shot.index]?.trim() || MANHUA_DIALOGUE_SILENCE_TOKEN;
    return {
      ...shot,
      dialogueZh: value === MANHUA_DIALOGUE_SILENCE_TOKEN ? "" : value,
      dialogueSuppressed: value === MANHUA_DIALOGUE_SILENCE_TOKEN,
      additionalDialogueCues: [],
    };
  });
  const generated = createManhuaAudioFromShots(nextShots, durationSec).cues
    .filter(cue => /^script-shot-(\d+)-line-\d+$/.test(cue.id) && changedShots.has(Number(cue.id.match(/^script-shot-(\d+)-line-/)?.[1])));
  const freshById = new Map(generated.map(cue => [cue.id, cue]));
  const consumed = new Set<string>();
  const cues = studio.cues.map(cue => {
    const match = cue.kind === "dialogue" ? cue.id.match(/^script-shot-(\d+)-line-\d+$/) : null;
    if (!match || !changedShots.has(Number(match[1]))) return cue;
    const fresh = freshById.get(cue.id);
    if (!fresh) return { ...cue, textZh: "", enabled: false, selectedTakeId: undefined, approved: false };
    consumed.add(cue.id);
    if (cue.textZh === fresh.textZh && cue.speakerZh === fresh.speakerZh) return cue;
    const sameSpeaker = cue.speakerZh === fresh.speakerZh;
    return {
      ...cue,
      textZh: fresh.textZh,
      speakerZh: fresh.speakerZh,
      shotZh: fresh.shotZh,
      enabled: true,
      voice: sameSpeaker ? cue.voice : "",
      voiceLock: sameSpeaker ? cue.voiceLock : undefined,
      selectedTakeId: undefined,
      approved: false,
    };
  });
  for (const fresh of generated) if (!consumed.has(fresh.id)) cues.push(fresh);
  return { ...studio, cues };
}

/** 当前音轨台词是唯一真源；成片前只阻止旧候选混进修改后的台词。 */
export function manhuaClipSavedDialogueIssue(
  studio: CanvasAudioStudio | undefined,
  _shots: ManhuaWorkbenchShot[],
  _durationSec: number,
): string | undefined {
  const selectedCues = studio?.cues.filter(cue => cue.kind === "dialogue" && cue.selectedTakeId) || [];
  if (selectedCues.some(cue => {
    const selectedTake = cue.takes.find(take => take.id === cue.selectedTakeId);
    return selectedTake?.inputKey !== canvasAudioCueInputKey(cue);
  })) {
    return "当前台词、说话人或音色与已选TTS不一致；请按当前编辑重新生成并确认语音。静帧保留，本次未提交成片。";
  }
  return undefined;
}
