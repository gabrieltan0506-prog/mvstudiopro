/**
 * Wan 3.0（公测）· WaveSpeed reference-to-video。
 *
 * 实弹口径（2026-08-20 双单并发验证）：
 * - 单任务可直出 30s（这是它相对 15s 档引擎的核心卖点）；
 * - reference_images ≤ 10 张；reference_audios 合计 ≤ 15s（超限上游拒单）；
 * - 公测期排队时长不可预估（几十分钟到数小时都出现过），UI 必须明示。
 */
export const WAN30_WAVESPEED_PATH = "/api/v3/alibaba/wan-3.0/reference-to-video";

export const WAN30_REFERENCE_MAX = { image: 10, audio: 5, video: 5 } as const;
/** 上游参考音频合计上限（秒）；客户端只能尽力提示，硬校验在上游 */
export const WAN30_REFERENCE_AUDIO_TOTAL_SEC_MAX = 15;

export const WAN30_DURATION = { min: 2, max: 30, default: 30 } as const;

export const WAN30_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export type Wan30Resolution = (typeof WAN30_RESOLUTIONS)[number];
export const WAN30_DEFAULT_RESOLUTION: Wan30Resolution = "720p";

/**
 * 卡面备注：下拉与卡面都要带,不许让用户蒙在鼓里干等。
 * 0824 万相 3.0 正式上线（百炼 · 华北2），去掉「公测/排队长」的说法。
 */
export const WAN30_BETA_NOTE = "四模态参考 · 直出30s";

export function clampWan30Duration(raw?: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return WAN30_DURATION.default;
  return Math.min(WAN30_DURATION.max, Math.max(WAN30_DURATION.min, n));
}

export const WAN30_ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export function normalizeWan30AspectRatio(raw?: unknown): string {
  const key = String(raw || "").trim();
  return (WAN30_ASPECT_RATIOS as readonly string[]).includes(key) ? key : "16:9";
}

export function normalizeWan30Resolution(raw?: unknown): Wan30Resolution {
  const key = String(raw || "").trim().toLowerCase();
  return (WAN30_RESOLUTIONS as readonly string[]).includes(key)
    ? (key as Wan30Resolution)
    : WAN30_DEFAULT_RESOLUTION;
}
