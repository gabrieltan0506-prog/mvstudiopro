/** 客户端：优化稿 Markdown / PDF / Word 导出辅助 */

export function downloadTextFile(fileName: string, content: string, mime = "text/markdown;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadBase64File(fileName: string, base64: string, mime: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function triggerUrlDownload(fileUrl: string, fileName: string) {
  const a = document.createElement("a");
  a.href = fileUrl;
  a.download = fileName;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.click();
}

export function buildOptimizedCopyPdfHtml(input: {
  title?: string;
  markdown: string;
  imageUrls?: string[];
}): string {
  const title = String(input.title || "平台优化文案").trim() || "平台优化文案";
  const escaped = String(input.markdown || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const bodyHtml = escaped
    .split(/\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return "<br/>";
      if (/^###\s/.test(t)) return `<h3>${t.replace(/^###\s/, "")}</h3>`;
      if (/^##\s/.test(t)) return `<h2>${t.replace(/^##\s/, "")}</h2>`;
      if (/^#\s/.test(t)) return `<h1>${t.replace(/^#\s/, "")}</h1>`;
      return `<p>${t}</p>`;
    })
    .join("\n");

  const imagesHtml = (input.imageUrls || [])
    .filter(Boolean)
    .map(
      (url) =>
        `<figure style="margin:16px 0;text-align:center;"><img src="${url.replace(/"/g, "&quot;")}" style="max-width:100%;height:auto;border-radius:8px;" alt="素材"/></figure>`,
    )
    .join("\n");

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/><title>${title}</title>
<style>
body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;padding:32px;color:#111;line-height:1.75;font-size:14px;}
h1{font-size:22px;margin:0 0 16px;} h2{font-size:18px;margin:20px 0 10px;} h3{font-size:16px;margin:16px 0 8px;}
p{margin:8px 0;}
</style></head><body>
<h1>${title}</h1>
${imagesHtml}
${bodyHtml}
</body></html>`;
}
