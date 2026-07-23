import { describe, expect, it } from "vitest";
import {
  MANHUA_FACTORY_OPTIMIZE_MAX_PARTS,
  buildManhuaFactoryOptimizeBrief,
  isManhuaBibleOrBeatsBlockId,
  planManhuaFactoryOptimizeSource,
  splitManhuaFactoryOptimizeSource,
} from "./manhuaFactoryTextOptimize";

describe("manhuaFactoryTextOptimize", () => {
  it("detects bible/beats ids", () => {
    expect(isManhuaBibleOrBeatsBlockId("bible-e01-1")).toBe(true);
    expect(isManhuaBibleOrBeatsBlockId("beats-e01-1")).toBe(true);
    expect(isManhuaBibleOrBeatsBlockId("story-e01-1")).toBe(false);
  });

  it("keeps short text in one chunk", () => {
    const chunks = splitManhuaFactoryOptimizeSource("短文案".repeat(100));
    expect(chunks).toHaveLength(1);
  });

  it("splits long text into N chunks without losing characters", () => {
    const parts = Array.from({ length: 40 }, (_, i) => `第${i + 1}段。\n\n${"内容".repeat(220)}`);
    const text = parts.join("");
    expect(text.length).toBeGreaterThan(16_000);
    const chunks = splitManhuaFactoryOptimizeSource(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((c) => c.length <= 18_000)).toBe(true);
  });

  it("auto-plans 3+ parts for ~50k text without asking user to split", () => {
    const text = Array.from({ length: 90 }, (_, i) => `段${i + 1}\n\n${"剧情".repeat(280)}`).join("");
    expect(text.length).toBeGreaterThan(45_000);
    const plan = planManhuaFactoryOptimizeSource(text);
    expect(plan.overLimitZh).toBeNull();
    expect(plan.split).toBe(true);
    expect(plan.chunks.length).toBeGreaterThanOrEqual(3);
    expect(plan.chunks.join("")).toBe(text);
    expect(plan.chunks.every((c) => c.length <= 18_000)).toBe(true);
  });

  it("rejects only when beyond auto part cap", () => {
    const softish = "段\n\n" + "字".repeat(15_500);
    const text = Array.from({ length: MANHUA_FACTORY_OPTIMIZE_MAX_PARTS + 2 }, () => softish).join("");
    const plan = planManhuaFactoryOptimizeSource(text);
    expect(plan.chunks.length).toBeGreaterThan(MANHUA_FACTORY_OPTIMIZE_MAX_PARTS);
    expect(plan.overLimitZh).toMatch(/自动分段上限/);
  });

  it("labels N-part briefs without 前半/后半 only", () => {
    const mid = buildManhuaFactoryOptimizeBrief({
      baseBrief: "基线",
      partIndex: 3,
      partTotal: 5,
      previousMarkdown: "上一段尾巴",
    });
    expect(mid).toMatch(/分段生成 3\/5/);
    expect(mid).toMatch(/第 3 段/);
    expect(mid).not.toMatch(/后半/);
  });
});
