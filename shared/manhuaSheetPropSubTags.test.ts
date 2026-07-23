import { describe, expect, it } from "vitest";
import type { ManhuaWriterAssetCanon } from "./manhuaWriterAssetCanon";
import {
  buildManhuaSheetPropSubSlots,
  parseManhuaSheetPropSubTagsFromPrompt,
  stampManhuaSheetPropSubTagsOnPrompt,
} from "./manhuaSheetPropSubTags";

const canon: ManhuaWriterAssetCanon = {
  characters: [
    {
      id: "wa_char_hero",
      role: "character",
      nameZh: "沈少主",
      lookZh: "玄色锦袍，腰佩玉佩",
      promptZh: "沈少主",
    },
    {
      id: "wa_char_heroine",
      role: "character",
      nameZh: "柳姑娘",
      lookZh: "青衣长裙",
      promptZh: "柳姑娘",
    },
  ],
  props: [
    {
      id: "wa_prop_jade",
      role: "prop",
      nameZh: "玉佩",
      lookZh: "温润白玉",
      noteZh: "沈少主信物",
      promptZh: "玉佩",
    },
    {
      id: "wa_prop_fan",
      role: "prop",
      nameZh: "折扇",
      lookZh: "乌木折扇",
      noteZh: "柳姑娘随身",
      promptZh: "折扇",
    },
  ],
  locations: [],
  episodeMainSceneId: {},
};

describe("manhuaSheetPropSubTags", () => {
  it("assigns global @道具N and per-sheet sub tags", () => {
    const slots = buildManhuaSheetPropSubSlots({
      assetCanon: canon,
      characterTagById: {
        wa_char_hero: "@角色1",
        wa_char_heroine: "@角色2",
      },
      sheetUrlByCharacterId: {
        wa_char_hero: "https://cdn.example/hero-sheet.jpg",
      },
    });
    expect(slots.length).toBeGreaterThanOrEqual(1);
    const jade = slots.find((s) => s.propId === "wa_prop_jade");
    expect(jade?.propTag).toMatch(/^@道具\d+$/);
    expect(jade?.subTag).toBe("@角色1·道具1");
    expect(jade?.parentCharacterTag).toBe("@角色1");
    expect(jade?.path).toContain("hero-sheet.jpg");

    const fan = slots.find((s) => s.propId === "wa_prop_fan");
    expect(fan?.subTag).toBe("@角色2·道具1");
    expect(fan?.path).toMatch(/^logical:\/\//);
  });

  it("keeps same propId on same @道具N across characters (cross-episode lock)", () => {
    const a = buildManhuaSheetPropSubSlots({ assetCanon: canon });
    const b = buildManhuaSheetPropSubSlots({ assetCanon: canon });
    const tagA = a.find((s) => s.propId === "wa_prop_jade")?.propTag;
    const tagB = b.find((s) => s.propId === "wa_prop_jade")?.propTag;
    expect(tagA).toBeTruthy();
    expect(tagA).toBe(tagB);
  });

  it("stamps and parses sub-tag lines on charsheet prompt", () => {
    const slots = buildManhuaSheetPropSubSlots({
      assetCanon: canon,
      characterTagById: { wa_char_hero: "@角色1" },
    }).filter((s) => s.parentCharacterTag === "@角色1");
    const stamped = stampManhuaSheetPropSubTagsOnPrompt("女主定妆", slots, "@角色1");
    expect(stamped).toContain("【定妆特写·道具子编号·跨集锁】");
    expect(stamped).toContain("@角色1·道具");
    const parsed = parseManhuaSheetPropSubTagsFromPrompt(stamped);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0]?.propTag).toMatch(/^@道具\d+$/);
  });
});
