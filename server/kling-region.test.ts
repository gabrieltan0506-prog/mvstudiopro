import { describe, expect, it } from "vitest";

describe("Kling API Region Configuration", () => {
  it("should have KLING_REGION set to cn", () => {
    const region = process.env.KLING_REGION;
    expect(region).toBe("cn");
  });

  it("should have KLING_DEFAULT_REGION set to cn", () => {
    const defaultRegion = process.env.KLING_DEFAULT_REGION;
    expect(defaultRegion).toBe("cn");
  });

  it("should parse keys with cn region from env", async () => {
    const { parseKeysFromEnv } = await import("./kling/client");
    const keys = parseKeysFromEnv();
    // If keys exist, they should default to cn region
    if (keys.length > 0) {
      expect(keys[0].region).toBe("cn");
    }
  });
});
