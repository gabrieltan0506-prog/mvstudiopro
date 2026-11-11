import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

/** 可灵停用（方案 A）·售卖：对外价目不再列可灵、客服口径不再推销；计价键与历史账目保留。 */
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("价目表与计价键", () => {
  it("缺省停用：功能细项价目表不含可灵行，计价键仍在", async () => {
    vi.stubEnv("KLING_RETIRED", "");
    vi.resetModules();
    const { CREDIT_FEATURE_BREAKDOWN, CREDIT_COSTS } = await import("../plans");
    expect(CREDIT_FEATURE_BREAKDOWN.filter((r) => /可灵|Kling/i.test(r.product))).toEqual([]);
    expect(CREDIT_FEATURE_BREAKDOWN.length).toBeGreaterThan(20);
    expect(CREDIT_COSTS.klingVideo).toBe(80);
    expect(CREDIT_COSTS.klingImageO1_1K).toBe(8);
  });

  it("KLING_RETIRED=0 紧急恢复：可灵 7 行回到价目表", async () => {
    vi.stubEnv("KLING_RETIRED", "0");
    vi.resetModules();
    const { CREDIT_FEATURE_BREAKDOWN } = await import("../plans");
    expect(CREDIT_FEATURE_BREAKDOWN.filter((r) => /可灵/.test(r.product))).toHaveLength(7);
  });

  it("历史可灵图放大仍有基准价（计价键不删）", async () => {
    const { IMAGE_UPSCALE_BASE_CREDIT_KEYS } = await import("../../shared/plans");
    expect(IMAGE_UPSCALE_BASE_CREDIT_KEYS).toContain("klingImageO1_1K");
  });
});

describe("对外文案", () => {
  it("客服提示词不再推销可灵，也不点名可灵", () => {
    const src = readFileSync(new URL("../routers/customerService.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/Kling|可灵/i);
    expect(src).toMatch(/专业视频工作室」.*已下线/);
  });

  it("首页套餐卡不再列可灵卖点", () => {
    const src = readFileSync(new URL("../../client/src/components/HomePlans.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/Kling|可灵/i);
  });
});
