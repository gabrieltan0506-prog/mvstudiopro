import { describe, expect, it } from "vitest";
import {
  PHOTOREAL_FACE_SHAPE_FEMALE,
  PHOTOREAL_FACE_SHAPE_MALE,
  PHOTOREAL_LOCK_FACE_NOT_WARDROBE_ZH,
  formatPhotorealFaceShapeBlock,
  getPhotorealFaceShapeForId,
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
});
