import { expect, it } from "vitest";
import { auditKnowledgeBookletLayout, knowledgeLayoutIssueLines } from "./knowledgeLayoutAudit";

const clean = [1, 2, 3].map(page => ({ page, whitespace: 0.1, overflow: false, clippedHeadings: [], overlaps: [], brokenImages: [], spreadHalves: { a: 0, b: 0 } }));
it("干净版面通过", () => {
  expect(auditKnowledgeBookletLayout(clean)).toEqual({ passed: true, issues: [] });
  expect(auditKnowledgeBookletLayout([{ page: 1, spreadHalves: { a: 1, b: 0 } }, { page: 2, spreadHalves: { a: 0, b: 1 } }]).passed).toBe(true);
});
it("抓出标题遮挡、溢出、留白超限、页码不连续、坏图与跨页图不成对", () => {
  const pages = structuredClone(clean);
  pages[0].overlaps = [{ cover: "图片条", target: "下篇预告标题" }] as any;
  pages[0].clippedHeadings = ["第三章 血脂"] as any;
  pages[1].overflow = true;
  pages[1].whitespace = 0.4;
  pages[2].page = 5;
  pages[2].brokenImages = ["图 3"] as any;
  pages[2].spreadHalves = { a: 1, b: 0 };
  const result = auditKnowledgeBookletLayout(pages);
  expect(result.passed).toBe(false);
  expect(result.issues.map(i => [i.page, i.kind])).toEqual([
    [1, "clipped"], [1, "occluded"], [2, "overflow"], [2, "whitespace"], [5, "page_number"], [5, "image_missing"], [5, "spread_unpaired"],
  ]);
  const lines = knowledgeLayoutIssueLines(result.issues).join("\n");
  expect(lines).toContain("第 1 页 · 元素遮挡 · 图片条 压住 下篇预告标题");
  expect(lines).not.toMatch(/GLM|DeepSeek|OpenRouter|EvoLink|Gemini/);
});
