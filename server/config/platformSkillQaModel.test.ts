import { describe, expect, it } from "vitest";
import {
  resolvePlatformSkillQaOpenAiModel,
  resolvePlatformSkillQaPaidCredits,
  resolvePlatformSkillQaReasoningEffort,
} from "./platformSwitches.js";

describe("resolvePlatformSkillQaOpenAiModel", () => {
  it("allows Sol for regular users", () => {
    expect(
      resolvePlatformSkillQaOpenAiModel({
        requested: "gpt-5.6-sol",
        isSupervisor: false,
      }),
    ).toBe("gpt-5.6-sol");
  });

  it("allows Sol for supervisor", () => {
    expect(
      resolvePlatformSkillQaOpenAiModel({
        requested: "gpt-5.6-sol",
        isSupervisor: true,
      }),
    ).toBe("gpt-5.6-sol");
  });

  it("defaults Terra when unset", () => {
    expect(
      resolvePlatformSkillQaOpenAiModel({
        requested: null,
        isSupervisor: false,
      }),
    ).toBe("gpt-5.6-terra");
  });
});

describe("resolvePlatformSkillQaReasoningEffort", () => {
  it("defaults Terra to medium and Sol to high", () => {
    expect(resolvePlatformSkillQaReasoningEffort("terra")).toBe("medium");
    expect(resolvePlatformSkillQaReasoningEffort("sol")).toBe("high");
  });
});

describe("resolvePlatformSkillQaPaidCredits", () => {
  it("applies 60% markup on default api cost", () => {
    expect(resolvePlatformSkillQaPaidCredits("terra")).toBe(8);
    expect(resolvePlatformSkillQaPaidCredits("sol")).toBe(20);
  });
});
