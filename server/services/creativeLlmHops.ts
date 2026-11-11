import { createHash } from "node:crypto";
import { invokeLLM, extractFirstChoicePlainText, type InvokeParams, type InvokeResult } from "../_core/llm";
import { MANHUA_ADVISOR_MAX_OUTPUT_TOKENS, manhuaAdvisorReasoningEffort } from "./openrouterDeepSeekV41Flash";
import type { GeminiCarbonChannel } from "../../shared/geminiCarbon";
import { resolveGeminiModel } from "../../shared/geminiModelConfig";
import type { GeminiCarbonDeps } from "./geminiCarbonCall";

/**
 * 创作顾问（MV 分镜 / 新歌 / 学习）每一次 LLM 调用的三跳 fallback（用户规矩 2026-11-09 · LLM调用三层fallback）：
 * GLM 5.3 FlashX@EvoLink → GLM 5.3 FlashX@OpenRouter（传输层锁 Z.AI）→ DeepSeek V4.1 Flash 1017@OpenRouter（与 stockFootage/keywords.ts 同通道）。
 * 通道挂 / 超时 / 429 与「输出校验不过（写坏）」都算失败；每跳先带原因重写一次再切下一跳。
 * 每跳的 request / raw / decoded / repaired / rejected 分别永久落盘，由调用方前缀 `compose-hop-<n>-<model>-` 等命名。
 */
export type CreativeLlmHop = {
  readonly modelName: string;
  /** gemini_carbon（1111）：MV 深度编排的 Carbon 通道跳，经 geminiCarbonCall 单通道调用（EvoLink / Gemini API / Vertex）。 */
  readonly gateway: "auto" | "evolink_flash_only" | "gemini_carbon";
  readonly label: string;
  /** 仅 gemini_carbon：本跳通道。 */
  readonly carbonChannel?: GeminiCarbonChannel;
};

/**
 * 1111 MV 深度编排：Carbon 三通道各为一跳（顺序同共用调用层，env GEMINI_CARBON_CHANNEL_ORDER，缺省 EvoLink → Gemini API → Vertex），
 * 调用方把它们排在原三跳之前——Carbon 全部通道失败即自然回落原三跳。模型按 musicMvDeepCompose 领域（缺省 gemini-4-carbon）。
 * label 只进证据与服务端日志。
 */
export async function musicMvDeepComposeHops(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): Promise<CreativeLlmHop[]> {
  const { resolveGeminiCarbonChannelOrder, GEMINI_CARBON_CHANNEL_LABEL_ZH } = await import("./geminiCarbonCall");
  const modelName = resolveGeminiModel("musicMvDeepCompose", env);
  return resolveGeminiCarbonChannelOrder(env).map((channel) => ({
    modelName, gateway: "gemini_carbon" as const, carbonChannel: channel, label: `${modelName} · ${GEMINI_CARBON_CHANNEL_LABEL_ZH[channel]}`,
  }));
}

export const CREATIVE_LLM_HOPS: readonly CreativeLlmHop[] = [
  { modelName: "glm-5.3-flashx", gateway: "evolink_flash_only", label: "GLM 5.3 FlashX · EvoLink" },
  { modelName: "z-ai/glm-5.3-flashx", gateway: "auto", label: "GLM 5.3 FlashX · OpenRouter" },
  { modelName: "deepseek/deepseek-v4.1-flash-1017", gateway: "auto", label: "DeepSeek V4.1 Flash 1017 · OpenRouter" },
];

/** 证据对象名里用的模型短名：`z-ai/glm-5.3-flashx` → `z-ai_glm-5.3-flashx`。 */
export function creativeHopSlug(hop: CreativeLlmHop): string {
  const base = hop.modelName.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return hop.gateway === "gemini_carbon" && hop.carbonChannel ? `${base}@${hop.carbonChannel}` : base;
}

export type Save = (name: string, value: unknown) => Promise<unknown>;

/** 通道层失败（HTTP 错误 / 超时 / 截断 / 模型回执不符）：不做带原因重写，直接切下一跳。 */
export class CreativeHopTransportError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "CreativeHopTransportError";
  }
}

export type CreativeHopInvokeDeps = { invoke: (params: InvokeParams) => Promise<InvokeResult>; carbon?: GeminiCarbonDeps };
const realDeps: CreativeHopInvokeDeps = { invoke: invokeLLM };

export type CreativeHopResult = { text: string; model: string; inputSha256: string; elapsedMs: number };

/**
 * 在指定一跳上执行一次 JSON 创作调用：落 `request` 与 `raw`（或 `error`），返回模型正文（未解析）。
 * JSON 解析与校验由调用方做，解析/校验失败归调用方决定重写或切跳。
 */
