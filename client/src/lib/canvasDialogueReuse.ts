import { canvasAudioCueInputKey, canvasAudioCueSchema, type CanvasAudioCue, type CanvasAudioTake } from '@shared/canvasAudioStudio';
import type { CanvasBlock } from './canvasTypes';

export type DialogueReuseCandidate = { blockId: string; cueId: string; take: CanvasAudioTake; voice: string; emotion: string };
/** 仅从同集画布找同角色、同状态、同原文；情绪与音色须随候选显式选择，不按姓名自动借声。 */
export function findCanvasDialogueReuse(block: CanvasBlock, cue: CanvasAudioCue, sources: readonly CanvasBlock[]): DialogueReuseCandidate[] {
  if (cue.kind !== 'dialogue' || !cue.textZh.trim() || !cue.speakerZh.trim()) return [];
  const found: DialogueReuseCandidate[] = [];
  const seen = new Set(cue.takes.map(take => take.id));
  for (const source of sources) {
    if (source.id === block.id || source.episodeIndex !== block.episodeIndex) continue;
    for (const original of source.audioStudio?.cues || []) {
      if (original.kind !== 'dialogue' || original.speakerZh !== cue.speakerZh || original.voiceStateZh !== cue.voiceStateZh || original.textZh !== cue.textZh) continue;
      const key = canvasAudioCueInputKey(original);
      for (const take of original.takes) {
        if (seen.has(take.id) || take.inputKey !== key) continue;
        if (!canvasAudioCueSchema.safeParse({ ...cue, emotion: original.emotion, voice: original.voice, takes: [take] }).success) continue;
        seen.add(take.id);
        found.push({ blockId: source.id, cueId: original.id, take, voice: original.voice, emotion: original.emotion });
      }
    }
  }
  return found;
}

export function restoreCanvasDialogueCandidate(block: CanvasBlock, cue: CanvasAudioCue, sources: readonly CanvasBlock[], selected: DialogueReuseCandidate): CanvasAudioCue {
  const fresh = findCanvasDialogueReuse(block, cue, sources).find(candidate => candidate.blockId === selected.blockId && candidate.cueId === selected.cueId && candidate.take.id === selected.take.id && candidate.take.inputKey === selected.take.inputKey && candidate.take.gcsUri === selected.take.gcsUri);
  if (!fresh) throw new Error('原对白或当前台词已变化，请重新选择。');
  if (cue.takes.length >= 100) throw new Error('当前候选已满，原对白保留，请先整理候选。');
  return canvasAudioCueSchema.parse({ ...cue, voice: fresh.voice, emotion: fresh.emotion, takes: [...cue.takes, { ...fresh.take }], selectedTakeId: undefined, approved: false });
}
