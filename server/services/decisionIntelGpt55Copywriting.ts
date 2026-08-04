/**
 * 战略全景图 / 决策智库选题扩写：OpenRouter Kimi K3（chat completions · reasoning max）。
 */
import { getPlatformStage2OpenAiModel } from "../config/platformSwitches.js";
import { invokeGpt56ResponsesText } from "./gpt56ResponsesClient.js";

export async function callDecisionIntelGpt55StructuredJson(params: {
  taskSystemInstruction: string;
  userText: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const text = await invokeGpt56ResponsesText({
    instructions: params.taskSystemInstruction,
    input: params.userText,
    modelName: getPlatformStage2OpenAiModel(),
    reasoningMode: "pro",
    reasoningEffort: "max",
    store: false,
    jsonObject: true,
    abortSignal: params.abortSignal,
    timeoutMs: 240_000,
  });
  if (!text.trim()) {
    throw new Error("决策智库返回空内容，请稍后重试");
  }
  return text.trim();
}
