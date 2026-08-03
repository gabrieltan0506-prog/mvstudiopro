import { describe, expect, it } from "vitest";
import { canAccessSeedance25ByPlan } from "./seedance25Access";

describe("canAccessSeedance25ByPlan", () => {
  it("allows stripe paid plans", () => {
    expect(canAccessSeedance25ByPlan("pro")).toBe(true);
    expect(canAccessSeedance25ByPlan("enterprise")).toBe(true);
    expect(canAccessSeedance25ByPlan("PRO")).toBe(true);
  });

  it("blocks free / invite-only (credits without paid plan)", () => {
    expect(canAccessSeedance25ByPlan("free")).toBe(false);
    expect(canAccessSeedance25ByPlan("")).toBe(false);
    expect(canAccessSeedance25ByPlan(null)).toBe(false);
    expect(canAccessSeedance25ByPlan("beta")).toBe(false);
  });
});
