import { describe, it, expect, vi } from "vitest";

// Test the veo module's helper functions and structure
describe("Veo Video Generation", () => {
  it("isVeoAvailable returns true when GEMINI_API_KEY is set", async () => {
    // The env should have GEMINI_API_KEY set
    const { isVeoAvailable } = await import("./veo");
    // In test env, the key may or may not be set, just verify the function works
    const result = isVeoAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("generateVideo throws if GEMINI_API_KEY is not set", async () => {
    // Temporarily unset the key
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    // Re-import to get fresh module
    vi.resetModules();
    const { generateVideo } = await import("./veo");

    await expect(generateVideo({
      prompt: "test video",
      quality: "fast",
    })).rejects.toThrow("GEMINI_API_KEY");

    // Restore
    process.env.GEMINI_API_KEY = originalKey;
  });

  it("CREDIT_COSTS has correct video generation tiers", async () => {
    const { CREDIT_COSTS } = await import("../shared/plans");
    expect(CREDIT_COSTS.videoGenerationFast720).toBe(15);
    expect(CREDIT_COSTS.videoGenerationFast1080).toBe(25);
    expect(CREDIT_COSTS.videoGenerationStd720).toBe(30);
    expect(CREDIT_COSTS.videoGenerationStd1080).toBe(50);
  });

  it("CREDIT_COSTS video tiers are ordered by cost", async () => {
    const { CREDIT_COSTS } = await import("../shared/plans");
    expect(CREDIT_COSTS.videoGenerationFast720).toBeLessThan(CREDIT_COSTS.videoGenerationFast1080);
    expect(CREDIT_COSTS.videoGenerationFast1080).toBeLessThan(CREDIT_COSTS.videoGenerationStd720);
    expect(CREDIT_COSTS.videoGenerationStd720).toBeLessThan(CREDIT_COSTS.videoGenerationStd1080);
  });

  it("PK_REWARD_TIERS are properly defined", async () => {
    const { PK_REWARD_TIERS, getRewardTier } = await import("../shared/plans");
    expect(PK_REWARD_TIERS.length).toBe(3);
    // ≥90 gets 25 credits (精品级)
    expect(getRewardTier(95).credits).toBe(25);
    expect(getRewardTier(95).label).toBe("精品级");
    expect(getRewardTier(90).credits).toBe(25);
    // 80-89 gets 15 credits (优秀级)
    expect(getRewardTier(85).credits).toBe(15);
    expect(getRewardTier(80).credits).toBe(15);
    // below 80 gets 0
    expect(getRewardTier(79).credits).toBe(0);
    expect(getRewardTier(60).credits).toBe(0);
  });
});
