/**
 * /platform 趋势看板(platform_analysis 双段)文案通道(2026-08-21 用户拍板):
 * 主力 GPT-5.6 sol + reasoning high;兜底 Kimi K3。
 *
 * 背景:双段此前走 Vertex gemini-3.1-pro-preview,文案偏论文腔。
 * 网关沿用既有解析器(GPT-5.6:官方 OpenAI 优先→EvoLink 回落;K3:OpenRouter),不新增钥匙。
 * 主力失败(含截断/空内容)才降级兜底;两档都失败按原有语义上抛。
 */
import { invokeLLM } from "../_core/llm.js";
import { EVOLINK_CHAT_MODEL_GPT56_SOL } from "./evolinkChatModel.js";
import { OPENROUTER_KIMI_K3_MODEL } from "./openrouterKimiK3.js";

/** 主力:GPT-5.6 sol(官方/EvoLink 由 invokeLLM 内部解析) */
export const PLATFORM_ANALYSIS_PRIMARY_MODEL = EVOLINK_CHAT_MODEL_GPT56_SOL;
/** 兜底:Kimi K3(历史实测 30-40s 稳定交卷) */
export const PLATFORM_ANALYSIS_FALLBACK_MODEL = OPENROUTER_KIMI_K3_MODEL;

export type PlatformAnalysisChatResponse = {
  /** 调用方直接读 choices[0]：两档都已校验非空正文,故此处非可选 */
  choices: Array<{ message?: { content?: unknown }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  provider?: string;
};

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type PlatformAnalysisChatParams = {
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" };
};

function assertUsableChatResponse(
  res: { choices?: PlatformAnalysisChatResponse["choices"] },
  label: string,
): void {
  if (String(res.choices?.[0]?.finish_reason || "") === "length") {
    throw new Error(`${label} 输出被截断（预算耗尽）`);
  }
  const content = res.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`${label} 返回空内容`);
  }
}

/**
 * 主力 → 兜底两档调用。任一档只要拿到非空且未截断的正文即返回;
 * 主力失败仅记警告并降级,兜底再失败照抛(调用方原有 JSON.parse 容错语义不变)。
 */
export async function invokePlatformAnalysisChat(
  params: PlatformAnalysisChatParams,
): Promise<PlatformAnalysisChatResponse> {
  const base = {
    response_format: params.response_format ?? ({ type: "json_object" } as const),
    max_tokens: params.max_tokens ?? 65_536,
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    messages: params.messages,
  };
  try {
    const primary = (await invokeLLM({
      ...base,
      modelName: PLATFORM_ANALYSIS_PRIMARY_MODEL,
      reasoningEffort: "high",
    } as Parameters<typeof invokeLLM>[0])) as { choices?: PlatformAnalysisChatResponse["choices"] };
    assertUsableChatResponse(primary, `platform_analysis 主力 ${PLATFORM_ANALYSIS_PRIMARY_MODEL}`);
    return primary as PlatformAnalysisChatResponse;
  } catch (primaryError) {
    const msg = primaryError instanceof Error ? primaryError.message : String(primaryError);
    console.warn(`[platform_analysis] 主力失败,降级 ${PLATFORM_ANALYSIS_FALLBACK_MODEL}: ${msg.slice(0, 200)}`);
    const fallback = (await invokeLLM({
      ...base,
      modelName: PLATFORM_ANALYSIS_FALLBACK_MODEL,
    } as Parameters<typeof invokeLLM>[0])) as { choices?: PlatformAnalysisChatResponse["choices"] };
    assertUsableChatResponse(fallback, `platform_analysis 兜底 ${PLATFORM_ANALYSIS_FALLBACK_MODEL}`);
    return fallback as PlatformAnalysisChatResponse;
  }
}
