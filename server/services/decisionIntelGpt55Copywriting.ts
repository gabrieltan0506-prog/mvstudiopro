/**
 * 战略全景图 / 决策智库：OpenAI GPT‑5.5 · reasoning medium · JSON 结构化输出。
 */
import { extractFirstChoicePlainText, invokeLLM } from "../_core/llm.js";
import { getPlatformStage2OpenAiModel } from "../config/platformSwitches.js";
import { resolveGemini35FlashCopywritingMaxOutputTokens } from "./gemini35FlashRuntime.js";

export async function callDecisionIntelGpt55StructuredJson(params: {
  taskSystemInstruction: string;
  userText: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const response = await invokeLLM({
    provider: "openai",
    modelName: getPlatformStage2OpenAiModel(),
    max_tokens: resolveGemini35FlashCopywritingMaxOutputTokens(),
    temperature: 0.8,
    response_format: { type: "json_object" },
    reasoningEffort: "medium",
    messages: [
      { role: "system", content: params.taskSystemInstruction },
      { role: "user", content: params.userText },
    ],
    abortSignal: params.abortSignal,
  });
  return extractFirstChoicePlainText(response);
}
