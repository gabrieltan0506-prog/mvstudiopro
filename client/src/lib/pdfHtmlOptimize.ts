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
