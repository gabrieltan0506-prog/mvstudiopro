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

import { auditKnowledgeExportSegments, readKnowledgeLayoutAuditSummary, KNOWLEDGE_LAYOUT_AUDIT_MAX_ISSUES } from "./knowledgeLayoutAudit";
it("分段审查：按段起始页与段内多个排版根换算全书页码，截断清单并保留总数", () => {
  const seg = (count: number, roots: number[], extra: Record<string, unknown> = {}) => ({ count, booklets: roots.map(n => ({ pages: n, layout: Array.from({ length: n }, (_, i) => ({ page: i + 1, ...extra })) })) });
  const ok = auditKnowledgeExportSegments([seg(2, [2]), seg(3, [1, 2])], [0, 2]);
  expect(ok).toEqual({ checked: true, passed: true, pages: 5, issueCount: 0, issues: [] });
  const many = auditKnowledgeExportSegments([seg(80, [80], { overflow: true })], [10]);
  expect(many.checked && many.issueCount).toBe(80);
  expect(many.checked && many.issues.length).toBe(KNOWLEDGE_LAYOUT_AUDIT_MAX_ISSUES);
  expect(many.checked && many.issues[0]).toEqual({ page: 11, kind: "overflow", target: "正文栏" });
  expect(auditKnowledgeExportSegments([seg(2, [2]), { count: 3, booklets: [] }], [0, 2])).toEqual({ checked: false });
  expect(auditKnowledgeExportSegments([seg(2, [2]), undefined], [0, 2])).toEqual({ checked: false });
  expect(readKnowledgeLayoutAuditSummary(undefined)).toBeUndefined();
  expect(readKnowledgeLayoutAuditSummary({ checked: false })).toEqual({ checked: false });
  expect(readKnowledgeLayoutAuditSummary(ok)).toEqual(ok);
});

it("整图版式（站长 2026-11-12）：没有跨页图不误报；裁切条/跨页半张、变形与缩过下限的图被抓出", () => {
  const whole = { width: 1450, height: 815.63, naturalWidth: 1600, naturalHeight: 900, fullWidth: 1450, minWidth: 1254.6, inside: true };
  const pages = [1, 2, 3, 4].map(page => ({ page, whitespace: 0.1, croppedImages: 0, images: page === 4 ? [] : [whole], spreadHalves: { a: 0, b: 0 } }));
  expect(auditKnowledgeBookletLayout(pages)).toEqual({ passed: true, issues: [] });
  // 缩到下限仍合格；高度上限约束下满幅本就低于下限的图不算过小。
  expect(auditKnowledgeBookletLayout([{ page: 1, images: [{ ...whole, width: 1254.6, height: 1254.6 * 900 / 1600 }] }]).passed).toBe(true);
  expect(auditKnowledgeBookletLayout([{ page: 1, images: [{ ...whole, width: 1200, height: 900, naturalWidth: 1200, naturalHeight: 900, fullWidth: 1200 }] }]).passed).toBe(true);
  const bad = structuredClone(pages);
  bad[0].croppedImages = 1;
  bad[1].images = [{ ...whole, height: 900 }];
  bad[2].images = [{ ...whole, width: 1100, height: 1100 * 900 / 1600 }];
  expect(auditKnowledgeBookletLayout(bad).issues.map(i => [i.page, i.kind])).toEqual([[1, "image_cropped"], [2, "image_cropped"], [3, "image_too_small"]]);
});
