import { describe, expect, it } from "vitest";
import { KNOWLEDGE_LEAD_PAGE_CHARS, KNOWLEDGE_READING_BUDGET_VERSION, KNOWLEDGE_READING_CONTRACT, KNOWLEDGE_READING_PAGE_CHARS, knowledgeBudgetInstructions, knowledgeBudgetOutputContract, knowledgeCompressionInstructions, knowledgeFinalCompressionMarks, knowledgeReadingCharBudgets, knowledgeReadingOverflow } from "./knowledgeEditionBudget";
import { knowledgeFullPageRange, knowledgeHandbookPagePlan } from "./knowledgeHandbookPagePlan";
import { knowledgeReadingBudgetVersionTransitionError, knowledgeReviewNotStarted } from "./knowledgePublication";

const C = KNOWLEDGE_READING_CONTRACT, V = KNOWLEDGE_READING_BUDGET_VERSION;
// 资治通鉴形态：每章图外资料 1.5 万–9 万字（合计约 160 万字），图内 ≤1200 字。
const book = (n: number, total = 1_600_000) => Array.from({ length: n }, (_, i) => {
  const weight = 1 + ((i * 7) % 11) / 2; // 1..6 不等
  return { id: `p${i}`, headline: `章${i}`, body: "图中文字".repeat(300), imageJobId: `job-${i}`, role: "illustration" as const, supplement: "史", weight };
}).map((p, _i, all) => {
  const sum = all.reduce((a, b) => a + b.weight, 0);
  const { weight, ...page } = p;
  return { ...page, supplement: "史".repeat(Math.round(total * weight / sum)) };
});
const pagesOf = (budgets: ReturnType<typeof knowledgeReadingCharBudgets>) => budgets.pages.reduce((a, p) => a + p.readingPages, 0);

describe("审校预算 v2（站长 2026-11-20：总页数 ≤80、文字约 30 页）", () => {
  it("48 张图：续页合计 30 页、总页数 78 ≤80；各章 maxChars = 700 + 续页×1300；资料多的章预算更大", () => {
    const pages = book(48);
    const b = knowledgeReadingCharBudgets("full", pages, C, V);
    expect(pagesOf(b)).toBe(30);
    expect(b.budget.totalPages.max).toBe(78);
    for (const p of b.pages) expect(p.maxChars).toBe(KNOWLEDGE_LEAD_PAGE_CHARS + p.readingPages * KNOWLEDGE_READING_PAGE_CHARS);
    const total = b.pages.reduce((a, p) => a + p.maxChars, 0);
    expect(48 + Math.round((total - 48 * KNOWLEDGE_LEAD_PAGE_CHARS) / KNOWLEDGE_READING_PAGE_CHARS)).toBeLessThanOrEqual(80);
    expect(total).toBe(48 * 700 + 30 * 1300);
    const bySupplement = [...b.pages].sort((x: any, y: any) => y.offImageChars - x.offImageChars);
    expect(bySupplement[0]!.maxChars).toBeGreaterThan(bySupplement.at(-1)!.maxChars);
    console.log("48图:", JSON.stringify({ totalChars: total, ratioPct: +(total / 1_600_000 * 100).toFixed(2), dist: b.pages.map(p => p.readingPages).join("") }));
  });
  it("34 张图：续页 30 页、总页数 64；给出数值", () => {
    const b = knowledgeReadingCharBudgets("full", book(34), C, V);
    expect(pagesOf(b)).toBe(30);
    expect(b.budget.totalPages.max).toBe(64);
    console.log("34图:", JSON.stringify({ totalChars: b.pages.reduce((a, p) => a + p.maxChars, 0), totalPages: 34 + pagesOf(b) }));
  });
  it("图外资料很少的章不强行给续页；资料合计不足时少用预算", () => {
    const pages = book(10, 5000);
    const b = knowledgeReadingCharBudgets("full", pages, C, V);
    expect(b.pages.every((p: any) => p.readingPages === 0 || p.offImageChars - 700 >= 650)).toBe(true);
    expect(pagesOf(b)).toBeLessThan(30);
  });
  it("图数 ≥80 时续页为 0；精华版 30 图续页 ≤50、总页数 ≤80", () => {
    expect(pagesOf(knowledgeReadingCharBudgets("full", book(80), C, V))).toBe(0);
    const concise = knowledgeReadingCharBudgets("concise", book(30), C, V);
    expect(pagesOf(concise)).toBe(50);
    expect(concise.budget.totalPages.max).toBe(80);
  });
  it("提示文字：说明上限、提炼而非截断、不与图重复；输出合同逐页上限与请求同值；压缩说明不再写「图下一栏」", () => {
    const b = knowledgeReadingCharBudgets("full", book(48), C, V).pages.slice(0, 3);
    const text = knowledgeBudgetInstructions("full", b, C, V);
    expect(text).toContain("最多80页");
    expect(text).toContain("提炼出最重要的说明");
    expect(text).toContain("不是截断");
    expect(text).toContain("不得重复");
    expect(text).toContain(`"maxChars":${b[0]!.maxChars}`);
    expect(knowledgeBudgetOutputContract("full", b, C, V)).toContain(`"maxChars":${b[0]!.maxChars}`);
    expect(knowledgeCompressionInstructions("full", [], V)).not.toContain("图下一栏");
  });
  it("统稿补压标记按 v2 上限：未超不标，超出才标", () => {
    const pages = book(48);
    const b = knowledgeReadingCharBudgets("full", pages, C, V).pages;
    const big = b.find(p => p.readingPages > 0)!;
    expect(knowledgeFinalCompressionMarks(pages, [{ id: big.id, chars: big.maxChars, hasTable: false }], V)).toEqual([]);
    expect(knowledgeFinalCompressionMarks(pages, [{ id: big.id, chars: big.maxChars + 1, hasTable: false }], V)[0]!.maxChars).toBe(big.maxChars);
    expect(knowledgeReadingOverflow("full", pages, [{ id: big.id, chars: big.maxChars }], C, V)).toEqual([]);
  });
  it("页数区间同步：v2 上限 80；旧口径仍 ≤72", () => {
    expect(knowledgeFullPageRange(48, V)).toEqual({ min: 48, max: 78, target: 78 });
    expect(knowledgeFullPageRange(48)).toEqual({ min: 68, max: 72, target: 70 });
    expect(knowledgeHandbookPagePlan("full", [{ id: "a", body: "", hasImage: true }], V).range!.max).toBe(31);
  });
});

