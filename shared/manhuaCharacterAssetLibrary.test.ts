import { describe, expect, it } from "vitest";
import {
  MANHUA_CHARACTER_ASSET_LIBRARY,
  MANHUA_CHARACTER_FORMULA_ZH,
  buildManhuaCharacterPromptBlock,
  buildManhuaCharacterSheetGenPrompt,
  getManhuaCharacterById,
  getManhuaCharacterPreviewUrl,
  listManhuaCharactersByGender,
  recommendManhuaArtStyleFromTopic,
  recommendManhuaCharactersFromTopic,
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
    const block = buildManhuaCharacterPromptBlock(["char_f_07", "char_m_02"], {
      artStyleId: "cg_drama",
    });
    expect(block).toContain("唐若曦");
    expect(block).toContain("傅临渊");
    expect(block).toContain("【角色库锚点】");
    expect(block).toContain("【画风】");
    expect(block).toContain("CG 漫剧");
    expect(getManhuaCharacterPreviewUrl("char_f_07")).toBe("/manhua-characters/char_f_07.jpg");
  });

  it("recommends art style from topic", () => {
    expect(recommendManhuaArtStyleFromTopic("都市霸总职场情感").artStyleId).toBe("photoreal");
    expect(recommendManhuaArtStyleFromTopic("仙侠修仙权谋翻盘").artStyleId).toBe("cg_drama");
    expect(recommendManhuaArtStyleFromTopic("轻松日常漫画搞笑").artStyleId).toBe("manga_2d");
  });

  it("4.B recommends cool female + elite male for 权谋题材", () => {
    const rec = recommendManhuaCharactersFromTopic("女主权谋翻盘的情感连载，宫墙内外步步为营");
    expect(rec.femaleId).toBeTruthy();
    expect(rec.maleId).toBeTruthy();
    expect(rec.reasonZh).toMatch(/题材|气质/);
    const female = getManhuaCharacterById(rec.femaleId!);
    expect(female?.temperamentTags.join("")).toMatch(/清冷|克制|冷静|冷感|疏离|气场/);
  });

  it("4.B falls back to stable defaults when topic empty", () => {
    const rec = recommendManhuaCharactersFromTopic("");
    expect(rec.femaleId).toBe("char_f_01");
    expect(rec.maleId).toBe("char_m_02");
  });

  it("builds same-layout character sheet prompt", () => {
    const prompt = buildManhuaCharacterSheetGenPrompt({
      characterId: "char_f_01",
      artStyleId: "cg_drama",
    });
    expect(prompt).toContain("FRONT / SIDE / BACK");
    expect(prompt).toContain("沈清辞");
    expect(prompt).toContain("新面孔新人");
    expect(prompt).toContain("CG 漫剧");
  });
});
