import { describe, expect, it } from "vitest";
import {
  GROWTH_CAMP_PHASE2_MAX_TOKENS,
  GROWTH_CAMP_PHASE2_MODEL,
  GROWTH_CAMP_PHASE2_REASONING_EFFORT,
  growthCampPhase2InvokeOpts,
  resolveGrowthCampExtractScanEngine,
  resolveGrowthCampPhase2Engine,
  resolveGrowthCampPipelineMode,
  resolveGrowthCampStrategistEngine,
} from "./extractorPipeline.js";
import { OPENROUTER_KIMI_K3_MODEL } from "../services/openrouterKimiK3.js";

describe("growth camp extractor pipeline engines", () => {
  it("keeps Phase 1 voice scan on Gemini 3.5 Flash", () => {
    const scan = resolveGrowthCampExtractScanEngine();
    expect(scan.provider).toBe("vertex");
    expect(scan.modelName).toMatch(/gemini-3\.5-flash/i);
  });

  it("resolves Phase 2 to OpenRouter Kimi K3 with max / 128k", () => {
    const engine = resolveGrowthCampPhase2Engine();
    expect(engine).toEqual({
      modelName: GROWTH_CAMP_PHASE2_MODEL,
      provider: "openai",
      label: "文案主力",
    });
    expect(GROWTH_CAMP_PHASE2_MODEL).toBe(OPENROUTER_KIMI_K3_MODEL);
    const opts = growthCampPhase2InvokeOpts(engine);
    expect(opts.modelName).toBe(OPENROUTER_KIMI_K3_MODEL);
    expect(opts.reasoningEffort).toBe(GROWTH_CAMP_PHASE2_REASONING_EFFORT);
    expect(opts.max_tokens).toBe(GROWTH_CAMP_PHASE2_MAX_TOKENS);
    expect(GROWTH_CAMP_PHASE2_REASONING_EFFORT).toBe("max");
    expect(GROWTH_CAMP_PHASE2_MAX_TOKENS).toBe(128_000);
  });

  it("maps legacy sol / gpt-5.5 / gemini aliases to Phase 2 Kimi", () => {
    expect(resolveGrowthCampStrategistEngine("gpt-5.6-sol").modelName).toBe(OPENROUTER_KIMI_K3_MODEL);
    expect(resolveGrowthCampStrategistEngine("gpt-5.5").modelName).toBe(OPENROUTER_KIMI_K3_MODEL);
    expect(resolveGrowthCampStrategistEngine("gemini-3.5-flash").modelName).toBe(
      OPENROUTER_KIMI_K3_MODEL,
    );
    expect(resolveGrowthCampPipelineMode()).toBe("extractor_plus_kimi_k3_strategist");
  });
});
