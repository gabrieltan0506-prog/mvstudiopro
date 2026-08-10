export const MANHUA_ASSET_STANDARDIZE_QUALITIES = ["medium", "high"] as const;
export type ManhuaAssetStandardizeQuality =
  (typeof MANHUA_ASSET_STANDARDIZE_QUALITIES)[number];

/** 用户定价（2026-08-11）：官方成本加价 70%；产品整数价拍板 medium=3、high=5。 */
export const MANHUA_ASSET_STANDARDIZE_CREDITS: Record<
  ManhuaAssetStandardizeQuality,
  number
> = {
  medium: 3,
  high: 5,
};

export function normalizeManhuaAssetStandardizeQuality(
  raw: unknown
): ManhuaAssetStandardizeQuality {
  return String(raw || "")
    .trim()
    .toLowerCase() === "high"
    ? "high"
    : "medium";
}

export function manhuaAssetStandardizeCredits(raw: unknown): number {
  return MANHUA_ASSET_STANDARDIZE_CREDITS[
    normalizeManhuaAssetStandardizeQuality(raw)
  ];
}
