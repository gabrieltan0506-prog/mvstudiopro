export function buildVideoPrompt(input: {
  scenePrompt: string;
  character?: string;
  action?: string;
  camera?: string;
  mood?: string;
  lighting?: string;
  sceneDuration?: number;
  lockedCharacterPrompt?: string;
}) {
  const sceneDuration = Number(input.sceneDuration || 0) || 5;
  const parts = [
    "cinematic video",
    String(input.scenePrompt || "").trim(),
    `duration around ${sceneDuration}s`,
    `character: ${String(input.character || "").trim()}`,
    `action: ${String(input.action || "").trim()}`,
    `camera movement: ${String(input.camera || "dynamic medium shot").trim()}`,
    `mood: ${String(input.mood || "cinematic").trim()}`,
    `lighting: ${String(input.lighting || "dramatic lighting").trim()}`,
    "action continuity across shots",
    "same character identity from reference image",
  ].filter(Boolean);

  if (input.lockedCharacterPrompt) parts.push(String(input.lockedCharacterPrompt).trim());
  return parts.join(", ");
}
