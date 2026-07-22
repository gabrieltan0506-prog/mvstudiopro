import { describe, expect, it } from "vitest";
import {
  buildManhuaStylePackDraft,
  evaluateManhuaStylePackQuality,
  formatManhuaStylePackInjectBlock,
  normalizeManhuaStyleHex,
  parseManhuaStylePack,
} from "./manhuaStylePack";

const VALID = {
  nameZh: "雨夜冷青",
  artLockZh: "冷青主色，侧逆光，竖屏中近景，压抑对峙情绪。",
  primaryColors: ["#1A2B3C", "#2E4057", "#0F1C2E"],
  secondaryColors: ["#4A6FA5", "#6B8F71", "#8B7355", "#C4A35A", "#3D3D3D"],
  accentColors: ["#C23B22", "#E8D5B7"],
  lightingZh: "主光侧逆，明暗比约 4:1，眼神高光克制",
  textureZh: "湿青石与旧木纹可读",
  compositionZh: "竖屏中景，前景廊柱遮挡",
  cameraRhythmZh: "段内慢推一事，景别递进",
};

describe("manhuaStylePack", () => {
  it("normalizes hex", () => {
    expect(normalizeManhuaStyleHex("1a2b3c")).toBe("#1A2B3C");
    expect(normalizeManhuaStyleHex("#ff00aa")).toBe("#FF00AA");
    expect(normalizeManhuaStyleHex("bad")).toBeNull();
  });

  it("parses and injects valid pack", () => {
    const pack = parseManhuaStylePack(VALID);
    expect(pack?.nameZh).toBe("雨夜冷青");
    expect(evaluateManhuaStylePackQuality(pack).ok).toBe(true);
    const block = formatManhuaStylePackInjectBlock(pack);
    expect(block).toContain("强视觉锁");
    expect(block).toContain("#1A2B3C");
    expect(block).not.toMatch(/OpenAI|GPT|EvoLink/i);
  });

  it("draft is incomplete until colors filled", () => {
    const draft = buildManhuaStylePackDraft({
      artStyleLabelZh: "仿真人",
      sceneKeywordsZh: ["雨夜", "回廊"],
    });
    expect(parseManhuaStylePack(draft)).toBeNull();
    expect(evaluateManhuaStylePackQuality(parseManhuaStylePack({
      ...VALID,
      ...draft,
      primaryColors: VALID.primaryColors,
      secondaryColors: VALID.secondaryColors,
      accentColors: VALID.accentColors,
    })).ok).toBe(true);
  });
});
