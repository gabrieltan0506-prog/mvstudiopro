import { describe, expect, it } from "vitest";
import {
  buildKnowledgeCardSubjectPositionPrompt,
  resolveKnowledgeCardSubjectPosition,
} from "./knowledgeCardSubjectPosition";
import {
  KNOWLEDGE_CARD_DETAIL_LEVELS,
  resolveKnowledgeCardDetailLevel,
  suggestKnowledgeCardMinSections,
} from "./knowledgeCardDistillSections";

describe("knowledgeCardSubjectPosition", () => {
  it("defaults to left; only center is the other value", () => {
    expect(resolveKnowledgeCardSubjectPosition(undefined)).toBe("left");
    expect(resolveKnowledgeCardSubjectPosition("")).toBe("left");
    expect(resolveKnowledgeCardSubjectPosition("right")).toBe("left");
    expect(resolveKnowledgeCardSubjectPosition("CENTER")).toBe("center");
  });

  it("prompt always pins landscape 16:9 and states the chosen side", () => {
    const left = buildKnowledgeCardSubjectPositionPrompt("left");
    const center = buildKnowledgeCardSubjectPositionPrompt("center");
    for (const p of [left, center]) {
      expect(p).toContain("横版16:9");
      expect(p).toContain("LANDSCAPE 16:9");
    }
    expect(left).toContain("左侧约三分之一");
    expect(left).toContain("LEFT third");
    expect(center).toContain("主体居中");
    expect(center).toContain("CENTER the main visual subject");
  });
});

describe("knowledgeCard detail level (精简版 / 高级版)", () => {
  it("has exactly two levels and defaults to concise", () => {
    expect(KNOWLEDGE_CARD_DETAIL_LEVELS).toEqual(["concise", "full"]);
    expect(resolveKnowledgeCardDetailLevel(undefined)).toBe("concise");
    expect(resolveKnowledgeCardDetailLevel("FULL")).toBe("full");
    expect(resolveKnowledgeCardDetailLevel("balanced")).toBe("concise");
  });

  it("full keeps far more sections than concise for a book, identical for short posts", () => {
    expect(suggestKnowledgeCardMinSections(2_000, "full")).toBe(suggestKnowledgeCardMinSections(2_000, "concise"));
    const concise = suggestKnowledgeCardMinSections(95_000, "concise");
    const full = suggestKnowledgeCardMinSections(95_000, "full");
    expect(concise).toBeLessThanOrEqual(30);
    expect(full).toBeGreaterThanOrEqual(concise * 2);
    expect(full).toBeLessThanOrEqual(120);
    // 单参数调用等价精简版（旧调用方不变）
    expect(suggestKnowledgeCardMinSections(95_000)).toBe(concise);
  });
});
