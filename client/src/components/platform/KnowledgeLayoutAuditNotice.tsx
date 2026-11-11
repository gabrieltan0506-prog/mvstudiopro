import React, { useState } from "react";
import { knowledgeLayoutIssueLines, readKnowledgeLayoutAuditSummary } from "@shared/knowledgeLayoutAudit";

/** 默认先列出的问题条数，其余点「展开」再看。 */
export const KNOWLEDGE_LAYOUT_NOTICE_PREVIEW = 5;

/**
 * 导出后的版面审查提示：只提示，不拦截下载。
 * 通过 → 一行「版面审查通过」；有问题 → 「第 N 页 · 问题 · 涉及内容」清单；未审查/旧成品 → 一行说明（compact 时不显示）。
 */
export default function KnowledgeLayoutAuditNotice({ audit, compact = false, defaultExpanded = false }: { audit: unknown; compact?: boolean; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const summary = readKnowledgeLayoutAuditSummary(audit);
  if (!summary || !summary.checked) {
    return compact ? null : <p className="text-xs text-gray-400" data-layout-audit="unchecked">本次未做版面审查</p>;
  }
  if (summary.passed) return <p className="text-xs text-emerald-200" data-layout-audit="passed">版面审查通过</p>;
  const lines = knowledgeLayoutIssueLines(summary.issues);
  const shown = expanded ? lines : lines.slice(0, KNOWLEDGE_LAYOUT_NOTICE_PREVIEW);
  const hidden = summary.issueCount - shown.length;
  return (
    <div className="text-xs text-amber-100" data-layout-audit="issues">
      <p>版面审查发现 {summary.issueCount} 处需要留意，PDF 仍可照常下载：</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {shown.map((line, i) => <li key={i}>{line}</li>)}
      </ul>
      {lines.length > KNOWLEDGE_LAYOUT_NOTICE_PREVIEW && (
        <button type="button" className="mt-1 underline" onClick={() => setExpanded(v => !v)}>
          {expanded ? "收起" : `展开其余 ${lines.length - shown.length} 条`}
        </button>
      )}
      {hidden > 0 && (expanded || lines.length <= KNOWLEDGE_LAYOUT_NOTICE_PREVIEW) && <p className="mt-1 text-gray-400">另有 {hidden} 处未逐条列出</p>}
    </div>
  );
}
