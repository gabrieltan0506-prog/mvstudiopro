import { canvasAudioCueInputKey, type CanvasAudioCue, type CanvasAudioTake } from "./canvasAudioStudio";

/** 保留原声和后句窗口长度，只将冲突的后句顺延；先预览再由用户采用。 */
export function planCanvasDialogueTiming(cues: CanvasAudioCue[], cueId: string, take: CanvasAudioTake, durationSec: number) {
  const changes: Array<{ id: string; labelZh: string; fromStart: number; fromEnd: number; startSec: number; endSec: number }> = [];
  const fail = (issue: string) => ({ changes, requiredDurationSec: 0, issue });
  const cue = cues.find(row => row.id === cueId);
  if (!cue || !cue.enabled || cue.kind !== "dialogue" || take.inputKey !== canvasAudioCueInputKey(cue)) return fail("请选择与当前台词、音色一致的对白原声");
  if (!Number.isFinite(durationSec) || durationSec <= 0 || !Number.isFinite(take.durationSec) || take.durationSec <= 0) return fail("音频或片段时长无效");
  const dialogue = cues.filter(row => row.enabled && row.kind === "dialogue").sort((a, b) => a.startSec - b.startSec);
  if (dialogue.some(row => !Number.isFinite(row.startSec) || !Number.isFinite(row.endSec) || row.startSec < 0 || row.endSec <= row.startSec)) return fail("请先修正无效的对白起止时间");
  const index = dialogue.findIndex(row => row.id === cueId);
  if (dialogue.slice(0, index).some(row => row.endSec > cue.startSec)) return fail("本句开始前已有对白重叠，请先调整前句");
  const round = (value: number) => Math.round(value * 1000) / 1000;
  let previousEnd = cue.startSec;
  for (const row of dialogue.slice(index)) {
    const startSec = row.id === cueId ? row.startSec : Math.max(row.startSec, previousEnd);
    const length = row.id === cueId ? Math.max(row.endSec - row.startSec, take.durationSec) : row.endSec - row.startSec;
    const endSec = round(startSec + length);
    previousEnd = endSec;
    if (startSec !== row.startSec || endSec !== row.endSec) changes.push({ id: row.id, labelZh: row.speakerZh || row.labelZh || "对白", fromStart: row.startSec, fromEnd: row.endSec, startSec, endSec });
  }
  const requiredDurationSec = Math.max(previousEnd, ...dialogue.map(row => row.endSec));
  return { changes, requiredDurationSec, issue: requiredDurationSec > durationSec ? `本段至少需要 ${requiredDurationSec.toFixed(3)} 秒；请先延长镜头或拆段，再应用对白安排。` : "" };
}
