import type { GrowthCampModel } from "@shared/growth";
import {
  OPENROUTER_KIMI_K3_MODEL,
  OPENROUTER_KIMI_K3_REASONING_EFFORT,
} from "../services/openrouterKimiK3.js";

export function resolveGrowthCampExtractorModel() {
  return String(process.env.GROWTH_CAMP_EXTRACTOR_MODEL || "gemini-3.5-flash").trim()
    || "gemini-3.5-flash";
}

export type GrowthCampStrategistEngine = {
  modelName: GrowthCampModel;
  provider: "vertex" | "openai";
  label: string;
};

/**
 * Phase 2（抽帧视觉 + Markdown 总结 / 战略阶段）：OpenRouter Kimi K3。
 * （临时：Sol 官方额度不足 + OpenRouter OpenAI ToS）
 */
export const GROWTH_CAMP_PHASE2_MODEL = OPENROUTER_KIMI_K3_MODEL;
export const GROWTH_CAMP_PHASE2_REASONING_EFFORT = OPENROUTER_KIMI_K3_REASONING_EFFORT;
export const GROWTH_CAMP_PHASE2_MAX_TOKENS = 128_000;

/** 成长营 Phase 2 引擎：Kimi K3 · reasoning=max · max_tokens=128k */
export function resolveGrowthCampPhase2Engine(): GrowthCampStrategistEngine {
  return {
    modelName: GROWTH_CAMP_PHASE2_MODEL,
    provider: "openai",
    label: "文案主力",
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

export type GrowthCampPhase2InvokeOpts = {
  model: "pro";
  provider: GrowthCampStrategistEngine["provider"];
  modelName: GrowthCampModel;
  reasoningEffort?: typeof GROWTH_CAMP_PHASE2_REASONING_EFFORT;
  max_tokens?: number;
};

/** invokeLLM 参数：Phase 2 Kimi 固定 max + 128k；其它 openai 模型保持兼容。 */
export function growthCampPhase2InvokeOpts(
  engine: GrowthCampStrategistEngine,
): GrowthCampPhase2InvokeOpts {
  const base = {
    model: "pro" as const,
    provider: engine.provider,
    modelName: engine.modelName,
  };
  if (engine.provider !== "openai") return base;
  return {
    ...base,
    modelName: GROWTH_CAMP_PHASE2_MODEL,
    reasoningEffort: GROWTH_CAMP_PHASE2_REASONING_EFFORT,
    max_tokens: GROWTH_CAMP_PHASE2_MAX_TOKENS,
  };
}

/** 成长营深度分析（Phase 2）引擎：默认 Kimi K3；旧 sol / gpt-5.5 / gemini 别名统一迁到 Kimi。 */
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
    || raw === "kimi-k3"
    || raw === "moonshotai/kimi-k3"
    || raw.endsWith("/kimi-k3")
    || raw === "gpt-5.6-sol"
    || raw === "gpt56sol"
    || raw === "gpt-5.6"
    || raw === "sol"
    || raw === "gpt-5.5"
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
 * - 默认 moonshotai/kimi-k3（reasoning=max，max_tokens=128k）
 * - 语音 scan 仍走 resolveGrowthCampExtractScanEngine（Gemini 3.5 Flash）
 */
export function resolveGrowthCampStrategistModel(modelName?: string): GrowthCampModel {
  return resolveGrowthCampStrategistEngine(modelName).modelName;
}

export function resolveGrowthCampPipelineMode(modelName?: string) {
  void resolveGrowthCampStrategistEngine(modelName);
  return "extractor_plus_kimi_k3_strategist";
}
