import { getSelectedAudioTake, type CanvasAudioCue } from "./canvasAudioStudio";
export type CanvasAudioMixClip = { audioUri: string; sourceStartSec: number; sourceEndSec: number; startSec: number; volume: number; fadeInSec: number; fadeOutSec: number };

/** 在已采用音频上施加留白/对白避让，源音频不改写；返回真实后期任务可执行片段。 */
export function applyCanvasAudioMixPlan(cue: CanvasAudioCue, base: CanvasAudioMixClip, cues: readonly CanvasAudioCue[]): CanvasAudioMixClip[] {
  if (cue.kind === "dialogue" || !cue.mix) return [base];
  const end = base.startSec + base.sourceEndSec - base.sourceStartSec;
  const silences = cue.mix.silenceWindows;
  if (silences.some(w => w.startSec < cue.startSec || w.endSec > cue.endSec || w.endSec <= w.startSec)) throw new Error("留白窗口须位于音轨片内时间窗内");
  const dialogueWindows = cue.mix.duckUnderDialogue ? cues.filter(c => c.kind === "dialogue" && c.enabled && c.approved).map(c => ({ startSec: c.startSec, endSec: c.startSec + (getSelectedAudioTake(c)?.durationSec || 0) })) : [];
  const boundaries = Array.from(new Set([base.startSec, end, ...[...silences, ...dialogueWindows].flatMap(w => [w.startSec, w.endSec]).filter(t => t > base.startSec && t < end)])).sort((a,b)=>a-b);
  const clips: CanvasAudioMixClip[] = [];
  for(let i=1;i<boundaries.length;i++) {
    const start = boundaries[i-1]!, stop = boundaries[i]!, midpoint = (start+stop)/2;
    if(silences.some(w=>midpoint>=w.startSec&&midpoint<w.endSec)) continue;
    const volume = base.volume * (dialogueWindows.some(w=>midpoint>=w.startSec&&midpoint<w.endSec) ? cue.mix.duckVolume : 1);
    const last = clips[clips.length-1];
    if(last && last.volume===volume && Math.abs(last.startSec+last.sourceEndSec-last.sourceStartSec-start)<1e-9) { last.sourceEndSec=base.sourceStartSec+stop-base.startSec; continue; }
    clips.push({...base,sourceStartSec:base.sourceStartSec+start-base.startSec,sourceEndSec:base.sourceStartSec+stop-base.startSec,startSec:start,volume,fadeInSec:0,fadeOutSec:0});
  }
  // 仅原片起止保留淡入淡出；分割边界不重复淡入、也不挪动源音频时间。
  for(const clip of clips) {
    const length=clip.sourceEndSec-clip.sourceStartSec;
    if(clip.startSec===base.startSec) clip.fadeInSec=Math.min(base.fadeInSec,length/3);
    if(Math.abs(clip.startSec+length-end)<1e-9) clip.fadeOutSec=Math.min(base.fadeOutSec,length/3);
  }
  return clips;
}
export function assertCanvasAudioMixCapacity(clips: readonly CanvasAudioMixClip[]): void {
 if(!clips.length) throw new Error("留白后没有可播放音频，请保留至少一段声音");
 if(clips.length>12) throw new Error(`留白与对白避让展开为${clips.length}段，超过后期任务12段上限；请减少窗口或分段处理，本次未提交`);
}
