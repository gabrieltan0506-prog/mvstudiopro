import { backgroundRemoveStep } from "./backgroundRemoveStep.js";

export async function characterLockStep(input: { sceneImageUrl: string }): Promise<{ referenceCharacterUrl: string }> {
  const sceneImageUrl = String(input.sceneImageUrl || "").trim();
  if (!sceneImageUrl) throw new Error("sceneImageUrl is required");

  try {
    const removed = await backgroundRemoveStep({ imageUrl: sceneImageUrl });
    return { referenceCharacterUrl: removed.characterPngUrl || sceneImageUrl };
  } catch {
    return { referenceCharacterUrl: sceneImageUrl };
  }
}
