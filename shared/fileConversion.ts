/** 首页格式目录与执行器共用；只有已接入的格式才可选择。 */
export const FILE_CONVERSION_VERSION = 1;
export const FILE_CONVERSION_FREE_MAX_BYTES = 3_000_000;
export const FILE_CONVERSION_FORMATS = [
  { id: "pdf-docx", from: ["pdf"], to: "docx", label: "PDF → Word", group: "文档", note: "导出可编辑文字，按原页分隔；复杂表格、插图和原版式不保留。扫描文字需对照原件校对。" },
  { id: "pdf-txt", from: ["pdf"], to: "txt", label: "PDF → TXT", group: "文档", note: "提取文字层；含需识别的扫描页时先提示。" },
  { id: "html-pdf", from: ["html", "htm"], to: "pdf", label: "HTML → PDF", group: "文档", note: "支持内嵌样式和图片，展开折叠正文，宽表自动横向排版；不执行脚本，不加载网站、外部字体或本地文件。" },
  { id: "epub-pdf", from: ["epub"], to: "pdf", label: "EPUB → PDF", group: "电子书", note: "按阅读顺序排版；不支持加密电子书，不静默丢弃章节或图片。" },
  { id: "txt-docx", from: ["txt"], to: "docx", label: "TXT → Word", group: "文档", note: "UTF-8 文本转为可编辑文档。" },
  ...(["png", "jpeg", "webp", "tiff", "avif"] as const).map(to => ({
    id: `image-${to}`, from: ["png", "jpg", "jpeg", "webp", "tif", "tiff", "avif"], to,
    label: `图片 → ${to.toUpperCase()}`, group: "图片", note: "静态单页图片转换；保留像素尺寸，JPEG 透明背景转白。多帧图片会明确拒绝。",
  })),
] as const;
export type FileConversionFormat = typeof FILE_CONVERSION_FORMATS[number];
export function fileConversionFormat(id: string): FileConversionFormat {
  const format = FILE_CONVERSION_FORMATS.find(item => item.id === id);
  if (!format) throw new Error("不支持的转换格式");
  return format;
}
export function conversionExtension(name: string) {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
}
export function validateConversionFile(formatId: string, name: string, bytes: number) {
  const format = fileConversionFormat(formatId);
  if (!(format.from as readonly string[]).includes(conversionExtension(name))) throw new Error("文件格式与所选转换不符");
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > Number.MAX_SAFE_INTEGER) throw new Error("请选择有效的非空文件");
  return format;
}
export const FILE_CONVERSION_FREE_LIMIT = 3;
export const FILE_CONVERSION_FREE_LIMIT_MESSAGE = "今日免费转换已达上限，如需继续使用，请充值。";
/** 待用户明确批准后在此单一真源改价；当前关闭付费，不能猜测收费。 */
export const FILE_CONVERSION_PRICING: { version: string; standardCredits: number | null; scanCreditsPerMb: number | null } = {
  version: "pending-2026-10-09", standardCredits: null, scanCreditsPerMb: null,
};
export type FileConversionLane = "free" | "paid";
export function conversionBilling(bytes: number, needsOcr: boolean, lane: FileConversionLane = "free", pricing = FILE_CONVERSION_PRICING) {
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error("文件大小无效");
  const billableMb = Math.max(1, Math.ceil(bytes / 1_000_000));
  const rate = needsOcr ? pricing.scanCreditsPerMb : pricing.standardCredits;
  const configured = rate !== null && Number.isSafeInteger(rate) && rate > 0;
  const credits = lane === "free" && !needsOcr ? 0 : configured ? (needsOcr ? billableMb * rate! : rate!) : null;
  return { originalBytes: bytes, billableMb, needsOcr, credits, rateCreditsPerMb: pricing.scanCreditsPerMb,
    cnyPerCredit: 0.65, pricingVersion: pricing.version, available: lane === "free" ? !needsOcr : configured };
}
export type FileConversionSource = { objectName: string; generation: string; sha256: string; bytes: number; fileName: string };
export type FileConversionRequest = { kind: "file_conversion"; phase: "inspect" | "convert"; formatId: string; source: FileConversionSource; lane: FileConversionLane; day: string; ipHash?: string; quote?: { credits: number; pricingVersion: string } };
export type FileConversionInspection = { type: "inspection"; source: FileConversionSource; formatId: string; pages: number; billing: ReturnType<typeof conversionBilling>; notice: string };
export type FileConversionResult = { type: "converted"; objectName: string; fileName: string; mimeType: string; bytes: number; sha256: string; sourceSha256: string; credits: number; notice?: string };
export type FileConversionOutcome = FileConversionInspection | FileConversionResult | { type: "rejected"; message: string };
export function conversionSourcePrefix(userId: string | number) { return `file-conversion/u${userId}/sources/`; }
export function assertConversionSource(source: FileConversionSource, userId: string, formatId: string, allowUnhashed = false) {
  if (!/^[1-9]\d*$/.test(userId) || !source.objectName.startsWith(conversionSourcePrefix(userId)) ||
    !/^[a-zA-Z0-9/_-]+$/.test(source.objectName) || !/^\d+$/.test(source.generation) || !(allowUnhashed && source.sha256 === "") && !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("文件归属或版本无效");
  validateConversionFile(formatId, source.fileName, source.bytes);
}
