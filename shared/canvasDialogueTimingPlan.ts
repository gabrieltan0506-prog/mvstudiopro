import { canvasAudioCueInputKey, ceilCanvasDialogueSecond, getSelectedAudioTake, type CanvasAudioCue, type CanvasAudioTake } from "./canvasAudioStudio";

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
  // 一位小数向上安排，保留完整原声；仅消除浮点尾差，不向下裁尾。
  const round = ceilCanvasDialogueSecond;
  let previousEnd = cue.startSec;
  for (const row of dialogue.slice(index)) {
    const startSec = round(row.id === cueId ? row.startSec : Math.max(row.startSec, previousEnd));
    const selected = row.id === cueId ? take : getSelectedAudioTake(row);
    const audioLength = selected?.inputKey === canvasAudioCueInputKey(row) ? selected.durationSec : 0;
    const length = Math.max(row.endSec - row.startSec, audioLength);
    const endSec = round(startSec + length);
    previousEnd = endSec;
    if (startSec !== row.startSec || endSec !== row.endSec) changes.push({ id: row.id, labelZh: row.speakerZh || row.labelZh || "对白", fromStart: row.startSec, fromEnd: row.endSec, startSec, endSec });
  }
  const requiredDurationSec = Math.max(previousEnd, ...dialogue.map(row => row.endSec));
  return { changes, requiredDurationSec, issue: requiredDurationSec > durationSec ? `本段至少需要 ${requiredDurationSec.toFixed(1)} 秒；请先延长镜头或拆段，再应用对白安排。` : "" };
}

/** 整段预览只使用已选的完整原声，旧稿和停用候选不参与排序。 */
export function planCanvasDialoguePrecision(cues: CanvasAudioCue[], durationSec: number) {
  const dialogue = cues.filter(row => row.enabled && row.kind === "dialogue").sort((a, b) => a.startSec - b.startSec);
  const first = dialogue[0];
  const take = first && getSelectedAudioTake(first);
  if (!first || !take || dialogue.some(row => {
    const selected = getSelectedAudioTake(row);
    return !selected || selected.inputKey !== canvasAudioCueInputKey(row);
  })) return { changes: [], requiredDurationSec: 0, issue: "请先选择与每句当前台词、音色一致的原声候选，不重新生成。" };
  return planCanvasDialogueTiming(cues, first.id, take, durationSec);
}
