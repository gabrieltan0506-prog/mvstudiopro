import { describe, expect, it } from "vitest";
import {
  MANHUA_CHARACTER_ASSET_LIBRARY,
  MANHUA_CHARACTER_FORMULA_ZH,
  buildManhuaCharacterPromptBlock,
  getManhuaCharacterById,
  listManhuaCharactersByGender,
} from "./manhuaCharacterAssetLibrary";

describe("manhuaCharacterAssetLibrary", () => {
  it("has both male and female leads from CH 设定卡", () => {
    expect(MANHUA_CHARACTER_ASSET_LIBRARY.length).toBeGreaterThanOrEqual(28);
    expect(listManhuaCharactersByGender("female").length).toBeGreaterThanOrEqual(14);
    expect(listManhuaCharactersByGender("male").length).toBeGreaterThanOrEqual(13);
    expect(MANHUA_CHARACTER_FORMULA_ZH).toContain("脸型");
  });

  it("looks up by id and builds inject block", () => {
    const m = getManhuaCharacterById("char_m_02");
    expect(m?.nameZh).toBe("傅临渊");
    const f = getManhuaCharacterById("char_f_07");
    expect(f?.nameZh).toBe("唐若曦");
    const block = buildManhuaCharacterPromptBlock(["char_f_07", "char_m_02"]);
    expect(block).toContain("唐若曦");
    expect(block).toContain("傅临渊");
    expect(block).toContain("【角色库锚点】");
  });
});
