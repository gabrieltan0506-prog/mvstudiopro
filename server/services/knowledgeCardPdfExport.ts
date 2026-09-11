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
import { pipeline, finished } from "node:stream/promises";
import { Readable, type Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import PDFDocument from "pdfkit";
import sharp from "sharp";

// sharp/libvips 的内存约束统一在 sharpLimits（这里 import 保证独立加载本模块时也生效，
 // 且不覆盖 SHARP_CONCURRENCY 旋钮）
import "../_core/sharpLimits.js";

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

type PdfPipeResult = { ok: true } | { ok: false; error: unknown };

/**
 * pipeline 创建时就把成败转成已处理结果——不能等到 doc.end() 才 attach catch，
 * 中途任何一步失败都会变成 unhandledRejection 崩进程（终审 P1）。
 */
export function observeKnowledgeCardPdfPipeline(doc: NodeJS.ReadableStream, out: Writable): {
  done: Promise<PdfPipeResult>;
  check: () => void;
} {
  let result: PdfPipeResult | undefined;
  const done: Promise<PdfPipeResult> = pipeline(doc, out).then(
    () => (result = { ok: true }),
    (error) => (result = { ok: false, error }),
  );
  return {
    done,
    check() {
      if (result && !result.ok) throw result.error;
    },
  };
}

/**
 * 等本页真正落盘再生产下一页（终审 P2：PDFKit 忽略 push() 返回值，文件 sink 停滞时
 * readable 队列会无界积压——实测第 8 页前已积压 13 MB）。
 * 10ms 轮询公开队列长度，避开 drain 事件竞态；传播 pipeline 失败；有界超时。
 */
export async function waitKnowledgeCardPdfPageDrained(
  doc: NodeJS.ReadableStream & { readableLength: number; destroyed: boolean },
  out: Writable,
  pipe: { done: Promise<PdfPipeResult>; check: () => void },
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const deadline = performance.now() + (options.timeoutMs ?? 30_000);
  for (;;) {
    options.signal?.throwIfAborted();
    pipe.check();
    if (doc.destroyed || out.destroyed) throw new Error("PDF 写入流提前关闭");
    if (doc.readableLength === 0 && out.writableLength === 0) return;
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error("PDF 文件写入无进展，停止导出");
    const raced = await Promise.race([
      pipe.done,
      delay(Math.min(10, Math.max(1, remaining)), undefined, { signal: options.signal }).then(() => undefined),
    ]);
    if (raced && !raced.ok) throw raced.error;
    if (raced?.ok) throw new Error("PDF 写入流提前结束");
  }
}

/**
 * 逐页取图→归一→写入 PDF **文件**；每页写完等两端队列排空才取下一页，
 * 内存里同一时刻只有一页图 + 有界的流缓冲。返回临时文件路径与字节数；调用方负责用完删除。
 */
export async function buildKnowledgeCardPdfFile(
  loadPage: Array<() => Promise<Buffer>>,
  options: { timeoutMs?: number; signal?: AbortSignal; makeOut?: (filePath: string) => Writable } = {},
): Promise<{ filePath: string; dir: string; bytes: number }> {
  if (!loadPage.length) throw new Error("没有可导出的页面");
  const { width, height } = KNOWLEDGE_CARD_PDF_PAGE;
  const dir = await mkdtemp(nodePath.join(tmpdir(), "kc-pdf-"));
  const filePath = nodePath.join(dir, "knowledge-card.pdf");
  let doc: PDFKit.PDFDocument | undefined;
  let out: Writable | undefined;
  let pipe: ReturnType<typeof observeKnowledgeCardPdfPipeline> | undefined;
  try {
    out = options.makeOut?.(filePath) ?? createWriteStream(filePath);
    doc = new PDFDocument({ autoFirstPage: false, size: [width, height], margin: 0 });
    pipe = observeKnowledgeCardPdfPipeline(doc as unknown as NodeJS.ReadableStream, out);
    const readable = doc as unknown as NodeJS.ReadableStream & { readableLength: number; destroyed: boolean };
    // 先排空 PDF 头，随后每页尾排空本页
    await waitKnowledgeCardPdfPageDrained(readable, out, pipe, options);
    for (const load of loadPage) {
      options.signal?.throwIfAborted();
      pipe.check();
      const jpeg = await normalizeKnowledgeCardPage(await load());
      options.signal?.throwIfAborted();
      pipe.check();
      doc.addPage({ size: [width, height], margin: 0 });
      doc.image(jpeg, 0, 0, { width, height });
      await waitKnowledgeCardPdfPageDrained(readable, out, pipe, options);
    }
    doc.end();
    // 收尾同样有界：不能无限等一个停滞的文件系统
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      options.signal?.throwIfAborted();
      const result = await Promise.race([
        pipe.done,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("PDF 收尾写入超时")), options.timeoutMs ?? 30_000);
          onAbort = () => reject(options.signal?.reason ?? new Error("PDF 导出已取消"));
          options.signal?.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
      if (!result.ok) throw result.error;
    } finally {
      clearTimeout(timer);
      if (onAbort) options.signal?.removeEventListener("abort", onAbort);
    }
    const { size } = await stat(filePath);
    return { filePath, dir, bytes: size };
  } catch (error) {
    (doc as unknown as { destroy?: () => void } | undefined)?.destroy?.();
    out?.destroy();
    // pipeline 等 fs WriteStream close 后才能删目录；拒绝已在 observe 里转成结果，不会再抛
    if (pipe) await pipe.done;
    else if (out) await finished(out).catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
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
  // 终审 P2：调用方持有 Node 流的所有权——上传前置失败时 fd 不能靠 GC，
  // finally 里 destroy 并等它真正关闭，之后才删临时目录
  const source = createReadStream(filePath);
  const closed = finished(source, { cleanup: true }).catch(() => {});
  try {
    const safeTitle = String(params.title || "知识卡").replace(/[^\w一-鿿-]+/g, "_").slice(0, 60);
    const objectName = `${KNOWLEDGE_CARD_IMAGE_PREFIX}pdf/u${params.userId}/${Date.now()}-${safeTitle}.pdf`;
    const uploaded = await uploadStreamToGcs({
      objectName,
      stream: Readable.toWeb(source) as ReadableStream<Uint8Array>,
      contentLength: bytes,
      contentType: "application/pdf",
      signal: AbortSignal.timeout(10 * 60_000),
    });
    return { gcsUri: uploaded.gcsUri, url: signGsUriV4ReadUrl(uploaded.gcsUri, 7 * 24 * 3600), pageCount: loaders.length };
  } finally {
    source.destroy();
    await closed;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
