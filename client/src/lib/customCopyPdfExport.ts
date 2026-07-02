export type CustomCopyPdfKind =
  | "single_page_knowledge_card"
  | "storyboard_sheet_landscape"
  | "optimize_custom_copy";

export type CustomCopyPdfPayload = {
  kind: CustomCopyPdfKind;
  sourceText: string;
  optimizeBrief?: string;
  optimizeResult?: string | null;
  optimizeSummary?: string | null;
  imageUpperUrl?: string | null;
  imageLowerUrl?: string | null;
  exportedAt?: Date;
};

const KIND_LABEL: Record<CustomCopyPdfKind, string> = {
  single_page_knowledge_card: "单页图文知识卡片",
  storyboard_sheet_landscape: "2×4 分镜图",
  optimize_custom_copy: "深度优化文案",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatExportTime(date: Date): string {
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function textBlock(title: string, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  return `<section class="block">
    <h2>${escapeHtml(title)}</h2>
    <pre class="body">${escapeHtml(trimmed)}</pre>
  </section>`;
}

function imageBlock(title: string, url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  return `<section class="block">
    <h2>${escapeHtml(title)}</h2>
    <img src="${escapeHtml(trimmed)}" alt="${escapeHtml(title)}" />
  </section>`;
}

/** 自定义文案工作台：轻量 HTML 快照，供 pdf-worker 压制 PDF。 */
export function buildCustomCopyPdfHtml(payload: CustomCopyPdfPayload): string {
  const exportedAt = payload.exportedAt ?? new Date();
  const kindLabel = KIND_LABEL[payload.kind];
  const sections: string[] = [];

  sections.push(textBlock("原始文案", payload.sourceText));
  if (payload.optimizeBrief?.trim()) {
    sections.push(textBlock("优化要求", payload.optimizeBrief));
  }
  if (payload.optimizeResult?.trim()) {
    const summary = payload.optimizeSummary?.trim();
    const title = summary ? `深度优化结果 · ${summary}` : "深度优化结果";
    sections.push(textBlock(title, payload.optimizeResult));
  }
  if (payload.imageUpperUrl?.trim()) {
    const upperTitle =
      payload.kind === "single_page_knowledge_card" ? "图文卡片 · 上篇" : "生成图片";
    sections.push(imageBlock(upperTitle, payload.imageUpperUrl));
  }
  if (payload.imageLowerUrl?.trim()) {
    sections.push(imageBlock("图文卡片 · 下篇", payload.imageLowerUrl));
  }

  const bodyContent = sections.filter(Boolean).join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>自定义文案 · ${escapeHtml(kindLabel)}</title>
  <style>
    @page { margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #1a1a2e;
      font-family: "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    #custom-copy-export {
      max-width: 720px;
      margin: 0 auto;
      padding: 24px 20px 40px;
    }
    .masthead {
      border-bottom: 2px solid #ff4fb8;
      padding-bottom: 14px;
      margin-bottom: 22px;
    }
    .masthead h1 {
      margin: 0 0 6px;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: 0.02em;
      color: #111827;
    }
    .masthead .meta {
      margin: 0;
      font-size: 12px;
      color: #6b7280;
    }
    .block { margin-bottom: 22px; page-break-inside: avoid; }
    .block h2 {
      margin: 0 0 8px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #c026d3;
    }
    .block .body {
      margin: 0;
      padding: 14px 16px;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #fafafa;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 13px;
      line-height: 1.75;
      font-family: inherit;
    }
    .block img {
      display: block;
      width: 100%;
      max-width: 100%;
      height: auto;
      border-radius: 10px;
      border: 1px solid #e5e7eb;
    }
  </style>
</head>
<body>
  <div id="custom-copy-export">
    <header class="masthead">
      <h1>自定义文案 · ${escapeHtml(kindLabel)}</h1>
      <p class="meta">导出时间 ${escapeHtml(formatExportTime(exportedAt))} · MV Studio Pro</p>
    </header>
    ${bodyContent}
  </div>
</body>
</html>`;
}

export function hasCustomCopyPdfContent(payload: CustomCopyPdfPayload): boolean {
  return Boolean(
    payload.sourceText.trim() ||
      payload.optimizeBrief?.trim() ||
      payload.optimizeResult?.trim() ||
      payload.imageUpperUrl?.trim() ||
      payload.imageLowerUrl?.trim(),
  );
}
