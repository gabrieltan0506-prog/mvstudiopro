import { describe, expect, it } from "vitest";
import {
  resolvePlatformSkillQaOpenAiModel,
  resolvePlatformSkillQaPaidCredits,
  resolvePlatformSkillQaReasoningEffort,
} from "./platformSwitches.js";
import { OPENROUTER_KIMI_K3_MODEL } from "../services/openrouterKimiK3.js";

describe("resolvePlatformSkillQaOpenAiModel", () => {
  it("always routes to OpenRouter Kimi K3 regardless of Sol/Terra UI choice", () => {
    expect(
      resolvePlatformSkillQaOpenAiModel({
        requested: "gpt-5.6-sol",
        isSupervisor: false,
      }),
    ).toBe(OPENROUTER_KIMI_K3_MODEL);
    expect(
      resolvePlatformSkillQaOpenAiModel({
        requested: "gpt-5.6-terra",
        isSupervisor: true,
      }),
    ).toBe(OPENROUTER_KIMI_K3_MODEL);
    expect(
      resolvePlatformSkillQaOpenAiModel({
        requested: null,
        isSupervisor: false,
      }),
    ).toBe(OPENROUTER_KIMI_K3_MODEL);
  });
});

describe("resolvePlatformSkillQaReasoningEffort", () => {
  it("defaults to max for Kimi K3", () => {
    expect(resolvePlatformSkillQaReasoningEffort("terra")).toBe("max");
    expect(resolvePlatformSkillQaReasoningEffort("sol")).toBe("max");
  });
});

describe("resolvePlatformSkillQaPaidCredits", () => {
  it("applies 60% markup on default api cost", () => {
    expect(resolvePlatformSkillQaPaidCredits("terra")).toBe(8);
    expect(resolvePlatformSkillQaPaidCredits("sol")).toBe(20);
  });
});
