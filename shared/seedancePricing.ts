/**
 * Seedance 2.0（fal image-to-video）动态计价 — 与 fal 公开说明对齐：
 * - 720p：$0.3024 / 秒（文档原句针对 720p）
 * - 另计：$0.014 / 1000 tokens
 * - tokens = (height × width × duration秒 × 24) / 1024
 *
 * 1080p 的「按秒」部分文档未单列：此处按短边相对 720p 的比例放大时间分量（1.5×），
 * token 项已由像素计入，避免与像素增长重复乘算。
 *
 * 积分：`报价CNY = usdTotal × cnyPerUsd × quoteMarkup`，`credits = max(1, round(报价CNY / creditDivisor))`。
 * 默认 creditDivisor=0.7、cnyPerUsd=7.2、quoteMarkup=4.5 与产品侧历史讨论对齐，可用环境变量在服务端覆盖。
 */

export type SeedanceResolutionPricing = "720p" | "1080p";

export type SeedanceAspectRatioPricing =
  | "auto"
  | "21:9"
  | "16:9"
  | "4:3"
  | "1:1"
  | "3:4"
  | "9:16";

export const SEEDANCE_FAL_USD_PER_SEC_720P = 0.3024;
export const SEEDANCE_FAL_USD_PER_1K_TOKENS = 0.014;

export const SEEDANCE_ASPECT_RATIOS: SeedanceAspectRatioPricing[] = [
  "auto",
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
];

export function parseAspectRatioParts(aspect: string): { w: number; h: number } {
  const a = String(aspect || "").trim();
  if (!a || a === "auto") return { w: 16, h: 9 };
  const m = a.match(/^(\d+)\s*:\s*(\d+)$/);
  if (!m) return { w: 16, h: 9 };
  const w = Math.max(1, Number(m[1]) || 16);
  const h = Math.max(1, Number(m[2]) || 9);
  return { w, h };
}

/**
 * 以「短边 = 720 或 1080」对齐常见横纵分辨率（与分镜工程常用约定一致）。
 */
export function seedanceOutputDimensions(
  resolution: SeedanceResolutionPricing,
  aspect: string,
): { width: number; height: number } {
  const S = resolution === "1080p" ? 1080 : 720;
  const { w, h } = parseAspectRatioParts(aspect);
  if (w === h) {
    return { width: S, height: S };
  }
  if (w > h) {
    const height = S;
    const width = Math.round((S * w) / h);
    return { width, height };
  }
  const width = S;
  const height = Math.round((S * h) / w);
  return { width, height };
}

export function estimateSeedanceTokens(width: number, height: number, durationSec: number): number {
  return (width * height * durationSec * 24) / 1024;
}

export function seedanceFalUsdPerSecond(resolution: SeedanceResolutionPricing): number {
  if (resolution === "720p") return SEEDANCE_FAL_USD_PER_SEC_720P;
  return SEEDANCE_FAL_USD_PER_SEC_720P * (1080 / 720);
}

export type SeedancePricingEstimate = {
  width: number;
  height: number;
  durationSec: number;
  tokens: number;
  usdSecondsComponent: number;
  usdTokensComponent: number;
  usdTotal: number;
};

export function estimateSeedanceFalUsd(input: {
  resolution: SeedanceResolutionPricing;
  aspectRatio: string;
  durationSec: number;
}): SeedancePricingEstimate {
  const { width, height } = seedanceOutputDimensions(input.resolution, input.aspectRatio);
  const d = Math.max(1, Math.floor(Number(input.durationSec) || 8));
  const tokens = estimateSeedanceTokens(width, height, d);
  const usdSecondsComponent = d * seedanceFalUsdPerSecond(input.resolution);
  const usdTokensComponent = (tokens / 1000) * SEEDANCE_FAL_USD_PER_1K_TOKENS;
  const usdTotal = usdSecondsComponent + usdTokensComponent;
  return {
    width,
    height,
    durationSec: d,
    tokens,
    usdSecondsComponent,
    usdTokensComponent,
    usdTotal,
  };
}

