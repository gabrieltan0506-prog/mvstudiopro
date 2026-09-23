/**
 * 知识卡·EPUB 转好的 PDF 下载（0923 用户令）：
 * - 只有转档成功才存档、才出按钮；
 * - 存在 `generated/platform_knowledge_card/pdf/u{userId}/epub-*`（Fly 临时转存按 pdf/u{userId}/ 认本人）；
 * - 下载（Fly 临时副本建好）后立刻删 GCS 存档，按钮消失。
 * `epub-` 前缀把它和整套导出的 PDF 分开：删除接口只认这个前缀，绝不误删导出件。
 */
import { Readable } from "node:stream";

export type KnowledgeCardConvertedPdf = { fileName: string; url: string };

const PDF_PREFIX = "generated/platform_knowledge_card/pdf/";
/** 流式分块大小：subarray 只是视图，不复制整份 PDF（0911 内存事故同类风险） */
const STREAM_CHUNK_BYTES = 4 * 1024 * 1024;

export function epubPdfObjectPrefix(userId: number): string {
  return `${PDF_PREFIX}u${userId}/epub-`;
}

/** 把整份 Buffer 按块吐成 Web 流，不做整份拷贝 */
export function bufferToChunkedWebStream(buffer: Buffer): ReadableStream<Uint8Array> {
  function* chunks() {
    for (let i = 0; i < buffer.length; i += STREAM_CHUNK_BYTES) yield buffer.subarray(i, i + STREAM_CHUNK_BYTES);
  }
  return Readable.toWeb(Readable.from(chunks())) as ReadableStream<Uint8Array>;
}

/**
 * EPUB 转好的 PDF 存档（流式上传）。存档失败不拖垮提炼（PDF 只是附带下载），返回 null；
 * 用户终止则照常上抛。
 */
export async function archiveConvertedEpubPdf(params: {
  pdf: Buffer;
  fileName: string;
  userId: number;
  abortSignal?: AbortSignal;
}): Promise<KnowledgeCardConvertedPdf | null> {
  try {
    const { uploadStreamToGcs, signGsUriV4ReadUrl } = await import("./gcs.js");
    const base = params.fileName.replace(/\.epub$/i, "");
    const safe = base.replace(/[^\w一-鿿-]+/g, "_").slice(0, 60) || "epub";
    const uploaded = await uploadStreamToGcs({
      objectName: `${epubPdfObjectPrefix(params.userId)}${Date.now()}-${safe}.pdf`,
      stream: bufferToChunkedWebStream(params.pdf),
      contentLength: params.pdf.length,
      contentType: "application/pdf",
      signal: params.abortSignal,
    });
    return { fileName: `${base}.pdf`, url: signGsUriV4ReadUrl(uploaded.gcsUri, 7 * 24 * 3600) };
  } catch (e) {
    params.abortSignal?.throwIfAborted();
    console.warn(`[knowledgeCardEpubPdf] 转换后的 PDF 存档失败 ${params.fileName}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * 从签名 https 或 gs:// 解出对象名；只认**本人**的 `epub-` 存档，其它一律 null（不删）。
 */
export function resolveEpubPdfObjectName(url: string, bucket: string, userId: number): string | null {
  const raw = String(url || "").trim();
  let objectName = "";
  if (raw.startsWith(`gs://${bucket}/`)) {
    objectName = raw.slice(`gs://${bucket}/`.length);
  } else {
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
  const prefix = epubPdfObjectPrefix(userId);
  if (!objectName.startsWith(prefix)) return null;
  const rest = objectName.slice(prefix.length);
  if (!rest || rest.includes("/") || rest.includes("..") || !rest.endsWith(".pdf")) return null;
  return objectName;
}

/** 下载后删存档：只删本人 epub- 存档；对象已不在（重复点、已删）deleteGcsObject 按 404 静默成功 */
export async function deleteEpubPdfArchive(params: { url: string; userId: number }): Promise<void> {
  const { getGcsBucketName, deleteGcsObject } = await import("./gcs.js");
  const bucket = getGcsBucketName();
  const objectName = resolveEpubPdfObjectName(params.url, bucket, params.userId);
  if (!objectName) throw new Error("只能删除本人的 EPUB 转换 PDF");
  await deleteGcsObject({ objectName });
}
