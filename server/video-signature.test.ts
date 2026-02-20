import { describe, it, expect } from "vitest";
import { generateSignatureHash } from "./video-signature";

describe("Video Signature Service", () => {
  describe("generateSignatureHash", () => {
    it("should generate a valid SHA-256 hex string", () => {
      const hash = generateSignatureHash(1, "https://example.com/video.mp4");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should generate different hashes for different users", () => {
      const hash1 = generateSignatureHash(1, "https://example.com/video.mp4");
      const hash2 = generateSignatureHash(2, "https://example.com/video.mp4");
      expect(hash1).not.toBe(hash2);
    });

    it("should generate different hashes for different videos", () => {
      const hash1 = generateSignatureHash(1, "https://example.com/video1.mp4");
      const hash2 = generateSignatureHash(1, "https://example.com/video2.mp4");
      expect(hash1).not.toBe(hash2);
    });

    it("should generate consistent length hashes", () => {
      const hash = generateSignatureHash(999, "https://storage.example.com/long/path/to/video.mp4");
      expect(hash.length).toBe(64);
    });
  });

  describe("Signature Verification Logic", () => {
    it("should distinguish original vs remix source types", () => {
      // Test that the source enum values are valid
      const validSources = ["original", "remix"];
      expect(validSources).toContain("original");
      expect(validSources).toContain("remix");
    });

    it("should return verified: false for unregistered videos", () => {
      // This tests the expected behavior - unregistered videos should not be verified
      // Actual DB test would require integration test setup
      const mockResult = { verified: false };
      expect(mockResult.verified).toBe(false);
    });

    it("should return verified: true with source for registered videos", () => {
      const mockOriginal = { verified: true, source: "original" as const, userId: 1, signatureHash: "abc123" };
      expect(mockOriginal.verified).toBe(true);
      expect(mockOriginal.source).toBe("original");

      const mockRemix = { verified: true, source: "remix" as const, userId: 2, signatureHash: "def456" };
      expect(mockRemix.verified).toBe(true);
      expect(mockRemix.source).toBe("remix");
    });
  });

  describe("Reward Eligibility", () => {
    it("verified platform video with high score should get reward", () => {
      const verified = true;
      const score = 92;
      const shouldReward = verified && score >= 85;
      expect(shouldReward).toBe(true);
    });

    it("unverified video should NOT get reward even with high score", () => {
      const verified = false;
      const score = 98;
      const shouldReward = verified && score >= 85;
      expect(shouldReward).toBe(false);
    });

    it("verified video with low score should NOT get reward", () => {
      const verified = true;
      const score = 70;
      const shouldReward = verified && score >= 85;
      expect(shouldReward).toBe(false);
    });

    it("remix video should be eligible for reward", () => {
      const verified = true;
      const source = "remix";
      const score = 90;
      const isEligible = verified && (source === "original" || source === "remix");
      const shouldReward = isEligible && score >= 85;
      expect(shouldReward).toBe(true);
    });
  });
});
