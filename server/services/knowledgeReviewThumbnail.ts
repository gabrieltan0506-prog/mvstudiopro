import sharp from "sharp";
import { inspectGcsObjectBounded, statGcsObjectVersion, uploadBufferToGcsIfAbsent } from "./gcs";

/**
 * 审校配图缩图派生件（2026-11-09 用户决定，不用 base64 内联）：
 * EvoLink 文档要求公网 image_url 须 60 秒内下载完成，境外/鉴权图床会 400「Failed to download image」；
 * 敦煌 48 张 4K PNG（13–18MB）经 GCS 签名 URL 送 EvoLink DeepSeek 出现 54 次 400、同一 URL 先 400 后 200，属拉图超时抖动。
 * 这里在审校前为每张原图生成长边 ≤2048、JPEG q85 的缩图（约 0.3–0.8MB），存回同桶 `<原目录>/review-thumbs/<原文件名>.jpg`，
 * 永久保留不删；路由对缩图签 V4 URL（TTL 不变）给模型，原图 URL 只作回退。同一原图只生成一次（IfAbsent + 进程内缓存）。
 */
export const KNOWLEDGE_REVIEW_THUMB_MAX_EDGE = 2048;
export const KNOWLEDGE_REVIEW_THUMB_JPEG_QUALITY = 85;
export const KNOWLEDGE_REVIEW_THUMB_DIR = "review-thumbs";
const SOURCE_MAX_BYTES = 32 * 1024 * 1024;
const cache = new Map<string, string>();

/** 原图 gs://bucket/dir/file.png → gs://bucket/dir/review-thumbs/file.png.jpg */
export function knowledgeReviewThumbnailUri(uri: string) {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) throw new Error("审校缩图只支持 gs:// 原图");
  const [, bucket, objectName] = match;
  const slash = objectName.lastIndexOf("/");
  const dir = slash >= 0 ? objectName.slice(0, slash) : "";
  const base = slash >= 0 ? objectName.slice(slash + 1) : objectName;
  return { bucket, objectName: `${dir ? `${dir}/` : ""}${KNOWLEDGE_REVIEW_THUMB_DIR}/${base}.jpg`, uri: `gs://${bucket}/${dir ? `${dir}/` : ""}${KNOWLEDGE_REVIEW_THUMB_DIR}/${base}.jpg` };
}

export async function encodeKnowledgeReviewThumbnail(buffer: Buffer) {
  return sharp(buffer, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: KNOWLEDGE_REVIEW_THUMB_MAX_EDGE, height: KNOWLEDGE_REVIEW_THUMB_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: KNOWLEDGE_REVIEW_THUMB_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/** 取得（必要时生成）缩图的 gs:// URI；任何失败返回 null，由调用方回退原图签名 URL，不抛错、不重试。 */
export async function ensureKnowledgeReviewThumbnail(uri: string): Promise<string | null> {
  const hit = cache.get(uri);
  if (hit) return hit;
  try {
    const thumb = knowledgeReviewThumbnailUri(uri);
    let exists = false;
    try { exists = Boolean((await statGcsObjectVersion({ gcsUri: thumb.uri })).generation); } catch { exists = false; }
    if (!exists) {
      const chunks: Buffer[] = [];
      await inspectGcsObjectBounded({ gcsUri: uri, maxBytes: SOURCE_MAX_BYTES, timeoutMs: 60_000, onChunk: chunk => chunks.push(Buffer.from(chunk)) });
      const jpeg = await encodeKnowledgeReviewThumbnail(Buffer.concat(chunks));
      await uploadBufferToGcsIfAbsent({ bucket: thumb.bucket, objectName: thumb.objectName, buffer: jpeg, contentType: "image/jpeg", metadata: { source: uri, purpose: "knowledge-review-thumb" } });
    }
    if (cache.size >= 256) cache.delete(cache.keys().next().value as string);
    cache.set(uri, thumb.uri);
    return thumb.uri;
  } catch {
    return null;
  }
}