describe("版本隔离：无合同的更旧稿即使带版本号也走旧预算", () => {
  const pages = book(48);
  it("同旧", () => {
    expect(knowledgeReadingCharBudgets("full", pages, undefined, V)).toEqual(knowledgeReadingCharBudgets("full", pages));
    expect(knowledgeBudgetInstructions("full", [{ id: "a", maxChars: 700 }], undefined, V)).toBe(knowledgeBudgetInstructions("full", [{ id: "a", maxChars: 700 }]));
  });
});

describe("预算版本写入时机（publication.readingBudgetVersion）", () => {
  const base = { version: 1 as const, requestId: "r", source: {} as any, completedBatches: 0, attempts: {}, manuscript: "" };
  it("source 已存在、尚未开始审校的稿可写入；已开始（有并发分配/已完成批次/章节结果）的不能写", () => {
    expect(knowledgeReviewNotStarted(base as any)).toBe(true);
    expect(knowledgeReadingBudgetVersionTransitionError(base as any, { ...base, readingBudgetVersion: 2 } as any)).toBeNull();
    const started = { ...base, parallel: { channels: { "0": "evolink" }, completed: [] } };
    expect(knowledgeReadingBudgetVersionTransitionError(started as any, { ...started, readingBudgetVersion: 2 } as any)).toContain("沿用原篇幅预算");
    const done = { ...base, completedBatches: 1 };
    expect(knowledgeReadingBudgetVersionTransitionError(done as any, { ...done, readingBudgetVersion: 2 } as any)).toContain("沿用原篇幅预算");
    const reviewed = { ...base, chapterReviews: { x: {} } };
    expect(knowledgeReadingBudgetVersionTransitionError(reviewed as any, { ...reviewed, readingBudgetVersion: 2 } as any)).toContain("沿用原篇幅预算");
  });
  it("写入后不得改动或删除", () => {
    const v2 = { ...base, readingBudgetVersion: 2 as const };
    expect(knowledgeReadingBudgetVersionTransitionError(v2 as any, base as any)).toContain("不能改动或删除");
    expect(knowledgeReadingBudgetVersionTransitionError(v2 as any, { ...v2, parallel: { channels: {}, completed: [] } } as any)).toBeNull();
  });
});
