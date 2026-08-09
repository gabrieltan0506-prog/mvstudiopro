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
 * 时长三档 5 / 10 / 15 秒（用户 2026-08-09 拍板，取代 2026-08-05 的「钉死 15s」）。
 *
 * 上游 H3 接受 4–15 秒整数（不收小数、字符串、`auto`、`-1`），默认 4；
 * 这里只开三个整档，避免导演卡节拍算出 7.3 秒这种上游不认的值。
 * 认不出的入参一律回落 15（既有调用点大多不传，保持原行为）。
 */
export const HAILUO_OPENROUTER_DURATION_CHOICES = [5, 10, 15] as const;
export type HailuoOpenRouterDurationSec = (typeof HAILUO_OPENROUTER_DURATION_CHOICES)[number];
export const HAILUO_OPENROUTER_FIXED_DURATION_SEC = 15 as const;
export const HAILUO_OPENROUTER_DURATION = {
  min: 5,
  max: 15,
  default: HAILUO_OPENROUTER_FIXED_DURATION_SEC,
} as const;

/**
 * 画质两档：草稿 768p / 高清 2K（上游 `quality` 只认这两个值）。
 *
 * 产品默认取 **2K**（用户 2026-08-09 拍板）。理由是实测账单反过来了：
 * H3 的 2K 上游 **$0.13/秒**，比 Seedance 2.0 的 720p（BytePlus $0.159/秒、
 * EvoLink $0.1986/秒）**还便宜**，更是 Seedance 4K（$1.0126/秒）的 1/7.8。
 * 而 Seedance 全系根本没有 2K 档，H3 是站内唯一能出 2K 的引擎——
 * 把它默认压到 768p，等于把最便宜的高画质藏起来。
 */
export const HAILUO_OPENROUTER_RESOLUTION_CHOICES = ["768p", "2K"] as const;
export type HailuoOpenRouterResolution = (typeof HAILUO_OPENROUTER_RESOLUTION_CHOICES)[number];
export const HAILUO_OPENROUTER_RESOLUTION_DEFAULT = "2K" as const;
/** @deprecated 旧的「恒 2K」常量，仅供尚未接上选档的调用点过渡 */
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
 * 归一到 5 / 10 / 15 三档。
 *
 * 不传、传不出数、或传了上游不认的值（小数、7、`auto`）→ 回落 15，
 * 与既有「恒 15」的调用点行为一致；传了就近取档，不四舍五入到中间值。
 */
export function clampHailuoOpenRouterDuration(raw?: unknown): HailuoOpenRouterDurationSec {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return HAILUO_OPENROUTER_DURATION.default;
  let picked: HailuoOpenRouterDurationSec = HAILUO_OPENROUTER_DURATION_CHOICES[0];
  for (const choice of HAILUO_OPENROUTER_DURATION_CHOICES) {
    if (Math.abs(choice - n) < Math.abs(picked - n)) picked = choice;
  }
  return picked;
}

/** 只有显式要草稿档才给 768p；其余（含认不出的值）一律 2K —— 2K 才是 H3 的默认档 */
export function normalizeHailuoOpenRouterResolution(raw?: unknown): HailuoOpenRouterResolution {
  const q = String(raw || "").trim().toLowerCase();
  if (q === "768p") return "768p";
  return HAILUO_OPENROUTER_RESOLUTION_DEFAULT;
}

export function normalizeHailuoOpenRouterAspectRatio(raw: unknown): string {
  const a = String(raw || "16:9").trim();
  return (HAILUO_OPENROUTER_ASPECT_RATIOS as readonly string[]).includes(a) ? a : "16:9";
}
