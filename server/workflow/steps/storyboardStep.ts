import type { StoryboardScene } from "../types/workflow";
import { buildStoryboardPrompt } from "../prompts/storyboardPrompt.js";

export async function storyboardStep(input: {
  script: string;
  targetScenes?: number;
}): Promise<StoryboardScene[]> {
  const script = String(input.script || "").trim();
  const targetScenes = Math.max(1, Number(input.targetScenes || 6));
  if (!script) return [];
  const storyboardPromptContext = buildStoryboardPrompt({
    prompt: script.slice(0, 220),
    script,
    targetScenes,
    sceneDuration: 5,
  });
  void storyboardPromptContext;

  const sceneRegex = /(?:^|\n)\s*(?:scene|场景)\s*(\d+)\s*[:：]([\s\S]*?)(?=\n\s*(?:scene|场景)\s*\d+\s*[:：]|$)/gi;
  const scenes: StoryboardScene[] = [];

  let match: RegExpExecArray | null;
  while ((match = sceneRegex.exec(script)) !== null) {
    const idx = Number(match[1]);
    const content = String(match[2] || "").trim();
    scenes.push({
      sceneIndex: idx || scenes.length + 1,
      scenePrompt: content,
      duration: 5,
      camera: scenes.length % 2 === 0 ? "medium" : "wide",
      mood: "cinematic",
    });
  }

  if (!scenes.length) {
    const lines = script.split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, targetScenes);
    return lines.map((line, i) => ({
      sceneIndex: i + 1,
      scenePrompt: line,
      duration: 5,
      camera: i % 2 === 0 ? "medium" : "wide",
      mood: "cinematic",
    }));
  }

  return scenes.slice(0, targetScenes);
}
