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

/** 成长营用户可见引擎：GPT-5.5（抽帧分析 + 总结 / 完整商业分析战略阶段）。 */
export function resolveGrowthCampGpt55Engine(): GrowthCampStrategistEngine {
  return { modelName: "gpt-5.5", provider: "openai", label: "GPT-5.5" };
}

/** 提取模式 Phase 1 语音 scan：后台固定 Gemini 3.5 Flash（用户不可选）。 */
export function resolveGrowthCampExtractScanEngine(): GrowthCampStrategistEngine {
  const model = resolveGrowthCampExtractorModel();
  return { modelName: model as GrowthCampModel, provider: "vertex", label: "Gemini 3.5 Flash" };
}

/** 成长营深度分析（战略阶段）引擎：默认 GPT-5.5；旧 gemini 别名仍兼容。 */
export function resolveGrowthCampStrategistEngine(modelName?: string): GrowthCampStrategistEngine {
  const raw = String(
    modelName
      || process.env.GROWTH_CAMP_FINAL_MODEL
      || process.env.VERTEX_GROWTH_FINAL_MODEL
      || "gpt-5.5",
  ).trim()
    .toLowerCase();
  if (raw === "gpt-5.5" || raw === "gpt55") {
    return resolveGrowthCampGpt55Engine();
  }
  // 旧配置/缓存别名 → 统一走 GPT-5.5（Gemini 仅保留后台语音 scan）
  if (
    raw === "gemini-3.5-flash"
    || raw === "gemini-2.5-pro"
    || raw === "gemini-3.1-pro-preview"
  ) {
    return resolveGrowthCampGpt55Engine();
  }
  return resolveGrowthCampGpt55Engine();
}

/**
 * 战略分析阶段模型（GROWTH_CAMP_FINAL_MODEL）
 * - 默认 gpt-5.5
 * - 语音 scan 仍走 resolveGrowthCampExtractScanEngine（Gemini 3.5 Flash）
 */
export function resolveGrowthCampStrategistModel(modelName?: string): GrowthCampModel {
  return resolveGrowthCampStrategistEngine(modelName).modelName;
}

export function resolveGrowthCampPipelineMode(modelName?: string) {
  const engine = resolveGrowthCampStrategistEngine(modelName);
  if (engine.provider === "openai") return "extractor_plus_gpt55_strategist";
  return "extractor_plus_gpt55_strategist";
}
