/**
 * 知识卡整套导出 PDF（0909 用户令：生成后可选单张下载或整套 PDF）。
 * - 只接受本桶 `generated/platform_knowledge_card/u{userId}/` 下、属于**当前用户**的成品图（签名 https 或 gs://）
 * - 全部页归一 3840×2160：比例不同的页等比缩放后按图边缘平均色补边，不裁不拉伸
 * - pdfkit 拼页 → 落 GCS → 返回签名 https（媒体一律走 GCS URL，不回 base64）
 *
 * 0911 事故：23 页 4K 导出把进程打到 7.7 GB 被 OOM 杀掉，整站重启。两处根因：
 * 1) libvips 默认开缓存 + 多线程，每张 4K 图都留驻内存；
 * 2) 整份 PDF 先堆 chunks、再 Buffer.concat、上传时又转 Uint8Array，同一份数据在内存里存在三次。
 * 现在：sharp 关缓存单线程；PDF 边生成边写临时文件，再以文件流上传，内存只过一页。
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import PDFDocument from "pdfkit";
import sharp from "sharp";

// 4K 页逐张过 sharp：关掉 libvips 缓存、限单线程，避免缓存与线程私有缓冲把内存顶爆
sharp.cache(false);
sharp.concurrency(1);

export const KNOWLEDGE_CARD_PDF_PAGE = { width: 3840, height: 2160 } as const;
const KNOWLEDGE_CARD_IMAGE_PREFIX = "generated/platform_knowledge_card/";

/** 该用户成品目录前缀（出图落盘同款，见 proxyImageService.generatePlatformCompositeSheetImage） */
export function knowledgeCardOwnerPrefix(userId: number): string {
  return `${KNOWLEDGE_CARD_IMAGE_PREFIX}u${userId}/`;
}

export const KNOWLEDGE_CARD_LEGACY_OBJECT_MESSAGE =
  "历史成品请逐张下载或重新生成后再导出 PDF";

/** 每用户每分钟最多 2 次导出 */
export const KNOWLEDGE_CARD_EXPORT_RATE = { limit: 2, windowMs: 60_000 } as const;
export const KNOWLEDGE_CARD_EXPORT_RATE_MESSAGE = "导出太频繁，请一分钟后再试";

/**
 * 纯函数节流：把 `history`（该用户过去的导出时刻）按窗口裁剪后判断本次是否放行。
 * 放行时返回裁剪并追加了 `now` 的新历史，调用方写回 Map。
 */
export function checkKnowledgeCardExportRate(
  history: number[] | undefined,
  now: number,
): { allowed: boolean; history: number[] } {
  const { limit, windowMs } = KNOWLEDGE_CARD_EXPORT_RATE;
  const recent = (history || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) return { allowed: false, history: recent };
  return { allowed: true, history: [...recent, now] };
}

/** 解析成品图地址 → 本桶对象名；不是**本人**的本桶知识卡成品一律拒绝 */
export function resolveKnowledgeCardImageObjectName(url: string, bucket: string, userId: number): string | null {
  const raw = String(url || "").trim();
  if (!raw) return null;
  let objectName = "";
  if (raw.startsWith(`gs://${bucket}/`)) objectName = raw.slice(`gs://${bucket}/`.length);
  else {
    try {
      const u = new URL(raw);
      if (u.hostname !== "storage.googleapis.com") return null;
      const path = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
      if (!path.startsWith(`${bucket}/`)) return null;
      objectName = path.slice(bucket.length + 1);
    } catch {
      return null;
    }
  }
  // 归属校验：只放行本人 `u{userId}/` 目录；旧的无 userId 前缀（历史成品）不放行
  if (!objectName.startsWith(knowledgeCardOwnerPrefix(userId)) || objectName.includes("..")) return null;
  return objectName;
}

