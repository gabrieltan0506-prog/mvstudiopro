import type { CanvasUploadedAsset } from "./canvasTypes";

const TEXT_DOC_EXT = /\.(txt|md|markdown)(\?|$)/i;
const PDF_EXT = /\.pdf(\?|$)/i;
const MAX_DOC_CHARS = 100_000;

function isPlainTextDocument(asset: CanvasUploadedAsset): boolean {
  const name = asset.fileName || asset.url || "";
  if (TEXT_DOC_EXT.test(name)) return true;
  if (asset.mimeType?.startsWith("text/")) return true;
  return false;
}

function isPdfDocument(asset: CanvasUploadedAsset): boolean {
  const name = asset.fileName || asset.url || "";
  return PDF_EXT.test(name) || asset.mimeType === "application/pdf";
}

/** 读取画布文档正文：TXT/MD 直接 fetch；PDF 需用户改贴文本或改用 TXT */
export async function loadCanvasDocumentTexts(assets: CanvasUploadedAsset[]): Promise<string[]> {
  if (!assets.length) return [];

  const chunks: string[] = [];
  for (const asset of assets) {
    const label = asset.fileName || "文档";
    if (isPdfDocument(asset) && !isPlainTextDocument(asset)) {
      throw new Error(
        `暂不支持直接解析 PDF「${label}」正文。请另存为 TXT/MD 再上传，或把正文粘贴到提示词后运行。`,
      );
    }
    if (!isPlainTextDocument(asset)) {
      throw new Error(`无法读取文档「${label}」：请使用 TXT / MD`);
    }
    const resp = await fetch(asset.url);
    if (!resp.ok) {
      throw new Error(`无法读取文档「${label}」（HTTP ${resp.status}）。请重新上传后再试。`);
    }
    const text = String(await resp.text() || "").replace(/^\uFEFF/, "").trim();
    if (!text) {
      throw new Error(`文档「${label}」内容为空`);
    }
    chunks.push(`【文档 ${label}】\n${text.slice(0, MAX_DOC_CHARS)}`);
  }
  return chunks;
}
