/**
 * 小云雀（XYQ / Pippit）Seedance 2.5 · 内部联调常量。
 * 联调密钥只放 Fly secrets：SEEDANCE_25_ENABLED=1 + XYQ_ACCESS_KEY（勿写本机 .env）。
 *
 * CLI 对齐：
 * - 模型直出：`generate-video --model Seedance_2.5` → video_part_tool_param
 * - 会话编辑：`submit_run --message … --asset-ids …`（无 video_part；局部重拍）
 * - 参考上限：图≤9 / 视≤3 / 音≤3（mp3/wav）
 */

export const XYQ_SEEDANCE_25_MODEL = "Seedance_2.5" as const;

/** 与 CLI / 小云雀视频片段 Agent 一致 */
export const XYQ_VIDEO_PART_AGENT = "pippit_video_part_agent" as const;

export const XYQ_SEEDANCE_DURATION = { min: 4, max: 30, default: 15 } as const;

export const XYQ_REFERENCE_MAX = { image: 9, video: 3, audio: 3 } as const;

/** 官方 video-super-resolution 输出档 */
export const XYQ_UPSCALE_RESOLUTIONS = ["720p", "1080p", "2k", "4k"] as const;
export type XyqUpscaleResolution = (typeof XYQ_UPSCALE_RESOLUTIONS)[number];

export function normalizeXyqUpscaleResolution(raw: unknown): XyqUpscaleResolution {
  const q = String(raw || "").trim().toLowerCase();
  if ((XYQ_UPSCALE_RESOLUTIONS as readonly string[]).includes(q)) {
    return q as XyqUpscaleResolution;
  }
  if (q === "1080" || q === "fhd") return "1080p";
  if (q === "720") return "720p";
  return "1080p";
}

/** 官方 --tool-version */
export const XYQ_UPSCALE_TOOL_VERSIONS = ["standard", "professional_v1", "professional_v2"] as const;
export type XyqUpscaleToolVersion = (typeof XYQ_UPSCALE_TOOL_VERSIONS)[number];

export function normalizeXyqUpscaleToolVersion(raw: unknown): XyqUpscaleToolVersion {
  const v = String(raw || "").trim().toLowerCase();
  if ((XYQ_UPSCALE_TOOL_VERSIONS as readonly string[]).includes(v)) {
    return v as XyqUpscaleToolVersion;
  }
  return "standard";
}

export function clampXyqSeedanceDuration(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return XYQ_SEEDANCE_DURATION.default;
  return Math.min(XYQ_SEEDANCE_DURATION.max, Math.max(XYQ_SEEDANCE_DURATION.min, n));
}

/** 小云雀常见档：480p / 720p（未给时不传，交给服务端默认） */
export function normalizeXyqSeedanceResolution(raw: unknown): "480p" | "720p" | undefined {
  const q = String(raw || "").trim().toLowerCase();
  if (q === "480p" || q === "720p") return q;
  if (q === "1080p") return "720p";
  return undefined;
}

export function normalizeXyqSeedanceRatio(raw: unknown): string | undefined {
  const a = String(raw || "").trim();
  if (!a) return undefined;
  const allowed = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);
  return allowed.has(a) ? a : undefined;
}
