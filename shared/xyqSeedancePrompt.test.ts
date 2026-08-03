import { describe, expect, it } from "vitest";
import {
  buildXyqExtendInstruction,
  buildXyqRemixInstruction,
  buildXyqReshootInstruction,
  composeXyqSeedance25Prompt,
  formatXyqTimestampStoryboardLines,
  hasXyqTimestampStoryboard,
  parseXyqSeedance25WorkMode,
} from "./xyqSeedancePrompt";

describe("xyqSeedancePrompt", () => {
  it("detects timestamp storyboard", () => {
    expect(hasXyqTimestampStoryboard("0-5秒：开场")).toBe(true);
    expect(hasXyqTimestampStoryboard("主角走进雨夜")).toBe(false);
  });

  it("formats storyboard lines", () => {
    const out = formatXyqTimestampStoryboardLines("0-5 | 环绕半周\n5-12 | 推近面部", 15);
    expect(out).toContain("0-5秒：环绕半周");
    expect(out).toContain("5-12秒：推近面部");
    expect(out).toContain("15 秒");
  });

  it("compose generate merges board", () => {
    const out = composeXyqSeedance25Prompt({
      basePrompt: "雨夜对峙",
      workMode: "generate",
      timestampStoryboard: "0-8 | 全景环场一周",
      durationSec: 12,
    });
    expect(out).toContain("雨夜对峙");
    expect(out).toContain("全景环场一周");
  });

  it("compose extend / reshoot instructions", () => {
    expect(buildXyqExtendInstruction("继续追击", 10)).toMatch(/延长|续写/);
    expect(buildXyqReshootInstruction("改表情", 2, 5)).toMatch(/局部重拍/);
    const r = composeXyqSeedance25Prompt({
      basePrompt: "改台词口型",
      workMode: "reshoot",
      durationSec: 8,
      reshootFromSec: 1,
      reshootToSec: 4,
    });
    expect(r).toContain("1-4");
  });

  it("compose remix / parse work modes", () => {
    expect(buildXyqRemixInstruction("换成古装")).toMatch(/复刻/);
    expect(parseXyqSeedance25WorkMode("upscale")).toBe("upscale");
    expect(parseXyqSeedance25WorkMode("erase_subtitle")).toBe("erase_subtitle");
    expect(composeXyqSeedance25Prompt({ basePrompt: "", workMode: "upscale", durationSec: 8 })).toMatch(
      /清晰度/,
    );
  });
});
