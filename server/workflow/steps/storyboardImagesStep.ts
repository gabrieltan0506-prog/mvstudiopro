import type { StoryboardImages, StoryboardScene } from "../types/workflow";
import { generateStoryboardSceneImages } from "../../models/banana";

export async function storyboardImagesStep(scenes: StoryboardScene[]): Promise<StoryboardImages[]> {
  const result: StoryboardImages[] = [];
  for (const scene of scenes) {
    const generated = await generateStoryboardSceneImages({
      scenePrompt: scene.scenePrompt,
      count: 2,
    });

    result.push({
      sceneIndex: scene.sceneIndex,
      images: generated.imageUrls.slice(0, 2),
    });
  }
  return result;
}
