/**
 * 黑金卡布奇诺 HTML 壳 · 与 marked 组合后在 Puppeteer 内 printBackground 出 PDF。
 * 不依赖外网字体 CDN（使用容器内 fonts-noto-cjk），避免 networkidle 卡死。
 */

import { marked } from "marked";

marked.setOptions({ gfm: true });

function parseMarkdownToHtml(markdownContent: string): string {
  const raw = String(markdownContent || "").trim();
  if (!raw) return "<p>（无正文）</p>";
  // async: false → 同步返回 string
  return marked.parse(raw, { async: false }) as string;
}

export function generateHtmlTemplate(markdownContent: string): string {
  const htmlBody = parseMarkdownToHtml(markdownContent);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>战略情报局 · 智库报告</title>
  <style>
    :root {
      --bg-color: #FAF8F5;
      --text-main: #2D2D2D;
      --gold-accent: #B8860B;
      --dark-panel: #1A1A1A;
      --table-stripe: #F2EFE9;
      --quote-bg: #F0EBE1;
    }
    * { box-sizing: border-box; }
    body {
      font-family: "Noto Sans CJK SC", "Noto Sans CJK TC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif;
      background-color: var(--bg-color);
      color: var(--text-main);
      line-height: 1.8;
      padding: 8px 8px 24px;
      margin: 0;
      font-size: 14px;
    }
    /* 淡色对角水印 — 打印时保留 */
    .wm {
      position: fixed;
      top: 38%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-32deg);
      font-size: 56px;
      font-weight: 800;
      color: rgba(184, 134, 11, 0.07);
      z-index: 0;
      pointer-events: none;
      white-space: nowrap;
      user-select: none;
    }
    .content { position: relative; z-index: 1; }
    h1, h2, h3 {
      font-family: "Noto Serif CJK SC", "Noto Serif CJK TC", "Source Han Serif SC", "Songti SC", serif;
      color: var(--dark-panel);
      border-bottom: 1px solid rgba(184, 134, 11, 0.35);
      padding-bottom: 8px;
      margin-top: 1.2em;
    }
    h1 {
      color: var(--gold-accent);
      text-align: center;
      margin-bottom: 28px;
      font-size: 1.75rem;
      border-bottom: 2px solid rgba(184, 134, 11, 0.45);
    }
    h2 { font-size: 1.35rem; }
    h3 { font-size: 1.15rem; border-bottom: none; }
    p { margin: 0.65em 0; }
    a { color: #8B4513; }
    ul, ol { padding-left: 1.4em; }
    li { margin: 0.35em 0; }
    hr {
      border: none;
      border-top: 1px solid rgba(26, 26, 26, 0.12);
      margin: 1.5em 0;
    }
    /* 表格 — 黑金表头 */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 22px 0;
      font-size: 13px;
      page-break-inside: auto;
    }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    th {
      background-color: var(--dark-panel);
      color: var(--gold-accent);
      padding: 10px 12px;
      text-align: left;
      font-weight: 700;
      border: 1px solid #333;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #E0DCD3;
      border-left: 1px solid #E8E4DB;
      border-right: 1px solid #E8E4DB;
      vertical-align: top;
    }
    tr:nth-child(even) td { background-color: var(--table-stripe); }
    blockquote {
      border-left: 4px solid var(--gold-accent);
      background-color: var(--quote-bg);
      padding: 12px 18px;
      margin: 18px 0;
      font-style: italic;
      color: #3d3d3d;
    }
    pre, code {
      font-family: ui-monospace, "Cascadia Code", monospace;
      font-size: 12px;
    }
    pre {
      background: #1a1a1a;
      color: #e8e0d5;
      padding: 12px 14px;
      border-radius: 8px;
      overflow-x: auto;
      page-break-inside: avoid;
    }
    code { background: rgba(184, 134, 11, 0.12); padding: 1px 5px; border-radius: 4px; }
    pre code { background: transparent; padding: 0; }
    img { max-width: 100%; height: auto; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="wm">CONFIDENTIAL · 机密</div>
  <div class="content">
    ${htmlBody}
  </div>
</body>
</html>`;
}
