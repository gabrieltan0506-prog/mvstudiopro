import { describe, it, expect } from "vitest";

// 这三条不是单元测试，是「本机 .env 配好了没」的冒烟检查。
// CI 上不挂 Kling 生产密钥，缺 key 时整组跳过，不然永远红。
const hasKlingKeys =
  (process.env.KLING_CN_VIDEO_ACCESS_KEY || "").trim().length > 5 &&
  (process.env.KLING_CN_VIDEO_SECRET_KEY || "").trim().length > 5;

describe.skipIf(!hasKlingKeys)("Kling CN Environment Validation", () => {
  it("should have KLING_CN_VIDEO_ACCESS_KEY set", () => {
    expect(process.env.KLING_CN_VIDEO_ACCESS_KEY).toBeDefined();
    expect(process.env.KLING_CN_VIDEO_ACCESS_KEY!.length).toBeGreaterThan(5);
  });

  it("should have KLING_CN_VIDEO_SECRET_KEY set", () => {
    expect(process.env.KLING_CN_VIDEO_SECRET_KEY).toBeDefined();
    expect(process.env.KLING_CN_VIDEO_SECRET_KEY!.length).toBeGreaterThan(5);
  });

  it("should use KLING_CN_BASE_URL when provided", () => {
    const baseUrl = process.env.KLING_CN_BASE_URL;
    if (baseUrl) {
      expect(baseUrl).toContain("api-beijing.klingai.com");
    }
  });
});
