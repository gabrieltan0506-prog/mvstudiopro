export function buildVideoPrompt(input: {
  scenePrompt: string;
  character?: string;
  action?: string;
  camera?: string;
  lighting?: string;
  mood?: string;
  sceneDuration?: number;
  lockedCharacterPrompt?: string;
}) {
  const sceneDuration = Number(input.sceneDuration || 0) || 5;
  const parts = [
    "cinematic video",
    "film-grade lighting",
    "maintain exact same character identity from reference image",
    "no identity drift",
    "motion continuity",
    `duration around ${sceneDuration}s`,
    `scene: ${String(input.scenePrompt || "").trim()}`,
    `character: ${String(input.character || "").trim()}`,
    `action: ${String(input.action || "").trim()}`,
    `camera movement: ${String(input.camera || "dynamic cinematic shot").trim()}`,
    `lighting: ${String(input.lighting || "dramatic lighting").trim()}`,
    `mood: ${String(input.mood || "cinematic").trim()}`,
  ].filter(Boolean);

  if (input.lockedCharacterPrompt) {
    parts.push(String(input.lockedCharacterPrompt).trim());
  }

  return parts.join(", ");
}
