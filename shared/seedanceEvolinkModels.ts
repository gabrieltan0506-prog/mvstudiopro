/**
 * EvoLink Seedance 模型名与产品闸门。
 *
 * 文档：
 * - 2.0：text / image / reference → video（时长 4–15s）
 * - 2.0 Mini：廉价草稿档（480p/720p，约半价）；探针默认走此档
 * - 2.5：文生、图生、多模态参考、视频编辑、视频延长（时长 4–30s）
 *
 * @see https://docs.evolink.ai/cn/api-manual/video-series/seedance2.0/
 * @see https://evolink.ai/seedance-2-0-mini
 * @see https://docs.evolink.ai/en/api-manual/video-series/seedance2.5/
 */

import {
  SEEDANCE_25_LAUNCH_DATE_LABEL_EN,
  SEEDANCE_25_LAUNCH_DATE_LABEL_ZH,
  isSeedance25Launched,
} from "./seedance25Access.js";

export const SEEDANCE_20_MODELS = {
  textToVideo: "seedance-2.0-text-to-video",
  imageToVideo: "seedance-2.0-image-to-video",
  referenceToVideo: "seedance-2.0-reference-to-video",
} as const;

/** 廉价迭代档：草稿 / 探针优先；Mini 不支持 1080p */
export const SEEDANCE_20_MINI_MODELS = {
  textToVideo: "seedance-2.0-mini-text-to-video",
  imageToVideo: "seedance-2.0-mini-image-to-video",
  referenceToVideo: "seedance-2.0-mini-reference-to-video",
} as const;

export const SEEDANCE_25_MODELS = {
  textToVideo: "seedance-2.5-text-to-video",
  imageToVideo: "seedance-2.5-image-to-video",
  referenceToVideo: "seedance-2.5-reference-to-video",
  videoEdit: "seedance-2.5-video-edit",
  videoExtend: "seedance-2.5-video-extend",
} as const;

/**
 * EvoLink `content_filter`（用户 2026-08-09 拍板改为 false）。
 *
 * - `true`：标准内容安全检查（上游默认）
 * - `false`：**放宽内容限制，上游加收 10%**；文档同时注明「违法违禁内容无论如何都拦」，
 *   所以放宽不等于没有底线。
 *
 * 改动理由：漫剧每一段都拿角色定妆图当首帧，标准档会把人物图判成真人素材拦下来
 * （2026-08-09 实测到 `InputImageSensitiveContentDetected.PrivacyInformation`）。
 *
 * ⚠️ 只对 EvoLink 路径生效。BytePlus ModelArk 的请求体没有这个参数，
 * 主路径（2.5）的人脸拦截**不会**因为这里改成 false 而解除。
 */
export const SEEDANCE_EVOLINK_CONTENT_FILTER = false as const;

export type SeedanceEvolinkVersion = "2.0" | "2.0-mini" | "2.5";
export type SeedanceEvolinkMode =
  | "text_to_video"
  | "image_to_video"
  | "reference_to_video"
  | "video_edit"
  | "video_extend";

export const SEEDANCE_25_EVOLINK_MODES: readonly SeedanceEvolinkMode[] = [
  "text_to_video",
  "image_to_video",
  "reference_to_video",
  "video_edit",
  "video_extend",
] as const;

export function isSeedance25EvolinkMode(raw: unknown): raw is SeedanceEvolinkMode {
  return (SEEDANCE_25_EVOLINK_MODES as readonly unknown[]).includes(raw);
}

/** 兼容旧画布草稿：旧“延长/局部重拍/复刻”分别折到新版延长/编辑。 */
export function normalizeSeedance25EvolinkMode(
  raw: unknown,
  media: { imageUrls?: string[]; videoUrls?: string[]; audioUrls?: string[] } = {},
): SeedanceEvolinkMode {
  const value = String(raw || "").trim().toLowerCase();
  if (isSeedance25EvolinkMode(value)) return value;
  if (value === "extend") return "video_extend";
  if (
    value === "reshoot" ||
    value === "remix" ||
    value === "upscale" ||
    value === "erase_subtitle"
  ) {
    return "video_edit";
  }
  return inferSeedanceMode(media);
}

/** 产品默认时长：对齐「约 15 秒」漫剧/短镜口径；仍受各版 API 上下限约束 */
export const SEEDANCE_PRODUCT_DEFAULT_DURATION_SEC = 15;

