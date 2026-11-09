import { createHash } from "node:crypto";
import { invokeLLM, extractFirstChoicePlainText, type InvokeParams, type InvokeResult } from "../_core/llm";
import { MANHUA_ADVISOR_MAX_OUTPUT_TOKENS, manhuaAdvisorReasoningEffort } from "./openrouterDeepSeekV41Flash";

/**
 * 创作顾问（MV 分镜 / 新歌 / 学习）每一次 LLM 调用的三跳 fallback（用户规矩 2026-11-09 · LLM调用三层fallback）：
 * GLM 5.3 FlashX@EvoLink → GLM 5.3 FlashX@OpenRouter（传输层锁 Z.AI）→ DeepSeek V4.1 Flash 1017@OpenRouter（与 stockFootage/keywords.ts 同通道）。
 * 通道挂 / 超时 / 429 与「输出校验不过（写坏）」都算失败；每跳先带原因重写一次再切下一跳。
 * 每跳的 request / raw / decoded / repaired / rejected 分别永久落盘，由调用方前缀 `compose-hop-<n>-<model>-` 等命名。
 */
export type CreativeLlmHop = {
  readonly modelName: string;
  readonly gateway: "auto" | "evolink_flash_only";
  readonly label: string;
};

export const CREATIVE_LLM_HOPS: readonly CreativeLlmHop[] = [
  { modelName: "glm-5.3-flashx", gateway: "evolink_flash_only", label: "GLM 5.3 FlashX · EvoLink" },
  { modelName: "z-ai/glm-5.3-flashx", gateway: "auto", label: "GLM 5.3 FlashX · OpenRouter" },
  { modelName: "deepseek/deepseek-v4.1-flash-1017", gateway: "auto", label: "DeepSeek V4.1 Flash 1017 · OpenRouter" },
];

/** 证据对象名里用的模型短名：`z-ai/glm-5.3-flashx` → `z-ai_glm-5.3-flashx`。 */
export function creativeHopSlug(hop: CreativeLlmHop): string {
  return hop.modelName.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export type Save = (name: string, value: unknown) => Promise<unknown>;

/** 通道层失败（HTTP 错误 / 超时 / 截断 / 模型回执不符）：不做带原因重写，直接切下一跳。 */
export class CreativeHopTransportError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "CreativeHopTransportError";
  }
}

export type CreativeHopInvokeDeps = { invoke: (params: InvokeParams) => Promise<InvokeResult> };
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
