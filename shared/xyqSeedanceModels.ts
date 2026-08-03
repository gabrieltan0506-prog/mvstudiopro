/**
 * 小云雀（XYQ / Pippit）Seedance 2.5 · 内部联调常量。
 * 产品闸门仍关；联调密钥只放 Fly secrets：SEEDANCE_25_ENABLED=1 + XYQ_ACCESS_KEY（勿写本机 .env）。
 *
 * CLI 对齐：`pippit-tool-cli generate-video --model Seedance_2.5`
 */

export const XYQ_SEEDANCE_25_MODEL = "Seedance_2.5" as const;

/** 与 CLI / 小云雀视频片段 Agent 一致 */
export const XYQ_VIDEO_PART_AGENT = "pippit_video_part_agent" as const;

export const XYQ_SEEDANCE_DURATION = { min: 4, max: 30, default: 15 } as const;

export const XYQ_REFERENCE_MAX = { image: 9, video: 3, audio: 3 } as const;

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
