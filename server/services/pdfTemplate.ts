/**
 * 「私人银行 · 黑金象牙」战略报告 HTML 壳
 * 与 marked 组合后由 Puppeteer 在容器内 printBackground 出 PDF。
 * 不依赖外网字体 CDN（使用容器内 fonts-noto-cjk），避免 networkidle 卡死。
 *
 * 调色板（v2 · 商务收敛）：
 *   - 冷象牙底色 + 深炭正文 + 香槟金/海军蓝双重点缀
 *   - 浅色斜对角浮水印（极低权重，避免红色压迫感）
 *   - 表格头：海军蓝底 + 香槟金描边 + 浅金标题
 */

import { marked } from "marked";

marked.setOptions({ gfm: true });

function parseMarkdownToHtml(markdownContent: string): string {
  const raw = String(markdownContent || "").trim();
  if (!raw) return "<p>（无正文）</p>";
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
      /* 冷象牙底色 + 深炭正文 + 香槟金 + 海军 */
      --bg-page: #F7F4EC;
      --bg-elev: #FBF8F2;
      --text-main: #1C1C1C;
      --text-muted: #555555;
      --gold: #9C7A2A;
      --gold-soft: #C9A14A;
      --navy: #1F2A44;
      --navy-soft: #34425E;
      --rule: #D9D2C2;
      --row-alt: #EFEAE0;
      --confidential: #6E2A2A;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: "Noto Sans CJK SC", "Noto Sans CJK TC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, "Helvetica Neue", sans-serif;
      background-color: var(--bg-page);
      color: var(--text-main);
      line-height: 1.78;
      padding: 16px 14px 28px;
      font-size: 13.5px;
      letter-spacing: 0.005em;
    }

    /* 极低权重斜对角水印 */
    .wm {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-30deg);
      font-size: 96px;
      font-weight: 800;
      color: rgba(31, 42, 68, 0.045);
      letter-spacing: 0.18em;
      z-index: 0;
      pointer-events: none;
      white-space: nowrap;
      user-select: none;
    }
    .content { position: relative; z-index: 1; }

    /* 标题 */
    h1, h2, h3, h4 {
      font-family: "Noto Serif CJK SC", "Noto Serif CJK TC", "Source Han Serif SC", Georgia, serif;
      color: var(--text-main);
      letter-spacing: 0.025em;
      line-height: 1.45;
    }
    h1 {
      font-size: 25px;
      font-weight: 800;
      color: var(--text-main);
      text-align: left;
      padding: 26px 28px;
      margin: 0 0 28px;
      background: linear-gradient(135deg, rgba(156,122,42,0.10) 0%, rgba(31,42,68,0.05) 100%);
      border-left: 4px solid var(--gold);
      border-right: 1px solid var(--rule);
    }
    h2 {
      font-size: 19px;
      font-weight: 700;
      color: var(--navy);
      border-bottom: 2px solid var(--gold);
      padding-bottom: 7px;
      margin: 36px 0 18px;
    }
    h3 {
      font-size: 15.5px;
      font-weight: 700;
      color: var(--text-main);
      margin: 24px 0 12px;
      padding-left: 12px;
      border-left: 3px solid var(--gold);
    }
    h4 {
      font-size: 14px;
      font-weight: 700;
      color: var(--navy-soft);
      margin: 18px 0 8px;
    }

    p { margin: 10px 0; color: var(--text-main); }
    strong { color: var(--navy); font-weight: 700; }
    em { color: var(--navy-soft); font-style: italic; }
    a { color: var(--gold); text-decoration: underline; }
    hr {
      border: none;
      border-top: 1px solid var(--rule);
      margin: 26px 0;
    }

    ul, ol { padding-left: 22px; margin: 10px 0; }
    li { margin: 4px 0; line-height: 1.78; }
    li::marker { color: var(--gold); }

    /* 表格 — 海军蓝表头 + 香槟金描边 */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 12.5px;
      page-break-inside: auto;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
    }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    thead th {
      background: var(--navy);
      color: var(--gold-soft);
      padding: 11px 13px;
      text-align: left;
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.05em;
      border-bottom: 2px solid var(--gold);
      border-right: 1px solid #2a3756;
    }
    thead th:last-child { border-right: none; }
    tbody td {
      padding: 10px 13px;
      border-bottom: 1px solid var(--rule);
      vertical-align: top;
      color: var(--text-main);
    }
    tbody tr:nth-child(even) td { background-color: var(--row-alt); }

    /* 引用 / 战略警示 */
    blockquote {
      border-left: 4px solid var(--gold);
      background: rgba(156, 122, 42, 0.06);
      padding: 13px 20px;
      margin: 18px 0;
      color: var(--navy);
      border-radius: 0 6px 6px 0;
      font-style: normal;
    }
    blockquote p { margin: 6px 0; }

    /* 代码 / 关键术语 */
    code {
      background: rgba(31, 42, 68, 0.07);
      padding: 1px 6px;
      border-radius: 3px;
      font-family: "JetBrains Mono", "SF Mono", Menlo, ui-monospace, monospace;
      font-size: 12px;
      color: var(--navy);
    }
    pre {
      background: #15203b;
      color: #d8c8a0;
      padding: 14px 16px;
      border-radius: 6px;
      border-left: 3px solid var(--gold);
      overflow-x: auto;
      font-size: 12px;
      page-break-inside: avoid;
    }
    pre code { background: transparent; padding: 0; color: inherit; }

    img { max-width: 100%; height: auto; border-radius: 4px; }

    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      h2 { page-break-after: avoid; }
      h3 { page-break-after: avoid; }
    }
  </style>
</head>
<body>
  <div class="wm">CONFIDENTIAL · 战略情报局</div>
  <div class="content">
    ${htmlBody}
  </div>
</body>
</html>`;
}
