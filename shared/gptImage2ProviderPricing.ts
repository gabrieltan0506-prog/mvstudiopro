/**
 * GPT-image-2：OpenAI 官方 vs EvoLink 牌价对照（2026-08 公开页快照）。
 * 单位统一为 USD / 1K tokens，便于直接比较。
 *
 * OpenAI（developers.openai.com pricing）：
 * - Image output $30 / 1M = $0.030 / 1K
 * - Image input  $8  / 1M = $0.008 / 1K
 * - Text input   $5  / 1M = $0.005 / 1K
 *
 * EvoLink（evolink.ai/gpt-image-2）：
 * - Image output $0.027 / 1K
 * - Image input  $0.0072 / 1K
 * - Text input   $0.0045 / 1K
 *
 * 结论：EvoLink 全项更低 → 默认主路径 EvoLink，OpenAI 作 fallback。
 * 可用 GPT_IMAGE2_PROVIDER=openai|evolink|auto 强制；auto 按本表。
 */

export type GptImage2UpstreamProvider = "evolink" | "openai";

export type GptImage2TokenRatesUsdPer1k = {
  imageOutput: number;
  imageInput: number;
  textInput: number;
};

/** 核对日：2026-08-08；改价时同步更新本表与单测。 */
export const GPT_IMAGE2_OPENAI_RATES_USD_PER_1K: GptImage2TokenRatesUsdPer1k = {
  imageOutput: 0.03,
  imageInput: 0.008,
  textInput: 0.005,
};

export const GPT_IMAGE2_EVOLINK_RATES_USD_PER_1K: GptImage2TokenRatesUsdPer1k = {
  imageOutput: 0.027,
  imageInput: 0.0072,
  textInput: 0.0045,
};

/** 用 image output 单价比主档（出图成本大头）。 */
export function compareGptImage2ProviderCost(): {
  cheaper: GptImage2UpstreamProvider;
  dearer: GptImage2UpstreamProvider;
  openaiImageOutput: number;
  evolinkImageOutput: number;
} {
  const o = GPT_IMAGE2_OPENAI_RATES_USD_PER_1K.imageOutput;
  const e = GPT_IMAGE2_EVOLINK_RATES_USD_PER_1K.imageOutput;
  if (e <= o) {
    return { cheaper: "evolink", dearer: "openai", openaiImageOutput: o, evolinkImageOutput: e };
  }
  return { cheaper: "openai", dearer: "evolink", openaiImageOutput: o, evolinkImageOutput: e };
}

/**
 * auto：便宜优先；显式 openai/evolink 则固定主路径（仍可走另一家 fallback，除非对方未配置）。
 */
export function resolveGptImage2ProviderOrder(
  providerMode: string | null | undefined = "auto",
): GptImage2UpstreamProvider[] {
  const mode = String(providerMode || "auto").trim().toLowerCase();
  const { cheaper, dearer } = compareGptImage2ProviderCost();
  if (mode === "openai") return ["openai", "evolink"];
  if (mode === "evolink") return ["evolink", "openai"];
  return [cheaper, dearer];
}
