import type { ManhuaWorkbenchShot } from "@shared/manhuaScriptWorkbench";

/** Filtering must retain the source index used by preview, segment and canvas selection. */
export function filterManhuaShots(shots: readonly ManhuaWorkbenchShot[], query: string) {
  const normalized = query.normalize("NFKC").trim().toLocaleLowerCase();
  const number = normalized.match(/^(?:第\s*)?0*(\d+)\s*(?:镜|鏡)?$/);
  const terms = normalized.split(/\s+/).filter(Boolean);
  return shots.map((shot, originalIndex) => ({ shot, originalIndex })).filter(({ shot }) => {
    if (number) return shot.index === Number(number[1]);
    const text = [shot.index, shot.cameraZh, shot.actionZh, shot.dialogueZh,
      shot.dialogueSpeakerNameZh, shot.stateNoteZh, shot.emotionZh,
      ...(shot.additionalDialogueCues ?? []).flatMap(cue => [cue.dialogueZh, cue.speakerNameZh]),
    ].filter(value => value != null).join(" ").normalize("NFKC").toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
}
