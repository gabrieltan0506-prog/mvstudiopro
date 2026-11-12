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
  /** 本页跨页图左右半张计数（旧版式；新版式恒为 0，保留字段兼容旧测量）。 */
  spreadHalves?: { a: number; b: number };
  /** 本页被裁切的图片元素数（跨页半张、预告裁切条）；站长 2026-11-12 起不允许任何裁切，应为 0。 */
  croppedImages?: number;
  /** 本页整图的实测显示尺寸：须与原图等比例（±1px）、完整落在图框内、宽度不低于 min(满幅, 下限)。 */
  images?: { width: number; height: number; naturalWidth: number; naturalHeight: number; fullWidth: number; minWidth: number; contentWidth?: number; inside?: boolean }[];
};
export type KnowledgeLayoutIssueKind = "overflow" | "clipped" | "occluded" | "whitespace" | "page_number" | "image_missing" | "spread_unpaired" | "image_cropped" | "image_too_small";
export type KnowledgeLayoutIssue = { page: number; kind: KnowledgeLayoutIssueKind; target: string };
export const KNOWLEDGE_LAYOUT_MAX_WHITESPACE = 1 / 3;
export const KNOWLEDGE_LAYOUT_ISSUE_LABEL: Record<KnowledgeLayoutIssueKind, string> = {
  overflow: "文字溢出", clipped: "标题被裁切", occluded: "元素遮挡", whitespace: "留白超过三分之一",
  page_number: "页码不连续", image_missing: "图片缺失", spread_unpaired: "跨页图不成对",
  image_cropped: "图片被裁切或变形", image_too_small: "图片缩得过小",
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
    if (m.croppedImages) issues.push({ page: m.page, kind: "image_cropped", target: `裁切图 ${m.croppedImages} 处` });
    for (const img of m.images || []) {
      if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) continue;
      const expectedHeight = img.width * img.naturalHeight / img.naturalWidth;
      if (Math.abs(img.height - expectedHeight) > 1 || img.inside === false)
        issues.push({ page: m.page, kind: "image_cropped", target: `显示 ${Math.round(img.width)}×${Math.round(img.height)}，原图 ${img.naturalWidth}×${img.naturalHeight}` });
      if (img.width + 1 < Math.min(img.fullWidth, img.minWidth))
        issues.push({ page: m.page, kind: "image_too_small", target: `宽 ${Math.round(img.width)}，下限 ${Math.round(Math.min(img.fullWidth, img.minWidth))}` });
    }
    spreadA += m.spreadHalves?.a || 0; spreadB += m.spreadHalves?.b || 0;
  });
  if (spreadA !== spreadB) issues.push({ page: pages.at(-1)?.page ?? 0, kind: "spread_unpaired", target: `左半 ${spreadA} 张、右半 ${spreadB} 张` });
  return { passed: issues.length === 0, issues };
}

/** 给用户看的问题清单（不含模型/通道名）。 */
export function knowledgeLayoutIssueLines(issues: KnowledgeLayoutIssue[]) {
  return issues.map(i => `第 ${i.page} 页 · ${KNOWLEDGE_LAYOUT_ISSUE_LABEL[i.kind]} · ${i.target}`);
}

/** 导出结果里的版面审查摘要：checked=false 表示本次未审查（排版服务未回报测量或数据不全），不影响导出。issues 截断到上限，issueCount 为总数。 */
export type KnowledgeLayoutAuditSummary =
  | { checked: false }
  | { checked: true; passed: boolean; pages: number; issueCount: number; issues: KnowledgeLayoutIssue[] };
export const KNOWLEDGE_LAYOUT_AUDIT_MAX_ISSUES = 60;

/**
 * 分段导出：每段一组排版根（booklets），每根的 layout 页码是段内、根内从 1 起的局部页码。
 * 按段起始页（offsets）与段内前序根页数换算成全书页码后整册审查；任一段/根缺测量或页数对不上即视为未审查。
 */
export function auditKnowledgeExportSegments(
  segments: ({ count: number; booklets?: { pages?: number; layout?: unknown }[] } | undefined)[],
  offsets: number[],
): KnowledgeLayoutAuditSummary {
  try {
    const pages: KnowledgeLayoutPageMeasure[] = [];
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      const booklets = segment?.booklets;
      if (!segment || !booklets?.length || !Number.isSafeInteger(offsets[index])) return { checked: false };
      let within = 0;
      for (const booklet of booklets) {
        if (!Array.isArray(booklet.layout)) return { checked: false };
        for (const raw of booklet.layout as KnowledgeLayoutPageMeasure[]) {
          if (!raw || typeof raw !== "object" || !Number.isFinite(raw.page)) return { checked: false };
          pages.push({ ...raw, page: raw.page + offsets[index]! + within });
        }
        within += booklet.layout.length;
      }
      if (within !== segment.count) return { checked: false };
    }
    if (!pages.length) return { checked: false };
    const result = auditKnowledgeBookletLayout(pages);
    return { checked: true, passed: result.passed, pages: pages.length, issueCount: result.issues.length, issues: result.issues.slice(0, KNOWLEDGE_LAYOUT_AUDIT_MAX_ISSUES) };
  } catch {
    return { checked: false };
  }
}

/** 读回成品清单里的审查摘要；旧清单或格式不对时返回 undefined（前台按未审查处理）。 */
export function readKnowledgeLayoutAuditSummary(value: unknown): KnowledgeLayoutAuditSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (v.checked === false) return { checked: false };
  if (v.checked !== true || typeof v.passed !== "boolean" || !Array.isArray(v.issues) || !Number.isSafeInteger(v.issueCount)) return undefined;
  const kinds = Object.keys(KNOWLEDGE_LAYOUT_ISSUE_LABEL);
  const issues = (v.issues as KnowledgeLayoutIssue[]).filter(i => i && Number.isFinite(i.page) && kinds.includes(i.kind) && typeof i.target === "string").slice(0, KNOWLEDGE_LAYOUT_AUDIT_MAX_ISSUES);
  return { checked: true, passed: v.passed, pages: Number(v.pages) || 0, issueCount: v.issueCount as number, issues };
}
