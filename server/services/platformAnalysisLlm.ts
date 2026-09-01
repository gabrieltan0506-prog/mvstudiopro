/** /platform 双段分析文固定路由：北京 Qwen 3.8 → 新加坡 Qwen 3.8 → GLM-5.3。 */
import { extractJsonString } from "../_core/llm.js";
import {
  PLATFORM_TEXT_GLM_MODEL,
  PLATFORM_TEXT_QWEN_MODEL,
  runPlatformTextAnalysisAttempts,
  type PlatformTextAnalysisEngine,
  type PlatformTextAnalysisInvokeDeps,
} from "./platformTextAnalysisLlm.js";

export const PLATFORM_ANALYSIS_PRIMARY_MODEL = PLATFORM_TEXT_QWEN_MODEL;
export const PLATFORM_ANALYSIS_FALLBACK_MODEL = PLATFORM_TEXT_GLM_MODEL;

export type PlatformAnalysisChatResponse = {
  /** 调用方直接读 choices[0]：两档都已校验非空正文,故此处非可选 */
  choices: Array<{ message?: { content?: unknown }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  provider?: string;
  gateway?: string;
  routeEngine: PlatformTextAnalysisEngine;
  routeAttempt: number;
};

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type PlatformAnalysisChatParams = {
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" };
  abortSignal?: AbortSignal;
};

function validateJsonObject(content: string): void {
  const parsed = JSON.parse(extractJsonString(content));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("platform_analysis 返回值不是 JSON 对象");
  }
}

export async function invokePlatformAnalysisChat(
  params: PlatformAnalysisChatParams,
  deps: PlatformTextAnalysisInvokeDeps = {},
): Promise<PlatformAnalysisChatResponse> {
  const systemPrompt = params.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const userPrompt = params.messages
    .filter((message) => message.role !== "system")
    .map((message) => message.role === "assistant" ? `【既有助手内容】\n${message.content}` : message.content)
    .join("\n\n");
  const result = await runPlatformTextAnalysisAttempts({
    systemPrompt,
    userPrompt,
    maxTokens: params.max_tokens ?? 65_536,
    temperature: params.temperature,
    abortSignal: params.abortSignal,
    validateContent: validateJsonObject,
  }, deps);
  return {
    ...result.response,
    choices: result.response.choices ?? [],
    routeEngine: result.engine,
    routeAttempt: result.attempt,
  };
}
