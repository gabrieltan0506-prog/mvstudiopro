import { describe, it, expect } from "vitest";
import { knowledgeFullPageRange, knowledgeHandbookPagePlan, KNOWLEDGE_SPREAD_PAGE_CHARS } from "./knowledgeHandbookPagePlan";
import { KNOWLEDGE_LEAD_PAGE_CHARS, KNOWLEDGE_READING_CONTRACT, knowledgeReadingCharBudgets, knowledgeReadingOverflow } from "./knowledgeEditionBudget";
import { knowledgePublicationImageModes } from "./knowledgePublicationHtml";

const chapters = (n: number, density: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, body: "图".repeat(density(i)), hasImage: true }));

describe("完整版页数预算：图数 × 1.41～1.59，≤72（用户 2026-11-11）；2026-11-13 起取消跨页、一律图文同页", () => {
  it("页数区间口径不变：34 图 → 48–54，48 图 → 68–72（72 页硬顶）；跨页名额恒为 0", () => {
    expect(knowledgeFullPageRange(34)).toEqual({ min: 48, max: 54, target: 51 });
    expect(knowledgeFullPageRange(48)).toEqual({ min: 68, max: 72, target: 70 });
    expect(knowledgeFullPageRange(0)).toBeNull();
    const p34 = knowledgeHandbookPagePlan("full", chapters(34, i => 100 + i));
    expect(p34.range).toEqual({ min: 48, max: 54, target: 51 });
    expect(p34.spreadSlots).toBe(0);
    expect(knowledgeHandbookPagePlan("full", chapters(48, () => 500)).spreadSlots).toBe(0);
    expect(knowledgeHandbookPagePlan("full", chapters(1, () => 10)).spreadSlots).toBe(0);
  });

  it("所有章图文同页、预算统一 700；图内文字量照旧报出但不再分配跨页", () => {
    const plan = knowledgeHandbookPagePlan("full", chapters(34, i => (i % 2 ? 1000 - i : 100 + i)));
    expect(plan.chapters.every(c => c.mode === "inline")).toBe(true);
    expect(plan.chapters.every(c => c.maxChars === KNOWLEDGE_LEAD_PAGE_CHARS)).toBe(true);
    expect(plan.chapters.some(c => c.maxChars === KNOWLEDGE_SPREAD_PAGE_CHARS)).toBe(false);
    expect(plan.chapters.map(c => c.density)).toEqual(Array.from({ length: 34 }, (_, i) => (i % 2 ? 1000 - i : 100 + i)));
  });

  it("精华版与无档位旧稿同样图文同页；无图章密度为 0", () => {
    expect(knowledgeHandbookPagePlan("concise", chapters(20, () => 900)).chapters.every(c => c.mode === "inline")).toBe(true);
    expect(knowledgeHandbookPagePlan(undefined, chapters(20, () => 900)).spreadSlots).toBe(0);
    const mixed = knowledgeHandbookPagePlan("full", [...chapters(6, () => 300), { id: "text", body: "很长".repeat(900), hasImage: false }]);
    expect(mixed.chapters.find(c => c.id === "text")).toEqual({ id: "text", mode: "inline", maxChars: KNOWLEDGE_LEAD_PAGE_CHARS, density: 0 });
  });

  it("审校预算：新合同完整版一律 700，无跨页档；旧稿（无合同）与精华版保持原预算", () => {
    const pages = Array.from({ length: 34 }, (_, i) => ({ id: `p${i}`, headline: `第${i}章`, body: "图".repeat(i < 17 ? 1100 : 300), imageJobId: `job-${i}` }));
    const fresh = knowledgeReadingCharBudgets("full", pages, KNOWLEDGE_READING_CONTRACT).pages;
    expect(fresh.every(p => p.maxChars === KNOWLEDGE_LEAD_PAGE_CHARS && (p as { mode?: string }).mode === "inline")).toBe(true);
    expect(knowledgeReadingCharBudgets("full", pages).pages.every(p => p.maxChars === KNOWLEDGE_LEAD_PAGE_CHARS)).toBe(true);
    expect(knowledgeReadingCharBudgets("concise", pages, KNOWLEDGE_READING_CONTRACT).pages.some(p => p.maxChars === KNOWLEDGE_SPREAD_PAGE_CHARS)).toBe(false);
    // 超出判断：500 字不再超出（原跨页章 420 档已取消），800 字超出 100。
    expect(knowledgeReadingOverflow("full", pages, [{ id: "p0", chars: 500 }], KNOWLEDGE_READING_CONTRACT)).toEqual([]);
    expect(knowledgeReadingOverflow("full", pages, [{ id: "p0", chars: 800 }], KNOWLEDGE_READING_CONTRACT)).toEqual([{ id: "p0", headline: "第0章", chars: 800, maxChars: KNOWLEDGE_LEAD_PAGE_CHARS, excess: 100 }]);
  });

  it("导出逐章版式：完整版与精华版全部图文同页，整册排版改动章序不影响", () => {
    const sourcePages = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, headline: `第${i}章`, body: "图".repeat([900, 10, 800, 20, 700, 30][i]!), imageUrl: `gs://x/${i}.png` }));
    const doc = (level: "full" | "concise", order: number[]) => ({ pages: order.map(i => ({ id: `p${i}`, imageUrl: `gs://x/${i}.png` })), publication: { source: { detailLevel: level, pages: sourcePages } } }) as any;
    expect(knowledgePublicationImageModes(doc("full", [0, 1, 2, 3, 4, 5])).every(m => m === "inline")).toBe(true);
    expect(knowledgePublicationImageModes(doc("full", [5, 4, 3, 2, 1, 0])).every(m => m === "inline")).toBe(true);
    expect(knowledgePublicationImageModes(doc("concise", [0, 1, 2, 3, 4, 5])).every(m => m === "inline")).toBe(true);
  });
});
