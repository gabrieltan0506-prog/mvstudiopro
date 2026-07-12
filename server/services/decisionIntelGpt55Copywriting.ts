/**
 * 战略全景图 / 决策智库：OpenAI GPT‑5.6 · reasoning high · JSON 结构化输出。
 * 失败或空回时临时 fallback 到 Gemini Flash（与 Stage2 文案同模型）。
 */
import { extractFirstChoicePlainText, invokeLLM } from "../_core/llm.js";
import { getPlatformStage2OpenAiModel } from "../config/platformSwitches.js";
import {
  callGemini35FlashCopywriting,
  resolveGemini35FlashCopywritingMaxOutputTokens,
  resolvePlatformStage2GeminiModel,
} from "./gemini35FlashRuntime.js";

const DECISION_INTEL_TEMPERATURE = 0.8;

export async function callDecisionIntelGpt55StructuredJson(params: {
  taskSystemInstruction: string;
  userText: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  try {
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
    if (text) return text;
    console.warn("[decisionIntel] GPT-5.6 空回 → Gemini 3.1 Pro fallback");
  } catch (e) {
    console.warn(
      "[decisionIntel] GPT-5.6 failed → Gemini 3.1 Pro fallback:",
      e instanceof Error ? e.message : e,
    );
  }

  const geminiModel = resolvePlatformStage2GeminiModel();
  console.warn(`[decisionIntel] Gemini 3.1 Pro fallback · model=${geminiModel}`);
  return callGemini35FlashCopywriting({
    taskSystemInstruction: params.taskSystemInstruction,
    userText: params.userText,
    responseMimeType: "application/json",
    maxOutputTokens: resolveGemini35FlashCopywritingMaxOutputTokens(),
    temperature: DECISION_INTEL_TEMPERATURE,
    topP: 0.95,
    modelName: geminiModel,
    abortSignal: params.abortSignal,
  });
}
