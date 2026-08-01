import { describe, expect, it } from "vitest";
import {
  PLATFORM_NETFEEL_ACCENT_PALETTE,
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
  it("exposes full A1 title pattern set including open loop and value nail", () => {
    const ids = new Set(PLATFORM_NETFEEL_TITLE_PATTERNS.map((p) => p.id));
    expect(ids.has("bracket_pipe_contrast")).toBe(true);
    expect(ids.has("season_life_vibe")).toBe(true);
    expect(ids.has("open_loop_n_steps")).toBe(true);
    expect(ids.has("value_nail_emotion_bar")).toBe(true);
    expect(ids.has("hashtag_truth_hook")).toBe(true);
    expect(PLATFORM_NETFEEL_TITLE_PATTERNS.length).toBeGreaterThanOrEqual(10);
  });

  it("exposes full A1 cover shells including template-row shells", () => {
    const ids = PLATFORM_NETFEEL_COVER_SHELLS.map((s) => s.id);
    for (const id of [
      "flank_keyword",
      "truth_vertical",
      "life_stall_vibe",
      "deform_tension",
      "simple_recolor",
      "pip_eye_green",
      "knowledge_black_gold",
      "manga_bold_stall",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("exposes multi-accent palette (not single locked red)", () => {
    const ids = PLATFORM_NETFEEL_ACCENT_PALETTE.map((a) => a.id);
    expect(ids).toContain("warm_yellow_block");
    expect(ids).toContain("hot_pink_flank");
    expect(ids).toContain("eye_green");
    expect(ids).toContain("peach");
    expect(ids).toContain("rose_gold");
    expect(ids).toContain("sky_cobalt");
    expect(ids).toContain("truth_crimson");
    expect(ids.length).toBeGreaterThanOrEqual(8);
  });

  it("weights xiaohongshu primary with bilibili+douyin secondary", () => {
    expect([...PLATFORM_TREND_PRIORITY_FOR_FULLCASE.primary]).toEqual(["xiaohongshu"]);
    expect([...PLATFORM_TREND_PRIORITY_FOR_FULLCASE.secondary]).toEqual(["bilibili", "douyin"]);
    const g = composePlatformTrendPriorityGuidance();
    expect(g).toMatch(/小红书/);
    expect(g).toMatch(/B站/);
    expect(g).toMatch(/抖音/);
  });

  it("compose helpers use A1 full palette and expression match without vendor leak", () => {
    const blob = [
      composePlatformNetfeelTitleGuidance(),
      composePlatformNetfeelCoverGuidance(),
      composePlatformNetfeelFullcaseGuidance(),
      composePlatformNetfeelImageSkillHint(),
    ].join("\n");
    expect(blob).toMatch(/烟火气|反差|幽默/);
    expect(blob).toMatch(/张口大吃/);
    expect(blob).toMatch(/强调色池|配色池轮换|同批轮换/);
    expect(blob).toMatch(/水蜜桃|玫瑰金|吸睛绿|黑金/);
    expect(blob).toMatch(/simple_recolor|manga_bold_stall|knowledge_black_gold/);
    expect(blob).not.toMatch(/OpenAI|GPT-|Gemini|EvoLink/i);
  });
});
