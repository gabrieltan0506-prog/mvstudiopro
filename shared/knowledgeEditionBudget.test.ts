import { describe, expect, it } from "vitest";
import { knowledgeBudgetInstructions, knowledgeCompressionInstructions, knowledgeEditionBudgetCheck, knowledgeEditionPageBudget, knowledgeReadingCharBudgets, knowledgeReadingOverflow, KNOWLEDGE_LEAD_PAGE_CHARS, KNOWLEDGE_READING_PAGE_CHARS } from "./knowledgeEditionBudget";
import { attachKnowledgeTextModules } from "./knowledgeTextAttachment";
import { compileKnowledgeEditions } from "./knowledgeCardEdition";
import { knowledgeEditionIllustratedPages, knowledgeEditionImageChars, knowledgeEditionImagePlan, planKnowledgeCardPages } from "./knowledgeCardPagination";

describe("图文比例页数预算（用户2026-11-08确认；2026-11-09 完整版拍板图文同页）", () => {
  it("完整版图文同页：预算页数 = 图片数，不排独立内文页；16 图 → 16 页", () => {
    const b = knowledgeEditionPageBudget("full", 16);
    expect(b.textPages).toEqual({ min: 0, target: 0, max: 0 });
    expect(b.totalPages).toEqual({ min: 16, target: 16, max: 16 });
    expect(knowledgeEditionPageBudget("full", 48).totalPages).toEqual({ min: 48, target: 48, max: 48 });
    expect(knowledgeEditionPageBudget("full", 0).totalPages.max).toBe(0);
  });
  it("1108g2 敦煌复盘：16张图、6.8万字图外细节不得再排成内文页；预检给出压缩目标字数、比例与不压缩所需图数", () => {
    const dunhuang = knowledgeEditionBudgetCheck("full", 16, 68077, 15551);
    expect(dunhuang.plannedTextPages).toBe(0);
    expect(dunhuang.plannedTotalPages).toBe(16);
    expect(dunhuang.compression).toEqual({
      readingCapacityChars: 11200, targetReadingChars: 11200, excessChars: 56877,
      ratio: 11200 / 68077, imagesForNoLoss: Math.ceil((68077 + 15551) / 1900), imageCap: 16,
    });
    expect(dunhuang.compression!.imagesForNoLoss).toBe(45);
    const text = dunhuang.warnings.join("");
    expect(text).toContain("不排独立内文页");
    expect(text).toContain("压缩至约11200字（约16%");
    expect(text).toContain("不压缩需约45张图，超过完整版上限16张，只能压缩");
  });
  it("完整版内文装得进图下栏时无压缩提示；略超但加图可容时给出改图数方案而不自行加图", () => {
    const fit = knowledgeEditionBudgetCheck("full", 16, 11000, 15000);
    expect(fit.compression).toBeNull();
    expect(fit.warnings).toEqual([]);
    expect(fit.plannedTotalPages).toBe(16);
    const slight = knowledgeEditionBudgetCheck("full", 10, 8000, 12000);
    expect(slight.compression!.imagesForNoLoss).toBe(11);
    expect(slight.warnings.join("")).toContain("或改为11张图（≤上限16张）可不丢内容，需用户拍板，不自行加图");
    expect(slight.plannedTotalPages).toBe(10);
  });
  it("精华版图:内文1:2–1:3", () => {
    expect(knowledgeEditionPageBudget("concise", 8).textPages).toEqual({ min: 16, target: 20, max: 24 });
  });
  it("生图前预检只提示不阻断：资料不足/过多给出说明", () => {
    const thin = knowledgeEditionBudgetCheck("concise", 8, 3000);
    expect(thin.warnings.join("")).toContain("不硬凑篇幅");
    expect(thin.plannedTextPages).toBe(16);
    const heavy = knowledgeEditionBudgetCheck("full", 16, 200000);
    expect(heavy.plannedTextPages).toBe(0);
    expect(heavy.plannedTotalPages).toBe(16);
    expect(heavy.warnings.join("")).toContain("合并去重");
    expect(knowledgeEditionBudgetCheck("concise", 8, 76000).warnings.join("")).toContain("不重复图中内容");
  });
  it("完整版每章只有图下一栏预算（≤700 字），不分配任何续页；精华版按图外资料多少分配整页", () => {
    const pages = Array.from({ length: 16 }, (_, i) => ({ id: `p${i}`, headline: `章${i}`, body: "图中文字".repeat(250), imageJobId: `job-${i}`, supplement: i % 4 === 0 ? "图外资料".repeat(1500) : "" }));
    const full = knowledgeReadingCharBudgets("full", pages);
    expect(full.budget.totalPages.max).toBe(16);
    expect(full.pages.every(p => p.readingPages === 0 && p.maxChars === KNOWLEDGE_LEAD_PAGE_CHARS)).toBe(true);
    const concise = knowledgeReadingCharBudgets("concise", pages.slice(0, 8));
    const extra = concise.pages.reduce((sum, p) => sum + p.readingPages, 0);
    expect(extra).toBe(concise.budget.textPages.target);
    expect(concise.pages.filter((_, i) => i % 4 === 0).every(p => p.readingPages > 0)).toBe(true);
    expect(concise.pages.find(p => p.id === "p0")!.maxChars).toBe(KNOWLEDGE_LEAD_PAGE_CHARS + concise.pages.find(p => p.id === "p0")!.readingPages * KNOWLEDGE_READING_PAGE_CHARS);
  });
  it("预算说明要求完整版装进图下一栏、不重打图中内容并列出每页上限", () => {
    const text = knowledgeBudgetInstructions("full", [{ id: "a", maxChars: 700 }]);
    expect(text).toContain("不排独立内文页");
    expect(text).toContain("不得在reading里重打");
    expect(text).toContain('"maxChars":700');
    expect(knowledgeBudgetInstructions(undefined, [{ id: "a", maxChars: 1 }])).toBe("");
  });
});

