import { describe, expect, it } from "vitest";
import {
  buildManhuaEpisodeSegmentPlanFixtureMarkdown,
  evaluateManhuaEpisodeSegmentPlanQuality,
  formatManhuaEpisodeSegmentPlanPromptBlock,
  parseManhuaEpisodeSegmentPlanFromMarkdown,
  upsertManhuaSegmentIntentInMarkdown,
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

  it("parses nested multi-line dialogue bullets under 对白", () => {
    const md = [
      "#### 段01",
      "- 对白：",
      "  - 甲：「第一句。」",
      "  - 乙：「第二句。」",
      "  - 甲：「第三句。」",
      "- 表演：甲眉心紧、握拳；乙后退半步眼神一颤。",
      "- 场景：雪关关隘",
      "- 配色风格：冷灰",
      "- 角色：甲、乙",
      "- 服装道具：旧甲",
      "- 光影运镜：中近景",
      "#### 段02",
      "- 对白：「一」「二」「三」",
      "- 表演：甲侧脸咬肌隆起，乙握拳。",
      "- 场景：破屋",
      "- 配色风格：暖灰",
      "- 角色：甲、乙",
      "- 服装道具：锄",
      "- 光影运镜：推",
    ].join("\n");
    // pad to 10 with fixture tail
    const more = buildManhuaEpisodeSegmentPlanFixtureMarkdown()
      .split(/\n#### 段/)
      .slice(3)
      .map((chunk, i) => `#### 段${String(i + 3).padStart(2, "0")}${chunk.includes("\n") ? chunk.slice(chunk.indexOf("\n")) : ""}`)
      .join("\n");
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(`${md}\n${more}`);
    expect(plan.segments[0]?.dialogueZh).toMatch(/第一句/);
    expect(
      (plan.segments[0]?.dialogueZh.match(/「[^」]+」/g) || []).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("rejects only two dialogue quotes in a 15s segment", () => {
    const two = [
      "#### 段01",
      "- 意图：羞辱与隐忍对撞",
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
    expect(block).toMatch(/意图/);
    expect(block).toMatch(/对白/);
    expect(block).toMatch(/表演/);
    expect(block).toMatch(/3–4/);
    expect(block).toMatch(/配色风格/);
    expect(block).toMatch(/光影运镜/);
  });

  it("upserts segment intent into markdown and re-parses", () => {
    const md = buildManhuaEpisodeSegmentPlanFixtureMarkdown();
    const next = upsertManhuaSegmentIntentInMarkdown(md, 2, "新意图·试探转硬碰");
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(next);
    expect(plan.segments.find((s) => s.index === 2)?.intentZh).toContain("新意图");
  });
});
