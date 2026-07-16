/**
 * 战略全景图 / 决策智库：仅 Evolink GPT‑5.6 · reasoning high · JSON（已取消 Gemini fallback）。
 */
import { extractFirstChoicePlainText, invokeLLM } from "../_core/llm.js";
import { getPlatformStage2OpenAiModel } from "../config/platformSwitches.js";
import { resolveGemini35FlashCopywritingMaxOutputTokens } from "./gemini35FlashRuntime.js";

const DECISION_INTEL_TEMPERATURE = 0.8;

export async function callDecisionIntelGpt55StructuredJson(params: {
  taskSystemInstruction: string;
  userText: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const response = await invokeLLM({
    provider: "openai",
    modelName: getPlatformStage2OpenAiModel(),
    max_tokens: resolveGemini35FlashCopywritingMaxOutputTokens(),
    temperature: DECISION_INTEL_TEMPERATURE,
    response_format: { type: "json_object" },
    reasoningEffort: "high",
    messages: [
      { role: "system", content: params.taskSystemInstruction },
      { role: "user", content: params.userText },
    ],
    abortSignal: params.abortSignal,
  });
  const text = extractFirstChoicePlainText(response).trim();
  if (!text) {
    throw new Error("Evolink GPT-5.6 Sol 决策智库返回空内容（已取消 Gemini fallback）");
  }
  return text;
}