/** 探针专用：5s·480p，约半价于标准 2.0。探针路径显式传这两个值，不靠模型默认 */
export const SEEDANCE_PROBE_DEFAULT_DURATION_SEC = 5;
export const SEEDANCE_PROBE_DEFAULT_QUALITY = "480p" as const;

export const SEEDANCE_20_DURATION = { min: 4, max: 15, default: SEEDANCE_PRODUCT_DEFAULT_DURATION_SEC } as const;
/**
 * Mini 已是正式售卖档（39 积分/段），默认必须跟产品口径走 15s。
 * 以前它挂在探针的 5s 上：任何漏传时长的调用都会按 39 积分只出 5 秒片。
 */
export const SEEDANCE_20_MINI_DURATION = { min: 4, max: 15, default: SEEDANCE_PRODUCT_DEFAULT_DURATION_SEC } as const;
export const SEEDANCE_25_DURATION = { min: 4, max: 30, default: SEEDANCE_PRODUCT_DEFAULT_DURATION_SEC } as const;

/**
 * 到 `SEEDANCE_25_LAUNCH_AT_ISO` 自动放开（用户 2026-08-05 明文：对外宣称上线日、到点自动可用）。
 * 日期真源只有 `shared/seedance25Access.ts` 一处，此处不复写，避免改期后注释腐烂。
 * 上线前内部联调设环境变量 SEEDANCE_25_ENABLED=1（仅服务端）。
 *
 * 写成函数而非常量：Fly 是长驻进程，常量会在启动时求值，跨过上线时刻也不会翻转。
 */
export function isSeedance25PubliclyEnabled(now?: Date | number): boolean {
  return isSeedance25Launched(now);
}

export const SEEDANCE_25_COMING_SOON_LABEL_EN = `Seedance 2.5 launches ${SEEDANCE_25_LAUNCH_DATE_LABEL_EN} on MV Studio Pro`;
export const SEEDANCE_25_COMING_SOON_LABEL_ZH = `Seedance 2.5 将于 ${SEEDANCE_25_LAUNCH_DATE_LABEL_ZH}上线 MV Studio Pro`;

export function resolveSeedanceModelId(
  version: SeedanceEvolinkVersion,
  mode: SeedanceEvolinkMode,
): string {
  const table =
    version === "2.5"
      ? SEEDANCE_25_MODELS
      : version === "2.0-mini"
        ? SEEDANCE_20_MINI_MODELS
        : SEEDANCE_20_MODELS;
  if (mode === "video_edit") {
    if (version !== "2.5") throw new Error("视频编辑仅支持 Seedance 2.5");
    return SEEDANCE_25_MODELS.videoEdit;
  }
  if (mode === "video_extend") {
    if (version !== "2.5") throw new Error("视频延长仅支持 Seedance 2.5");
    return SEEDANCE_25_MODELS.videoExtend;
  }
  if (mode === "image_to_video") return table.imageToVideo;
  if (mode === "reference_to_video") return table.referenceToVideo;
  return table.textToVideo;
}

export function clampSeedanceDuration(
  version: SeedanceEvolinkVersion,
  raw: unknown,
): number {
  const lim =
    version === "2.5"
      ? SEEDANCE_25_DURATION
      : version === "2.0-mini"
        ? SEEDANCE_20_MINI_DURATION
        : SEEDANCE_20_DURATION;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return lim.default;
  return Math.min(lim.max, Math.max(lim.min, n));
}

/** Mini 仅 480p/720p；标准 2.0 可到 1080p */
export function normalizeSeedanceQuality(
  version: SeedanceEvolinkVersion,
  raw: unknown,
): "480p" | "720p" | "1080p" {
  const q = String(raw || "720p").trim().toLowerCase();
  if (version === "2.0-mini" || version === "2.5") {
    return q === "480p" ? "480p" : "720p";
  }
  if (q === "480p" || q === "1080p") return q;
  return "720p";
}

export function parseSeedanceVersion(raw: unknown): SeedanceEvolinkVersion {
  const v = String(raw || "2.0").trim().toLowerCase();
  if (v === "2.5" || v === "25") return "2.5";
  if (v === "2.0-mini" || v === "mini" || v === "2.0mini") return "2.0-mini";
  return "2.0";
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
