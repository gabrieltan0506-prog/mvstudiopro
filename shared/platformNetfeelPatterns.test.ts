import { describe, expect, it } from "vitest";
import {
  PLATFORM_NETFEEL_ACCENT_PALETTE,
  PLATFORM_NETFEEL_COVER_SHELLS,
  PLATFORM_NETFEEL_REJECTED_SHELLS,
  PLATFORM_NETFEEL_TITLE_PATTERNS,
  PLATFORM_NETFEEL_TYPE_DEVICES,
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

  it("exposes only the human-approved A1 cover shells", () => {
    const ids = PLATFORM_NETFEEL_COVER_SHELLS.map((s) => s.id);
    for (const id of [
      "flank_keyword",
      "truth_vertical",
      "life_stall_vibe",
      "big_topic_warn",
      "beauty_pink_dual",
      "simple_recolor",
      "pip_eye_green",
      "knowledge_black_gold",
      "manga_bold_stall",
    ]) {
      expect(ids).toContain(id);
    }
    expect(ids).not.toContain("abstract_stunt");
    expect(ids).not.toContain("deform_tension");
  });

  it("keeps the 2026-08-02 approved re-extraction shells and drops the kicked ones", () => {
    const ids = PLATFORM_NETFEEL_COVER_SHELLS.map((s) => s.id);
    for (const id of [
      "growth_vertical_triad",
      "howto_hand_english",
      "neon_arrow_question",
      "slash_wrap_product",
      "food_taste_frame",
      "count_haul_number",
      "arrow_annotate_dual",
      "warm_letgo_four",
      "magazine_masthead",
    ]) {
      expect(ids).toContain(id);
    }
    expect(ids).not.toContain("strike_negation");
    expect(ids).not.toContain("gold_vertical_money");
    expect(ids).not.toContain("ratio_compare_beauty");
    // B1/B3 优化口径写进 hint
    const b1 = PLATFORM_NETFEEL_COVER_SHELLS.find((s) => s.id === "neon_arrow_question");
    expect(b1?.visualHint).toMatch(/桃|玫瑰金|暖琥珀/);
    expect(b1?.visualHint).toMatch(/荧光绿|荧光黄/);
    const b3 = PLATFORM_NETFEEL_COVER_SHELLS.find((s) => s.id === "magazine_masthead");
    expect(b3?.visualHint).toMatch(/私人笔记/);
    expect(b3?.visualHint).toMatch(/Forbes|Fortune/);
  });

  it("offers type devices that stay subordinate to the headline", () => {
    const ids = PLATFORM_NETFEEL_TYPE_DEVICES.map((d) => d.id);
    expect(ids).toContain("slash_wrap");
    expect(ids).toContain("warm_arrow_annotate");
    expect(ids).toContain("private_notes_masthead");
    expect(ids).toContain("bilingual_subtitle");
    expect(ids).toContain("picture_in_picture");
    expect(ids).not.toContain("strike_negation_word");
    expect(ids).not.toContain("neon_arrow_annotate");
    const cover = composePlatformNetfeelCoverGuidance();
    expect(cover).toMatch(/挑 \*\*1–2 个\*\*/);
    expect(cover).toMatch(/neon_flank/);
  });

  it("keeps rejected shells documented so they are not reused", () => {
    const ids = PLATFORM_NETFEEL_REJECTED_SHELLS.map((s) => s.id);
    expect(ids).toContain("abstract_stunt");
    expect(ids).toContain("deform_tension");
    expect(ids).toContain("answer_spoiler");
    expect(ids).toContain("strike_negation");
    expect(ids).toContain("gold_vertical_money");
    expect(ids).toContain("ratio_compare_beauty");
    const cover = composePlatformNetfeelCoverGuidance();
    expect(cover).toMatch(/已剔除/);
    expect(cover).toMatch(/剧透/);
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
