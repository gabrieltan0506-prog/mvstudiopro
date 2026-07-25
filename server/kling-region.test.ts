import { afterEach, describe, expect, it, vi } from "vitest";

// server/config/env.ts 在模块求值时就把 process.env 快照成常量对象，
// getKlingCnConfig / parseKeysFromEnv 读的都是那份快照。所以必须先改
// process.env、再 resetModules 重新 import，import 之后再赋值是无效的。
const ENV_KEYS = [
  "NODE_ENV",
  "KLING_CN_BASE_URL",
  "KLING_CN_VIDEO_ACCESS_KEY",
  "KLING_CN_VIDEO_SECRET_KEY",
] as const;

const saved = new Map<string, string | undefined>();

function stubEnv(patch: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): void {
  for (const key of ENV_KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
  }
  for (const key of ENV_KEYS) {
    const value = patch[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
}

afterEach(() => {
  for (const [key, value] of Array.from(saved.entries())) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
  vi.resetModules();
});

describe("Kling CN Configuration", () => {
  it("uses the Beijing endpoint by default", async () => {
    stubEnv({
      NODE_ENV: "test",
      KLING_CN_VIDEO_ACCESS_KEY: "test-access",
      KLING_CN_VIDEO_SECRET_KEY: "test-secret",
    });

    const { getKlingCnConfig } = await import("./config/klingCn");
    expect(getKlingCnConfig().baseUrl).toBe("https://api-beijing.klingai.com");
  });

  it("prefers KLING_CN_BASE_URL over the default", async () => {
    stubEnv({
      NODE_ENV: "test",
      KLING_CN_BASE_URL: "https://api-singapore.klingai.com",
      KLING_CN_VIDEO_ACCESS_KEY: "test-access",
      KLING_CN_VIDEO_SECRET_KEY: "test-secret",
    });

    const { getKlingCnConfig } = await import("./config/klingCn");
    expect(getKlingCnConfig().baseUrl).toBe("https://api-singapore.klingai.com");
  });

  it("throws when the CN video keys are missing", async () => {
    stubEnv({ NODE_ENV: "test" });

    const { getKlingCnConfig } = await import("./config/klingCn");
    expect(() => getKlingCnConfig()).toThrow(/KLING_CN_VIDEO_ACCESS_KEY/);
  });

  it("parses keys from KLING_CN_VIDEO_ACCESS_KEY/KLING_CN_VIDEO_SECRET_KEY", async () => {
    stubEnv({
      NODE_ENV: "test",
      KLING_CN_VIDEO_ACCESS_KEY: "test-access",
      KLING_CN_VIDEO_SECRET_KEY: "test-secret",
    });

    const { parseKeysFromEnv } = await import("./kling/client");
    const keys = parseKeysFromEnv();

    expect(keys.length).toBeGreaterThan(0);
    expect(keys[0]!.region).toBe("cn");
  });
});
