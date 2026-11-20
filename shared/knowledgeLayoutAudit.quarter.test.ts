import { expect, it } from "vitest";
import { auditKnowledgeBookletLayout, knowledgeLayoutIssueLines, KNOWLEDGE_LAYOUT_MAX_WHITESPACE } from "./knowledgeLayoutAudit";

// 站长 2026-11-13：一章可占两页，但留白不得超过四分之一页（原审查按 1/3）。
const kinds = (whitespace: number) => auditKnowledgeBookletLayout([{ page: 1, whitespace }]).issues.map(i => i.kind);
it("留白上限为四分之一：恰好 25% 通过，超出一点即提示；原先放过的 30% 现在提示", () => {
  expect(KNOWLEDGE_LAYOUT_MAX_WHITESPACE).toBe(0.25);
  expect(kinds(0.25)).toEqual([]);
  expect(kinds(0.2499)).toEqual([]);
  expect(kinds(0.2501)).toEqual(["whitespace"]);
  expect(kinds(0.3)).toEqual(["whitespace"]);
  expect(kinds(1 / 3)).toEqual(["whitespace"]);
});
it("提示文字写四分之一", () => {
  const issues = auditKnowledgeBookletLayout([{ page: 4, whitespace: 0.3 }]).issues;
  expect(knowledgeLayoutIssueLines(issues)).toEqual(["第 4 页 · 留白超过四分之一 · 留白 30%"]);
});
