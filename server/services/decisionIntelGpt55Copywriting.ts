/**
 * 战略全景图 / 决策智库选题扩写：官方 Responses Pro（gpt-5.6-sol）→ Chat Completions 回退。
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
    reasoningEffort: "medium",
    store: false,
    jsonObject: true,
    abortSignal: params.abortSignal,
    timeoutMs: 240_000,
  });
  if (!text.trim()) {
    throw new Error("GPT-5.6 Sol Responses 决策智库返回空内容");
  }
  return text.trim();
}
