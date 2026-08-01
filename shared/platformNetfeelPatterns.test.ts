import { describe, expect, it } from "vitest";
import {
  PLATFORM_NETFEEL_COVER_SHELLS,
  PLATFORM_NETFEEL_TITLE_PATTERNS,
  PLATFORM_TREND_PRIORITY_FOR_FULLCASE,
  composePlatformNetfeelCoverGuidance,
  composePlatformNetfeelFullcaseGuidance,
  composePlatformNetfeelImageSkillHint,
  composePlatformNetfeelTitleGuidance,
  composePlatformTrendPriorityGuidance,
} from "./platformNetfeelPatterns";

describe("platformNetfeelPatterns", () => {
  it("exposes title patterns with life-vibe / contrast / humor skeletons", () => {
    expect(PLATFORM_NETFEEL_TITLE_PATTERNS.length).toBeGreaterThanOrEqual(6);
    const ids = new Set(PLATFORM_NETFEEL_TITLE_PATTERNS.map((p) => p.id));
    expect(ids.has("bracket_pipe_contrast")).toBe(true);
    expect(ids.has("season_life_vibe")).toBe(true);
    expect(ids.has("self_deprecating_office")).toBe(true);
    for (const p of PLATFORM_NETFEEL_TITLE_PATTERNS) {
      expect(p.skeleton.length).toBeGreaterThan(8);
      expect(p.vibeExamples.length).toBeGreaterThan(0);
    }
  });

  it("exposes cover shells including deform_tension (2B)", () => {
    const ids = PLATFORM_NETFEEL_COVER_SHELLS.map((s) => s.id);
    expect(ids).toContain("flank_keyword");
    expect(ids).toContain("life_stall_vibe");
    expect(ids).toContain("deform_tension");
  });

  it("weights xiaohongshu primary with bilibili+douyin secondary", () => {
    expect([...PLATFORM_TREND_PRIORITY_FOR_FULLCASE.primary]).toEqual(["xiaohongshu"]);
    expect([...PLATFORM_TREND_PRIORITY_FOR_FULLCASE.secondary]).toEqual(["bilibili", "douyin"]);
    const g = composePlatformTrendPriorityGuidance();
    expect(g).toMatch(/小红书/);
    expect(g).toMatch(/B站/);
    expect(g).toMatch(/抖音/);
  });

  it("compose helpers mention netfeel cues without vendor leak", () => {
    const blob = [
      composePlatformNetfeelTitleGuidance(),
      composePlatformNetfeelCoverGuidance(),
      composePlatformNetfeelFullcaseGuidance(),
      composePlatformNetfeelImageSkillHint(),
    ].join("\n");
    expect(blob).toMatch(/烟火气|反差|幽默/);
    expect(blob).toMatch(/deform_tension|变形/);
    expect(blob).not.toMatch(/OpenAI|GPT-|Gemini|EvoLink/i);
  });

  it("requires expression/action to match copy tension and premium palette", () => {
    const cover = composePlatformNetfeelCoverGuidance();
    const hint = composePlatformNetfeelImageSkillHint();
    expect(cover).toMatch(/张口大吃/);
    expect(cover).toMatch(/香槟金|暖琥珀/);
    expect(cover).toMatch(/发呆|证件照/);
    expect(hint).toMatch(/文案=表情|同档/);
    expect(hint).toMatch(/香槟金|暖琥珀/);
  });
});
