import { describe, expect, it } from "vitest";
import {
  buildManhuaEpisodeSegmentPlanFixtureMarkdown,
  evaluateManhuaEpisodeSegmentPlanQuality,
  formatManhuaEpisodeSegmentPlanPromptBlock,
  parseManhuaEpisodeSegmentPlanFromMarkdown,
} from "./manhuaEpisodeSegmentPlan";

describe("manhuaEpisodeSegmentPlan", () => {
  it("parses 12 segments and passes quality", () => {
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(buildManhuaEpisodeSegmentPlanFixtureMarkdown());
    expect(plan.segments).toHaveLength(12);
    const q = evaluateManhuaEpisodeSegmentPlanQuality(plan);
    expect(q.ok).toBe(true);
    expect(q.readyCount).toBe(12);
  });

  it("accepts 10 contiguous ready segments", () => {
    const md = buildManhuaEpisodeSegmentPlanFixtureMarkdown()
      .split(/\n#### 段11/)[0]!
      .trim();
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(md);
    expect(plan.segments.length).toBeGreaterThanOrEqual(10);
    const q = evaluateManhuaEpisodeSegmentPlanQuality(plan);
    expect(q.ok).toBe(true);
    expect(q.readyCount).toBe(10);
  });

  it("rejects filler dialogue and missing fields", () => {
    const thin = [
      "#### 段01",
      "- 对白：嗯",
      "- 表演：皱眉握拳",
      "- 场景：屋里",
      "- 配色风格：暖",
      "- 角色：甲",
      "- 服装道具：衣",
      "- 光影运镜：推",
    ].join("\n");
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(thin);
    const q = evaluateManhuaEpisodeSegmentPlanQuality(plan);
    expect(q.ok).toBe(false);
    expect(q.issues.some((e) => /不足|灌水|缺段|对白仅/.test(e))).toBe(true);
  });

  it("rejects only two dialogue quotes in a 15s segment", () => {
    const two = [
      "#### 段01",
      "- 对白：「罪户只配吃风。」「断粮的人才想杀人。」",
      "- 表演：马县丞踢瓮冷笑；苏照雪接种子时眼神一凛、肩线绷紧。",
      "- 场景：开荒村破屋",
      "- 配色风格：冷灰雪白",
      "- 角色：苏照雪、马县丞",
      "- 服装道具：破袍、空粮瓮",
      "- 光影运镜：中近景固定",
    ].join("\n");
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(
      `${two}\n` + buildManhuaEpisodeSegmentPlanFixtureMarkdown().replace(/^###[^\n]+\n/, ""),
    );
    // 段01 仅 2 句应拦下，后续合格段不算连续
    const q = evaluateManhuaEpisodeSegmentPlanQuality(
      parseManhuaEpisodeSegmentPlanFromMarkdown(two),
    );
    expect(q.ok).toBe(false);
    expect(q.issues.some((e) => /对白仅|至少 3/.test(e))).toBe(true);
    void plan;
  });

  it("prompt block asks for 10–12 ×15s and performance", () => {
    const block = formatManhuaEpisodeSegmentPlanPromptBlock();
    expect(block).toMatch(/10/);
    expect(block).toMatch(/12/);
    expect(block).toMatch(/15 秒/);
    expect(block).toMatch(/对白/);
    expect(block).toMatch(/表演/);
    expect(block).toMatch(/3–4/);
    expect(block).toMatch(/配色风格/);
    expect(block).toMatch(/光影运镜/);
  });
});
