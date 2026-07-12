import { describe, expect, it } from "vitest";
import { CREDIT_COSTS, platformSkillQaImageCredits } from "../../shared/plans";

describe("platformSkillQaImageCredits", () => {
  it("首张九折，其后封面原价", () => {
    expect(platformSkillQaImageCredits(0)).toEqual({
      cost: CREDIT_COSTS.platformSkillQaImageFirst,
      isFirstDiscount: true,
    });
    expect(platformSkillQaImageCredits(1)).toEqual({
      cost: CREDIT_COSTS.platformTopicFrameGraphic,
      isFirstDiscount: false,
    });
    expect(CREDIT_COSTS.platformSkillQaImageFirst).toBe(
      Math.round(CREDIT_COSTS.platformTopicFrameGraphic * 0.9),
    );
  });
});
