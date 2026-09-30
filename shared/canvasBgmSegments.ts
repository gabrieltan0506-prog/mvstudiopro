import { canvasAudioCueSchema, type CanvasAudioCue } from "./canvasAudioStudio";

/** 原曲选段与片内落点各自保留；不裁文件、不改变其他声音。 */
export function canvasBgmRangeIssue(cue: CanvasAudioCue): string {
  if (!cue.source) return "请先选择这一段使用的原曲。";
  if (!Number.isFinite(cue.sourceStartSec) || !Number.isFinite(cue.sourceEndSec) || cue.sourceStartSec < 0 || cue.sourceEndSec <= cue.sourceStartSec || cue.sourceEndSec > cue.source.durationSec)
    return "所选起止秒必须在原曲实际时长内，结束晚于开始。";
  return "";
}

export function fitCanvasBgmSegment(cue: CanvasAudioCue, durationSec: number): number {
  const issue = canvasBgmRangeIssue(cue);
  if (issue) throw new Error(issue);
  const end = Math.round((cue.startSec + cue.sourceEndSec - cue.sourceStartSec) * 1000) / 1000;
  if (end > durationSec || cue.startSec < 0) throw new Error("选段放不进当前片内落点，请缩短选段或提前入点；未截断原曲。 ");
  return end;
}

/** 仅为用户选定的剧情段准备原曲要求；生成时长由原曲制作区另行选择。 */
export function canvasBgmSegmentMusicPrompt(cue: CanvasAudioCue): string {
  if (cue.kind !== "bgm" || !(cue.labelZh.trim() || cue.shotZh.trim())) throw new Error("先填写这段的剧情位置、音乐主题或镜头动作。 ");
  return `这段的剧情位置与音乐主题：${cue.labelZh.trim() || "按下列剧情设计"}\n画面与人物表演：${cue.shotZh.trim() || "按当前剧情表达"}\n用于片内${cue.startSec}–${cue.endSec}秒，按本段情绪、眼神、站位与动作表达叙事；无对白时仍需有情绪进程，可支持、反衬或暗示人物意图。\n制作可供选段的纯音乐原曲，生成时长以用户在原曲制作区选择的值为准；不要求整曲全用，不自动循环或跨段贯穿。`;
}

/** 按剧情秒位拆开配乐草稿，原曲与旧候选保留；两段均须重新裁切、试听并采用。 */
export function splitCanvasBgmSegment(cue: CanvasAudioCue, atSec: number, rightId: string): [CanvasAudioCue, CanvasAudioCue] {
  if (cue.kind !== "bgm") throw new Error("这里只拆分背景音乐，不改变对白或音效。 ");
  const issue = canvasBgmRangeIssue(cue);
  if (issue) throw new Error(issue);
  const musicEnd = Math.min(cue.endSec, cue.startSec + cue.sourceEndSec - cue.sourceStartSec);
  if (cue.startSec + cue.sourceEndSec - cue.sourceStartSec > cue.endSec + .001) throw new Error("请先按选段长度设置片内结束，或缩短所选区间；不会自动截掉原曲。 ");
  if (!Number.isFinite(atSec) || atSec <= cue.startSec || atSec >= musicEnd) throw new Error("切段秒位须在这段音乐实际播放范围内部。 ");
  if (!rightId || rightId === cue.id) throw new Error("新配乐段编号无效。 ");
  const sourceAt = Math.round((cue.sourceStartSec + atSec - cue.startSec) * 1000) / 1000;
  const mixFor = (start: number, end: number) => cue.mix ? { ...cue.mix, silenceWindows: cue.mix.silenceWindows.map(w => ({ startSec: Math.max(w.startSec, start), endSec: Math.min(w.endSec, end) })).filter(w => w.endSec > w.startSec) } : undefined;
  const left = canvasAudioCueSchema.parse({ ...cue, endSec: atSec, sourceEndSec: sourceAt, fadeInSec: Math.min(cue.fadeInSec, (sourceAt - cue.sourceStartSec) / 2), fadeOutSec: 0, approved: false, selectedTakeId: undefined, mix: mixFor(cue.startSec, atSec) });
  const right = canvasAudioCueSchema.parse({ ...cue, id: rightId, labelZh: `${cue.labelZh || "配乐"} · 后段`.slice(0, 200), startSec: atSec, sourceStartSec: sourceAt, fadeInSec: 0, fadeOutSec: Math.min(cue.fadeOutSec, (cue.sourceEndSec - sourceAt) / 2), takes: [], approved: false, selectedTakeId: undefined, mix: mixFor(atSec, cue.endSec) });
  return [left, right];
}
