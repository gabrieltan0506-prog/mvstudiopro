import { describe, expect, it } from "vitest";
import { KNOWLEDGE_READING_CONTRACT as C, knowledgeBudgetInstructions, knowledgeBudgetOutputContract, knowledgeCompressionInstructions, knowledgeEditionPageBudget, knowledgeFinalCompressionMarks, knowledgeReadingCharBudgets, knowledgeReadingOverflow } from "./knowledgeEditionBudget";
import { knowledgeFullPageRange } from "./knowledgeHandbookPagePlan";

// 旧稿（publication 无 readingBudgetVersion）逐字不变：快照在改动前（main 7287ed4）生成，改动后逐字对照。
const pages = Array.from({ length: 48 }, (_, i) => ({ id: `p${i}`, headline: `章${i}`, body: "图中文字".repeat(300), imageJobId: `job-${i}`, role: "illustration" as const, supplement: "史".repeat(15000 + (i % 7) * 10000) }));
describe("旧预算快照（改动前生成）", () => {
  it("完整版新合同 / 无合同 / 精华版：预算数值、审校提示、输出合同、压缩说明、补压标记", () => {
    for (const contract of [C, undefined] as const) for (const level of ["full", "concise"] as const) {
      const b = knowledgeReadingCharBudgets(level, level === "full" ? pages : pages.slice(0, 20), contract);
      expect({ budget: b.budget, pages: b.pages }).toMatchSnapshot(`budgets-${level}-${contract}`);
      expect(knowledgeBudgetInstructions(level, b.pages.slice(0, 3), contract)).toMatchSnapshot(`instr-${level}-${contract}`);
      expect(knowledgeBudgetOutputContract(level, b.pages.slice(0, 3), contract)).toMatchSnapshot(`contract-${level}-${contract}`);
      expect(knowledgeCompressionInstructions(level, [{ id: "p0", headline: "章0", chars: 900, maxChars: 700, excess: 200 }])).toMatchSnapshot(`compress-${level}`);
      expect(knowledgeReadingOverflow(level, pages, pages.map((p, i) => ({ id: p.id, chars: 500 + i * 60 })), contract)).toMatchSnapshot(`overflow-${level}-${contract}`);
    }
    expect(knowledgeFinalCompressionMarks(pages, pages.map((p, i) => ({ id: p.id, chars: 300 + i * 80, hasTable: i % 2 === 0 })))).toMatchSnapshot("final-marks");
    expect([16, 34, 48].map(n => [knowledgeFullPageRange(n), knowledgeEditionPageBudget("full", n), knowledgeEditionPageBudget("concise", Math.min(n, 30))])).toMatchSnapshot("ranges");
  });
});
