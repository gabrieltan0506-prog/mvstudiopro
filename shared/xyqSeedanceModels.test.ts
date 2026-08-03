import { describe, expect, it } from "vitest";
import {
  XYQ_SEEDANCE_25_MODEL,
  clampXyqSeedanceDuration,
  normalizeXyqSeedanceRatio,
  normalizeXyqSeedanceResolution,
} from "./xyqSeedanceModels";

describe("xyqSeedanceModels", () => {
  it("keeps VIP model slug for CLI parity", () => {
    expect(XYQ_SEEDANCE_25_MODEL).toBe("Seedance_2.5");
  });

  it("clamps duration 4–30 default 15", () => {
    expect(clampXyqSeedanceDuration(undefined)).toBe(15);
    expect(clampXyqSeedanceDuration(3)).toBe(4);
    expect(clampXyqSeedanceDuration(99)).toBe(30);
    expect(clampXyqSeedanceDuration(8)).toBe(8);
  });

  it("normalizes resolution and ratio", () => {
    expect(normalizeXyqSeedanceResolution("480p")).toBe("480p");
    expect(normalizeXyqSeedanceResolution("1080p")).toBe("720p");
    expect(normalizeXyqSeedanceResolution("")).toBeUndefined();
    expect(normalizeXyqSeedanceRatio("9:16")).toBe("9:16");
    expect(normalizeXyqSeedanceRatio("weird")).toBeUndefined();
  });
});
