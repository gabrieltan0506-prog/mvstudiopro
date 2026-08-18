import { describe, expect, it } from "vitest";
import {
  getOpenRouterKimiK3Model,
  isOpenRouterKimiK3Model,
  OPENROUTER_KIMI_K3_MODEL,
  OPENROUTER_KIMI_K3_REASONING_EFFORT,
  resolveOpenRouterKimiK3MaxCompletionTokens,
} from "./openrouterKimiK3.js";
import { getPlatformStage2OpenAiModel, getVisualReportOpenAiModel } from "../config/platformSwitches.js";

describe("openrouterKimiK3", () => {
  it("identifies OpenRouter / bare kimi-k3 slugs", () => {
    expect(isOpenRouterKimiK3Model("moonshotai/kimi-k3")).toBe(true);
    expect(isOpenRouterKimiK3Model("kimi-k3")).toBe(true);
    expect(isOpenRouterKimiK3Model("openai/gpt-5.6-terra")).toBe(false);
  });

  it("keeps platform stage2 on Kimi K3; visual report keeps K3 only as attempt-3 fallback", () => {
    delete process.env.PLATFORM_OPENROUTER_MODEL;
    delete process.env.VISUAL_REPORT_OPENROUTER_MODEL;
    delete process.env.VISUAL_REPORT_OPENAI_MODEL;
    expect(getOpenRouterKimiK3Model()).toBe(OPENROUTER_KIMI_K3_MODEL);
    expect(getPlatformStage2OpenAiModel()).toBe(OPENROUTER_KIMI_K3_MODEL);
    expect(getVisualReportOpenAiModel()).toBe(OPENROUTER_KIMI_K3_MODEL);
    expect(OPENROUTER_KIMI_K3_REASONING_EFFORT).toBe("max");
  });

  it("resolves max completion tokens with docs default 131072", () => {
    delete process.env.PLATFORM_KIMI_K3_MAX_COMPLETION_TOKENS;
    expect(resolveOpenRouterKimiK3MaxCompletionTokens()).toBe(131_072);
  });
});
