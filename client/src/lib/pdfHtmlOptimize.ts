/**
 * 作品庫 DOM 快照上傳 GCS / pdf-worker 前的輕量優化：
 * - 去掉 HTML 註釋
 * - 壓縮標籤間空白（保護 <pre> / <textarea> 內容）
 * - 將 macOS/Windows 字體棧映射到 Linux pdf-worker 的 Noto CJK，利於 PDF 內嵌字體「子集化」、減少多寫入重字重的體積
 */
export function optimizePdfSnapshotHtml(html: string): string {
  let s = html.replace(/<!--([\s\S]*?)-->/g, "");

  const prePlaceholders: string[] = [];
  s = s.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, (block) => {
    prePlaceholders.push(block);
    return `\0PRE_${prePlaceholders.length - 1}_\0`;
  });
  const taPlaceholders: string[] = [];
  s = s.replace(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi, (block) => {
    taPlaceholders.push(block);
    return `\0TA_${taPlaceholders.length - 1}_\0`;
  });

  s = s.replace(/>\s+</g, "><");

  for (let i = taPlaceholders.length - 1; i >= 0; i--) {
    s = s.replace(`\0TA_${i}_\0`, taPlaceholders[i]!);
  }
  for (let i = prePlaceholders.length - 1; i >= 0; i--) {
    s = s.replace(`\0PRE_${i}_\0`, prePlaceholders[i]!);
  }

  const pairs: Array<[RegExp, string]> = [
    [/'PingFang SC','HarmonyOS Sans','Source Han Sans',Inter,sans-serif/gi, "'Noto Sans CJK SC',sans-serif"],
    [/'PingFang SC', 'HarmonyOS Sans', 'Source Han Sans', Inter, sans-serif/gi, "'Noto Sans CJK SC',sans-serif"],
    [/PingFang SC/gi, "Noto Sans CJK SC"],
    [/HarmonyOS Sans/gi, "Noto Sans CJK SC"],
    [/Source Han Sans/gi, "Noto Sans CJK SC"],
    [/Source Han Serif SC/gi, "Noto Serif CJK SC"],
    [/\bInter\b/g, "Noto Sans CJK SC"],
  ];
  for (const [re, to] of pairs) {
    s = s.replace(re, to);
  }

  return s;
}

/**
 * Platform 頁 PDF 快照：與 MyReports `injectPdfSnapshotSanitizeIntoHead` 同源思路
 *（摘掉 Sonner / Toast、列印根容器與圖表分頁），根選擇器為 `#platform-report`。
 */
export function injectPlatformPdfSnapshotSanitizeIntoHead(html: string): string {
  const strip = `<style id="mvs-pdf-snapshot-sanitize">
[data-sonner-toaster],[data-sonner-toast],[data-sonner-toaster] li,
ol[data-sonner-toaster],section[aria-label*="tific" i],section[aria-label*="通知" i],
[class*="sonner-toast"],.toaster.group,.toaster{display:none!important;visibility:hidden!important;
height:0!important;width:0!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important;}
@media print{
html,body{margin:0!important;padding:0!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
#platform-report{margin:0!important;padding:0!important;max-width:none!important;}
/* 決策智庫儀表板等寬幅區：列印時展開橫向捲動容器，避免可視高度為捲動視窗高度 → 空白頁 / 內容被推到下幾頁 */
#platform-report .overflow-x-auto{overflow:visible!important;height:auto!important;max-height:none!important;width:100%!important;}
#platform-report .overflow-x-auto>.inline-block{display:block!important;width:100%!important;max-width:100%!important;}
/* 與 PNG / 桌面預覽一致：列印在紙上占滿寬度（pdf-worker 使用橫向 A4 + 寬 viewport） */
[data-pdf-dashboard="1"]{width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important;}
figure:not(.cover-page),img:not(:is(.cover-page img)),.echart-mount{page-break-inside:avoid!important;break-inside:avoid!important;}
figure:not(.cover-page) img,.report-raw-html figure:not(.cover-page) img,img:not(:is(.cover-page img)){max-height:277mm!important;max-width:100%!important;width:auto!important;height:auto!important;object-fit:contain!important;}
@page{margin:0;size:A4 landscape;}
}
</style>`;
  if (html.includes("</head>")) return html.replace("</head>", `${strip}</head>`);
  return `${strip}${html}`;
}
