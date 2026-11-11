import { describe, it, expect } from "vitest";
import {
  NOVEL_ADVISOR_PROMO_UNTIL,
  NOVEL_ADVISOR_TIER_OPTIONS,
  resolveNovelAdvisorTierPrice,
} from "./novelWorkspace";

const tier = (value: string) => NOVEL_ADVISOR_TIER_OPTIONS.find(o => o.value === value)!;

describe("创作顾问档位价格（卓越档限时特价截至 11-30）", () => {
  it("截止前：卓越显示特价 20、原价 40", () => {
    expect(resolveNovelAdvisorTierPrice(tier("carbon"), new Date("2026-11-30T23:59:59+08:00"))).toEqual({
      credits: 20,
      originalCredits: 40,
      promo: true,
    });
  });
  it("12-01 零点（东八区）起恢复 40，不再带特价", () => {
    expect(NOVEL_ADVISOR_PROMO_UNTIL).toBe("2026-12-01T00:00:00+08:00");
    expect(resolveNovelAdvisorTierPrice(tier("carbon"), new Date("2026-12-01T00:00:00+08:00"))).toEqual({ credits: 40, promo: false });
    expect(resolveNovelAdvisorTierPrice(tier("carbon"), Date.parse("2027-01-05T00:00:00Z"))).toEqual({ credits: 40, promo: false });
  });
  it("优秀 10、完美 5 不随时间变化", () => {
    for (const at of [new Date("2026-11-12T00:00:00+08:00"), new Date("2026-12-02T00:00:00+08:00")]) {
      expect(resolveNovelAdvisorTierPrice(tier("glm"), at)).toEqual({ credits: 10, promo: false });
      expect(resolveNovelAdvisorTierPrice(tier("deepseek"), at)).toEqual({ credits: 5, promo: false });
    }
  });
});
