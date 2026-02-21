import { describe, it, expect } from "vitest";

describe("FAL_API_KEY validation", () => {
  it("FAL_API_KEY environment variable is set", () => {
    expect(process.env.FAL_API_KEY).toBeDefined();
    expect(process.env.FAL_API_KEY!.length).toBeGreaterThan(10);
  });

  it("FAL_API_KEY has correct format (UUID:hash)", () => {
    const key = process.env.FAL_API_KEY!;
    expect(key).toMatch(/^[a-f0-9-]+:[a-f0-9]+$/);
  });

  it("hunyuan3d service checkFalAvailability returns true", async () => {
    const { isFalConfigured } = await import("../server/services/hunyuan3d");
    expect(isFalConfigured()).toBe(true);
  });
});
