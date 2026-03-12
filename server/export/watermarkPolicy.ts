import type { ExportWatermarkPolicy } from "../../shared/export/types.js";

export function getExportWatermarkPolicy(input?: {
  isPaidUser?: boolean;
  brand?: string;
}): ExportWatermarkPolicy {
  const brand = String(input?.brand || "MVStudioPro").trim() || "MVStudioPro";
  const isPaidUser = Boolean(input?.isPaidUser);

  return {
    isPaidUser,
    imageWatermarkText: `${brand} FREE`,
    docWatermarkText: `${brand} FREE EXPORT`,
  };
}