export type SeedanceCreditParams = {
  resolution: SeedanceResolutionPricing;
  aspectRatio: string;
  durationSec: number;
  /** 默认 7.2 */
  cnyPerUsd?: number;
  /** 默认 4.5（毛利系数，可调） */
  quoteMarkup?: number;
  /** 默认 0.7 → credits = round(报价/0.7) */
  creditDivisor?: number;
};

export function estimateSeedanceWorkflowCredits(params: SeedanceCreditParams): {
  credits: number;
  estimate: SeedancePricingEstimate;
  quoteCny: number;
} {
  const cnyPerUsd = params.cnyPerUsd ?? 7.2;
  const quoteMarkup = params.quoteMarkup ?? 4.5;
  const creditDivisor = params.creditDivisor ?? 0.7;
  const estimate = estimateSeedanceFalUsd({
    resolution: params.resolution,
    aspectRatio: params.aspectRatio,
    durationSec: params.durationSec,
  });
  const quoteCny = estimate.usdTotal * cnyPerUsd * quoteMarkup;
  const credits = Math.max(1, Math.round(quoteCny / creditDivisor));
  return { credits, estimate, quoteCny };
}

/** 21:9 在 fal 动态积分上 ×1.56（+56%）；16:9 / 4:3 / 3:4 不低于同分辨率、同时长的 16:9 动态价（积分不随窄画幅下降）。 */
const SEEDANCE_ASPECT_21_9_CREDIT_MULTIPLIER = 1.56;
const SEEDANCE_CREDIT_FLOOR_ASPECTS = new Set(["16:9", "4:3", "3:4"]);

export function estimateSeedanceWorkflowCreditsForProduct(params: SeedanceCreditParams): {
  credits: number;
  estimate: SeedancePricingEstimate;
  quoteCny: number;
} {
  const aspect = String(params.aspectRatio || "").trim();
  const base = estimateSeedanceWorkflowCredits(params);
  let credits = base.credits;

  if (aspect === "21:9") {
    credits = Math.max(1, Math.round(credits * SEEDANCE_ASPECT_21_9_CREDIT_MULTIPLIER));
  } else if (SEEDANCE_CREDIT_FLOOR_ASPECTS.has(aspect)) {
    const floorCredits = estimateSeedanceWorkflowCredits({
      ...params,
      aspectRatio: "16:9",
    }).credits;
    if (credits < floorCredits) {
      credits = floorCredits;
    }
  }

  return {
    credits,
    estimate: base.estimate,
    quoteCny: base.quoteCny,
  };
}

/** 生成定价表（720p+1080p × 全部比例 × 常用时长），供后台/文档/调试 */
export function buildSeedancePricingTable(durationList: number[] = [5, 8, 10, 15]): Array<{
  resolution: SeedanceResolutionPricing;
  aspectRatio: SeedanceAspectRatioPricing;
  durationSec: number;
  width: number;
  height: number;
  tokensRounded: number;
  usdSeconds: number;
  usdTokens: number;
  usdTotal: number;
  credits: number;
  quoteCny: number;
}> {
  const resolutions: SeedanceResolutionPricing[] = ["720p", "1080p"];
  const rows: Array<{
    resolution: SeedanceResolutionPricing;
    aspectRatio: SeedanceAspectRatioPricing;
    durationSec: number;
    width: number;
    height: number;
    tokensRounded: number;
    usdSeconds: number;
    usdTokens: number;
    usdTotal: number;
    credits: number;
    quoteCny: number;
  }> = [];

  for (const resolution of resolutions) {
    for (const aspectRatio of SEEDANCE_ASPECT_RATIOS) {
      for (const durationSec of durationList) {
        const { credits, estimate, quoteCny } = estimateSeedanceWorkflowCreditsForProduct({
          resolution,
          aspectRatio,
          durationSec,
        });
        rows.push({
          resolution,
          aspectRatio,
          durationSec,
          width: estimate.width,
          height: estimate.height,
          tokensRounded: Math.round(estimate.tokens),
          usdSeconds: Number(estimate.usdSecondsComponent.toFixed(4)),
          usdTokens: Number(estimate.usdTokensComponent.toFixed(4)),
          usdTotal: Number(estimate.usdTotal.toFixed(4)),
          credits,
          quoteCny: Number(quoteCny.toFixed(2)),
        });
      }
    }
  }
  return rows;
}
