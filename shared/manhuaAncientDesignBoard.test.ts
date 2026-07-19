import { describe, expect, it } from "vitest";
import {
  buildAncientArchetypePrompt,
  formatAncientDesignBoardBrief,
  getAncientArchetypePreviewUrl,
} from "./manhuaAncientDesignBoard.js";
import {
  getAncientArchetypeById,
  listAncientArchetypes,
  MANHUA_ANCIENT_ARCHETYPE_LIBRARY,
} from "./manhuaAncientArchetypeLibrary.js";

describe("manhuaAncientDesignBoard + archetype library", () => {
  it("ships exactly 7 archetypes without brand watermark", () => {
    expect(MANHUA_ANCIENT_ARCHETYPE_LIBRARY).toHaveLength(7);
    for (const b of MANHUA_ANCIENT_ARCHETYPE_LIBRARY) {
      expect(b.id.startsWith("arch_")).toBe(true);
      expect(JSON.stringify(b)).not.toMatch(/元点/);
      expect(getAncientArchetypePreviewUrl(b.id)).toBe(`/manhua-characters/ancient/${b.id}_sheet.jpg`);
    }
  });

  it("builds formula prompts for standard / weathered / physician", () => {
    const sword = getAncientArchetypeById("arch_xianmen_sword_cold")!;
    const dao = getAncientArchetypeById("arch_rain_jianghu_dao")!;
    const doc = getAncientArchetypeById("arch_yaolu_physician")!;
    expect(buildAncientArchetypePrompt(sword)).toContain("服饰层次");
    expect(buildAncientArchetypePrompt(dao)).toContain("服饰旧化");
    expect(buildAncientArchetypePrompt(doc)).toContain("医者道具");
    expect(formatAncientDesignBoardBrief(sword)).toContain("【古风原型·设计板】");
  });

  it("filters by lane", () => {
    const xianxia = listAncientArchetypes({ lane: "xianxia" });
    expect(xianxia.every((b) => b.lane === "xianxia")).toBe(true);
    expect(xianxia.length).toBeGreaterThanOrEqual(3);
  });
});
