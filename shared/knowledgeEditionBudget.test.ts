import { describe, expect, it } from "vitest";
import { knowledgeBudgetInstructions, knowledgeEditionBudgetCheck, knowledgeEditionPageBudget, knowledgeReadingCharBudgets, KNOWLEDGE_LEAD_PAGE_CHARS, KNOWLEDGE_READING_PAGE_CHARS } from "./knowledgeEditionBudget";
import { attachKnowledgeTextModules } from "./knowledgeTextAttachment";

describe("图文比例页数预算（用户2026-11-08确认）", () => {
  it("完整版图:内文 3:1–2:1，72 只是总页数硬顶：16图时内文5–8页（目标7，总23），不再撑到56页", () => {
    const b = knowledgeEditionPageBudget("full", 16);
    expect(b.textPages).toEqual({ min: 5, target: 7, max: 8 });
    expect(b.totalPages).toEqual({ min: 21, target: 23, max: 24 });
    // 旧 48 图稿：内文 16–22–24 页，总页数仍不超过 72
    expect(knowledgeEditionPageBudget("full", 48).textPages).toEqual({ min: 16, target: 22, max: 24 });
    expect(knowledgeEditionPageBudget("full", 48).totalPages.max).toBe(72);
    // 图极多时由 72 硬顶夹住比例上限
    expect(knowledgeEditionPageBudget("full", 60).textPages.max).toBe(12);
    expect(knowledgeEditionPageBudget("full", 72).textPages).toEqual({ min: 0, target: 0, max: 0 });
  });
  it("1108g2 敦煌复盘：16张图、7.5万字图外细节不得再排成66–72页；预检给出压缩比例", () => {
    const dunhuang = knowledgeEditionBudgetCheck("full", 16, 75475);
    expect(dunhuang.estimatedTextPages).toBe(50);
    expect(dunhuang.plannedTextPages).toBe(7);
    expect(dunhuang.plannedTotalPages).toBe(23);
    expect(dunhuang.warnings.join("")).toContain("超出8页上限");
    expect(dunhuang.warnings.join("")).toMatch(/压缩至约\d+%/);
  });
  it("精华版图:内文1:2–1:3", () => {
    expect(knowledgeEditionPageBudget("concise", 8).textPages).toEqual({ min: 16, target: 20, max: 24 });
  });
  it("生图前预检只提示不阻断：资料不足/过多给出说明", () => {
    const thin = knowledgeEditionBudgetCheck("concise", 8, 3000);
    expect(thin.warnings.join("")).toContain("不硬凑篇幅");
    expect(thin.plannedTextPages).toBe(16);
    const heavy = knowledgeEditionBudgetCheck("full", 16, 200000);
    expect(heavy.plannedTextPages).toBe(7);
    expect(heavy.plannedTotalPages).toBe(23);
    expect(heavy.warnings.join("")).toContain("合并去重");
    // 资料在比例内：16 图、1.6 万字图外细节 → 4 页内文、总 20 页、无提示
    const fit = knowledgeEditionBudgetCheck("full", 16, 16000);
    expect(fit.plannedTextPages).toBe(4);
    expect(fit.plannedTotalPages).toBe(20);
    expect(fit.warnings).toEqual([]);
    expect(knowledgeEditionBudgetCheck("concise", 8, 76000).warnings.join("")).toContain("不重复图中内容");
  });
  it("按图外资料多少分配整页，完整版总预算不超过上限", () => {
    const pages = Array.from({ length: 48 }, (_, i) => ({ id: `p${i}`, headline: `章${i}`, body: "图中文字".repeat(250), imageJobId: `job-${i}`, supplement: i % 4 === 0 ? "图外资料".repeat(1500) : "" }));
    const { budget, pages: result } = knowledgeReadingCharBudgets("full", pages);
    const extra = result.reduce((sum, p) => sum + p.readingPages, 0);
    expect(extra).toBeLessThanOrEqual(budget.textPages.target);
    expect(result.every(p => p.maxChars >= KNOWLEDGE_LEAD_PAGE_CHARS)).toBe(true);
    // 有大量图外资料的章节先拿到续页
    expect(result.filter((_, i) => i % 4 === 0).every(p => p.readingPages > 0)).toBe(true);
    expect(result.find(p => p.id === "p0")!.maxChars).toBe(KNOWLEDGE_LEAD_PAGE_CHARS + result.find(p => p.id === "p0")!.readingPages * KNOWLEDGE_READING_PAGE_CHARS);
  });
  it("完整版资料少时不硬凑篇幅", () => {
    const pages = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, headline: `章${i}`, body: "短", imageJobId: `job-${i}` }));
    expect(knowledgeReadingCharBudgets("full", pages).pages.every(p => p.readingPages === 0)).toBe(true);
  });
  it("预算说明要求不重打图中内容并列出每页上限", () => {
    const text = knowledgeBudgetInstructions("full", [{ id: "a", maxChars: 700 }]);
    expect(text).toContain("不得在reading里重打");
    expect(text).toContain('"maxChars":700');
    expect(knowledgeBudgetInstructions(undefined, [{ id: "a", maxChars: 1 }])).toBe("");
  });
});

describe("无图文字模块并入相关章节", () => {
  it("按内容归属，每个模块只并入一次且原文不变", () => {
    const images = ["## 膳食纤维\n\n水溶性膳食纤维来源：燕麦、魔芋、豆类。", "## 快走运动\n\n快走心率与运动强度对照。"];
    const texts = [{ headline: "膳食纤维单位更正", body: "膳食纤维的单位应为克，燕麦每100克约含膳食纤维。" }, { headline: "快走强度自查", body: "快走时能说话但不能唱歌，心率约为最大心率的六成。" }];
    const result = attachKnowledgeTextModules(images, texts);
    expect(result[0]).toContain("膳食纤维单位更正");
    expect(result[0]).toContain(texts[0]!.body);
    expect(result[1]).toContain("快走强度自查");
    expect(result.join("").split("### ").length - 1).toBe(2);
  });
  it("没有文字模块时返回空补充", () => {
    expect(attachKnowledgeTextModules(["## a\n\n甲"], [])).toEqual([""]);
  });
});
