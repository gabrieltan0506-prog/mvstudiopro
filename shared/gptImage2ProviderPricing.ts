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
 * 牌价对照仅供成本核算；主路径顺序由 0909 用户拍板固定（见 GPT_IMAGE2_PROVIDER_ORDER_DEFAULT），
 * `GPT_IMAGE2_PROVIDER=openai|wavespeed|evolink` 只改主路径。
 */

export type GptImage2UpstreamProvider = "openai" | "wavespeed" | "evolink";

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
 * 0910 用户拍板（覆盖 0909）：固定 **OpenAI 官方（gpt-image-2.5）→ EvoLink（gpt-image-2.5 已接通）→ WaveSpeed（gpt-image-2）兜底**，
 * 画布、资产、知识卡全站一致。显式 openai/wavespeed/evolink 只改主路径，其余两家按此序兜底；
 * `auto` 与未设都等于官方优先。WaveSpeed 牌价（2026-09 查实）：medium+2k $0.10/张，high+4k $0.72/张。
 */
export const GPT_IMAGE2_PROVIDER_ORDER_DEFAULT: readonly GptImage2UpstreamProvider[] = [
  "openai",
  "evolink",
  "wavespeed",
];

export function resolveGptImage2ProviderOrder(
  providerMode: string | null | undefined = "auto",
): GptImage2UpstreamProvider[] {
  const mode = String(providerMode || "auto").trim().toLowerCase();
  const rest = (first: GptImage2UpstreamProvider) =>
    [first, ...GPT_IMAGE2_PROVIDER_ORDER_DEFAULT.filter((p) => p !== first)];
  if (mode === "openai" || mode === "wavespeed" || mode === "evolink") return rest(mode);
  return [...GPT_IMAGE2_PROVIDER_ORDER_DEFAULT];
}
