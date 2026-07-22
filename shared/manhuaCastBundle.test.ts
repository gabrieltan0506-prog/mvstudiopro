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

  it("江湖刀光打斗交锋的短剧 → ancient，不塞西装角色，不推口红戒指盒", () => {
    const b = recommendManhuaCastBundle({ topic: "江湖刀光打斗交锋的短剧" });
    expect(b.lane).toBe("ancient");
    expect(b.characterIds).toEqual([]);
    expect(b.femaleId).toBe("");
    expect(b.maleId).toBe("");
    expect(b.ancientArchetypeIds).toContain("arch_rain_jianghu_dao");
    // 对位可混搭宫廷服化轨（防单一江湖审美疲劳）；手选可改；不锁性别
    expect(b.ancientArchetypeIds.length).toBeGreaterThanOrEqual(1);
    expect(b.wardrobePropContinuityIds).toContain("wpc_02_jianghu_dao");
    expect(b.propIds.every((id) => !/lipstick|ring_box|fountain_pen/i.test(id))).toBe(true);
    expect(b.propIds.some((id) => id.includes("ancient") || id.includes("intrigue"))).toBe(true);
  });

  it("江湖权谋含朝堂宫廷 → 刀客服化轨与宫廷服化轨可混搭", () => {
    const b = recommendManhuaCastBundle({
      topic: "江湖权谋刀客入朝，朝堂宫廷步步为营",
      charactersMd: "雨夜刀客入朝；宫廷权谋凤仪",
    });
    expect(b.lane).toBe("ancient");
    expect(b.characterIds).toEqual([]);
    expect(b.ancientArchetypeIds).toContain("arch_rain_jianghu_dao");
    expect(b.ancientArchetypeIds).toContain("arch_phoenix_empress");
    expect(b.wardrobePropContinuityIds).toEqual(
      expect.arrayContaining(["wpc_02_jianghu_dao", "wpc_07_court_phoenix"]),
    );
  });

  it("题材含糊但编剧人物表已是交领外袍 → 纠回 ancient", () => {
    const b = recommendManhuaCastBundle({
      topic: "父辈拔刀成仇儿女执手破局",
      charactersMd:
        "沈照野｜墨黑高马尾，玄青窄袖外袍叠银灰交领内衫，左肩皮甲｜顾青棠｜暗红短褙子叠月白内衫，黑色护腕",
    });
    expect(b.lane).toBe("ancient");
    expect(b.characterIds).toEqual([]);
    expect(b.ancientArchetypeIds.length).toBeGreaterThanOrEqual(1);
  });
});
