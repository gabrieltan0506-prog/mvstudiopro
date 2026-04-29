import type { GrowthCampModel } from "@shared/growth";

export function resolveGrowthCampExtractorModel() {
  return String(process.env.GROWTH_CAMP_EXTRACTOR_MODEL || "gemini-3-flash-preview").trim()
    || "gemini-3-flash-preview";
}

/**
 * 战略分析阶段模型（GROWTH_CAMP_FINAL_MODEL）
 * - 默认 gemini-3.1-pro-preview（商业洞察质量更高）
 * - 可通过 env GROWTH_CAMP_FINAL_MODEL 强制切回 gemini-2.5-pro 控成本
 */
export function resolveGrowthCampStrategistModel(modelName?: string): GrowthCampModel {
  const normalized = String(
    modelName
      || process.env.GROWTH_CAMP_FINAL_MODEL
      || process.env.VERTEX_GROWTH_FINAL_MODEL
      || "gemini-3.1-pro-preview",
  ).trim();
  return normalized === "gemini-2.5-pro" ? "gemini-2.5-pro" : "gemini-3.1-pro-preview";
}

export function resolveGrowthCampPipelineMode(modelName?: string) {
  return resolveGrowthCampStrategistModel(modelName) === "gemini-3.1-pro-preview"
    ? "extractor_plus_3_1_strategist"
    : "extractor_plus_2_5_strategist";
}
