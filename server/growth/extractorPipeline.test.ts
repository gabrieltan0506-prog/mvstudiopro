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

describe("growth camp extractor pipeline engines", () => {
  it("keeps Phase 1 voice scan on Gemini 3.5 Flash", () => {
    const scan = resolveGrowthCampExtractScanEngine();
    expect(scan.provider).toBe("vertex");
    expect(scan.modelName).toMatch(/gemini-3\.5-flash/i);
  });

  it("resolves Phase 2 to GPT-5.6 Sol with high / 128k", () => {
    const engine = resolveGrowthCampPhase2Engine();
    expect(engine).toEqual({
      modelName: GROWTH_CAMP_PHASE2_MODEL,
      provider: "openai",
      label: "GPT-5.6 Sol",
    });
    const opts = growthCampPhase2InvokeOpts(engine);
    expect(opts.modelName).toBe("gpt-5.6-sol");
    expect(opts.reasoningEffort).toBe(GROWTH_CAMP_PHASE2_REASONING_EFFORT);
    expect(opts.max_tokens).toBe(GROWTH_CAMP_PHASE2_MAX_TOKENS);
    expect(GROWTH_CAMP_PHASE2_REASONING_EFFORT).toBe("high");
    expect(GROWTH_CAMP_PHASE2_MAX_TOKENS).toBe(128_000);
  });

  it("maps legacy gpt-5.5 / gemini aliases to Phase 2 Sol", () => {
    expect(resolveGrowthCampStrategistEngine("gpt-5.5").modelName).toBe("gpt-5.6-sol");
    expect(resolveGrowthCampStrategistEngine("gemini-3.5-flash").modelName).toBe("gpt-5.6-sol");
    expect(resolveGrowthCampPipelineMode()).toBe("extractor_plus_gpt56_sol_strategist");
  });
});
