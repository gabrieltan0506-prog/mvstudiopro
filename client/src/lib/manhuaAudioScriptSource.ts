import type { CanvasAudioCue } from "@shared/canvasAudioStudio";

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
