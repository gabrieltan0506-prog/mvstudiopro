/**
 * 一键预混母轨（0908 墨菁传实录搬进配音间）：
 * 对白按秒窗原音量落位；配乐压到 −12 dB（线性 0.25）并带淡入淡出；合成一条本段时长的单轨，
 * 挂到 manhuaSegmentRefs.master，出片时作唯一 @音频1（逐句配音不再并列送，避免撞供应商 30 s 上限）。
 * 走现成的 audio_timeline 后期任务（ffmpeg：adelay + volume + afade + amix + alimiter），免费。
 */
import type { CanvasAudioCue, CanvasAudioTake } from "@shared/canvasAudioStudio";

export const PREMIX_BGM_VOLUME = 0.25;
export const PREMIX_BGM_FADE_IN_SEC = 0.7;
export const PREMIX_BGM_FADE_OUT_SEC = 1.2;
/** pendingOperations.inputKey 前缀：带它的后期任务结果挂 master，不当合听预览 */
export const PREMIX_PENDING_PREFIX = "premix:";

export type PremixTimelineClip = {
  audioUri: string;
  sourceStartSec: number;
  sourceEndSec: number;
  startSec: number;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
};

export function isPremixPendingKey(inputKey: string | null | undefined): boolean {
  return String(inputKey || "").startsWith(PREMIX_PENDING_PREFIX);
}

/**
 * 只收「已确认且启用」的 cue；至少一句对白；每条 take 必须与当前 cue 内容一致且不长于秒窗。
 * 抛中文错误给面板直接显示。
 */
export function buildPremixTimelineClips(input: {
  cues: CanvasAudioCue[];
  durationSec: number;
  getSelectedTake: (cue: CanvasAudioCue) => CanvasAudioTake | undefined;
  inputKeyOf: (cue: CanvasAudioCue) => string;
}): PremixTimelineClip[] {
  const cues = input.cues.filter((cue) => cue.approved && cue.enabled !== false);
  if (!cues.some((cue) => cue.kind === "dialogue")) {
    throw new Error("先试听并确认至少一句对白，再预混母轨。");
  }
  return cues.map((cue) => {
    if (!(cue.startSec >= 0 && cue.endSec > cue.startSec && cue.endSec <= input.durationSec)) {
      throw new Error(`「${cue.labelZh || cue.textZh || cue.id}」的秒窗超出本段 ${input.durationSec} 秒，请先调整。`);
    }
    const take = input.getSelectedTake(cue);
    if (!take || take.inputKey !== input.inputKeyOf(cue)) {
      throw new Error("音频内容已修改，请重新试听确认。");
    }
    if (take.durationSec > cue.endSec - cue.startSec + 0.02) {
      throw new Error("对白或音乐长于秒窗，请调整结束秒；不会截断对白。");
    }
    const isBgm = cue.kind === "bgm";
    // 淡入淡出总和不能超过片长（服务端 checkAudioClip 会拒）：各自封顶到片长的三分之一
    const fadeIn = isBgm ? Math.min(PREMIX_BGM_FADE_IN_SEC, take.durationSec / 3) : 0;
    const fadeOut = isBgm ? Math.min(PREMIX_BGM_FADE_OUT_SEC, take.durationSec / 3) : 0;
    return {
      audioUri: take.gcsUri,
      sourceStartSec: 0,
      sourceEndSec: take.durationSec,
      startSec: cue.startSec,
      volume: isBgm ? PREMIX_BGM_VOLUME : 1,
      fadeInSec: Math.round(fadeIn * 1000) / 1000,
      fadeOutSec: Math.round(fadeOut * 1000) / 1000,
    };
  });
}
