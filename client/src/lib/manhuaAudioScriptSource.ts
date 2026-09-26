import { canvasAudioCueInputKey, type CanvasAudioCue, type CanvasAudioStudio } from "@shared/canvasAudioStudio";
import type { ManhuaWorkbenchShot } from "@shared/manhuaScriptWorkbench";
import { createManhuaAudioFromShots } from "@shared/manhuaAudioFromShots";

const SCRIPT_CUE_ID = /^script-shot-\d+-line-\d+$/;

/** 只拦截与原镜绑定的旧对白；用户自行添加的对白仍可独立制作。 */
export function manhuaScriptCueSourceIssue(
  cue: CanvasAudioCue,
  expectedCues: readonly CanvasAudioCue[] | undefined,
  hasSourceShots: boolean,
): string | undefined {
  if (!SCRIPT_CUE_ID.test(cue.id)) return undefined;
  if (!hasSourceShots) return "本段分镜原稿尚未读取到，无法核对这句旧音轨；未提交付费配音。";
  const expected = expectedCues?.find(row => row.id === cue.id);
  if (expected &&
    expected.speakerZh === cue.speakerZh &&
    expected.textZh === cue.textZh &&
    Math.abs(expected.startSec - cue.startSec) <= 0.001 &&
    Math.abs(expected.endSec - cue.endSec) <= 0.001
  ) return undefined;
  return "本句与当前分镜原稿的台词、角色或秒窗不一致；先按原稿刷新或逐句核对，未提交付费配音。";
}

/** 成片付费提交前复核已存TTS是否仍对应当前镜稿；旧候选保留但不能混进新口型。 */
export function manhuaClipSavedDialogueIssue(
  studio: CanvasAudioStudio | undefined,
  shots: ManhuaWorkbenchShot[],
  durationSec: number,
): string | undefined {
  const scriptCues = studio?.cues.filter(cue => SCRIPT_CUE_ID.test(cue.id)) || [];
  const generatedCues = scriptCues.filter(cue => cue.takes.some(take => take.id === cue.selectedTakeId));
  // 只有草稿、尚未生成TTS时，台词修改不要求重新购买配音。
  if (!generatedCues.length) return undefined;
  if (!shots.length) return "当前分段原稿不可用，旧配音未提交成片。";
  let expected: CanvasAudioCue[];
  try { expected = createManhuaAudioFromShots(shots, durationSec).cues; }
  catch { return "当前分段对白无法校验，旧配音未提交成片。"; }
  if (generatedCues.some(cue => {
    const current = expected.find(row => row.id === cue.id);
    const selectedTake = cue.takes.find(take => take.id === cue.selectedTakeId);
    return !current || current.speakerZh !== cue.speakerZh || current.textZh !== cue.textZh ||
      selectedTake?.inputKey !== canvasAudioCueInputKey(cue);
  })) {
    return "台词或说话人已变更，已有TTS语音需按新台词重新生成并确认；静帧保留，本次未提交成片。";
  }
  return undefined;
}