export async function invokeCreativeHop(
  hop: CreativeLlmHop,
  instructions: string,
  input: unknown,
  save: Save,
  options: { timeoutMs?: number; maxTokens?: number; reasoningEffort?: "none" | "low" | "medium" } = {},
  deps: CreativeHopInvokeDeps = realDeps,
): Promise<CreativeHopResult> {
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized) > 2 * 1024 * 1024) throw new Error("完整创作上下文超过容量，未截断或调用模型");
  const inputSha256 = createHash("sha256").update(instructions).update(serialized).digest("hex");
  if (hop.gateway === "gemini_carbon") return invokeCarbonCreativeHop(hop, instructions, serialized, inputSha256, save, deps.carbon);
  const timeoutMs = options.timeoutMs ?? 180_000;
  const maxTokens = options.maxTokens ?? MANHUA_ADVISOR_MAX_OUTPUT_TOKENS;
  const reasoningEffort = options.reasoningEffort ?? manhuaAdvisorReasoningEffort(hop.modelName);
  await save("request", { model: hop.modelName, gateway: hop.gateway, label: hop.label, instructions, input, inputSha256, reasoningEffort, maxOutputTokens: maxTokens, timeoutMs });
  const startedAt = Date.now();
  let raw: InvokeResult;
  try {
    raw = await deps.invoke({
      provider: "openai",
      modelName: hop.modelName,
      openAiGateway: hop.gateway,
      reasoningEffort,
      max_tokens: maxTokens,
      abortSignal: AbortSignal.timeout(timeoutMs),
      response_format: { type: "json_object" },
      ...(hop.gateway === "auto" ? { openRouterProviderPreferences: { require_parameters: true } } : {}),
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: serialized },
      ],
    });
  } catch (error) {
    const e = error as { status?: number; statusCode?: number; name?: string; message?: string };
    const status = e.status ?? e.statusCode;
    await save("error", { model: hop.modelName, gateway: hop.gateway, status, name: e.name, message: e.message, elapsedMs: Date.now() - startedAt, usage: null });
    throw new CreativeHopTransportError(`${hop.label} 通道失败${status ? `（HTTP ${status}）` : e.name === "TimeoutError" || e.name === "AbortError" ? "（超时）" : ""}：${e.message || String(error)}`, status);
  }
  const elapsedMs = Date.now() - startedAt;
  await save("raw", { ...raw, elapsedMs });
  const finish = raw.choices?.[0]?.finish_reason;
  if (finish !== "stop") throw new CreativeHopTransportError(`${hop.label} 输出未完整结束（finish_reason=${String(finish)}），原回包已保留`);
  const text = extractFirstChoicePlainText(raw);
  if (!text.trim()) throw new CreativeHopTransportError(`${hop.label} 未返回正文，原回包已保留`);
  return { text, model: raw.model || hop.modelName, inputSha256, elapsedMs };
}

/**
 * Carbon 单通道跳：系统提示 + 完整上下文（同 GLM 跳），JSON 输出，输出上限 65536（含思考 token）。
 * 超时用 Carbon 文字类缺省 5 分钟（GLM 跳的 180 秒对 Carbon 过短）；429 同通道退避由调用层负责。
 * 通道层失败（超时 / 断线 / HTTP / 空回 / MAX_TOKENS / 拦截 / 限流用尽 / 未配置）一律 CreativeHopTransportError → 不重写、直接切下一跳。
 * 证据：request（同 GLM 跳）+ carbon-raw / carbon-error（含 usage 与估价，由调用层落）。
 */
async function invokeCarbonCreativeHop(
  hop: CreativeLlmHop, instructions: string, serialized: string, inputSha256: string, save: Save, carbonDeps?: GeminiCarbonDeps,
): Promise<CreativeHopResult> {
  const { callGeminiCarbonChannel, GeminiCarbonChannelError, GEMINI_CARBON_TEXT_TIMEOUT_MS, GEMINI_CARBON_DEFAULT_MAX_OUTPUT_TOKENS } = await import("./geminiCarbonCall");
  const channel = hop.carbonChannel;
  if (!channel) throw new CreativeHopTransportError(`${hop.label} 缺少通道`);
  const generationConfig = { maxOutputTokens: GEMINI_CARBON_DEFAULT_MAX_OUTPUT_TOKENS, responseMimeType: "application/json" };
  await save("request", { model: hop.modelName, gateway: hop.gateway, channel, label: hop.label, instructions, input: JSON.parse(serialized), inputSha256, maxOutputTokens: generationConfig.maxOutputTokens, timeoutMs: GEMINI_CARBON_TEXT_TIMEOUT_MS });
  const startedAt = Date.now();
  try {
    const result = await callGeminiCarbonChannel(channel, { model: hop.modelName, systemInstruction: instructions, parts: [{ text: serialized }], generationConfig }, {
      timeoutMs: GEMINI_CARBON_TEXT_TIMEOUT_MS, save, slug: "carbon", ...(carbonDeps ? { deps: carbonDeps } : {}),
    });
    console.info(`[creativeHop] ${hop.label} in=${result.usage.inputTokens} out=${result.usage.outputTokens} thoughts=${result.usage.thoughtsTokens} ${result.elapsedMs}ms`);
    return { text: result.text, model: hop.modelName, inputSha256, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof GeminiCarbonChannelError) throw new CreativeHopTransportError(`${hop.label} 通道失败（${error.reasonZh}）`, error.status);
    throw new CreativeHopTransportError(`${hop.label} 通道失败：${error instanceof Error ? error.message : String(error)}`);
  }
}
