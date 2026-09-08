/**
 * 知识卡整套导出 PDF（0909 用户令：生成后可选单张下载或整套 PDF）。
 * - 只接受本桶 `generated/platform_knowledge_card/u{userId}/` 下、属于**当前用户**的成品图（签名 https 或 gs://）
 * - 全部页归一 3840×2160：比例不同的页等比缩放后按图边缘平均色补边，不裁不拉伸
 * - pdfkit 拼页 → 落 GCS → 返回签名 https（媒体一律走 GCS URL，不回 base64）
 */
import PDFDocument from "pdfkit";
import sharp from "sharp";

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

/** 逐页取图→归一→写入 PDF，同一时刻内存里只有一页原图（19 页 4K 在 2 核机上不整批驻留） */
export async function buildKnowledgeCardPdf(loadPage: Array<() => Promise<Buffer>>): Promise<Buffer> {
  if (!loadPage.length) throw new Error("没有可导出的页面");
  const { width, height } = KNOWLEDGE_CARD_PDF_PAGE;
  const doc = new PDFDocument({ autoFirstPage: false, size: [width, height], margin: 0 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  for (const load of loadPage) {
    const jpeg = await normalizeKnowledgeCardPage(await load());
    doc.addPage({ size: [width, height], margin: 0 });
    doc.image(jpeg, 0, 0, { width, height });
  }
  doc.end();
  return done;
}

/** 下载本桶成品图（服务端内部取回，不经客户端） */
export async function exportKnowledgeCardPdfToGcs(params: {
  userId: number;
  imageUrls: string[];
  title?: string;
}): Promise<{ gcsUri: string; url: string; pageCount: number }> {
  const { getGcsBucketName, signGsUriV4ReadUrl, uploadBufferToGcs } = await import("./gcs.js");
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
  const pdf = await buildKnowledgeCardPdf(loaders);
  const safeTitle = String(params.title || "知识卡").replace(/[^\w一-鿿-]+/g, "_").slice(0, 60);
  const objectName = `${KNOWLEDGE_CARD_IMAGE_PREFIX}pdf/u${params.userId}/${Date.now()}-${safeTitle}.pdf`;
  const uploaded = await uploadBufferToGcs({ objectName, buffer: pdf, contentType: "application/pdf" });
  return { gcsUri: uploaded.gcsUri, url: signGsUriV4ReadUrl(uploaded.gcsUri, 7 * 24 * 3600), pageCount: loaders.length };
}
