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

/**
 * ⚠️ 默认 5 秒，不是 30。
 *
 * 官方默认就是 5；而**按秒计费且向上取整**——默认 30 秒 1080p 一发 $8.40，
 * 用户不改参数直接点，等于每次都按最贵的跑。
 */
export const WAN30_DURATION = { min: 2, max: 30, default: 5 } as const;

/** 按秒计价（USD/秒，官方页 0824） */
export const WAN30_PRICE_USD_PER_SEC = { "480p": 0.07, "720p": 0.13, "1080p": 0.28 } as const;

/** 计费时长向上取整并夹到 2–30 */
export function wan30BilledSeconds(raw?: unknown): number {
  const n = Math.ceil(Number(raw));
  if (!Number.isFinite(n)) return WAN30_DURATION.default;
  return Math.min(WAN30_DURATION.max, Math.max(WAN30_DURATION.min, n));
}

export function wan30EstimatedUsd(resolution: Wan30Resolution, durationSec: number): number {
  return WAN30_PRICE_USD_PER_SEC[resolution] * wan30BilledSeconds(durationSec);
}

/**
 * 参考素材硬约束（官方页 0824）。超限上游拒单，异步任务要等轮询才知道失败，
 * 所以这些数字要在提交前就能校验。
 */
export const WAN30_REFERENCE_VIDEO_LIMITS = {
  perItemSec: { min: 1, max: 15 },
  totalSec: 15,
  maxBytes: 100 * 1024 * 1024,
  sidePx: { min: 240, max: 4096 },
  maxAspectRatio: 8,
} as const;

/** 三类参考**至少要有一类**，否则上游拒单 */
export function hasAnyWan30Reference(input: {
  images?: readonly unknown[];
  videos?: readonly unknown[];
  audios?: readonly unknown[];
}): boolean {
  return Boolean(
    (input.images?.length || 0) + (input.videos?.length || 0) + (input.audios?.length || 0),
  );
}

/** 轮询：官方建议约 2 秒一次，长任务可拉长 */
export const WAN30_POLL_INTERVAL_MS = 2_000;
/** 终态集合；其余状态继续等 */
export const WAN30_TERMINAL_STATUSES = ["completed", "failed", "cancelled", "timeout"] as const;
/** 结果地址优先取响应里的 urls.get，取不到才用这个模板 */
export function wan30ResultUrl(predictionId: string): string {
  return `https://api.wavespeed.ai/api/v3/predictions/${encodeURIComponent(predictionId)}/result`;
}

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

/** 官方六档（原先漏了 4:3 与 3:4） */
export const WAN30_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
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

/** seed 官方范围；-1 表示随机（示例里就是 -1） */
export const WAN30_SEED_RANGE = { min: 0, max: 2_147_483_647 } as const;
export function normalizeWan30Seed(raw?: unknown): number | undefined {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return undefined; // -1/缺省＝随机，不传
  return Math.min(WAN30_SEED_RANGE.max, n);
}

export type Wan30ReferenceToVideoRequest = {
  prompt: string;
  reference_images?: string[];
  reference_videos?: string[];
  reference_audios?: string[];
  resolution: Wan30Resolution;
  aspect_ratio: string;
  duration: number;
  thinking_mode?: boolean;
  enable_audio?: boolean;
  seed?: number;
};

/**
 * 组装 WaveSpeed 请求体。
 *
 * ⚠️ 与百炼原生**字段不可混用**（见 `shared/wanBailianNative.ts` 的对照表）：
 * 这里是顶层 `prompt` ＋ `reference_*` ＋ 小写 `480p`；
 * 百炼那边是 `input.prompt` ＋ `input.media[]` ＋ 大写 `480P`。
 */
export function buildWan30ReferenceToVideoRequest(input: {
  prompt: string;
  referenceImages?: readonly string[];
  referenceVideos?: readonly string[];
  referenceAudios?: readonly string[];
  resolution?: unknown;
  aspectRatio?: unknown;
  durationSec?: unknown;
  thinkingMode?: boolean;
  enableAudio?: boolean;
  seed?: unknown;
}): Wan30ReferenceToVideoRequest {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("Wan 3.0 缺少提示词");
  const images = (input.referenceImages || []).slice(0, WAN30_REFERENCE_MAX.image);
  const videos = (input.referenceVideos || []).slice(0, WAN30_REFERENCE_MAX.video);
  const audios = (input.referenceAudios || []).slice(0, WAN30_REFERENCE_MAX.audio);
  if (!hasAnyWan30Reference({ images, videos, audios })) {
    throw new Error("Wan 3.0 参考模式至少需要一类参考素材（图/视频/音频）");
  }
  const seed = normalizeWan30Seed(input.seed);
  return {
    prompt,
    ...(images.length ? { reference_images: [...images] } : {}),
    ...(videos.length ? { reference_videos: [...videos] } : {}),
    ...(audios.length ? { reference_audios: [...audios] } : {}),
    resolution: normalizeWan30Resolution(input.resolution),
    aspect_ratio: normalizeWan30AspectRatio(input.aspectRatio),
    duration: clampWan30Duration(input.durationSec),
    ...(input.thinkingMode ? { thinking_mode: true } : {}),
    // 官方默认 true，显式传避免依赖上游默认值
    enable_audio: input.enableAudio !== false,
    ...(seed !== undefined ? { seed } : {}),
  };
}
