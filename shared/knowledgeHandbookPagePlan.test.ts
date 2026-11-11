import { describe, it, expect } from "vitest";
import { knowledgeFullPageRange, knowledgeHandbookPagePlan, KNOWLEDGE_SPREAD_PAGE_CHARS } from "./knowledgeHandbookPagePlan";
import { KNOWLEDGE_LEAD_PAGE_CHARS, KNOWLEDGE_READING_CONTRACT, knowledgeReadingCharBudgets, knowledgeReadingOverflow } from "./knowledgeEditionBudget";
import { knowledgePublicationImageModes } from "./knowledgePublicationHtml";

const chapters = (n: number, density: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, body: "图".repeat(density(i)), hasImage: true }));

describe("完整版页数预算：图数 × 1.41～1.59，≤72（用户 2026-11-11）", () => {
  it("34 图 → 48–54 页，目标 51，跨页名额 17；48 图 → 68–72（72 页硬顶取较小值），名额 24", () => {
    expect(knowledgeFullPageRange(34)).toEqual({ min: 48, max: 54, target: 51 });
    expect(knowledgeHandbookPagePlan("full", chapters(34, i => 100 + i)).spreadSlots).toBe(17);
    expect(knowledgeFullPageRange(48)).toEqual({ min: 68, max: 72, target: 70 });
    expect(knowledgeHandbookPagePlan("full", chapters(48, () => 500)).spreadSlots).toBe(22);
    // 每章至少 1 页：名额 = 目标 − 章数，不会出现负数或超过图数。
    expect(knowledgeHandbookPagePlan("full", chapters(1, () => 10)).spreadSlots).toBe(0);
  });

  it("名额优先给图内文字最密的章；同量按章序；跨页章正文上限 420、图文同页 700", () => {
    const plan = knowledgeHandbookPagePlan("full", chapters(34, i => (i % 2 ? 1000 - i : 100 + i)));
    const spread = plan.chapters.filter(c => c.mode === "spread");
    expect(spread).toHaveLength(17);
    // 最密的 17 章正好是奇数章（1000 量级），且按密度挑最多者。
    expect(spread.every(c => Number(c.id.slice(1)) % 2 === 1)).toBe(true);
    expect(Math.min(...spread.map(c => c.density))).toBeGreaterThanOrEqual(Math.max(...plan.chapters.filter(c => c.mode === "inline").map(c => c.density)));
    expect(spread.every(c => c.maxChars === KNOWLEDGE_SPREAD_PAGE_CHARS)).toBe(true);
    expect(plan.chapters.filter(c => c.mode === "inline").every(c => c.maxChars === KNOWLEDGE_LEAD_PAGE_CHARS)).toBe(true);
    const tie = knowledgeHandbookPagePlan("full", chapters(10, () => 50));
    expect(tie.chapters.filter(c => c.mode === "spread").map(c => c.id)).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  });

  it("精华版与无档位旧稿不跨页；无图章不参与", () => {
    expect(knowledgeHandbookPagePlan("concise", chapters(20, () => 900)).chapters.every(c => c.mode === "inline")).toBe(true);
    expect(knowledgeHandbookPagePlan(undefined, chapters(20, () => 900)).spreadSlots).toBe(0);
    const mixed = knowledgeHandbookPagePlan("full", [...chapters(6, () => 300), { id: "text", body: "很长".repeat(900), hasImage: false }]);
    expect(mixed.chapters.find(c => c.id === "text")!.mode).toBe("inline");
  });

  it("审校预算：新合同完整版按分配给 420/700；旧稿（无合同）与精华版保持原预算，请求身份不变", () => {
    const pages = Array.from({ length: 34 }, (_, i) => ({ id: `p${i}`, headline: `第${i}章`, body: "图".repeat(i < 17 ? 1100 : 300), imageJobId: `job-${i}` }));
    const fresh = knowledgeReadingCharBudgets("full", pages, KNOWLEDGE_READING_CONTRACT).pages;
    expect(fresh.filter(p => p.maxChars === KNOWLEDGE_SPREAD_PAGE_CHARS).map(p => p.id)).toEqual(pages.slice(0, 17).map(p => p.id));
    expect(knowledgeReadingCharBudgets("full", pages).pages.every(p => p.maxChars === KNOWLEDGE_LEAD_PAGE_CHARS)).toBe(true);
    expect(knowledgeReadingCharBudgets("concise", pages, KNOWLEDGE_READING_CONTRACT).pages.some(p => p.maxChars === KNOWLEDGE_SPREAD_PAGE_CHARS)).toBe(false);
    // 超出判断随之变化：跨页章 500 字即超出，旧稿同字数不超。
    const reviewed = [{ id: "p0", chars: 500 }];
    expect(knowledgeReadingOverflow("full", pages, reviewed, KNOWLEDGE_READING_CONTRACT)).toEqual([{ id: "p0", headline: "第0章", chars: 500, maxChars: KNOWLEDGE_SPREAD_PAGE_CHARS, excess: 80 }]);
    expect(knowledgeReadingOverflow("full", pages, reviewed)).toEqual([]);
  });

  it("导出逐章版式按章 id 对应全书分配：整册排版改动章序不影响；精华版全部图文同页", () => {
    const sourcePages = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, headline: `第${i}章`, body: "图".repeat([900, 10, 800, 20, 700, 30][i]!), imageUrl: `gs://x/${i}.png` }));
    const doc = (level: "full" | "concise", order: number[]) => ({ pages: order.map(i => ({ id: `p${i}`, imageUrl: `gs://x/${i}.png` })), publication: { source: { detailLevel: level, pages: sourcePages } } }) as any;
    // 6 图 → 9 页目标（8.46–9.54），3 个名额：p0、p2、p4。
    expect(knowledgePublicationImageModes(doc("full", [0, 1, 2, 3, 4, 5]))).toEqual(["spread", "inline", "spread", "inline", "spread", "inline"]);
    expect(knowledgePublicationImageModes(doc("full", [5, 4, 3, 2, 1, 0]))).toEqual(["inline", "spread", "inline", "spread", "inline", "spread"]);
    expect(knowledgePublicationImageModes(doc("concise", [0, 1, 2, 3, 4, 5])).every(m => m === "inline")).toBe(true);
  });
});
