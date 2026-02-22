import { describe, it, expect } from "vitest";
import { CREDIT_COSTS, PLANS } from "../shared/plans";

describe("Storyboard Configuration", () => {
  it("should have correct scene limits for free and paid users", () => {
    expect(PLANS.free.limits.storyboardImages).toBe(10);
    expect(PLANS.pro.limits.storyboardImages).toBe(30);
    expect(PLANS.enterprise.limits.storyboardImages).toBe(70);
  });

  it("should have storyboard credit cost defined", () => {
    expect(CREDIT_COSTS.storyboard).toBe(15);
  });

  it("should have forge image cost as 3 credits", () => {
    expect(CREDIT_COSTS.forgeImage).toBe(3);
  });

  it("should have storyboard flash cost as 8 credits", () => {
    expect(CREDIT_COSTS.storyboardFlash).toBe(8);
  });

  it("should have storyboard GPT 5.1 cost as 20 credits", () => {
    expect(CREDIT_COSTS.storyboardGpt5).toBe(20);
  });

  it("should not display 'Forge AI' in user-facing plan features", () => {
    const allFeatures = [
      ...PLANS.free.features,
      ...PLANS.free.featuresCn,
      ...PLANS.pro.features,
      ...PLANS.pro.featuresCn,
      ...PLANS.enterprise.features,
      ...PLANS.enterprise.featuresCn,
    ];
    
    for (const feature of allFeatures) {
      expect(feature).not.toContain("Forge AI");
    }
  });

  it("should have correct model options (all paid)", () => {
    // All models cost credits
    expect(CREDIT_COSTS.storyboardFlash).toBe(8);
    expect(CREDIT_COSTS.storyboard).toBe(15);
    expect(CREDIT_COSTS.storyboardGpt5).toBe(20);
  });

  it("should have NBP 2K and 4K credit costs defined", () => {
    expect(CREDIT_COSTS.nbpImage2K).toBe(5);
    expect(CREDIT_COSTS.nbpImage4K).toBe(9);
  });
});
