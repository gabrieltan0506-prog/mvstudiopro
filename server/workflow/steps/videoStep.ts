import { generateVideoWithVeo } from "../../models/veo";
import type { StoryboardImages, StoryboardScene } from "../types/workflow";

export async function videoStep(input: {
  storyboard: StoryboardScene[];
  storyboardImages: StoryboardImages[];
  referenceImages: string[];
}) {
  const firstScene = input.storyboard[0];
  const firstImages = input.storyboardImages[0]?.images || [];

  const result = await generateVideoWithVeo({
    scenePrompt: firstScene?.scenePrompt || "cinematic scene",
    referenceImages: input.referenceImages || [],
    imageUrls: firstImages,
  });

  return result.videoUrl;
}