describe("完整版膨胀稿端到端：排版源页数 = 图数，无独立内文页，溢出只报压缩目标", () => {
  it("40 节 × 1500 字的完整版稿：16 张图 → 16 个图文同页，每页 reading 预算 700 字，预检报出压缩字数与图数方案", () => {
    const sentence = (i: number, j: number) => `第${i}节第${j}句记述一件具体史实，以及它前后的经过与影响。`;
    const book = compileKnowledgeEditions("膨胀测试", Array.from({ length: 40 }, (_, i) => ({
      headline: `原小节${i}`, body: Array.from({ length: 50 }, (_, j) => sentence(i, j)).join(""), priority: "primary" as const,
    })));
    const plan = knowledgeEditionImagePlan(book.full)!;
    expect(plan.images.length).toBe(16);
    expect(planKnowledgeCardPages(book.full).pageCount).toBe(16);
    // 排版源只有 16 个图文同页：独立文字模块全部并入图下 supplement，没有单独文字页。
    const pages = knowledgeEditionIllustratedPages(book.full)!;
    expect(pages.length).toBe(16);
    const budgets = knowledgeReadingCharBudgets("full", pages.map((p, i) => ({ id: `p${i}`, headline: p.headline, body: p.body, supplement: p.supplement, role: "illustration" as const })));
    expect(budgets.budget.totalPages).toEqual({ min: 16, target: 16, max: 16 });
    expect(budgets.pages.every(p => p.readingPages === 0 && p.maxChars === KNOWLEDGE_LEAD_PAGE_CHARS)).toBe(true);
    const check = knowledgeEditionBudgetCheck("full", 16, plan.readingChars, knowledgeEditionImageChars(plan));
    expect(check.plannedTotalPages).toBe(16);
    expect(check.compression!.targetReadingChars).toBe(16 * KNOWLEDGE_LEAD_PAGE_CHARS);
    expect(check.compression!.excessChars).toBe(plan.readingChars - 16 * KNOWLEDGE_LEAD_PAGE_CHARS);
    expect(check.compression!.imagesForNoLoss).toBeGreaterThan(16);
    expect(check.warnings.join("")).toContain("只能压缩");
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

describe("审校后预算核对：knowledgeReadingOverflow", () => {
  const pages = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, headline: `章${i}`, body: "图内", supplement: "补", imageJobId: `job${i}` }));
  it("完整版每页上限 700：只报超出页，excess 为超出字数", () => {
    const overflow = knowledgeReadingOverflow("full", pages, [{ id: "p0", chars: 700 }, { id: "p1", chars: 1850 }, { id: "p2", chars: 701 }]);
    expect(overflow).toEqual([
      { id: "p1", headline: "章1", chars: 1850, maxChars: 700, excess: 1150 },
      { id: "p2", headline: "章2", chars: 701, maxChars: 700, excess: 1 },
    ]);
  });
  it("无档位或页不在预算内时不报", () => {
    expect(knowledgeReadingOverflow(undefined, pages, [{ id: "p1", chars: 9999 }])).toEqual([]);
    expect(knowledgeReadingOverflow("full", pages, [{ id: "unknown", chars: 9999 }])).toEqual([]);
  });
  it("压缩说明带每页 maxChars 目标", () => {
    const text = knowledgeCompressionInstructions("full", [{ id: "p1", headline: "章1", chars: 1850, maxChars: 700, excess: 1150 }]);
    expect(text).toContain("每页约700字");
    expect(text).toContain('{"id":"p1","chars":1850,"maxChars":700}');
  });
});
