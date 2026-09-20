/**
 * 审片报告导出 PDF（0920 用户令：「在ＰＲ加一個島出ＰＤＦ檔的按鈕」）。
 *
 * 复用现成两件套，不新造链路：
 *   · HTML 由 `manhuaNativeReportRender` 渲染并落 GCS（含内嵌帧图 data URI，自包含）
 *   · HTML → PDF 走图文笔记那条 Cloud Run `pdf-worker`（`pdfWorkerClient.fetchPdfBufferFromWorker`）
 * PDF 落 `GCS_PDF_EXPORT_BUCKET`（与知识卡导出同桶口径），返回带 attachment 的 V4 签名链。
 *
 * 🔴 判据：worker 回来的必须是真 PDF（`%PDF` 魔数）。它出错时会回 HTML 错误页，
 * 不校验就会把错误页当成 PDF 交给用户下载。
 */
import { Storage } from "@google-cloud/storage";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  resolvePdfExportBucketName,
  uploadBufferToGcs,
} from "./gcs.js";
import { fetchPdfBufferFromWorker } from "./pdfWorkerClient.js";

export const NATIVE_REPORT_PDF_MAGIC = "%PDF" as const;

export type NativeReportPdfResult = {
  pdfUrl: string;
  pdfObjectName: string;
  bytes: number;
};

/** 供测试注入：默认走真实 worker、真实 GCS。 */
export type NativeReportPdfDeps = {
  downloadHtml: (objectName: string) => Promise<string>;
  htmlToPdf: (html: string) => Promise<Buffer>;
  upload: (params: { objectName: string; buffer: Buffer; bucket: string }) => Promise<void>;
  sign: (bucket: string, objectName: string) => Promise<string>;
};

const defaultDeps: NativeReportPdfDeps = {
  downloadHtml: async (objectName) => {
    const { buffer } = await downloadGcsObjectVersioned({
      gcsUri: `gs://${getGcsBucketName()}/${objectName}`,
    });
    return buffer.toString("utf8");
  },
  htmlToPdf: (html) => fetchPdfBufferFromWorker(html),
  upload: async ({ objectName, buffer, bucket }) => {
    await uploadBufferToGcs({ objectName, buffer, contentType: "application/pdf", bucket });
  },
  sign: async (bucket, objectName) => {
    const creds = JSON.parse(String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "{}")) as {
      client_email?: string; private_key?: string; project_id?: string;
    };
    const storage = new Storage({
      credentials: { client_email: creds.client_email, private_key: creds.private_key },
      projectId: creds.project_id,
    });
    const downloadName = objectName.split("/").pop() || "report.pdf";
    const [url] = await storage.bucket(bucket).file(objectName).getSignedUrl({
      version: "v4", action: "read", expires: Date.now() + 6 * 24 * 3600 * 1000,
      responseDisposition: `attachment; filename="${downloadName}"`,
    });
    return url;
  },
};

/** 报告 HTML 对象名 → 同名 .pdf 对象名（只换扩展名，身份跟着 HTML，不另起命名体系）。 */
export function nativeReportPdfObjectName(htmlObjectName: string): string {
  const name = String(htmlObjectName || "").trim();
  if (!name.endsWith(".html")) {
    throw new Error(`报告对象名必须以 .html 结尾，收到：${name || "(空)"}`);
  }
  return `${name.slice(0, -".html".length)}.pdf`;
}

export async function renderNativeReportPdfFromHtmlObject(
  input: { htmlObjectName: string },
  deps: NativeReportPdfDeps = defaultDeps,
): Promise<NativeReportPdfResult> {
  const pdfObjectName = nativeReportPdfObjectName(input.htmlObjectName);
  const html = await deps.downloadHtml(input.htmlObjectName);
  if (!html.trim()) throw new Error("报告 HTML 为空，拒绝出 PDF");
  const pdf = await deps.htmlToPdf(html);
  if (!pdf?.length) throw new Error("pdf-worker 返回空内容");
  if (pdf.subarray(0, 4).toString("latin1") !== NATIVE_REPORT_PDF_MAGIC) {
    throw new Error("pdf-worker 返回的不是 PDF（可能是错误页），拒绝交付");
  }
  const bucket = resolvePdfExportBucketName();
  await deps.upload({ objectName: pdfObjectName, buffer: pdf, bucket });
  const pdfUrl = await deps.sign(bucket, pdfObjectName);
  return { pdfUrl, pdfObjectName, bytes: pdf.length };
}
