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

  it("rejects filler dialogue and missing fields", () => {
    const thin = [
      "#### 段01",
      "- 对白：嗯",
      "- 场景：屋里",
      "- 配色风格：暖",
      "- 角色：甲",
      "- 服装道具：衣",
      "- 光影运镜：推",
    ].join("\n");
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(thin);
    const q = evaluateManhuaEpisodeSegmentPlanQuality(plan);
    expect(q.ok).toBe(false);
    expect(q.issues.some((e) => /不足|灌水|缺段/.test(e))).toBe(true);
  });

  it("prompt block asks for 12×15s", () => {
    const block = formatManhuaEpisodeSegmentPlanPromptBlock();
    expect(block).toMatch(/12 段/);
    expect(block).toMatch(/15 秒/);
    expect(block).toMatch(/对白/);
    expect(block).toMatch(/配色风格/);
    expect(block).toMatch(/光影运镜/);
  });
});
