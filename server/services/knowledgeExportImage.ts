import sharp from "sharp";
// sharp/libvips 内存约束（关缓存、限线程）；4K 原图编码时防止常驻。
import "../_core/sharpLimits.js";
import { downloadGcsObjectVersioned, inspectGcsObjectBounded, statGcsObjectVersion, uploadBufferToGcsIfAbsent } from "./gcs";

/**
 * 成品配图派生件（站长 2026-11-21：成品图用「原像素 + 高品质 JPEG」，PDF 最多 280MB）。
 * - 像素尺寸与原图相同：不缩放，只按 EXIF 摆正；mozjpeg、4:4:4 色度不抽样，质量档由容量估算选定（默认 95）。
 * - 存回同桶 `<原目录>/export-full/<原文件名>.q<质量>.jpg`，只建不改（IfAbsent）、永久保留；同一原图同一质量只编码一次（进程内缓存）。
 * - 原图本身已是 JPEG：直接用原图字节（不重编码），返回原图地址。
 * - 任何失败都抛出明确错误：成品不得退回降采样缩图（与审校缩图「失败回退原图」相反）。
 */
export const KNOWLEDGE_EXPORT_IMAGE_DIR = "export-full";
const SOURCE_MAX_BYTES = 64 * 1024 * 1024;
const SOURCE_TIMEOUT_MS = 120_000;

export type KnowledgeExportImage = { uri: string; bytes: number; width: number; height: number; quality: number | "original-jpeg" };

export function knowledgeExportImageUri(uri: string, quality: number) {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) throw new Error("成品高清配图只支持 gs:// 原图");
  const [, bucket, objectName] = match;
  const slash = objectName!.lastIndexOf("/");
  const dir = slash >= 0 ? objectName!.slice(0, slash) : "";
  const base = slash >= 0 ? objectName!.slice(slash + 1) : objectName!;
  const name = `${dir ? `${dir}/` : ""}${KNOWLEDGE_EXPORT_IMAGE_DIR}/${base}.q${quality}.jpg`;
  return { bucket: bucket!, objectName: name, uri: `gs://${bucket}/${name}` };
}

/** 原像素 JPEG 编码（只按 EXIF 摆正，不缩放）。 */
export async function encodeKnowledgeExportImage(buffer: Buffer, quality: number) {
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new Error("成品配图质量参数无效");
  return sharp(buffer, { limitInputPixels: 80_000_000 }).rotate().jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
}

type Store = {
  /** 派生件是否已存在（存在返回字节数）。 */
  stat(uri: string): Promise<{ byteLength?: number } | null>;
  read(uri: string): Promise<Buffer>;
  /** 只在不存在时创建。 */
  create(bucket: string, objectName: string, buffer: Buffer, metadata: Record<string, string>): Promise<void>;
};
const realStore: Store = {
  async stat(uri) {
    try { return await statGcsObjectVersion({ gcsUri: uri }); }
    catch (e) { if (e instanceof Error && /:404$/.test(e.message)) return null; throw e; }
  },
  async read(uri) {
    if (/\/export-full\//.test(uri)) return (await downloadGcsObjectVersioned({ gcsUri: uri })).buffer;
    const chunks: Buffer[] = [];
    await inspectGcsObjectBounded({ gcsUri: uri, maxBytes: SOURCE_MAX_BYTES, timeoutMs: SOURCE_TIMEOUT_MS, onChunk: chunk => chunks.push(Buffer.from(chunk)) });
    return Buffer.concat(chunks);
  },
  async create(bucket, objectName, buffer, metadata) {
    await uploadBufferToGcsIfAbsent({ bucket, objectName, buffer, contentType: "image/jpeg", metadata });
  },
};

const cache = new Map<string, Promise<KnowledgeExportImage>>();
/** 测试用：清进程内缓存。 */
export function resetKnowledgeExportImageCache() { cache.clear(); }

export function ensureKnowledgeExportImage(uri: string, quality: number, store: Store = realStore): Promise<KnowledgeExportImage> {
  const key = `${uri}|${quality}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const task = (async (): Promise<KnowledgeExportImage> => {
    const target = knowledgeExportImageUri(uri, quality);
    try {
      const existing = await store.stat(target.uri);
      if (existing) {
        const buffer = await store.read(target.uri);
        const meta = await sharp(buffer).metadata();
        return { uri: target.uri, bytes: buffer.length, width: meta.width!, height: meta.height!, quality };
      }
      const source = await store.read(uri);
      const meta = await sharp(source).metadata();
      if (!meta.width || !meta.height) throw new Error("读不出原图尺寸");
      if (meta.format === "jpeg") {
        const rotated = !!(meta.orientation && meta.orientation >= 5);
        return { uri, bytes: source.length, width: rotated ? meta.height : meta.width, height: rotated ? meta.width : meta.height, quality: "original-jpeg" };
      }
      const jpeg = await encodeKnowledgeExportImage(source, quality);
      const out = await sharp(jpeg).metadata();
      await store.create(target.bucket, target.objectName, jpeg, { source: uri, purpose: "knowledge-export-full", quality: String(quality), width: String(out.width), height: String(out.height) });
      return { uri: target.uri, bytes: jpeg.length, width: out.width!, height: out.height!, quality };
    } catch (error) {
      throw new Error(`成品高清配图生成失败（质量 ${quality}）：${String((error as Error)?.message ?? error).replace(/(?:https?|gs):\/\/\S+/g, "[地址]").slice(0, 200)}；未用降采样图代替，请稍后重试导出`);
    }
  })();
  cache.set(key, task);
  task.catch(() => { if (cache.get(key) === task) cache.delete(key); });
  if (cache.size > 512) cache.delete(cache.keys().next().value as string);
  return task;
}
