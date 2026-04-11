import type { GrowthCampModel } from "@shared/growth";

export function resolveGrowthCampExtractorModel() {
  return String(process.env.GROWTH_CAMP_EXTRACTOR_MODEL || "gemini-3-flash-preview").trim()
    || "gemini-3-flash-preview";
}

export function resolveGrowthCampStrategistModel(modelName?: string): GrowthCampModel {
  const normalized = String(
    modelName
      || process.env.GROWTH_CAMP_FINAL_MODEL
      || process.env.VERTEX_GROWTH_FINAL_MODEL
      || "gemini-2.5-pro",
  ).trim();
  return normalized === "gemini-3.1-pro-preview"
    ? "gemini-3.1-pro-preview"
    : "gemini-2.5-pro";
}

export function resolveGrowthCampPipelineMode(modelName?: string) {
  return resolveGrowthCampStrategistModel(modelName) === "gemini-3.1-pro-preview"
    ? "extractor_plus_3_1_strategist"
    : "extractor_plus_2_5_strategist";
}
