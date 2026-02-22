import { describe, it, expect } from "vitest";

describe("Kling API Key Validation", () => {
  it("should have KLING_ACCESS_KEY set", () => {
    expect(process.env.KLING_ACCESS_KEY).toBeDefined();
    expect(process.env.KLING_ACCESS_KEY!.length).toBeGreaterThan(5);
  });

  it("should have KLING_SECRET_KEY set", () => {
    expect(process.env.KLING_SECRET_KEY).toBeDefined();
    expect(process.env.KLING_SECRET_KEY!.length).toBeGreaterThan(5);
  });

  it("should have KLING_REGION set to cn", () => {
    // KLING_REGION should be set to cn for domestic API
    const region = process.env.KLING_REGION || process.env.KLING_DEFAULT_REGION;
    expect(region).toBe("cn");
  });
});
