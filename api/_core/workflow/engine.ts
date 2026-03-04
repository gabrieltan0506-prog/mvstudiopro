import { generateStoryboard } from "./storyboard.js";

export function createRunState(type: "storyboardToVideo", inputJson: any) {
  if (type === "storyboardToVideo") {
    const sb = generateStoryboard({ text: String(inputJson?.text || "") });
    return {
      step: "storyboard.ready",
      storyboard: sb,
      cursor: 0,
    };
  }
  throw new Error("unknown workflow type");
}
