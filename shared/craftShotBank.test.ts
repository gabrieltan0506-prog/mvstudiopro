import { describe, expect, it } from "vitest";
import {
  CRAFT_SHOT_BANK,
  buildCraftShotInjectBlock,
  getCraftShotById,
  listCraftShotsByCategory,
  recommendCraftShotFromTopic,
} from "./craftShotBank";

describe("craftShotBank ⑧A", () => {
  it("has categorized atomic craft entries", () => {
    expect(CRAFT_SHOT_BANK.length).toBeGreaterThanOrEqual(28);
    expect(listCraftShotsByCategory("lighting").length).toBe(8);
    expect(listCraftShotsByCategory("camera").length).toBe(8);
    expect(listCraftShotsByCategory("emotion").length).toBe(8);
    expect(listCraftShotsByCategory("transition").length).toBe(6);
  });

  it("builds inject block without director/vendor names", () => {
    const e = getCraftShotById("light_03_high_contrast");
    expect(e?.nameZh).toContain("高反差");
    const block = buildCraftShotInjectBlock(["light_03_high_contrast", "cam_01_slow_push"]);
    expect(block).toContain("手法条目库");
    expect(block).toContain("高反差");
    expect(block).toContain("缓慢推进");
    expect(block).not.toMatch(/Nolan|王家卫|HyperFrames|小蓝|EvoLink|fal/i);
  });

  it("recommends craft shot from 权谋 topic", () => {
    const rec = recommendCraftShotFromTopic("女主权谋翻盘，宫墙对峙");
    expect(rec.craftShotId).toBe("light_03_high_contrast");
    expect(rec.reasonZh).toMatch(/权谋|宫斗|对峙|宫墙/);
  });

  it("recommends craft shot from 雨夜霓虹 topic", () => {
    const rec = recommendCraftShotFromTopic("雨夜霓虹街头错过");
    expect(rec.craftShotId).toBe("light_05_neon_spill");
  });
});
