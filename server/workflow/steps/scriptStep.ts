import type { WorkflowTask } from "../types/workflow";
import { generateScriptWithGemini } from "../../models/gemini";

export async function scriptStep(task: WorkflowTask): Promise<string> {
  const prompt = String(task.payload?.prompt || "").trim();
  const targetWords = Number(task.payload?.targetWords || 900);
  const result = await generateScriptWithGemini({ prompt, targetWords });
  return result.script;
}
