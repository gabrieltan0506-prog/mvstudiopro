import { describe, expect, it } from "vitest";

describe("Kling CN Configuration", () => {
  it("uses the Beijing endpoint by default", async () => {
    const { getKlingCnConfig } = await import("./config/klingCn");
    const originalNodeEnv = process.env.NODE_ENV;
    const originalBase = process.env.KLING_CN_BASE_URL;
    const originalAccessKey = process.env.KLING_CN_VIDEO_ACCESS_KEY;
    const originalSecretKey = process.env.KLING_CN_VIDEO_SECRET_KEY;

    process.env.NODE_ENV = "test";
    delete process.env.KLING_CN_BASE_URL;
    process.env.KLING_CN_VIDEO_ACCESS_KEY = originalAccessKey || "test-access";
    process.env.KLING_CN_VIDEO_SECRET_KEY = originalSecretKey || "test-secret";

    const config = getKlingCnConfig();
    expect(config.baseUrl).toBe("https://api-beijing.klingai.com");

    process.env.NODE_ENV = originalNodeEnv;
    if (originalBase === undefined) {
      delete process.env.KLING_CN_BASE_URL;
    } else {
      process.env.KLING_CN_BASE_URL = originalBase;
    }
    if (originalAccessKey === undefined) {
      delete process.env.KLING_CN_VIDEO_ACCESS_KEY;
    } else {
      process.env.KLING_CN_VIDEO_ACCESS_KEY = originalAccessKey;
    }
    if (originalSecretKey === undefined) {
      delete process.env.KLING_CN_VIDEO_SECRET_KEY;
    } else {
      process.env.KLING_CN_VIDEO_SECRET_KEY = originalSecretKey;
    }
  });

  it("parses keys from KLING_CN_VIDEO_ACCESS_KEY/KLING_CN_VIDEO_SECRET_KEY", async () => {
    const { parseKeysFromEnv } = await import("./kling/client");
    const originalAccessKey = process.env.KLING_CN_VIDEO_ACCESS_KEY;
    const originalSecretKey = process.env.KLING_CN_VIDEO_SECRET_KEY;

    process.env.KLING_CN_VIDEO_ACCESS_KEY = originalAccessKey || "test-access";
    process.env.KLING_CN_VIDEO_SECRET_KEY = originalSecretKey || "test-secret";
    const keys = parseKeysFromEnv();

    expect(keys.length).toBeGreaterThan(0);
    expect(keys[0].region).toBe("cn");

    if (originalAccessKey === undefined) {
      delete process.env.KLING_CN_VIDEO_ACCESS_KEY;
    } else {
      process.env.KLING_CN_VIDEO_ACCESS_KEY = originalAccessKey;
    }
    if (originalSecretKey === undefined) {
      delete process.env.KLING_CN_VIDEO_SECRET_KEY;
    } else {
      process.env.KLING_CN_VIDEO_SECRET_KEY = originalSecretKey;
    }
  });
});
