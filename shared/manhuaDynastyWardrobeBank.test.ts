import { describe, expect, it } from "vitest";
import {
  formatDynastyWardrobeInjectBlock,
  formatRecommendedDynastyWardrobeBlock,
  recommendDynastyWardrobeFromText,
} from "./manhuaDynastyWardrobeBank";
import { MANHUA_CLIP_PITFALL_GUARD_BLOCK } from "./manhuaDramaPitfallGuard";

describe("manhuaDynastyWardrobeBank", () => {
  it("lookup still works for explicit pick UI", () => {
    const e = recommendDynastyWardrobeFromText("盛唐贵女齐胸襦裙宫廷复仇");
    expect(e?.id).toBe("dyn_tang");
    expect(formatRecommendedDynastyWardrobeBlock("唐朝贵女")).toContain("朝代服饰锚点");
  });

  it("injects only when ids are explicit", () => {
    expect(formatDynastyWardrobeInjectBlock([])).toBe("");
    expect(formatDynastyWardrobeInjectBlock(undefined)).toBe("");
    expect(formatDynastyWardrobeInjectBlock(["dyn_tang"])).toContain("齐胸襦裙");
  });
});

describe("manhuaDramaPitfallGuard", () => {
  it("is internal memo only (not for user prompt injection)", () => {
    expect(MANHUA_CLIP_PITFALL_GUARD_BLOCK).toContain("内部");
    expect(MANHUA_CLIP_PITFALL_GUARD_BLOCK).toContain("脸服场");
    expect(MANHUA_CLIP_PITFALL_GUARD_BLOCK.split("\n").length).toBeLessThan(12);
  });
});
