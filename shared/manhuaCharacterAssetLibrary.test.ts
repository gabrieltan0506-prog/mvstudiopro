import { describe, expect, it } from "vitest";
import {
  MANHUA_CHARACTER_ASSET_LIBRARY,
  MANHUA_CHARACTER_FORMULA_ZH,
  MANHUA_COUPLE_PACKS,
  MANHUA_TEMPERAMENT_PACKS,
  buildManhuaCharacterPromptBlock,
  buildManhuaCharacterClipboardText,
  buildManhuaCharacterSheetGenPrompt,
  buildManhuaDualLeadBrief,
  characterMatchesTemperamentPack,
  getManhuaCharacterById,
  getManhuaCharacterPreviewUrl,
  getManhuaCharacterLifeStage,
  listManhuaCharactersByAgeBand,
  listManhuaCharactersByGender,
  listManhuaCharactersByLifeStage,
  listManhuaCharactersForLibraryTab,
  parseManhuaCoupleSelection,
  parseManhuaFavoriteIds,
  recommendManhuaArtStyleFromTopic,
  recommendManhuaCharactersFromTopic,
  recommendManhuaCouplePacksFromTopic,
  serializeManhuaCoupleSelection,
  serializeManhuaFavoriteIds,
  suggestManhuaContrastPartner,
  suggestManhuaSameFieldPartner,
} from "./manhuaCharacterAssetLibrary";

describe("manhuaCharacterAssetLibrary", () => {
  it("has both male and female leads from CH 设定卡", () => {
    expect(MANHUA_CHARACTER_ASSET_LIBRARY.length).toBeGreaterThanOrEqual(36);
    expect(listManhuaCharactersByGender("female").length).toBeGreaterThanOrEqual(14);
    expect(listManhuaCharactersByGender("male").length).toBeGreaterThanOrEqual(13);
    expect(
      listManhuaCharactersByGender("female").every((c) => getManhuaCharacterLifeStage(c) === "adult"),
    ).toBe(true);
    expect(
      listManhuaCharactersByGender("female", { lifeStage: "any" }).some((c) => c.lifeStage === "child"),
    ).toBe(true);
    expect(MANHUA_CHARACTER_FORMULA_ZH).toContain("脸型");
  });

  it("filters elder/child lifeStage and library tabs", () => {
    const elders = listManhuaCharactersByLifeStage("elder");
    const children = listManhuaCharactersByLifeStage("child");
    expect(elders.length).toBe(4);
    expect(children.length).toBe(4);
    expect(elders.every((c) => getManhuaCharacterLifeStage(c) === "elder")).toBe(true);
    expect(children.every((c) => /^char_(boy|girl)_/.test(c.id))).toBe(true);
    expect(listManhuaCharactersForLibraryTab("elder").map((c) => c.id)).toEqual(
      elders.map((c) => c.id),
    );
    expect(listManhuaCharactersForLibraryTab("child").length).toBe(4);
    expect(listManhuaCharactersByAgeBand("elder").length).toBe(4);
    expect(getManhuaCharacterPreviewUrl("char_boy_01", { artStyleId: "photoreal" })).toBe(
      "/manhua-characters/photoreal/char_boy_01_sheet.jpg",
    );
    expect(getManhuaCharacterPreviewUrl("char_elder_f_01")).toBe(
      "/manhua-characters/photoreal/char_elder_f_01_sheet.jpg",
    );
  });

  it("topic recommend stays adult leads only", () => {
    const rec = recommendManhuaCharactersFromTopic("甜宠恋爱校园");
    expect(rec.femaleId).toBeTruthy();
    expect(rec.maleId).toBeTruthy();
    expect(getManhuaCharacterLifeStage(getManhuaCharacterById(rec.femaleId!))).toBe("adult");
    expect(getManhuaCharacterLifeStage(getManhuaCharacterById(rec.maleId!))).toBe("adult");
    expect(rec.femaleId).not.toMatch(/boy|girl|elder/);
    expect(rec.maleId).not.toMatch(/boy|girl|elder/);
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
    expect(block).toContain("预览图：/manhua-characters/char_f_07.jpg");
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

  it("photoreal child sheet prompt includes family-safe cast block", () => {
    const prompt = buildManhuaCharacterSheetGenPrompt({
      characterId: "char_girl_01",
      artStyleId: "photoreal",
    });
    expect(prompt).toMatch(/剧用儿童|8–12/);
    expect(prompt).toMatch(/校服|全家宜|G 级/);
    expect(prompt).toMatch(/去美颜|禁止全员帅哥美女/);
  });

  it("builds clipboard text for a single character", () => {
    const text = buildManhuaCharacterClipboardText("char_f_01", { artStyleId: "manga_2d" });
    expect(text).toContain("沈清辞");
    expect(text).toContain("二维漫画");
    expect(text).toContain("提示词：");
  });

  it("couple packs and temperament packs stay consistent", () => {
    expect(MANHUA_COUPLE_PACKS.length).toBeGreaterThanOrEqual(10);
    for (const p of MANHUA_COUPLE_PACKS) {
      expect(getManhuaCharacterById(p.femaleId)?.gender).toBe("female");
      expect(getManhuaCharacterById(p.maleId)?.gender).toBe("male");
    }
    const cold = MANHUA_TEMPERAMENT_PACKS.find((x) => x.id === "cold_elite");
    expect(cold).toBeTruthy();
    expect(
      MANHUA_CHARACTER_ASSET_LIBRARY.filter((c) => characterMatchesTemperamentPack(c, cold)).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("serializes favorites and couple selection", () => {
    const fav = parseManhuaFavoriteIds(serializeManhuaFavoriteIds(["char_f_01", "nope"]));
    expect(fav).toEqual(["char_f_01"]);
    const couple = parseManhuaCoupleSelection(
      serializeManhuaCoupleSelection({
        femaleId: "char_f_01",
        maleId: "char_m_02",
        artStyleId: "photoreal",
      }),
    );
    expect(couple?.femaleId).toBe("char_f_01");
    expect(couple?.maleId).toBe("char_m_02");
    expect(couple?.artStyleId).toBe("photoreal");
  });

  it("soft-recommends couple packs and contrast partners", () => {
    const packs = recommendManhuaCouplePacksFromTopic("都市霸总职场情感");
    expect(packs.packIds).toContain("urban_cold");
    const contrast = suggestManhuaContrastPartner("char_f_01", { limit: 3 });
    expect(contrast.length).toBeGreaterThan(0);
    expect(contrast.every((c) => c.gender === "male")).toBe(true);
  });

  it("suggests same-field partners by job tokens", () => {
    // 钢琴演奏家 → 钢琴家
    const peers = suggestManhuaSameFieldPartner("char_f_03", { limit: 5 });
    expect(peers.some((c) => c.id === "char_m_04")).toBe(true);
  });

  it("builds dual lead brief", () => {
    const brief = buildManhuaDualLeadBrief("char_f_01", "char_m_02", { artStyleId: "photoreal" });
    expect(brief).toContain("女主：沈清辞");
    expect(brief).toContain("男主：傅临渊");
    expect(brief).toContain("仿真人");
  });
});
