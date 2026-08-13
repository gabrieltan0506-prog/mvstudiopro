import { describe, expect, it } from "vitest";
import {
  getPlatformTrendReportCredits,
  isPlatformTrendCoverPromo,
} from "./platformTrendPricing";

describe("platformTrendPricing", () => {
  it("9 月 15 日北京时间结束前保持 50 分并赠送封面页", () => {
    const at = Date.parse("2026-09-15T23:59:59+08:00");
    expect(getPlatformTrendReportCredits(3, at)).toBe(50);
    expect(getPlatformTrendReportCredits(7, at)).toBe(50);
    expect(isPlatformTrendCoverPromo(7, at)).toBe(true);
  });

  it("9 月 16 日北京时间起切为 60 分", () => {
    const at = Date.parse("2026-09-16T00:00:00+08:00");
    expect(getPlatformTrendReportCredits(3, at)).toBe(60);
    expect(getPlatformTrendReportCredits(7, at)).toBe(60);
    expect(getPlatformTrendReportCredits(15, at)).toBe(50);
    expect(isPlatformTrendCoverPromo(7, at)).toBe(false);
  });
});
