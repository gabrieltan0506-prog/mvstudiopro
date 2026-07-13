import { describe, expect, it } from "vitest";
import {
  PLATFORM_FASHION_EDITORIAL_CHARACTER_EN,
  PLATFORM_FASHION_EDITORIAL_CHARACTER_ZH,
  PLATFORM_SCENE_WARDROBE_LOCK_EN,
  PLATFORM_SCENE_WARDROBE_LOCK_ZH,
  appendFashionEditorialCharacterGuidance,
} from "../../shared/platformFashionEditorialCharacter";

describe("platformFashionEditorialCharacter scene wardrobe lock", () => {
  it("forbids overcoat-on-tennis absurdity in zh/en locks", () => {
    expect(PLATFORM_SCENE_WARDROBE_LOCK_ZH).toMatch(/禁止.*外套.*网球|网球.*禁止/);
    expect(PLATFORM_SCENE_WARDROBE_LOCK_EN).toMatch(/NEVER absurd mismatches/i);
    expect(PLATFORM_SCENE_WARDROBE_LOCK_EN).toMatch(/overcoat while playing tennis/i);
    expect(PLATFORM_FASHION_EDITORIAL_CHARACTER_ZH).toContain("场景服饰·防穿帮硬锁");
    expect(PLATFORM_FASHION_EDITORIAL_CHARACTER_EN).toContain("SCENE-WARDROBE HARD LOCK");
  });

  it("appends wardrobe lock when base already has fashion block without it", () => {
    const out = appendFashionEditorialCharacterGuidance("【人物造型·国际时尚大片】旧文案无防穿帮", {
      lang: "zh",
    });
    expect(out).toContain("场景服饰·防穿帮硬锁");
  });
});
