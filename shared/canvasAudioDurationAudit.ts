import { canvasAudioCueInputKey, getSelectedAudioTake, type CanvasAudioCue } from "./canvasAudioStudio.js";

export type CanvasAudioDurationAudit = {
  dialogueCount: number;
  dialogueReadyCount: number;
  bgmCoveredSec: number;
  bgmUncoveredSec: number;
  issuesZh: string[];
};

/** 只读现有采用记录与实测音频时长；留白是提示，不擅自延长片段或裁切音频。 */
export function auditCanvasAudioDuration(cues: readonly CanvasAudioCue[], segmentSec: number): CanvasAudioDurationAudit {
  const duration = Number.isFinite(segmentSec) && segmentSec > 0 ? segmentSec : 0;
  const dialogue = cues.filter(cue => cue.kind === "dialogue" && cue.enabled);
  const bgm = cues.filter(cue => cue.kind === "bgm" && cue.enabled);
  const issuesZh: string[] = [];
  const bgmIntervals: Array<[number, number]> = [];
  let dialogueReadyCount = 0;
  const selected = (cue: CanvasAudioCue) => {
    const take = getSelectedAudioTake(cue);
    return cue.approved && take?.inputKey === canvasAudioCueInputKey(cue) ? take : undefined;
  };
  for (const cue of dialogue) {
    const label = cue.speakerZh.trim() || cue.labelZh.trim() || "未命名对白";
    const take = selected(cue);
    if (!take) { issuesZh.push(`${label}：尚无与当前台词一致的已采用配音`); continue; }
    const windowSec = cue.endSec - cue.startSec;
    if (!(windowSec > 0) || cue.startSec < 0 || cue.endSec > duration + 0.02) {
      issuesZh.push(`${label}：对白秒窗超出本段或起止时间无效`);
    } else if (take.durationSec > windowSec + 0.02) {
      issuesZh.push(`${label}：配音 ${take.durationSec.toFixed(2)} 秒，比秒窗长 ${(take.durationSec - windowSec).toFixed(2)} 秒`);
    } else dialogueReadyCount += 1;
  }
  for (const cue of bgm) {
    const take = selected(cue);
    if (!take) { issuesZh.push(`${cue.labelZh.trim() || "背景音乐"}：尚无与当前裁切一致的已采用音频`); continue; }
    if (!cue.source || !(cue.sourceEndSec > cue.sourceStartSec) || cue.sourceEndSec > cue.source.durationSec + 0.02) {
      issuesZh.push(`${cue.labelZh.trim() || "背景音乐"}：原曲与裁切区间无效`);
      continue;
    }
    const start = Math.max(0, cue.startSec);
    const windowSec = cue.endSec - cue.startSec;
    if (!(windowSec > 0) || cue.endSec > duration + 0.02) {
      issuesZh.push(`${cue.labelZh.trim() || "背景音乐"}：配乐秒窗超出本段或起止时间无效`);
      continue;
    }
    if (take.durationSec > windowSec + 0.02) {
      issuesZh.push(`${cue.labelZh.trim() || "背景音乐"}：音频 ${take.durationSec.toFixed(2)} 秒，比秒窗长 ${(take.durationSec - windowSec).toFixed(2)} 秒`);
      continue;
    }
    bgmIntervals.push([start, Math.min(duration, start + take.durationSec)]);
  }
  bgmIntervals.sort((a, b) => a[0] - b[0]);
  let bgmCoveredSec = 0;
  let end = 0;
  for (const [start, finish] of bgmIntervals) {
    if (finish <= end) continue;
    bgmCoveredSec += finish - Math.max(start, end);
    end = finish;
  }
  return {
    dialogueCount: dialogue.length,
    dialogueReadyCount,
    bgmCoveredSec,
    bgmUncoveredSec: Math.max(0, duration - bgmCoveredSec),
    issuesZh,
  };
}
