import { describe, expect, it } from "vitest";
import {
  resolvePlatformSkillQaOpenAiModel,
  resolvePlatformSkillQaPaidCredits,
  resolvePlatformSkillQaReasoningEffort,
} from "./platformSwitches.js";
import { PLATFORM_TEXT_MODEL } from "../services/platformTextModel.js";

describe("resolvePlatformSkillQaOpenAiModel", () => {
  it("always routes to GLM 5.3 FlashX regardless of Sol/Terra UI choice", () => {
    expect(
      resolvePlatformSkillQaOpenAiModel({
        requested: "gpt-5.6-sol",
        isSupervisor: false,
      }),
    ).toBe(PLATFORM_TEXT_MODEL);
    expect(
      resolvePlatformSkillQaOpenAiModel({
        requested: "gpt-5.6-terra",
        isSupervisor: true,
      }),
    ).toBe(PLATFORM_TEXT_MODEL);
    expect(
      resolvePlatformSkillQaOpenAiModel({
        requested: null,
        isSupervisor: false,
      }),
    ).toBe(PLATFORM_TEXT_MODEL);
  });
});

describe("resolvePlatformSkillQaReasoningEffort", () => {
  it("defaults to low for GLM", () => {
    expect(resolvePlatformSkillQaReasoningEffort("terra")).toBe("low");
    expect(resolvePlatformSkillQaReasoningEffort("sol")).toBe("low");
  });
});

describe("resolvePlatformSkillQaPaidCredits", () => {
  it("applies 60% markup on default api cost", () => {
    expect(resolvePlatformSkillQaPaidCredits("terra")).toBe(8);
    expect(resolvePlatformSkillQaPaidCredits("sol")).toBe(20);
  });
});
