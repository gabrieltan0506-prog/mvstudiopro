import type { StoryboardImages, StoryboardScene } from "../types/workflow";
import { generateStoryboardSceneImages } from "../../models/banana.js";
import { buildStoryboardImagePrompt } from "../prompts/storyboardImagePrompt.js";

export async function storyboardImagesStep(scenes: StoryboardScene[]): Promise<StoryboardImages[]> {
  const result: StoryboardImages[] = [];
  for (const scene of scenes) {
    const prompt = buildStoryboardImagePrompt({
      scenePrompt: scene.scenePrompt,
      environment: scene.environment,
      character: scene.character,
      action: scene.action,
      camera: scene.camera,
      lighting: scene.lighting,
      mood: scene.mood,
    });
    const generated = await generateStoryboardSceneImages({
      scenePrompt: prompt,
      count: 1,
    });

    result.push({
      sceneIndex: scene.sceneIndex,
      images: generated.imageUrls.slice(0, 1),
    });
  }
  return result;
}
