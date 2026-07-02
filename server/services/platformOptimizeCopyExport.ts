import axios from "axios";
import { storagePut } from "../storage";

export type ExportOptimizedCopyInput = {
  title?: string;
  markdown: string;
  /** 封面 / 分镜等 HTTPS 或 data URL */
  imageUrls?: string[];
};

async function fetchImageBuffer(url: string): Promise<{ buffer: Buffer; mime: string } | null> {
  const raw = String(url || "").trim();
  if (!raw) return null;
  if (raw.startsWith("data:")) {
    const match = raw.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return { buffer: Buffer.from(match[2], "base64"), mime: match[1] || "image/png" };
  }
  try {
    const res = await axios.get<ArrayBuffer>(raw, { responseType: "arraybuffer", timeout: 30_000 });
    const mime = String(res.headers["content-type"] || "image/png").split(";")[0];
    return { buffer: Buffer.from(res.data), mime };
  } catch {
    return null;
  }
}

function markdownToParagraphs(markdown: string) {
  return String(markdown || "").split(/\n/).map((line) => line.trimEnd());
}

export async function exportOptimizedCopyToWord(
  input: ExportOptimizedCopyInput,
): Promise<{ url: string; fileName: string }> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    ImageRun,
  } = await import("docx");

  const title = String(input.title || "平台优化文案").trim() || "平台优化文案";
  const children: InstanceType<typeof Paragraph>[] = [];

  children.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    }),
  );

  for (const url of input.imageUrls || []) {
    const img = await fetchImageBuffer(url);
    if (!img) continue;
    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: img.buffer,
            transformation: { width: 480, height: 270 },
            type: img.mime.includes("png") ? "png" : "jpg",
          }),
        ],
        spacing: { after: 200 },
      }),
    );
  }

  for (const line of markdownToParagraphs(input.markdown)) {
    if (!line.trim()) {
      children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
      continue;
    }
    const isHeading = /^#{1,3}\s/.test(line);
    const text = line.replace(/^#{1,3}\s/, "");
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: isHeading,
            size: isHeading ? 28 : 24,
          }),
        ],
        spacing: { after: isHeading ? 160 : 100 },
      }),
    );
  }

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  const fileName = `platform-optimized-copy-${Date.now()}.docx`;
  const uploaded = await storagePut(
    fileName,
    buffer,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  return { url: uploaded.url, fileName };
}

export function buildOptimizedCopyPdfHtml(input: ExportOptimizedCopyInput): string {
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
