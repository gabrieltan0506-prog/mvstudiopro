/**
 * WaveSpeed · ByteDance Video Upscaler（视频超分）。
 *
 * 字节自研超分模型，专门针对 Seedance / Sora 这类 AI 生成视频调优：细节恢复 + 去振铃，
 * 时序稳定不闪烁，风格与 Seedance 高度契合——这正是我们需要的，因为站内成片全是 Seedance 出的。
 *
 * 为什么必须走这条路（2026-08-09 实测）：
 * - **2K 在 Seedance 全系根本不存在**。上游原话：
 *   `Unsupported resolution '2K' for BytePlus Seedance. Supported values: 480p, 720p, 1080p, 4K`
 *   2.5 更是只到 720p（`only supports quality=[480p 720p]`）。所以 2K 只能靠超分。
 * - 4K 虽然 2.0 标准档有，但原生 4K 生成 **$1.0126/秒**，而
 *   「720p 生成 $0.1986 + 超分到 4K $0.0288」= **$0.2274/秒**，便宜 4.45 倍。
 *   超分只占总成本的 12.7%，贵的一直是生成本身。
 *
 * 因此画质不再由生成引擎单独决定，拆成两段：**生成档（480p/720p/1080p）+ 超分档（2K/4K）**。
 * 只能出 720p 的 2.5 也因此能交付 2K/4K。
 *
 * @see https://wavespeed.ai/models/bytedance/video-upscaler
 */

export const WAVESPEED_API_BASE_DEFAULT = "https://api.wavespeed.ai/api/v3" as const;
export const WAVESPEED_VIDEO_UPSCALE_PATH = "/bytedance/video-upscaler" as const;

/** 上游 `target_resolution` 只认这三个小写值 */
export const WAVESPEED_UPSCALE_TARGETS = ["1080p", "2k", "4k"] as const;
export type WavespeedUpscaleTarget = (typeof WAVESPEED_UPSCALE_TARGETS)[number];

/** 每秒单价（美元）。最低按 5 秒计，单任务最长 600 秒。 */
export const WAVESPEED_UPSCALE_USD_PER_SEC: Readonly<Record<WavespeedUpscaleTarget, number>> = {
  "1080p": 0.0072,
  "2k": 0.0144,
  "4k": 0.0288,
};
export const WAVESPEED_UPSCALE_MIN_BILLED_SEC = 5 as const;
export const WAVESPEED_UPSCALE_MAX_BILLED_SEC = 600 as const;

/**
 * 源分辨率 → 可选超分档。
 *
 * 720p 可升 1080p/2K/4K；1080p 可升 2K/4K。已经是 2K/4K 的没有再升的档，
 * 提交上去只会白花钱，所以这里直接判空，让调用方在扣费前就挡住。
 */
const UPSCALE_TARGETS_BY_SOURCE: Readonly<Record<string, readonly WavespeedUpscaleTarget[]>> = {
  "480p": ["1080p", "2k", "4k"],
  "720p": ["1080p", "2k", "4k"],
  "768p": ["1080p", "2k", "4k"],
  "1080p": ["2k", "4k"],
};

export function wavespeedUpscaleTargetsForSource(
  sourceResolution?: string | null,
): readonly WavespeedUpscaleTarget[] {
  const key = String(sourceResolution || "").trim().toLowerCase();
  return UPSCALE_TARGETS_BY_SOURCE[key] ?? [];
}

export function canWavespeedUpscale(
  sourceResolution: string | null | undefined,
  target: string | null | undefined,
): boolean {
  const t = normalizeWavespeedUpscaleTarget(target);
  if (!t) return false;
  return wavespeedUpscaleTargetsForSource(sourceResolution).includes(t);
}

/** 画布用「2K/4K」大写口径，上游要小写；认不出返回 null，由调用方拒绝而不是猜一个 */
export function normalizeWavespeedUpscaleTarget(raw: unknown): WavespeedUpscaleTarget | null {
  const q = String(raw || "").trim().toLowerCase();
  if (q === "1080p" || q === "1k") return "1080p";
  if (q === "2k") return "2k";
  if (q === "4k") return "4k";
  return null;
}

/** 上游实扣（美元）：按时长 × 档位，钳到 [5, 600] 秒 */
export function wavespeedUpscaleUsdCost(
  target: WavespeedUpscaleTarget,
  durationSec: number,
): number {
  const raw = Number(durationSec);
  const sec = Math.min(
    WAVESPEED_UPSCALE_MAX_BILLED_SEC,
    Math.max(WAVESPEED_UPSCALE_MIN_BILLED_SEC, Number.isFinite(raw) && raw > 0 ? raw : 0),
  );
  return sec * WAVESPEED_UPSCALE_USD_PER_SEC[target];
}
