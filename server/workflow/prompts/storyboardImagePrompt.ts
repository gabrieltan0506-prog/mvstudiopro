export function buildStoryboardImagePrompt(input: {
  scenePrompt: string;
  environment?: string;
  character?: string;
  action?: string;
  camera?: string;
  lighting?: string;
  mood?: string;
  lockedCharacterPrompt?: string;
  referenceImageMode?: string;
}) {
  const parts = [
    "cinematic movie still",
    "film still",
    "professional film frame",
    "35mm lens",
    "shallow depth of field",
    "dramatic lighting",
    "same character identity across scenes",
    "same face",
    "same outfit",
    "same hairstyle",
    String(input.scenePrompt || "").trim(),
    `environment: ${String(input.environment || "").trim()}`,
    `character: ${String(input.character || "").trim()}`,
    `action: ${String(input.action || "").trim()}`,
    `camera: ${String(input.camera || "").trim()}`,
    `lighting: ${String(input.lighting || "").trim()}`,
    `mood: ${String(input.mood || "").trim()}`,
    "16:9 composition",
    "ultra detailed",
  ].filter(Boolean);

  if (input.lockedCharacterPrompt) {
    parts.push(String(input.lockedCharacterPrompt).trim());
  }
  if (input.referenceImageMode) {
    parts.push(`reference mode: ${String(input.referenceImageMode).trim()}`);
  }

  return parts.join(", ");
}
