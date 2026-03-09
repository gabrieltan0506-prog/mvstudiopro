import type { WorkflowTask } from "../types/workflow";

export async function renderStep(task: WorkflowTask): Promise<string> {
  const finalVideoUrl = String(task.outputs.videoUrl || "").trim();
  if (!finalVideoUrl) {
    throw new Error("videoUrl is required before render");
  }
  return finalVideoUrl;
}
