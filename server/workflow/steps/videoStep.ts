import { generateVideoWithVeo } from "../../models/veo.js";
import { veoReferenceVideo } from "../../models/veoReferenceVideo.js";
import type { StoryboardImages, StoryboardScene } from "../types/workflow";

export async function videoStep(input: {
  storyboard: StoryboardScene[];
  storyboardImages: StoryboardImages[];
  referenceImages: string[];
  referenceCharacterUrl?: string;
}) {
  const firstScene = input.storyboard[0];
  const firstImages = input.storyboardImages[0]?.images || [];
  const scenePrompt = firstScene?.scenePrompt || "cinematic scene";

  if (input.referenceCharacterUrl) {
    try {
      const result = await veoReferenceVideo({
        prompt: scenePrompt,
        reference_images: [input.referenceCharacterUrl],
        duration: Number(firstScene?.duration || 0) || 5,
        resolution: "720p",
      });
      if (result.videoUrl) return result.videoUrl;
    } catch {
      // fallback to existing model router
    }
  }

  const result = await generateVideoWithVeo({
    scenePrompt,
    referenceImages: input.referenceImages || [],
    imageUrls: firstImages,
  });

  return result.videoUrl;
}
