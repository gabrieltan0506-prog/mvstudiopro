import { describe, expect, it } from "vitest";
import {
  MANHUA_FACTORY_OPTIMIZE_SOURCE_MAX,
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

  it("splits long text without losing characters", () => {
    const parts = Array.from({ length: 40 }, (_, i) => `第${i + 1}段。\n\n${"内容".repeat(220)}`);
    const text = parts.join("");
    expect(text.length).toBeGreaterThan(16_000);
    const chunks = splitManhuaFactoryOptimizeSource(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((c) => c.length <= 18_000)).toBe(true);
  });

  it("rejects over 32000 without truncating", () => {
    const text = "字".repeat(MANHUA_FACTORY_OPTIMIZE_SOURCE_MAX + 1);
    const plan = planManhuaFactoryOptimizeSource(text);
    expect(plan.overLimitZh).toMatch(/上限/);
    expect(plan.chunks.join("")).toBe(text);
  });
});
