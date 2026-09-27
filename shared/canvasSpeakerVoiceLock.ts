import type { CanvasAudioCue } from "./canvasAudioStudio";

export type SpeakerVoiceLock = { speakerZh: string; voice: string; conflict: boolean; sourceCueIds: string[] };
type Source = { episodeIndex?: number; audioStudio?: { cues: CanvasAudioCue[] } };

export function speakerVoiceLockKey(cue: Pick<CanvasAudioCue, "speakerId" | "speakerZh">): string {
  return cue.speakerId?.trim() ? `id:${cue.speakerId.trim()}` : cue.speakerZh.trim();
}

/** 同一项目内首次采用后锁定角色声线，跨段、跨集沿用；改台词不释放。 */
export function collectSpeakerVoiceLocks(sources: readonly Source[], resolveLegacyId?: (speakerZh: string) => string | undefined): Map<string, SpeakerVoiceLock> {
  const voices = new Map<string, { ids: string[]; names: Set<string> }>();
  for (const source of sources) {
    for (const cue of source.audioStudio?.cues || []) {
      const speakerId = cue.voiceLock?.speakerId?.trim() || cue.speakerId?.trim() || resolveLegacyId?.(cue.voiceLock?.speakerZh || cue.speakerZh);
      const speaker = speakerId ? `id:${speakerId}` : speakerVoiceLockKey(cue);
      const voice = cue.voiceLock?.voice || (cue.approved && cue.takes.some(take => take.id === cue.selectedTakeId) ? cue.voice : "");
      if (cue.kind !== "dialogue" || !voice || !speaker) continue;
      const entry = voices.get(speaker) || { ids: [], names: new Set<string>() };
      entry.ids.push(cue.id);
      entry.names.add(voice);
      voices.set(speaker, entry);
    }
  }
  const locks = new Map<string, SpeakerVoiceLock>();
  for (const [speakerZh, entry] of Array.from(voices.entries())) {
    const names = Array.from(entry.names);
    locks.set(speakerZh, { speakerZh, voice: names[0]!, conflict: names.length > 1, sourceCueIds: entry.ids });
  }
  return locks;
}
