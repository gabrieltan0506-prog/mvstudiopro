import { describe, expect, it } from "vitest";
import { resolvePlatformSkillQaOpenAiModel } from "./platformSwitches.js";

describe("resolvePlatformSkillQaOpenAiModel", () => {
  it("forces Terra for regular users even if Sol requested", () => {
    expect(
      resolvePlatformSkillQaOpenAiModel({
        requested: "gpt-5.6-sol",
        isSupervisor: false,
      }),
    ).toBe("gpt-5.6-terra");
  });

  it("allows Sol for supervisor", () => {
    expect(
      resolvePlatformSkillQaOpenAiModel({
        requested: "gpt-5.6-sol",
        isSupervisor: true,
      }),
    ).toBe("gpt-5.6-sol");
  });

  it("defaults Terra for supervisor when unset", () => {
    expect(
      resolvePlatformSkillQaOpenAiModel({
        requested: null,
        isSupervisor: true,
      }),
    ).toBe("gpt-5.6-terra");
  });
});
