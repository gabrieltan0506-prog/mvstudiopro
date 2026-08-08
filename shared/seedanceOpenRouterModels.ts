/**
 * OpenRouter Seedance 2.0 / 2.0-fast 模型与参数钳制。
 * 前台文案见 canvasTypes / manhuaSeedanceLayout（正式产品名）；此处仅内部 slug。
 *
 * @see https://openrouter.ai/bytedance/seedance-2.0
 * @see https://openrouter.ai/bytedance/seedance-2.0-fast
 */

export type SeedanceOpenRouterVariant = "2.0" | "2.0-fast";

export const SEEDANCE_OPENROUTER_MODELS = {
  "2.0": "bytedance/seedance-2.0",
  "2.0-fast": "bytedance/seedance-2.0-fast",
} as const;

/** 与 EvoLink 2.0 时长口径对齐：4–15s，产品默认 15 */
export const SEEDANCE_OPENROUTER_DURATION = { min: 4, max: 15, default: 15 } as const;

/**
 * Seedance 2.0 多模态参考的官方上限：图 9 / 视频 3 / 音频 3。
 * prompt 里用 @image1~@image9 引用，序号必须与实际发出的数组同序。
 * 别再各处拍脑袋写 4 或 6——喂图不计费（计费只看输出分辨率×时长），砍名额纯亏一致性。
 */
export const SEEDANCE_REFERENCE_MAX = { image: 9, video: 3, audio: 3 } as const;

export const SEEDANCE_25_COMING_SOON_LABEL_EN = "Seedance 2.5 Coming soon on MV Studio Pro";
export const SEEDANCE_25_COMING_SOON_LABEL_ZH = "Seedance 2.5 即将登陆 MV Studio Pro";

/** 产品可选：标准 / 快速。`2.0-mini` 仅内部探针解析用，不对产品暴露。 */
export type SeedanceProductVersion = "2.0" | "2.0-fast" | "2.0-mini" | "2.5";

export function isOpenRouterSeedanceVersion(
  version: string | null | undefined,
): version is SeedanceOpenRouterVariant {
  return version === "2.0" || version === "2.0-fast";
}

export function parseSeedanceProductVersion(raw: unknown): SeedanceProductVersion {
  const v = String(raw || "2.0").trim().toLowerCase();
  if (v === "2.0-fast" || v === "fast" || v === "2.0fast") return "2.0-fast";
  // 保留解析以便探针传 version=2.0-mini；产品请求会在 jobs 层改走 fast
  if (v === "2.0-mini" || v === "mini" || v === "2.0mini") return "2.0-mini";
  if (v === "2.5" || v === "25") return "2.5";
  return "2.0";
}

export function resolveSeedanceOpenRouterModelId(variant: SeedanceOpenRouterVariant): string {
  return SEEDANCE_OPENROUTER_MODELS[variant];
}

export function clampSeedanceOpenRouterDuration(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return SEEDANCE_OPENROUTER_DURATION.default;
  return Math.min(
    SEEDANCE_OPENROUTER_DURATION.max,
    Math.max(SEEDANCE_OPENROUTER_DURATION.min, n),
  );
}

/** OpenRouter Seedance：480p / 720p / 1080p（fast 侧常见 480/720） */
export function normalizeSeedanceOpenRouterQuality(
  variant: SeedanceOpenRouterVariant,
  raw: unknown,
): "480p" | "720p" | "1080p" | "2K" | "4K" {
  const q = String(raw || "720p").trim().toLowerCase();
  // 快速档定位是「便宜快」，不给高画质选项，免得比标准档还贵
  if (variant === "2.0-fast") {
    return q === "480p" ? "480p" : "720p";
  }
  if (q === "480p" || q === "1080p") return q;
  // Seedance 按像素计费，2K/4K 单价是 720p 的 4 倍与 9 倍，售价见 canvasGenerationPricing
  if (q === "1k") return "1080p";
  if (q === "2k") return "2K";
  if (q === "4k") return "4K";
  return "720p";
}

export function normalizeSeedanceOpenRouterAspectRatio(raw: unknown): string {
  const a = String(raw || "16:9").trim();
  const allowed = new Set([
    "16:9",
    "9:16",
    "1:1",
    "4:3",
    "3:4",
    "3:2",
    "2:3",
    "21:9",
    "9:21",
  ]);
  return allowed.has(a) ? a : "16:9";
}

/** 画布 videoModel id → OpenRouter variant */
export function seedanceVariantFromCanvasVideoModel(
  videoModel: string | null | undefined,
): SeedanceOpenRouterVariant | null {
  const id = String(videoModel || "").trim();
  if (id === "seedance-2.0-fast") return "2.0-fast";
  if (id === "seedance-2.0") return "2.0";
  return null;
}
