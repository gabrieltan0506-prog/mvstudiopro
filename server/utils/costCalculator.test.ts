import { describe, expect, it } from "vitest";
import { flatImageAnalysisCost } from "./costCalculator";
import { platformAssetAnalysisTotalCredits } from "@shared/plans";

describe("flatImageAnalysisCost", () => {
  it("GROWTH 按张 × 40", () => {
    expect(flatImageAnalysisCost("GROWTH", 1)).toBe(40);
    expect(flatImageAnalysisCost("GROWTH", 2)).toBe(80);
  });

  it("0 张为 0", () => {
    expect(flatImageAnalysisCost("GROWTH", 0)).toBe(0);
  });
});

describe("platformAssetAnalysisTotalCredits", () => {
  it("与 server 按张计费一致", () => {
    expect(platformAssetAnalysisTotalCredits(3)).toBe(120);
  });
});
