import { describe, it, expect } from "vitest";
import { PLANS, CREDIT_COSTS, CREDIT_PACKS } from "../server/plans";
import { CREDIT_COSTS as SHARED_CREDIT_COSTS } from "../shared/credits";

describe("Stripe Plans Configuration", () => {
  it("should define all three plan tiers", () => {
    expect(PLANS).toHaveProperty("free");
    expect(PLANS).toHaveProperty("pro");
    expect(PLANS).toHaveProperty("enterprise");
  });

  it("free plan should have 0 monthly price and 50 monthly credits", () => {
    expect(PLANS.free.monthlyPrice).toBe(0);
    expect(PLANS.free.monthlyCredits).toBe(50);
  });

  it("pro plan should have correct pricing (CNY)", () => {
    expect(PLANS.pro.monthlyPrice).toBe(108);
    expect(PLANS.pro.yearlyPrice).toBe(1036);
    expect(PLANS.pro.monthlyCredits).toBe(200);
  });

  it("enterprise plan should have correct pricing (CNY)", () => {
    expect(PLANS.enterprise.monthlyPrice).toBe(358);
    expect(PLANS.enterprise.monthlyCredits).toBe(800);
  });

  it("should define credit costs for all actions", () => {
    expect(CREDIT_COSTS).toHaveProperty("mvAnalysis");
    expect(CREDIT_COSTS).toHaveProperty("idolGeneration");
    expect(CREDIT_COSTS).toHaveProperty("storyboard");
    expect(CREDIT_COSTS).toHaveProperty("videoGeneration");
  });

  it("credit costs should be non-negative numbers", () => {
    Object.values(CREDIT_COSTS).forEach((cost) => {
      expect(cost).toBeGreaterThanOrEqual(0);
    });
  });

  it("paid credit costs should be positive", () => {
    // forgeImage is free (0 credits), all others should be positive
    const paidCosts = Object.entries(CREDIT_COSTS).filter(([key]) => key !== "forgeImage");
    paidCosts.forEach(([key, cost]) => {
      expect(cost).toBeGreaterThan(0);
    });
  });

  it("should define credit packs (CNY)", () => {
    expect(CREDIT_PACKS).toHaveProperty("small");
    expect(CREDIT_PACKS).toHaveProperty("large");
    expect(CREDIT_PACKS.small.credits).toBe(50);
    expect(CREDIT_PACKS.small.price).toBe(35);
    expect(CREDIT_PACKS.large.credits).toBe(250);
    expect(CREDIT_PACKS.large.price).toBe(168);
  });

  it("large pack should be more cost-effective than small pack", () => {
    const smallPerCredit = CREDIT_PACKS.small.price / CREDIT_PACKS.small.credits;
    const largePerCredit = CREDIT_PACKS.large.price / CREDIT_PACKS.large.credits;
    expect(largePerCredit).toBeLessThan(smallPerCredit);
  });

  it("shared credit costs should match server credit costs", () => {
    expect(SHARED_CREDIT_COSTS.mvAnalysis).toBe(CREDIT_COSTS.mvAnalysis);
    expect(SHARED_CREDIT_COSTS.idolGeneration).toBe(CREDIT_COSTS.idolGeneration);
    expect(SHARED_CREDIT_COSTS.storyboard).toBe(CREDIT_COSTS.storyboard);
    expect(SHARED_CREDIT_COSTS.videoGeneration).toBe(CREDIT_COSTS.videoGeneration);
    expect(SHARED_CREDIT_COSTS.aiInspiration).toBe(CREDIT_COSTS.aiInspiration);
    expect(SHARED_CREDIT_COSTS.idol3D).toBe(CREDIT_COSTS.idol3D);
    expect(SHARED_CREDIT_COSTS.klingVideo).toBe(CREDIT_COSTS.klingVideo);
    expect(SHARED_CREDIT_COSTS.klingLipSync).toBe(CREDIT_COSTS.klingLipSync);
  });
});

describe("Stripe initialization", () => {
  it("getStripe should return null when STRIPE_SECRET_KEY is not set", async () => {
    const { getStripe } = await import("../server/stripe");
    // Without env var, should return null gracefully
    const stripe = getStripe();
    expect(stripe).toBeNull();
  });
});
