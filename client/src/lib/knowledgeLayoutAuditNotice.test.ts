import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import KnowledgeLayoutAuditNotice from "@/components/platform/KnowledgeLayoutAuditNotice";

const html = (audit: unknown, compact = false) => renderToStaticMarkup(createElement(KnowledgeLayoutAuditNotice, { audit, compact }));

it("版面审查提示三种状态：通过 / 有问题（默认前 5 条可展开）/ 未审查", () => {
  expect(html({ checked: true, passed: true, pages: 5, issueCount: 0, issues: [] })).toContain("版面审查通过");
  const issues = Array.from({ length: 7 }, (_, i) => ({ page: i + 3, kind: "whitespace", target: `留白 ${40 + i}%` }));
  const out = html({ checked: true, passed: false, pages: 12, issueCount: 9, issues });
  expect(out).toContain("版面审查发现 9 处需要留意，PDF 仍可照常下载");
  expect(out).toContain("第 3 页 · 留白超过三分之一 · 留白 40%");
  expect(out).toContain("第 7 页 · 留白超过三分之一 · 留白 44%");
  expect(out).not.toContain("第 8 页");
  expect(out).toContain("展开其余 2 条");
  expect(renderToStaticMarkup(createElement(KnowledgeLayoutAuditNotice, { audit: { checked: true, passed: false, pages: 12, issueCount: 9, issues }, defaultExpanded: true }))).toContain("另有 2 处未逐条列出");
  expect(html({ checked: false })).toContain("本次未做版面审查");
  expect(html(undefined)).toContain("本次未做版面审查");
  expect(html({ checked: false }, true)).toBe("");
  // 用户可见文字不含内部术语或模型名（去掉标签与属性后检查）。
  expect(out.replace(/<[^>]*>/g, "")).not.toMatch(/layout|audit|overflow|whitespace|模型|GPT|Gemini|Claude/i);
});
