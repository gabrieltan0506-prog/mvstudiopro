/**
 * 成品容量估算与画质档（站长 2026-11-21）：
 * - 成品图一律保留原像素，只按用户选的画质档编成 JPEG：优良 0.95 / 0.85，压缩 0.75 / 0.65；默认 0.95。
 * - 「你先让函数在排版前估算一下容量」：本文件的纯函数供导出与前台共用，选项一变立刻算出大概体积。
 * - 「超出上限就超出了，不要搞报错」：280MB 只是提示线，超过照常导出，只给提示，不拦截、不自动降档。
 *
 * 每百万像素字节数为站长这本书 3 张 3840×2160 原图实测均值（MB/张）：
 * q0.95 = 3.97/4.27/3.99，q0.85 = 2.44/2.61/2.43，q0.75 = 1.88/2.02/1.87，q0.65 = 1.59/1.70/1.57。
 * 已知原图（PNG）字节时另按「JPEG/PNG 字节比」估一遍，两者取大；原图本就是 JPEG 时成品直接用原字节。
 */
export const KNOWLEDGE_EXPORT_PDF_NOTICE_BYTES = 280 * 1024 * 1024;
/** 稿件上保存的画质选项（publication.exportOptions.imageQuality）。 */
export const KNOWLEDGE_EXPORT_IMAGE_QUALITY_OPTIONS = [0.95, 0.85, 0.75, 0.65] as const;
export type KnowledgeExportImageQualityOption = (typeof KNOWLEDGE_EXPORT_IMAGE_QUALITY_OPTIONS)[number];
export const KNOWLEDGE_EXPORT_IMAGE_QUALITY_LABELS: Record<KnowledgeExportImageQualityOption, string> = {
  0.95: "优良 0.95", 0.85: "优良 0.85", 0.75: "压缩 0.75", 0.65: "压缩 0.65",
};
/** 编码用的整数质量档。 */
export const KNOWLEDGE_EXPORT_JPEG_QUALITIES = [95, 85, 75, 65] as const;
export type KnowledgeExportJpegQuality = (typeof KNOWLEDGE_EXPORT_JPEG_QUALITIES)[number];
export const KNOWLEDGE_EXPORT_DEFAULT_JPEG_QUALITY: KnowledgeExportJpegQuality = 95;
/** 稿件选项 → 编码质量；缺省或不认识的值按默认 0.95。 */
export function knowledgeExportJpegQuality(option?: number | null): KnowledgeExportJpegQuality {
  const quality = Math.round(Number(option) * 100);
  return (KNOWLEDGE_EXPORT_JPEG_QUALITIES as readonly number[]).includes(quality) ? quality as KnowledgeExportJpegQuality : KNOWLEDGE_EXPORT_DEFAULT_JPEG_QUALITY;
}
/** 文字页与字体等预留：固定部分 + 每段（每章一段，各段 PDF 各自嵌字体子集与装饰，合并不去重）。 */
export const KNOWLEDGE_EXPORT_RESERVE_BASE_BYTES = 8 * 1024 * 1024;
/** 每段约 0.75MiB：1121 缩图版 67.4MB/48 段，扣掉 48 张 2048 q85 缩图（约 33MB）后非图部分约 0.7MB/段（估算）。 */
export const KNOWLEDGE_EXPORT_RESERVE_PER_SEGMENT_BYTES = 768 * 1024;
const MB = 1024 * 1024;
/** 每百万像素的 JPEG 字节（MiB/MP）。 */
export const KNOWLEDGE_EXPORT_JPEG_MIB_PER_MEGAPIXEL: Record<KnowledgeExportJpegQuality, number> = { 95: 0.4916, 85: 0.3006, 75: 0.2319, 65: 0.1954 };
/** 相对 PNG 原图字节的比例（同一实测）。 */
export const KNOWLEDGE_EXPORT_JPEG_PNG_RATIO: Record<KnowledgeExportJpegQuality, number> = { 95: 0.28, 85: 0.171, 75: 0.132, 65: 0.111 };
const DEFAULT_PIXELS = 3840 * 2160;

export type KnowledgeExportImageInput = { pixels?: number; sourceBytes?: number; sourceIsJpeg?: boolean };
export type KnowledgeExportSizeEstimate = { quality: KnowledgeExportJpegQuality; imageBytes: number; reserveBytes: number; totalBytes: number; overNotice: boolean };

export function knowledgeExportReserveBytes(segments: number) {
  return KNOWLEDGE_EXPORT_RESERVE_BASE_BYTES + Math.max(0, Math.floor(segments || 0)) * KNOWLEDGE_EXPORT_RESERVE_PER_SEGMENT_BYTES;
}
/** 单张图在某质量档的估算字节。 */
export function estimateKnowledgeExportImageBytes(image: KnowledgeExportImageInput, quality: KnowledgeExportJpegQuality) {
  if (image.sourceIsJpeg && image.sourceBytes) return image.sourceBytes;
  const byPixels = (image.pixels && image.pixels > 0 ? image.pixels : image.sourceBytes ? 0 : DEFAULT_PIXELS) / 1e6 * KNOWLEDGE_EXPORT_JPEG_MIB_PER_MEGAPIXEL[quality] * MB;
  const byBytes = image.sourceBytes ? image.sourceBytes * KNOWLEDGE_EXPORT_JPEG_PNG_RATIO[quality] : 0;
  return Math.ceil(Math.max(byPixels, byBytes));
}
/** 估算成品体积：图按所选画质，文字与字体按段预留（站长：「档案大小主要是看图片的尺寸，文字的部分其实不大」）。只估算，不拦截。 */
export function estimateKnowledgeExportSize(images: readonly KnowledgeExportImageInput[], options: { segments?: number; quality?: KnowledgeExportJpegQuality } = {}): KnowledgeExportSizeEstimate {
  const quality = options.quality ?? KNOWLEDGE_EXPORT_DEFAULT_JPEG_QUALITY;
  const reserveBytes = knowledgeExportReserveBytes(options.segments ?? images.length);
  const imageBytes = images.reduce((sum, image) => sum + estimateKnowledgeExportImageBytes(image, quality), 0);
  const totalBytes = imageBytes + reserveBytes;
  return { quality, imageBytes, reserveBytes, totalBytes, overNotice: totalBytes > KNOWLEDGE_EXPORT_PDF_NOTICE_BYTES };
}
