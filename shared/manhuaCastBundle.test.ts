import { describe, expect, it } from "vitest";
import { recommendManhuaCastBundle } from "./manhuaCastBundle.js";

describe("recommendManhuaCastBundle", () => {
  it("古装权谋江湖 → ancient 原型，不塞西装男女主", () => {
    const b = recommendManhuaCastBundle({
      topic: "古装权谋江湖朝堂密谋刀客复仇",
    });
    expect(b.lane).toBe("ancient");
    expect(b.characterIds).toEqual([]);
    expect(b.femaleId).toBe("");
    expect(b.maleId).toBe("");
    expect(b.ancientArchetypeIds.length).toBeGreaterThanOrEqual(1);
    expect(b.ancientArchetypeIds.some((id) => id.startsWith("arch_"))).toBe(true);
    expect(b.wardrobePropContinuityIds.length).toBeGreaterThanOrEqual(1);
    expect(b.propIds.length).toBeGreaterThanOrEqual(1);
    expect(b.identityLockZh).toMatch(/跟剧本|古风/);
  });

  it("华尔街商战外国人 → urban，允许非华人身份锁", () => {
    const b = recommendManhuaCastBundle({
      topic: "华尔街商战权谋 外国投资人",
    });
    expect(b.lane).toBe("urban");
    expect(b.ancientArchetypeIds).toEqual([]);
    expect(b.characterIds.length).toBe(2);
    expect(b.wardrobePropContinuityIds).toContain("wpc_03_urban_power");
    expect(b.identityLockZh).toMatch(/海外|非华人|外国/);
  });

  it("校园甜宠 → urban，不套江湖刀客甲胄", () => {
    const b = recommendManhuaCastBundle({ topic: "校园甜宠恋爱" });
    expect(b.lane).toBe("urban");
    expect(b.ancientArchetypeIds).toEqual([]);
    expect(b.characterIds.length).toBe(2);
    expect(b.wardrobePropContinuityIds).not.toContain("wpc_02_jianghu_dao");
    expect(b.wardrobePropContinuityIds).not.toContain("wpc_04_red_armor");
  });
});
