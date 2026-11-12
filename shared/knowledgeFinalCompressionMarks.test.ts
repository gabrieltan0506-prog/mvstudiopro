import { describe, it, expect } from "vitest";
import { KNOWLEDGE_LEAD_PAGE_CHARS, KNOWLEDGE_LEAD_PROSE_PAGE_CHARS, KNOWLEDGE_READING_PAGE_CHARS, knowledgeFinalCompressionMarks } from "./knowledgeEditionBudget";

const source = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, headline: `第${i + 1}章`, body: "图内文字", imageJobId: `job-${i}` }));
const marks = (n: number, chars: (i: number) => number, table: (i: number) => boolean = () => false) =>
  knowledgeFinalCompressionMarks(source(n), source(n).map((p, i) => ({ id: p.id, chars: chars(i), hasTable: table(i) })));

describe("统稿后压缩标记：不必每章都压缩（站长 2026-11-13）", () => {
  it("一页放得下的章不压：纯段落 ≤1000、带表格 ≤700", () => {
    expect(marks(10, () => KNOWLEDGE_LEAD_PROSE_PAGE_CHARS)).toEqual([]);
    expect(marks(10, () => KNOWLEDGE_LEAD_PAGE_CHARS, () => true)).toEqual([]);
    expect(marks(10, i => (i === 3 ? 701 : 600), () => true).map(m => [m.id, m.maxChars])).toEqual([["p3", KNOWLEDGE_LEAD_PAGE_CHARS]]);
  });

  it("两页留白 ≤ 1/4 的章不压；介于一页与「两页四分之三」之间的章压回一页", () => {
    const twoMin = KNOWLEDGE_LEAD_PROSE_PAGE_CHARS + Math.ceil(KNOWLEDGE_READING_PAGE_CHARS * 0.75);
    const twoMax = KNOWLEDGE_LEAD_PROSE_PAGE_CHARS + KNOWLEDGE_READING_PAGE_CHARS;
    // 10 图 → 上限 15 页 → 5 个两页名额。
    expect(marks(10, i => (i === 0 ? twoMin : 600))).toEqual([]);
    expect(marks(10, i => (i === 0 ? twoMax : 600))).toEqual([]);
    expect(marks(10, i => (i === 0 ? twoMin - 1 : 600)).map(m => [m.id, m.maxChars])).toEqual([["p0", KNOWLEDGE_LEAD_PROSE_PAGE_CHARS]]);
    expect(marks(10, i => (i === 0 ? twoMax + 1 : 600)).map(m => [m.id, m.maxChars])).toEqual([["p0", twoMax]]);
  });

  it("两页名额有限（总页数上限 − 章数）：字数最多的章优先，名额用完的章压回一页", () => {
    // 10 图 → 5 个名额；7 章都够两页 → 最长的 5 章留两页，另 2 章压回一页。
    const result = marks(10, i => (i < 7 ? 2000 + i * 10 : 600));
    expect(result.map(m => m.id)).toEqual(["p0", "p1"]);
    expect(result.every(m => m.maxChars === KNOWLEDGE_LEAD_PROSE_PAGE_CHARS)).toBe(true);
  });

  it("48 图完整版：上限 72 页 → 24 个两页名额", () => {
    const result = marks(48, () => 2100);
    expect(result).toHaveLength(24);
    expect(result.map(m => m.id)).toEqual(Array.from({ length: 24 }, (_, i) => `p${i + 24}`));
  });

  it("正文偏少的一页章标记扩写：纯段落不足 500、带表格不足 350；上限为一页容量", () => {
    expect(marks(10, i => (i === 2 ? 499 : 600)).map(m => [m.id, m.minChars, m.maxChars, m.excess])).toEqual([["p2", 500, KNOWLEDGE_LEAD_PROSE_PAGE_CHARS, 0]]);
    expect(marks(10, i => (i === 2 ? 500 : 600))).toEqual([]);
    expect(marks(10, i => (i === 2 ? 349 : 400), () => true).map(m => [m.id, m.minChars, m.maxChars])).toEqual([["p2", 350, KNOWLEDGE_LEAD_PAGE_CHARS]]);
  });
});
