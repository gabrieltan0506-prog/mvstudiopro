import { describe, it, expect } from "vitest";

describe("Kling CN Environment Validation", () => {
  it("should have KLING_CN_VIDEO_KEY set", () => {
    expect(process.env.KLING_CN_VIDEO_KEY).toBeDefined();
    expect(process.env.KLING_CN_VIDEO_KEY!.length).toBeGreaterThan(5);
  });

  it("should use KLING_CN_BASE_URL when provided", () => {
    const baseUrl = process.env.KLING_CN_BASE_URL;
    if (baseUrl) {
      expect(baseUrl).toContain("api-beijing.klingai.com");
    }
  });
});
