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

/** Phase 2（抽帧视觉 + Markdown 总结 / 战略阶段）：GPT-5.6 Sol */
export const GROWTH_CAMP_PHASE2_MODEL = "gpt-5.6-sol" as const;
export const GROWTH_CAMP_PHASE2_REASONING_EFFORT = "high" as const;
export const GROWTH_CAMP_PHASE2_MAX_TOKENS = 128_000;

/** 成长营 Phase 2 引擎：GPT-5.6 Sol · reasoning=high · max_tokens=128k */
export function resolveGrowthCampPhase2Engine(): GrowthCampStrategistEngine {
  return {
    modelName: GROWTH_CAMP_PHASE2_MODEL,
    provider: "openai",
    label: "GPT-5.6 Sol",
  };
}

/**
 * @deprecated 使用 {@link resolveGrowthCampPhase2Engine}
 * 旧名保留：历史调用点（弱 scan 回退 / extract_only）仍 import 此符号。
 */
export function resolveGrowthCampGpt55Engine(): GrowthCampStrategistEngine {
  return resolveGrowthCampPhase2Engine();
}

/** 提取模式 Phase 1 语音 scan：后台固定 Gemini 3.5 Flash（用户不可选）。 */
export function resolveGrowthCampExtractScanEngine(): GrowthCampStrategistEngine {
  const model = resolveGrowthCampExtractorModel();
  return { modelName: model as GrowthCampModel, provider: "vertex", label: "Gemini 3.5 Flash" };
}

/** invokeLLM 参数：Phase 2 Sol 固定 high + 128k；其它 openai 模型保持兼容。 */
export function growthCampPhase2InvokeOpts(engine: GrowthCampStrategistEngine) {
  const base = {
    model: "pro" as const,
    provider: engine.provider,
    modelName: engine.modelName,
  };
  if (engine.provider !== "openai") return base;
  // Phase 2 统一 Sol：high + 128k（旧 gpt-5.5 别名也会 resolve 到 Sol）
  if (
    engine.modelName === GROWTH_CAMP_PHASE2_MODEL
    || engine.modelName === "gpt-5.5"
    || engine.modelName === "gemini-3.5-flash"
  ) {
    return {
      ...base,
      modelName: GROWTH_CAMP_PHASE2_MODEL,
      reasoningEffort: GROWTH_CAMP_PHASE2_REASONING_EFFORT,
      max_tokens: GROWTH_CAMP_PHASE2_MAX_TOKENS,
    };
  }
  return {
    ...base,
    modelName: GROWTH_CAMP_PHASE2_MODEL,
    reasoningEffort: GROWTH_CAMP_PHASE2_REASONING_EFFORT,
    max_tokens: GROWTH_CAMP_PHASE2_MAX_TOKENS,
  };
}

/** 成长营深度分析（Phase 2）引擎：默认 GPT-5.6 Sol；旧 gpt-5.5 / gemini 别名统一迁到 Sol。 */
export function resolveGrowthCampStrategistEngine(modelName?: string): GrowthCampStrategistEngine {
  const raw = String(
    modelName
      || process.env.GROWTH_CAMP_FINAL_MODEL
      || process.env.VERTEX_GROWTH_FINAL_MODEL
      || GROWTH_CAMP_PHASE2_MODEL,
  ).trim()
    .toLowerCase();
  if (
    raw === GROWTH_CAMP_PHASE2_MODEL
    || raw === "gpt56sol"
    || raw === "gpt-5.6"
    || raw === "sol"
  ) {
    return resolveGrowthCampPhase2Engine();
  }
  // 旧配置/缓存别名 → 统一走 Phase 2 Sol（Gemini 仅保留后台语音 scan）
  if (
    raw === "gpt-5.5"
    || raw === "gpt55"
    || raw === "gemini-3.5-flash"
    || raw === "gemini-2.5-pro"
    || raw === "gemini-3.1-pro-preview"
  ) {
    return resolveGrowthCampPhase2Engine();
  }
  return resolveGrowthCampPhase2Engine();
}

/**
 * 战略分析阶段模型（GROWTH_CAMP_FINAL_MODEL）
 * - 默认 gpt-5.6-sol（reasoning=high，max_tokens=128k）
 * - 语音 scan 仍走 resolveGrowthCampExtractScanEngine（Gemini 3.5 Flash）
 */
export function resolveGrowthCampStrategistModel(modelName?: string): GrowthCampModel {
  return resolveGrowthCampStrategistEngine(modelName).modelName;
}

export function resolveGrowthCampPipelineMode(modelName?: string) {
  void resolveGrowthCampStrategistEngine(modelName);
  return "extractor_plus_gpt56_sol_strategist";
}
