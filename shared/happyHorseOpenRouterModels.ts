/**
 * OpenRouter Alibaba HappyHorse 1.1 · 画布成片 videoModel 与时长钳制。
 * 首页照片动画仍用 homePhotoTools 的 5/10/15；画布漫剧段默认钉 15s。
 *
 * @see https://openrouter.ai/alibaba/happyhorse-1.1
 */

export const OPENROUTER_HAPPYHORSE_1_1_MODEL_ID = "alibaba/happyhorse-1.1" as const;

/** 画布 videoModel id */
export const CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1 = "happyhorse-1.1" as const;

/** 画布成片：Happy Horse 最长 15s（与 Seedance 2.0 / H3 同口径） */
export const HAPPYHORSE_CANVAS_DURATION = {
  min: 5,
  max: 15,
  default: 15,
  allowed: [5, 10, 15] as const,
} as const;

export type HappyHorseCanvasDuration = (typeof HAPPYHORSE_CANVAS_DURATION.allowed)[number];

export const HAPPYHORSE_CANVAS_RESOLUTIONS = ["720p", "1080p"] as const;
export type HappyHorseCanvasResolution = (typeof HAPPYHORSE_CANVAS_RESOLUTIONS)[number];
export const HAPPYHORSE_CANVAS_RESOLUTION_DEFAULT: HappyHorseCanvasResolution = "720p";

/** 首帧图生；上游不吃多参考列表 */
export const HAPPYHORSE_REFERENCE_MAX = { image: 1 } as const;

export function isCanvasHappyHorseVideoModel(videoModel: string | null | undefined): boolean {
  const id = String(videoModel || "").trim().toLowerCase();
  return (
    id === CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1 ||
    id === "happyhorse" ||
    id === "happy-horse" ||
    id === "happyhorse-1.1" ||
    id === "alibaba/happyhorse-1.1"
  );
}

/**
 * 画布时长：>15 → 15；落在 5/10/15 则原样；其余就近钳到允许档（默认 15）。
 */
export function clampHappyHorseCanvasDuration(raw?: unknown): HappyHorseCanvasDuration {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return HAPPYHORSE_CANVAS_DURATION.default;
  if (n > HAPPYHORSE_CANVAS_DURATION.max) return HAPPYHORSE_CANVAS_DURATION.max;
  if (n <= 5) return 5;
  if (n <= 10) return 10;
  return 15;
}

export function normalizeHappyHorseCanvasResolution(raw?: unknown): HappyHorseCanvasResolution {
  const r = String(raw || "").trim().toLowerCase();
  if (r === "1080p" || r === "1k") return "1080p";
  return HAPPYHORSE_CANVAS_RESOLUTION_DEFAULT;
}
