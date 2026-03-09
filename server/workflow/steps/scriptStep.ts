import type { WorkflowTask } from "../types/workflow";
import { generateScriptWithGemini } from "../../models/gemini.js";
import { buildScriptPrompt } from "../prompts/scriptPrompt.js";

export async function scriptStep(task: WorkflowTask): Promise<string> {
  const prompt = buildScriptPrompt({
    prompt: String(task.payload?.prompt || "").trim(),
    targetWords: Number(task.payload?.targetWords || 0) || undefined,
    targetScenes: Number(task.payload?.targetScenes || 0) || undefined,
  });
  const targetWords = Number(task.payload?.targetWords || 900);
  const result = await generateScriptWithGemini({ prompt, targetWords });
  return result.script;
}
