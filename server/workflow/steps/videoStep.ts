import { generateVideoWithVeo } from "../../models/veo.js";
import { veoReferenceVideo } from "../../models/veoReferenceVideo.js";
import type { StoryboardImages, StoryboardScene } from "../types/workflow";
import { buildVideoPrompt } from "../prompts/videoPrompt.js";

export async function videoStep(input: {
  storyboard: StoryboardScene[];
  storyboardImages: StoryboardImages[];
  referenceImages: string[];
  referenceCharacterUrl?: string;
}) {
  const firstScene = input.storyboard[0];
  const firstImages = input.storyboardImages[0]?.images || [];
  const scenePrompt = buildVideoPrompt({
    scenePrompt: firstScene?.scenePrompt || "cinematic scene",
    character: firstScene?.character,
    action: firstScene?.action,
    camera: firstScene?.camera,
    lighting: firstScene?.lighting,
    mood: firstScene?.mood,
    sceneDuration: firstScene?.duration,
    lockedCharacterPrompt: input.referenceCharacterUrl
      ? `maintain exact same character identity from reference image: ${input.referenceCharacterUrl}`
      : undefined,
  });

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
