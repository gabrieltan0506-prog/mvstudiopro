import { describe, expect, it } from "vitest";
import {
  applyKnowledgeCardReviewSuggestions as apply,
  ruleScanKnowledgeCardText as scan,
  validateKnowledgeCardReviewIssues as validate,
  type KnowledgeCardTextReviewIssue as Issue,
} from "./knowledgeCardTextReview";
const make = (
  source: string,
  start: number,
  end: number,
  suggestion?: string,
  id = "a"
): Issue => ({
  id,
  start,
  end,
  original: source.slice(start, end),
  ...(suggestion !== undefined ? { suggestion } : {}),
  kind: "ocr",
  reason: "请对照原稿确认",
  source: "model",
  confidence: "medium",
});

describe("图文笔记校对保真契约", () => {
  it("规则只标记疑点，不改数字、术语、诗句，也不臆造原字", () => {
    const source =
      "HbA1c 6.5%，2026年利润199元。\n诗句\n下一行。OCR�字\u0001，，";
    const issues = scan(source);
    expect(issues.some(i => i.original === "�")).toBe(true);
    expect(issues.some(i => i.original === "\u0001")).toBe(true);
    expect(
      issues.some(i => i.original === "\n" && i.confidence === "low")
    ).toBe(true);
    expect(issues.every(i => i.suggestion === undefined)).toBe(true);
    expect(apply(source, source, issues, [])).toBe(source);
    expect(scan("HbA1c 6.5%，2026年利润199元。……真的！！")).toEqual([]);
  });
  it("疑点数量不截断，UTF16锚点保留表情前缀", () => {
    const source = "😀" + "�正常".repeat(500);
    const issues = scan(source);
    expect(issues).toHaveLength(500);
    expect(issues[0]!.start).toBe(2);
    for (const issue of issues)
      expect(source.slice(issue.start, issue.end)).toBe(issue.original);
  });
  it("严格拒绝畸形数组任一项、未知字段、重复ID和伪造来源", () => {
    const source = "原文";
    const issue = make(source, 0, 1, "新");
    for (const raw of [
      new Array(1),
      null,
      {},
      [issue, null],
      [issue, { ...issue, id: "b", reason: " " }],
      [issue, issue],
      [{ ...issue, kind: "unknown" }],
      [{ ...issue, extra: 1 }],
      [{ ...issue, source: "rules" }],
      [{ ...issue, suggestion: undefined }],
    ])
      expect(() => validate(source, raw, "model")).toThrow();
    expect(validate(source, [issue], "model")).toEqual([issue]);
  });
  it("拒绝非法范围、锚点错位和拆开emoji代理对", () => {
    const source = "😀原文";
    for (const issue of [
      make(source, -1, 1),
      make(source, 0, 0),
      make(source, 0, 99),
      make(source, 0.5, 2),
      make(source, 0, 1),
      make(source, 1, 2),
      { ...make(source, 2, 3), original: "错" },
    ])
      expect(() => validate(source, [issue], "model")).toThrow();
    expect(validate(source, [make(source, 0, 2, "🙂")], "model")).toHaveLength(
      1
    );
  });
  it("重复原文按明确位置修改，未选数字术语逐字保留", () => {
    const source = "原文199元，HbA1c原文😀";
    const issues = [
      make(source, 0, 2, "前言", "a"),
      make(source, 12, 14, "正文", "b"),
    ];
    expect(source.slice(12, 14)).toBe("原文");
    expect(apply(source, source, issues, ["b"])).toBe("原文199元，HbA1c正文😀");
    expect(apply(source, source, issues, ["b", "a"])).toBe(
      "前言199元，HbA1c正文😀"
    );
  });
  it("逆序替换支持相邻范围、变长文字与明确删除", () => {
    const source = "甲乙丙😀丁";
    const issues = [
      make(source, 0, 1, "第一段", "a"),
      make(source, 1, 2, "", "b"),
      make(source, 3, 5, "🙂", "c"),
    ];
    expect(apply(source, source, issues, ["a", "b", "c"])).toBe("第一段丙🙂丁");
  });
  it("旧原稿、重叠、未知ID、重复选择及无建议均拒绝，原稿不发生部分修改", () => {
    const source = "甲乙丙";
    const issues = [
      make(source, 0, 2, "新", "a"),
      make(source, 1, 3, "改", "b"),
    ];
    expect(() => apply("甲乙丙新", source, issues, ["a"])).toThrow(
      "正文已变化"
    );
    expect(() => apply(source, source, issues, ["a", "b"])).toThrow("重叠");
    expect(() => apply(source, source, issues, ["a", "a"])).toThrow();
    expect(() => apply(source, source, issues, ["missing"])).toThrow();
    expect(() => apply(source, source, [make(source, 0, 1)], ["a"])).toThrow(
      "缺少"
    );
    expect(apply(source, source, issues, ["a"])).toBe("新丙");
  });
});
