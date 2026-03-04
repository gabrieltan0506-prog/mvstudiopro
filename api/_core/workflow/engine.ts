import { generateStoryboard } from "./storyboard.js";

export function createWorkflow(type, input) {

  if (type === "storyboardToVideo") {

    const storyboard = generateStoryboard(input.text || "");

    return {
      step: "storyboard",
      storyboard,
      cursor: 0
    };

  }

  if (type === "musicVideo") {

    return {
      step: "music",
      prompt: input.prompt
    };

  }

  if (type === "viralAnalysis") {

    return {
      step: "analysis",
      videoUrl: input.videoUrl
    };

  }

  throw new Error("Unknown workflow type");

}
