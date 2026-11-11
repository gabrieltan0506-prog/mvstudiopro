/**
 * 排版后快速版面审查（站长 2026-11-11）：只查排版问题、不查内容事实、不调模型。
 * 输入是分页脚本（shared/knowledgeBooklet.ts）写在 __knowledgeBooklet.layout 的逐页测量值；纯函数，便于单测与服务端/前台复用。
 */
export type KnowledgeLayoutPageMeasure = {
  /** 印在页脚的页码（从 1 起）。 */
  page: number;
  /** 补白后仍空着的版心比例（0–1）。 */
  whitespace?: number;
  /** 正文栏是否溢出（scrollHeight 超出可视高度）。 */
  overflow?: boolean;
  /** 被裁切的标题文字（含「下篇预告」标题）。 */
  clippedHeadings?: string[];
  /** 互相压住的元素对：补白块/图片条 与 标题或正文。 */
  overlaps?: { cover: string; target: string }[];
  /** 未加载成功的图片（标题或序号）。 */
  brokenImages?: string[];
  /** 本页跨页图左右半张计数。 */
  spreadHalves?: { a: number; b: number };
};
export type KnowledgeLayoutIssueKind = "overflow" | "clipped" | "occluded" | "whitespace" | "page_number" | "image_missing" | "spread_unpaired";
export type KnowledgeLayoutIssue = { page: number; kind: KnowledgeLayoutIssueKind; target: string };
export const KNOWLEDGE_LAYOUT_MAX_WHITESPACE = 1 / 3;
export const KNOWLEDGE_LAYOUT_ISSUE_LABEL: Record<KnowledgeLayoutIssueKind, string> = {
  overflow: "文字溢出", clipped: "标题被裁切", occluded: "元素遮挡", whitespace: "留白超过三分之一",
  page_number: "页码不连续", image_missing: "图片缺失", spread_unpaired: "跨页图不成对",
};

export function auditKnowledgeBookletLayout(pages: KnowledgeLayoutPageMeasure[]): { passed: boolean; issues: KnowledgeLayoutIssue[] } {
  const issues: KnowledgeLayoutIssue[] = [];
  let spreadA = 0, spreadB = 0;
  pages.forEach((m, i) => {
    const expected = (pages[0]?.page ?? 1) + i;
    if (m.page !== expected) issues.push({ page: m.page, kind: "page_number", target: `应为第 ${expected} 页` });
    if (m.overflow) issues.push({ page: m.page, kind: "overflow", target: "正文栏" });
    for (const h of m.clippedHeadings || []) issues.push({ page: m.page, kind: "clipped", target: h });
    for (const o of m.overlaps || []) issues.push({ page: m.page, kind: "occluded", target: `${o.cover} 压住 ${o.target}` });
    if (typeof m.whitespace === "number" && m.whitespace > KNOWLEDGE_LAYOUT_MAX_WHITESPACE)
      issues.push({ page: m.page, kind: "whitespace", target: `留白 ${Math.round(m.whitespace * 100)}%` });
    for (const img of m.brokenImages || []) issues.push({ page: m.page, kind: "image_missing", target: img });
    spreadA += m.spreadHalves?.a || 0; spreadB += m.spreadHalves?.b || 0;
  });
  if (spreadA !== spreadB) issues.push({ page: pages.at(-1)?.page ?? 0, kind: "spread_unpaired", target: `左半 ${spreadA} 张、右半 ${spreadB} 张` });
  return { passed: issues.length === 0, issues };
}

/** 给用户看的问题清单（不含模型/通道名）。 */
export function knowledgeLayoutIssueLines(issues: KnowledgeLayoutIssue[]) {
  return issues.map(i => `第 ${i.page} 页 · ${KNOWLEDGE_LAYOUT_ISSUE_LABEL[i.kind]} · ${i.target}`);
}
