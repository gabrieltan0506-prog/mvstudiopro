import { describe, expect, it } from "vitest";
import { getPlatformTrendReportCredits } from "./platformTrendPricing";

describe("趋势报告按时间范围计费", () => {
  it.each([[3, 50], [7, 80], [15, 120]])("近%s天为%s积分", (days, credits) => {
    expect(getPlatformTrendReportCredits(days)).toBe(credits);
  });
  it.each([0, 1, 4, 30, 45, 90, NaN])("不把不支持的窗口%s静默按低价计费", days => {
    expect(() => getPlatformTrendReportCredits(days)).toThrow("仅支持");
  });
});