/** 归一到统一页面尺寸；比例不同时用上下边缘平均色补边 */
export async function normalizeKnowledgeCardPage(input: Buffer): Promise<Buffer> {
  const { width, height } = KNOWLEDGE_CARD_PDF_PAGE;
  const meta = await sharp(input).metadata();
  const w = meta.width || width;
  const h = meta.height || height;
  if (w === width && h === height) return sharp(input).jpeg({ quality: 92 }).toBuffer();
  const strip = Math.max(1, Math.min(12, Math.floor(h / 40)));
  const [top, bottom] = await Promise.all([
    sharp(input).extract({ left: 0, top: 0, width: w, height: strip }).stats(),
    sharp(input).extract({ left: 0, top: h - strip, width: w, height: strip }).stats(),
  ]);
  const avg = (i: number) => Math.round((top.channels[i]!.mean + bottom.channels[i]!.mean) / 2);
  const background = { r: avg(0), g: avg(1), b: avg(2) };
  return sharp(input)
    .resize({ width, height, fit: "contain", background })
    .flatten({ background })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * 逐页取图→归一→写入 PDF **文件**，同一时刻内存里只有一页图。
 * 返回临时文件路径与字节数；调用方负责用完删除。
 * 不再返回 Buffer：23 页 4K 的成品有几十上百 MB，堆在内存里等于给 OOM 递刀。
 */
export async function buildKnowledgeCardPdfFile(
  loadPage: Array<() => Promise<Buffer>>,
): Promise<{ filePath: string; dir: string; bytes: number }> {
  if (!loadPage.length) throw new Error("没有可导出的页面");
  const { width, height } = KNOWLEDGE_CARD_PDF_PAGE;
  const dir = await mkdtemp(nodePath.join(tmpdir(), "kc-pdf-"));
  const filePath = nodePath.join(dir, "knowledge-card.pdf");
  const out = createWriteStream(filePath);
  const doc = new PDFDocument({ autoFirstPage: false, size: [width, height], margin: 0 });
  const written = pipeline(doc as unknown as NodeJS.ReadableStream, out);
  try {
    for (const load of loadPage) {
      const jpeg = await normalizeKnowledgeCardPage(await load());
      doc.addPage({ size: [width, height], margin: 0 });
      doc.image(jpeg, 0, 0, { width, height });
    }
    doc.end();
    await written;
  } catch (err) {
    (doc as unknown as { destroy?: () => void }).destroy?.();
    out.destroy();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
  const { size } = await stat(filePath);
  return { filePath, dir, bytes: size };
}

/** 下载本桶成品图（服务端内部取回，不经客户端） */
export async function exportKnowledgeCardPdfToGcs(params: {
  userId: number;
  imageUrls: string[];
  title?: string;
}): Promise<{ gcsUri: string; url: string; pageCount: number }> {
  const { getGcsBucketName, signGsUriV4ReadUrl, uploadStreamToGcs } = await import("./gcs.js");
  const bucket = getGcsBucketName();
  const objectNames = params.imageUrls.map((u) => resolveKnowledgeCardImageObjectName(u, bucket, params.userId));
  if (objectNames.some((n) => !n)) {
    throw new Error(`只能导出本人在本平台生成的知识卡成品图；${KNOWLEDGE_CARD_LEGACY_OBJECT_MESSAGE}`);
  }
  const loaders = (objectNames as string[]).map((objectName) => async () => {
    const res = await fetch(signGsUriV4ReadUrl(`gs://${bucket}/${objectName}`, 600), { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`读取成品图失败（${res.status}）`);
    return Buffer.from(await res.arrayBuffer());
  });
  const { filePath, dir, bytes } = await buildKnowledgeCardPdfFile(loaders);
  try {
    const safeTitle = String(params.title || "知识卡").replace(/[^\w一-鿿-]+/g, "_").slice(0, 60);
    const objectName = `${KNOWLEDGE_CARD_IMAGE_PREFIX}pdf/u${params.userId}/${Date.now()}-${safeTitle}.pdf`;
    const uploaded = await uploadStreamToGcs({
      objectName,
      stream: Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>,
      contentLength: bytes,
      contentType: "application/pdf",
    });
    return { gcsUri: uploaded.gcsUri, url: signGsUriV4ReadUrl(uploaded.gcsUri, 7 * 24 * 3600), pageCount: loaders.length };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
