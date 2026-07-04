import { describe, expect, it } from "vitest";
import {
  deriveGrowthCoreScoresFromPartial,
  hasGrowthCoreScores,
  parseGrowthAnalysisScores,
} from "@shared/growth";

describe("growth core scores", () => {
  it("hasGrowthCoreScores accepts zero scores", () => {
    expect(hasGrowthCoreScores({
      composition: 0,
      color: 0,
      lighting: 0,
      impact: 0,
      viralPotential: 0,
    })).toBe(true);
  });

  it("hasGrowthCoreScores rejects missing fields", () => {
    expect(hasGrowthCoreScores({ composition: 70 })).toBe(false);
    expect(hasGrowthCoreScores({})).toBe(false);
  });

  it("deriveGrowthCoreScoresFromPartial uses platformScores", () => {
    const derived = deriveGrowthCoreScoresFromPartial({
      platformScores: { xiaohongshu: 7, douyin: 8, bilibili: 6, kuaishou: 5 },
    });
    expect(derived).not.toBeNull();
    expect(hasGrowthCoreScores(derived)).toBe(true);
    expect(derived!.composition).toBeGreaterThan(0);
  });

  it("parseGrowthAnalysisScores coerces string numbers", () => {
    const parsed = parseGrowthAnalysisScores({
      composition: "72",
      color: "68",
      lighting: "70",
      impact: "75",
      viralPotential: "80",
    });
    expect(parsed.composition).toBe(72);
    expect(parsed.viralPotential).toBe(80);
  });

  it("parseGrowthAnalysisScores throws when scores still missing", () => {
    expect(() => parseGrowthAnalysisScores({ summary: "no scores" })).toThrow();
  });
});
