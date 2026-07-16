/**
 * EvoLink Seedance 模型名与产品闸门。
 *
 * 文档：
 * - 2.0：text / image / reference → video（时长 4–15s）
 * - 2.5：同上三模式（时长 4–30s）；官方标注尚未上线，产品默认不开放
 *
 * @see https://docs.evolink.ai/cn/api-manual/video-series/seedance2.0/
 * @see https://docs.evolink.ai/en/api-manual/video-series/seedance2.5/
 */

export const SEEDANCE_20_MODELS = {
  textToVideo: "seedance-2.0-text-to-video",
  imageToVideo: "seedance-2.0-image-to-video",
  referenceToVideo: "seedance-2.0-reference-to-video",
} as const;

export const SEEDANCE_25_MODELS = {
  textToVideo: "seedance-2.5-text-to-video",
  imageToVideo: "seedance-2.5-image-to-video",
  referenceToVideo: "seedance-2.5-reference-to-video",
} as const;

export type SeedanceEvolinkVersion = "2.0" | "2.5";
export type SeedanceEvolinkMode = "text_to_video" | "image_to_video" | "reference_to_video";

/** 产品默认时长：对齐「约 15 秒」漫剧/短镜口径；仍受各版 API 上下限约束 */
export const SEEDANCE_PRODUCT_DEFAULT_DURATION_SEC = 15;

export const SEEDANCE_20_DURATION = { min: 4, max: 15, default: SEEDANCE_PRODUCT_DEFAULT_DURATION_SEC } as const;
export const SEEDANCE_25_DURATION = { min: 4, max: 30, default: SEEDANCE_PRODUCT_DEFAULT_DURATION_SEC } as const;

/**
 * 硬开关：EvoLink 正式上线 Seedance 2.5 前保持 false。
 * 内部联调可设环境变量 SEEDANCE_25_ENABLED=1（仅服务端）。
 */
export const SEEDANCE_25_PUBLICLY_ENABLED = false;

export const SEEDANCE_25_COMING_SOON_LABEL_EN = "Seedance 2.5 Coming soon on MV Studio Pro";
export const SEEDANCE_25_COMING_SOON_LABEL_ZH = "Seedance 2.5 即将登陆 MV Studio Pro";

export function resolveSeedanceModelId(
  version: SeedanceEvolinkVersion,
  mode: SeedanceEvolinkMode,
): string {
  const table = version === "2.5" ? SEEDANCE_25_MODELS : SEEDANCE_20_MODELS;
  if (mode === "image_to_video") return table.imageToVideo;
  if (mode === "reference_to_video") return table.referenceToVideo;
  return table.textToVideo;
}

export function clampSeedanceDuration(
  version: SeedanceEvolinkVersion,
  raw: unknown,
): number {
  const lim = version === "2.5" ? SEEDANCE_25_DURATION : SEEDANCE_20_DURATION;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return lim.default;
  return Math.min(lim.max, Math.max(lim.min, n));
}

export function inferSeedanceMode(input: {
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
}): SeedanceEvolinkMode {
  const images = (input.imageUrls || []).filter(Boolean);
  const videos = (input.videoUrls || []).filter(Boolean);
  const audios = (input.audioUrls || []).filter(Boolean);
  if (videos.length > 0 || audios.length > 0 || images.length > 1) {
    return "reference_to_video";
  }
  if (images.length === 1) return "image_to_video";
  return "text_to_video";
}
