/**
 * BytePlus ModelArk · Dreamina Seedance 模型 ID 与画布选型。
 * 成片 API：POST /contents/generations/tasks（不是 /responses）。
 *
 * @see https://docs.byteplus.com/en/docs/ModelArk/2607688
 */

export const BYTEPLUS_ARK_API_BASE_DEFAULT =
  "https://ark.ap-southeast.bytepluses.com/api/v3" as const;

/** 控制台实测可用的 Seedance 2.5 模型 id */
export const BYTEPLUS_SEEDANCE_25_MODEL_ID = "dreamina-seedance-2-5-260628" as const;

/** 打折档 Seedance 2.0 mini（至约 9 月；本轮仅备忘，画布 2.5 主链不强制切） */
export const BYTEPLUS_SEEDANCE_20_MINI_MODEL_ID = "dreamina-seedance-2-0-mini-260615" as const;

export const BYTEPLUS_SEEDANCE_20_MODEL_ID = "dreamina-seedance-2-0-260128" as const;

export const BYTEPLUS_SEEDANCE_25_DURATION = { min: 4, max: 30, default: 15 } as const;

export type ByteplusSeedance25Mode =
  | "text_to_video"
  | "image_to_video"
  | "reference_to_video"
  | "video_edit"
  | "video_extend";

export function clampByteplusSeedance25Duration(raw?: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return BYTEPLUS_SEEDANCE_25_DURATION.default;
  return Math.max(
    BYTEPLUS_SEEDANCE_25_DURATION.min,
    Math.min(BYTEPLUS_SEEDANCE_25_DURATION.max, Math.round(n)),
  );
}

export function normalizeByteplusRatio(raw?: unknown): string {
  const r = String(raw || "").trim();
  if (
    r === "9:16" ||
    r === "16:9" ||
    r === "1:1" ||
    r === "4:3" ||
    r === "3:4" ||
    r === "21:9" ||
    r === "9:21"
  ) {
    return r;
  }
  if (r === "adaptive") return "16:9";
  return "16:9";
}
