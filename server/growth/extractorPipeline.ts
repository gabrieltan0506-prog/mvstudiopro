import type { GrowthCampModel } from "@shared/growth";

export function resolveGrowthCampExtractorModel() {
  return String(process.env.GROWTH_CAMP_EXTRACTOR_MODEL || "gemini-3.5-flash").trim()
    || "gemini-3.5-flash";
}

export type GrowthCampStrategistEngine = {
  modelName: GrowthCampModel;
  provider: "vertex" | "openai";
  label: string;
};

/** 成长营深度分析（战略阶段）引擎：Gemini 3.5 Flash（默认）或 GPT-5.5，可对比质量。 */
export function resolveGrowthCampStrategistEngine(modelName?: string): GrowthCampStrategistEngine {
  const raw = String(
    modelName
      || process.env.GROWTH_CAMP_FINAL_MODEL
      || process.env.VERTEX_GROWTH_FINAL_MODEL
      || "gemini-3.5-flash",
  ).trim()
    .toLowerCase();
  if (raw === "gpt-5.5" || raw === "gpt55") {
    return { modelName: "gpt-5.5", provider: "openai", label: "GPT-5.5" };
  }
  if (raw === "gemini-2.5-pro") {
    return { modelName: "gemini-2.5-pro", provider: "vertex", label: "Gemini 2.5 Pro" };
  }
  if (raw === "gemini-3.1-pro-preview") {
    return { modelName: "gemini-3.1-pro-preview", provider: "vertex", label: "Gemini 3.1 Pro" };
  }
  return { modelName: "gemini-3.5-flash", provider: "vertex", label: "Gemini 3.5 Flash" };
}

/**
 * 战略分析阶段模型（GROWTH_CAMP_FINAL_MODEL）
 * - 默认 gemini-3.5-flash（稳定、无 thinking_level 兼容问题）
 * - 可选 gpt-5.5 对比质量
 */
export function resolveGrowthCampStrategistModel(modelName?: string): GrowthCampModel {
  return resolveGrowthCampStrategistEngine(modelName).modelName;
}

export function resolveGrowthCampPipelineMode(modelName?: string) {
  const engine = resolveGrowthCampStrategistEngine(modelName);
  if (engine.provider === "openai") return "extractor_plus_gpt55_strategist";
  return engine.modelName === "gemini-3.1-pro-preview"
    ? "extractor_plus_3_1_strategist"
    : engine.modelName === "gemini-3.5-flash"
      ? "extractor_plus_3_5_strategist"
      : "extractor_plus_2_5_strategist";
}
