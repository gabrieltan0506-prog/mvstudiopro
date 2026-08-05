/**
 * OpenRouter MiniMax H3（Hailuo 3）模型与参数钳制。
 * 前台文案见 canvasTypes（成片·H3）；此处仅内部 slug。
 * 调用走 OpenRouter（非 EvoLink）；EvoLink 页仅作能力参考。
 *
 * @see https://openrouter.ai/minimax/hailuo-3
 * @see https://evolink.ai/hailuo-3
 */

export const HAILUO_OPENROUTER_MODEL_ID = "minimax/hailuo-3" as const;

/** 画布 videoModel id */
export const CANVAS_VIDEO_MODEL_HAILUO_H3 = "minimax-hailuo-3" as const;

/**
 * 时长固定 15 秒（用户 2026-08-05 明文：H3 钉死 15s，不再随导演卡节拍浮动）。
 * OpenRouter 上游可接受 5–15s，这里只用上限；分辨率仅 2K。
 */
export const HAILUO_OPENROUTER_FIXED_DURATION_SEC = 15 as const;
export const HAILUO_OPENROUTER_DURATION = {
  min: HAILUO_OPENROUTER_FIXED_DURATION_SEC,
  max: HAILUO_OPENROUTER_FIXED_DURATION_SEC,
  default: HAILUO_OPENROUTER_FIXED_DURATION_SEC,
} as const;
export const HAILUO_OPENROUTER_RESOLUTION = "2K" as const;

export const HAILUO_OPENROUTER_ASPECT_RATIOS = [
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
] as const;

/** 首帧 / 末帧 + 参考图（OpenRouter 对非 Seedance 供应商会忽略音/视频参考） */
export const HAILUO_REFERENCE_MAX = { image: 9 } as const;

export function isCanvasHailuoH3VideoModel(videoModel: string | null | undefined): boolean {
  const id = String(videoModel || "").trim().toLowerCase();
  return (
    id === CANVAS_VIDEO_MODEL_HAILUO_H3 ||
    id === "hailuo-3" ||
    id === "minimax/hailuo-3" ||
    id === "minimax-h3" ||
    id === "h3"
  );
}

/**
 * H3 一律 15 秒：入参保留是为了兼容既有调用点（画布导演卡节拍、api/jobs 请求体），
 * 但无论传什么都返回固定值，避免某条路径漏改就退回 10s。
 */
export function clampHailuoOpenRouterDuration(_raw?: unknown): number {
  return HAILUO_OPENROUTER_FIXED_DURATION_SEC;
}

export function normalizeHailuoOpenRouterAspectRatio(raw: unknown): string {
  const a = String(raw || "16:9").trim();
  return (HAILUO_OPENROUTER_ASPECT_RATIOS as readonly string[]).includes(a) ? a : "16:9";
}
