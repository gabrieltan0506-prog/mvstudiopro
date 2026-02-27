import { describe, expect, it } from "vitest";

describe("Kling CN Configuration", () => {
  it("uses the Beijing endpoint by default", async () => {
    const { getKlingCnConfig } = await import("./config/klingCn");
    const originalNodeEnv = process.env.NODE_ENV;
    const originalBase = process.env.KLING_CN_BASE_URL;
    const originalKey = process.env.KLING_CN_VIDEO_KEY;

    process.env.NODE_ENV = "test";
    delete process.env.KLING_CN_BASE_URL;
    process.env.KLING_CN_VIDEO_KEY = originalKey || "test-key";

    const config = getKlingCnConfig();
    expect(config.baseUrl).toBe("https://api-beijing.klingai.com");

    process.env.NODE_ENV = originalNodeEnv;
    if (originalBase === undefined) {
      delete process.env.KLING_CN_BASE_URL;
    } else {
      process.env.KLING_CN_BASE_URL = originalBase;
    }
    if (originalKey === undefined) {
      delete process.env.KLING_CN_VIDEO_KEY;
    } else {
      process.env.KLING_CN_VIDEO_KEY = originalKey;
    }
  });

  it("parses keys from KLING_CN_VIDEO_KEY", async () => {
    const { parseKeysFromEnv } = await import("./kling/client");
    const originalKey = process.env.KLING_CN_VIDEO_KEY;

    process.env.KLING_CN_VIDEO_KEY = originalKey || "test-key";
    const keys = parseKeysFromEnv();

    expect(keys.length).toBeGreaterThan(0);
    expect(keys[0].region).toBe("cn");

    if (originalKey === undefined) {
      delete process.env.KLING_CN_VIDEO_KEY;
    } else {
      process.env.KLING_CN_VIDEO_KEY = originalKey;
    }
  });
});
