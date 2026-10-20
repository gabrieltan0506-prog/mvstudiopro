import { describe, expect, it } from "vitest";
import { appendOfferContext, calculateOfferEconomics, formatOfferEconomics, formatOptimizationAdvice, PARENT_CHILD_OFFER_EXAMPLE } from "./marketingOffer";

describe("商品价格测算", () => {
  it("平台建议在说明中可见，兼容没有建议的旧回执", () => {
    expect(formatOptimizationAdvice({summary: "优化了价值说明", platformNotes: [{platform: "小红书", angle: "引流候选：试读；成本待补"}]})).toContain("小红书：引流候选：试读；成本待补");
    expect(formatOptimizationAdvice({summary: "旧摘要"})).toBe("旧摘要");
  });
  it("未知成本不等于零，不生成虚构利润", () => {
    const input = { price: "100", variableCost: "", acquisitionCost: "", targetMargin: "50" };
    expect(calculateOfferEconomics(input).contribution).toBeNull();
    expect(calculateOfferEconomics(input).targetPrice).toBeNull();
    expect(formatOfferEconomics(input)).toContain("待补有效数值");
  });
  it("区分单笔贡献与净利润，允许负贡献及明确的零成本", () => {
    expect(calculateOfferEconomics({ price: "100", variableCost: "30", acquisitionCost: "10", targetMargin: "50" })).toMatchObject({ contribution: 60, contributionRate: 60, targetPrice: 80 });
    expect(calculateOfferEconomics({ price: "10", variableCost: "30", acquisitionCost: "0", targetMargin: "0" })).toMatchObject({ contribution: -20, contributionRate: -200, targetPrice: 30 });
    expect(calculateOfferEconomics({ price: "0", variableCost: "30", acquisitionCost: "0", targetMargin: "0" }).contributionRate).toBeNull();
  });
  it("拒绝非法金额和除零目标", () => {
    for (const value of ["-1", "Infinity", "NaN", "1e4", "  ", "12元", "1000000000001"]) {
      expect(calculateOfferEconomics({ price: value, variableCost: "10", acquisitionCost: "0", targetMargin: "100" }).contribution).toBeNull();
    }
    expect(calculateOfferEconomics({ price: "100", variableCost: "10", acquisitionCost: "0", targetMargin: "100" }).targetPrice).toBeNull();
  });
  it("保留原需求，超长和重复时原文不动", () => {
    const existing = "保留我的语气与已确认交付";
    const result = appendOfferContext(existing, PARENT_CHILD_OFFER_EXAMPLE);
    expect(result.value).toBe(existing + "\n\n" + PARENT_CHILD_OFFER_EXAMPLE);
    expect(appendOfferContext(result.value, PARENT_CHILD_OFFER_EXAMPLE)).toMatchObject({ value: result.value, error: expect.any(String) });
    expect(appendOfferContext("字".repeat(8000), "新增")).toMatchObject({ value: "字".repeat(8000), error: expect.any(String) });
  });
});
