export function buildStoryboardImagePrompt(input: {
  scenePrompt: string;
  environment?: string;
  character?: string;
  camera?: string;
  mood?: string;
  lighting?: string;
  action?: string;
  lockedCharacterPrompt?: string;
  referenceImageMode?: string;
}) {
  const parts = [
    "cinematic movie still, film still, dramatic lighting, high detail, 35mm, shallow depth of field, 16:9",
    String(input.scenePrompt || "").trim(),
    String(input.environment || "").trim(),
    String(input.character || "").trim(),
    String(input.camera || "").trim(),
    String(input.mood || "").trim(),
    String(input.lighting || "").trim(),
    String(input.action || "").trim(),
    "same character identity across scenes, same face, same outfit, same hairstyle",
  ].filter(Boolean);

  if (input.lockedCharacterPrompt) parts.push(String(input.lockedCharacterPrompt).trim());
  if (input.referenceImageMode) parts.push(`reference mode: ${String(input.referenceImageMode).trim()}`);

  return parts.join(", ");
}
