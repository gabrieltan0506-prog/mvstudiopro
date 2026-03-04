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

// Back-compat export for /api/jobs.ts
export function createRunState(type: any, inputJson: any) {
  // Prefer createWorkflow if present
  // @ts-ignore
  if (typeof (createWorkflow as any) === "function") {
    // @ts-ignore
    return (createWorkflow as any)(type, inputJson);
  }
  // Otherwise fall back to internal logic
  if (type === "storyboardToVideo") {
    // @ts-ignore
    const { generateStoryboard } = require("./storyboard.js");
    return {
      step: "storyboard.ready",
      storyboard: generateStoryboard({ text: String(inputJson?.text || inputJson?.input?.text || "") }),
      cursor: 0
    };
  }
  throw new Error("createRunState: unsupported workflow type");
}

