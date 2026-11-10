/**
 * 异步 PDF 的 HTML 快照归属约定（与 getPdfHtmlSnapshotUploadUrl 一处真源）：
 * 快照只落 PDF 导出桶的 pdf-async/html/<本人uid>/ 下；入队与执行各核一次，
 * 不在本人前缀下的 gs:// 一律拒绝 —— 不下载、不删除。
 */
import { resolvePdfExportBucketName } from "./gcs";

export const PDF_HTML_SNAPSHOT_FORBIDDEN = "pdf_html_snapshot_not_owned";

export function pdfHtmlSnapshotPrefix(userId: string | number): string {
  const safeUser = String(userId).replace(/[^0-9a-zA-Z_-]/g, "");
  if (!safeUser) throw new Error(PDF_HTML_SNAPSHOT_FORBIDDEN);
  return `pdf-async/html/${safeUser}/`;
}

/** 核验通过返回规范的桶与对象名；否则抛 PDF_HTML_SNAPSHOT_FORBIDDEN。 */
export function assertOwnPdfHtmlSnapshotUri(
  htmlGcsUri: string,
  userId: string | number,
  bucket: string = resolvePdfExportBucketName(),
): { bucket: string; objectName: string; gcsUri: string } {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(String(htmlGcsUri ?? "").trim());
  const prefix = pdfHtmlSnapshotPrefix(userId);
  const objectName = match?.[2] ?? "";
  const rest = objectName.slice(prefix.length);
  if (
    !match ||
    !bucket ||
    match[1] !== bucket ||
    !objectName.startsWith(prefix) ||
    // 前缀下只有一层文件名：不收子目录、越界段、反斜杠、查询串或编码字符
    !/^[0-9A-Za-z_-][0-9A-Za-z._-]*$/.test(rest) ||
    rest.includes("..")
  ) {
    throw new Error(PDF_HTML_SNAPSHOT_FORBIDDEN);
  }
  return { bucket, objectName, gcsUri: `gs://${bucket}/${objectName}` };
}
