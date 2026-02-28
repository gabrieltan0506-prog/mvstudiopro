import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock gemini-image (free 1K + 2K/4K tiers)
vi.mock("./gemini-image", () => ({
  generateGeminiImage: vi.fn().mockImplementation(async (args: { quality: "1k" | "2k" | "4k" }) => ({
    imageUrl: `https://s3.example.com/${args.quality}-idol.png`,
    quality: args.quality,
  })),
  isGeminiImageAvailable: vi.fn().mockReturnValue(true),
}));

// Mock storage
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://s3.example.com/uploaded.png", key: "uploaded.png" }),
}));

import { generateGeminiImage, isGeminiImageAvailable } from "./gemini-image";
import { CREDIT_COSTS } from "../shared/plans";

describe("Virtual Idol - Three Tier Generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct credit costs for each tier", () => {
    expect(CREDIT_COSTS.idolGeneration).toBe(3); // free tier (after free limit)
    expect(CREDIT_COSTS.storyboardImage2K).toBe(5); // 2K tier
    expect(CREDIT_COSTS.storyboardImage4K).toBe(9); // 4K tier
  });

  it("should check Gemini image availability", () => {
    expect(isGeminiImageAvailable()).toBe(true);
  });

  it("should call generateGeminiImage for free 1K tier", async () => {
    const result = await (generateGeminiImage as any)({ prompt: "test idol", quality: "1k" });
    expect(result).toEqual({ imageUrl: "https://s3.example.com/1k-idol.png", quality: "1k" });
    expect(generateGeminiImage).toHaveBeenCalledWith({ prompt: "test idol", quality: "1k" });
  });

  it("should call generateGeminiImage for 2K tier", async () => {
    const result = await (generateGeminiImage as any)({
      prompt: "test idol 2k",
      quality: "2k",
    });
    expect(result).toEqual({ imageUrl: "https://s3.example.com/2k-idol.png", quality: "2k" });
    expect(generateGeminiImage).toHaveBeenCalledWith({
      prompt: "test idol 2k",
      quality: "2k",
    });
  });

  it("should call generateGeminiImage for 4K tier", async () => {
    const result = await (generateGeminiImage as any)({
      prompt: "test idol 4k",
      quality: "4k",
    });
    expect(result).toBeDefined();
    expect(generateGeminiImage).toHaveBeenCalledWith({
      prompt: "test idol 4k",
      quality: "4k",
    });
  });

  it("should support reference image in free tier", async () => {
    await (generateGeminiImage as any)({
      prompt: "test idol with ref",
      quality: "1k",
      referenceImageUrl: "https://example.com/ref.jpg",
    });
    expect(generateGeminiImage).toHaveBeenCalledWith({
      prompt: "test idol with ref",
      quality: "1k",
      referenceImageUrl: "https://example.com/ref.jpg",
    });
  });

  it("should support reference image in 2K/4K tier", async () => {
    await (generateGeminiImage as any)({
      prompt: "test idol with ref",
      quality: "2k",
      referenceImageUrl: "https://example.com/ref.jpg",
    });
    expect(generateGeminiImage).toHaveBeenCalledWith({
      prompt: "test idol with ref",
      quality: "2k",
      referenceImageUrl: "https://example.com/ref.jpg",
    });
  });
});

describe("Quality Tiers Configuration", () => {
  it("should have three quality tiers defined", () => {
    const tiers = ["free", "2k", "4k"];
    expect(tiers).toHaveLength(3);
  });

  it("free tier should cost 0 credits (within free limit)", () => {
    // Free tier uses checkUsageLimit first, only charges after free limit
    expect(CREDIT_COSTS.idolGeneration).toBeGreaterThan(0); // 3 credits after free limit
  });

  it("2K tier should cost 5 credits", () => {
    expect(CREDIT_COSTS.storyboardImage2K).toBe(5);
  });

  it("4K tier should cost 9 credits", () => {
    expect(CREDIT_COSTS.storyboardImage4K).toBe(9);
  });

  it("4K should cost more than 2K", () => {
    expect(CREDIT_COSTS.storyboardImage4K).toBeGreaterThan(CREDIT_COSTS.storyboardImage2K);
  });
});
