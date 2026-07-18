import { describe, expect, it } from "vitest";
import {
  PHOTOREAL_ANTI_BEAUTY_FILTER_ZH,
  PHOTOREAL_CHILD_CAST_ZH,
  PHOTOREAL_ELDER_CAST_ZH,
  PHOTOREAL_FACE_SHAPE_FEMALE,
  PHOTOREAL_FACE_SHAPE_MALE,
  PHOTOREAL_LOCK_FACE_NOT_WARDROBE_ZH,
  PHOTOREAL_FACE_LOCK_BLEND_ZH,
  PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
  PHOTOREAL_SOFT_REF_SKIN_ONLY_ZH,
  formatPhotorealFaceShapeBlock,
  getPhotorealFaceShapeForId,
  photorealLifeStagePromptBlock,
} from "./photorealCharacterPrompt.js";

describe("photoreal face shape wheel", () => {
  it("stable per id", () => {
    const a = getPhotorealFaceShapeForId("char_f_03", "female");
    const b = getPhotorealFaceShapeForId("char_f_03", "female");
    expect(a.id).toBe(b.id);
    expect(a.labelZh).toBeTruthy();
  });

  it("spreads female ids across more than one shape", () => {
    const ids = Array.from({ length: 15 }, (_, i) => `char_f_${String(i + 1).padStart(2, "0")}`);
    const shapes = new Set(ids.map((id) => getPhotorealFaceShapeForId(id, "female").id));
    expect(shapes.size).toBeGreaterThan(5);
    expect(PHOTOREAL_FACE_SHAPE_FEMALE.length).toBe(15);
  });

  it("spreads male ids", () => {
    const ids = Array.from({ length: 14 }, (_, i) => `char_m_${String(i + 1).padStart(2, "0")}`);
    const shapes = new Set(ids.map((id) => getPhotorealFaceShapeForId(id, "male").id));
    expect(shapes.size).toBeGreaterThan(5);
    expect(PHOTOREAL_FACE_SHAPE_MALE.length).toBe(14);
  });

  it("format block bans tip chin", () => {
    const block = formatPhotorealFaceShapeBlock("char_m_01", "male");
    expect(block).toMatch(/反同质下巴|禁止/);
    expect(PHOTOREAL_LOCK_FACE_NOT_WARDROBE_ZH).toMatch(/锁脸不锁服/);
  });

  it("skin locks and face-lock blend policy", () => {
    expect(PHOTOREAL_SKIN_TEXTURE_LOCK_ZH).toMatch(/毛孔/);
    expect(PHOTOREAL_SKIN_TEXTURE_LOCK_ZH).toMatch(/禁止.*瓷器|蜡像/);
    expect(PHOTOREAL_SOFT_REF_SKIN_ONLY_ZH).toMatch(/禁止复制参考图五官/);
    expect(PHOTOREAL_FACE_LOCK_BLEND_ZH).toMatch(/皮肤|轮廓/);
    expect(PHOTOREAL_FACE_LOCK_BLEND_ZH).toMatch(/禁止.*网红|美颜|整容/);
    expect(PHOTOREAL_ANTI_BEAUTY_FILTER_ZH).toMatch(/去美颜|禁止全员帅哥美女/);
  });

  it("elder and child cast hard blocks", () => {
    expect(PHOTOREAL_ELDER_CAST_ZH).toMatch(/60–75|花白|法令纹/);
    expect(PHOTOREAL_CHILD_CAST_ZH).toMatch(/8–12/);
    expect(PHOTOREAL_CHILD_CAST_ZH).toMatch(/禁止.*性暗示|暴露/);
    expect(photorealLifeStagePromptBlock("elder")).toContain("老人");
    expect(photorealLifeStagePromptBlock("child")).toContain("剧用儿童");
    expect(photorealLifeStagePromptBlock("adult")).toBe("");
  });
});
