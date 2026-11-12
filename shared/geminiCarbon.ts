/**
 * Gemini 4 Carbon（1111 站长令接入）：模型标识、通道顺序、单价常量的一处真源。
 *
 * 站长口径：「Gemini 4 Carbon 不用去想 OpenRouter，只能走 EvoLink、Vertex、Gemini API」；
 * 属贵档（输出含思考 token、偏慢），**只在用户主动选择时调用**——任何缺省路径都不得自动落到它。
 *
 * 1111 09:00Z 工作机实测：模型标识 `gemini-4-carbon`（Gemini API 与 EvoLink 模型列表均有；`-preview` 三通道 404）；
 * EvoLink 200 / 2.2s，Gemini API 200 / 8.3s，Vertex（global）90 秒无回应 → 缺省通道顺序 EvoLink → Gemini API → Vertex，
 * 做成 env 可配，Vertex 复测通过后可调回首位。
 *
 * 模型名不写死：各调用领域经 shared/geminiModelConfig.ts 解析（缺省 gemini-4-carbon，env 可改）；本文件的
 * GEMINI_CARBON_MODEL 只作「Carbon 车道」的历史身份（系列后缀 -g4c、单价表键），不决定新请求用哪个模型。
 */

/** Carbon 车道身份（单价表键、模板学习系列后缀 -g4c）；新请求的模型由领域配置解析。 */
export const GEMINI_CARBON_MODEL = "gemini-4-carbon" as const;

export const GEMINI_CARBON_CHANNELS = ["evolink", "gemini_api", "vertex"] as const;
export type GeminiCarbonChannel = (typeof GEMINI_CARBON_CHANNELS)[number];
/** 缺省通道顺序：站长 2026-11-11 指定先走 Vertex（当日连通测试 Vertex global 曾 90 秒无回应，故调用层对「非末位的 Vertex」设较短超时后再切下一通道）。env `GEMINI_CARBON_CHANNEL_ORDER` 可改，如 "vertex,evolink,gemini_api"。 */
export const GEMINI_CARBON_DEFAULT_CHANNEL_ORDER: readonly GeminiCarbonChannel[] = ["vertex", "gemini_api", "evolink"];
export const GEMINI_CARBON_CHANNEL_ORDER_ENV = "GEMINI_CARBON_CHANNEL_ORDER" as const;

/**
 * 解析逗号分隔的通道顺序：去空白、转小写、去重；不认识的项忽略（并 warn）；只允许 allowed 内的通道。
 * 结果为空（未设 / 全无效）时回落 fallback。
 */
export function parseGeminiCarbonChannelOrder(
  raw: unknown,
  fallback: readonly GeminiCarbonChannel[] = GEMINI_CARBON_DEFAULT_CHANNEL_ORDER,
  allowed: readonly GeminiCarbonChannel[] = GEMINI_CARBON_CHANNELS,
): GeminiCarbonChannel[] {
  const items = String(raw ?? "").split(",").map((item) => item.trim().toLowerCase().replace(/-/g, "_")).filter(Boolean);
  const out: GeminiCarbonChannel[] = [];
  for (const item of items) {
    if (!(allowed as readonly string[]).includes(item)) {
      console.warn(`[geminiCarbon] 通道顺序里的「${item}」不可用（只认 ${allowed.join(" / ")}），已忽略`);
      continue;
    }
    if (!out.includes(item as GeminiCarbonChannel)) out.push(item as GeminiCarbonChannel);
  }
  return out.length ? out : [...fallback];
}

/**
 * 单价（美元 / 百万 token）。首发价到 2026-11-30；**2026-12-01 起翻倍为 $4 / $20**——到期改这两个常量即可。
 * 输出单价覆盖思考 token（Carbon 先花思考 token，计费按 输出 + 思考）。上下文约 105 万 token。
 */
export const GEMINI_CARBON_PRICE_USD_PER_M = { input: 2, output: 10 } as const;
/** 2026-12-01 起的标准价（首发价翻倍）；成本估算报告里同时给出两档。 */
export const GEMINI_CARBON_STANDARD_PRICE_USD_PER_M = { input: 4, output: 20 } as const;
export const GEMINI_CARBON_PROMO_PRICE_UNTIL = "2026-11-30" as const;

export type GeminiCarbonUsage = { inputTokens: number; outputTokens: number; thoughtsTokens: number; totalTokens: number };

/** 按单价估算美元成本（输出与思考 token 同按输出价）。仅用于证据与日志展示，不参与扣费。 */
export function estimateGeminiCarbonCostUsd(
  usage: Pick<GeminiCarbonUsage, "inputTokens" | "outputTokens" | "thoughtsTokens">,
  price: { input: number; output: number } = GEMINI_CARBON_PRICE_USD_PER_M,
): number {
  const input = Math.max(0, Number(usage.inputTokens) || 0);
  const output = Math.max(0, Number(usage.outputTokens) || 0) + Math.max(0, Number(usage.thoughtsTokens) || 0);
  return Math.round(((input * price.input + output * price.output) / 1_000_000) * 1_000_000) / 1_000_000;
}

/** Gemini 原生 usageMetadata → 统一用量（缺项按 0）。 */
export function readGeminiUsage(payload: unknown): GeminiCarbonUsage {
  const meta = (payload as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata ?? {};
  const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  return {
    inputTokens: num(meta.promptTokenCount),
    outputTokens: num(meta.candidatesTokenCount),
    thoughtsTokens: num(meta.thoughtsTokenCount),
    totalTokens: num(meta.totalTokenCount),
  };
}

export function addGeminiUsage(a: GeminiCarbonUsage, b: GeminiCarbonUsage): GeminiCarbonUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thoughtsTokens: a.thoughtsTokens + b.thoughtsTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

export const EMPTY_GEMINI_USAGE: GeminiCarbonUsage = Object.freeze({ inputTokens: 0, outputTokens: 0, thoughtsTokens: 0, totalTokens: 0 });
