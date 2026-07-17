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

  it("recommends craft from 修仙/审讯 keywords", () => {
    expect(recommendCraftShotFromTopic("修仙洞府奇遇").craftShotId).toBe("cam_07_wide_scale");
    expect(recommendCraftShotFromTopic("审讯室精算对峙").craftShotId).toBe("light_07_top_cut");
  });

  it("recommends craft from 群戏 keyword", () => {
    expect(recommendCraftShotFromTopic("派对群戏围观翻盘").craftShotId).toBe("emo_06_ensemble_pulse");
  });

  it("recommends craft from 校园 keyword", () => {
    expect(recommendCraftShotFromTopic("校园教室校服青春").craftShotId).toBe("light_01_window_motivated");
  });

  it("recommends craft from 末日 keyword", () => {
    expect(recommendCraftShotFromTopic("废土避难所末日求生").craftShotId).toBe("cam_07_wide_scale");
  });

  it("recommends craft from 科幻 keyword", () => {
    expect(recommendCraftShotFromTopic("星际飞船赛博全息").craftShotId).toBe("cam_07_wide_scale");
  });

  it("recommends craft from 密室/黑客 keyword", () => {
    expect(recommendCraftShotFromTopic("密室黑客入侵信息战").craftShotId).toBe("light_07_top_cut");
  });

  it("recommends craft from 边塞/卡点 keywords", () => {
    expect(recommendCraftShotFromTopic("边塞烽火出征").craftShotId).toBe("cam_07_wide_scale");
    expect(recommendCraftShotFromTopic("声先画后硬切卡点").craftShotId).toBe("tr_05_audio_lead");
  });

  it("recommends craft from 古风 keyword", () => {
    expect(recommendCraftShotFromTopic("古风皇宫长安府邸").craftShotId).toBe("light_03_high_contrast");
  });

  it("recommends craft from 武侠 keyword", () => {
    expect(recommendCraftShotFromTopic("江湖刀光比武").craftShotId).toBe("cam_03_track_follow");
  });

  it("recommends craft from 谍战 keyword before 对峙泛词", () => {
    expect(recommendCraftShotFromTopic("谍战卧底情报对峙").craftShotId).toBe("light_07_top_cut");
  });
});
