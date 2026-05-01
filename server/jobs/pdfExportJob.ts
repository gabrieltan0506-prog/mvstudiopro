import { type JobType, recordPdfExportStep } from "./repository";
import { downloadGcsObject, deleteGcsObject, uploadBufferToGcs, signGsUriV4ReadUrl, resolvePdfExportBucketName } from "../services/gcs";
import { fetchPdfBufferFromWorker } from "../services/pdfWorkerClient";

type Envelope = { action?: string; params?: Record<string, unknown> };

function asEnvelope(raw: unknown): Envelope {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Envelope;
  }
  return {};
}

/**
 * 异步 PDF：从 GCS 读 HTML 快照 → pdf-worker → PDF 落 GCS → 返回短时 GET 签名链接。
 */
export async function processPdfExportJob(
  inputRaw: unknown,
  userId: string,
  jobId?: string,
): Promise<{ output: unknown; provider: string }> {
  const input = asEnvelope(inputRaw);
  if (input.action !== "render_html") {
    throw new Error(`Unsupported pdf_export action: ${String(input.action)}`);
  }
  const params = input.params ?? {};
  const htmlGcsUri = String(params.htmlGcsUri ?? "").trim();
  if (!htmlGcsUri.startsWith("gs://")) {
    throw new Error("pdf_export missing htmlGcsUri");
  }
  const token = typeof params.token === "string" ? params.token : "";

  await recordPdfExportStep(jobId, "validate_input", `htmlGcsUri=${htmlGcsUri.slice(0, 160)}`);

  await recordPdfExportStep(jobId, "gcs_download_html_start");
  const { buffer: htmlBuffer } = await downloadGcsObject({ gcsUri: htmlGcsUri });
  const html = htmlBuffer.toString("utf-8");
  await recordPdfExportStep(jobId, "gcs_download_html_done", `bytes=${htmlBuffer.length}`);

  if (html.length < 100) {
    throw new Error("html snapshot empty after GCS download");
  }
  await recordPdfExportStep(jobId, "html_validated", `chars=${html.length}`);

  await recordPdfExportStep(jobId, "pdf_worker_request");
  const pdfBuffer = await fetchPdfBufferFromWorker(html, token);
  await recordPdfExportStep(jobId, "pdf_worker_response", `pdfBytes=${pdfBuffer.length}`);

  const bucket = resolvePdfExportBucketName();
  const safeUser = String(userId).replace(/[^0-9a-zA-Z_-]/g, "");
  const pdfObject = `pdf-async/pdf/${safeUser}/${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`;
  await recordPdfExportStep(jobId, "gcs_upload_pdf_start", pdfObject);
  const { gcsUri: pdfGcsUri } = await uploadBufferToGcs({
    bucket,
    objectName: pdfObject,
    buffer: pdfBuffer,
    contentType: "application/pdf",
  });
  await recordPdfExportStep(jobId, "gcs_upload_pdf_done", pdfGcsUri);

  await recordPdfExportStep(jobId, "sign_download_url");
  const downloadUrl = signGsUriV4ReadUrl(pdfGcsUri, 3600);

  const { bucket: htmlBucket, objectName: htmlObj } = (() => {
    const u = htmlGcsUri.replace(/^gs:\/\//, "");
    const i = u.indexOf("/");
    return { bucket: u.slice(0, i), objectName: u.slice(i + 1) };
  })();
  await recordPdfExportStep(jobId, "delete_html_snapshot_start", htmlGcsUri.slice(0, 200));
  await deleteGcsObject({ bucket: htmlBucket, objectName: htmlObj }).catch((e) => {
    console.warn("[pdf_export] delete html snapshot failed:", (e as Error).message);
  });
  await recordPdfExportStep(jobId, "delete_html_snapshot_done");

  await recordPdfExportStep(jobId, "complete");

  return {
    provider: "pdf-worker-async",
    output: {
      downloadUrl,
      pdfGcsUri,
      expiresInSeconds: 3600,
    },
  };
}

export function pdfExportJobTypeGuard(t: string): t is JobType {
  return t === "pdf_export";
}
