import { beforeEach, expect, it, vi } from "vitest";

/** 越权修复：pdf_export 只读、只删本桶 pdf-async/html/<本人uid>/ 下的快照（离线替身，不连 GCS / pdf-worker）。 */
const h = vi.hoisted(() => ({ download: vi.fn(), del: vi.fn(), upload: vi.fn(), worker: vi.fn() }));
vi.mock("./repository", () => ({ recordPdfExportStep: vi.fn(async () => undefined) }));
vi.mock("../services/gcs", () => ({
  downloadGcsObject: h.download,
  deleteGcsObject: h.del,
  uploadBufferToGcs: h.upload,
  signGsUriV4ReadUrl: (u: string) => `https://signed.example/${u.slice(5)}`,
  resolvePdfExportBucketName: () => "test-bucket",
}));
vi.mock("../services/pdfWorkerClient", () => ({ fetchPdfBufferFromWorker: h.worker }));
import { processPdfExportJob } from "./pdfExportJob";
import { assertOwnPdfHtmlSnapshotUri, pdfHtmlSnapshotPrefix } from "../services/pdfHtmlSnapshot";

const job = (htmlGcsUri: string, userId = "7") =>
  processPdfExportJob({ action: "render_html", params: { htmlGcsUri, token: "" } }, userId, "job-1");

beforeEach(() => {
  h.download.mockReset().mockResolvedValue({ buffer: Buffer.from(`<html><body>${"正文".repeat(80)}</body></html>`) });
  h.del.mockReset().mockResolvedValue(undefined);
  h.upload.mockReset().mockImplementation(async ({ bucket, objectName }: any) => ({ gcsUri: `gs://${bucket}/${objectName}` }));
  h.worker.mockReset().mockResolvedValue(Buffer.from("%PDF-test"));
});

it.each([
  ["别人前缀", "gs://test-bucket/pdf-async/html/8/1-abc.html"],
  ["前缀相近的别人（77）", "gs://test-bucket/pdf-async/html/77/1-abc.html"],
  ["别的桶同路径", "gs://other-bucket/pdf-async/html/7/1-abc.html"],
  ["本桶任意对象", "gs://test-bucket/uploads/u7/secret.mp4"],
  ["本桶 PDF 产物区", "gs://test-bucket/pdf-async/pdf/7/1.pdf"],
  ["越界段", "gs://test-bucket/pdf-async/html/7/../8/1-abc.html"],
  ["编码越界", "gs://test-bucket/pdf-async/html/7/%2e%2e/8/1.html"],
  ["本人前缀下的子目录", "gs://test-bucket/pdf-async/html/7/sub/1.html"],
  ["只有前缀没有文件名", "gs://test-bucket/pdf-async/html/7/"],
  ["任意 gs://", "gs://some-bucket/any/object.json"],
])("%s → 拒绝，零下载、零渲染、零上传、零删除", async (_name, uri) => {
  await expect(job(uri)).rejects.toThrow("pdf_html_snapshot_not_owned");
  expect(h.download).not.toHaveBeenCalled();
  expect(h.worker).not.toHaveBeenCalled();
  expect(h.upload).not.toHaveBeenCalled();
  expect(h.del).not.toHaveBeenCalled();
});

it("用户 id 清洗后为空 → 拒绝（不落到公共前缀）", async () => {
  await expect(job("gs://test-bucket/pdf-async/html//1.html", "///")).rejects.toThrow("pdf_html_snapshot_not_owned");
  expect(h.download).not.toHaveBeenCalled();
  expect(h.del).not.toHaveBeenCalled();
});

it("本人前缀快照：正常下载 → 渲染 → 上传 → 只删该快照", async () => {
  const uri = `gs://test-bucket/${pdfHtmlSnapshotPrefix(7)}1762740000000-AbC_def-123.html`;
  const result = await job(uri);
  expect(h.download).toHaveBeenCalledTimes(1);
  expect(h.download).toHaveBeenCalledWith({ gcsUri: uri });
  expect(h.worker).toHaveBeenCalledTimes(1);
  expect(h.upload.mock.calls[0][0].objectName).toMatch(/^pdf-async\/pdf\/7\//);
  expect(h.del).toHaveBeenCalledTimes(1);
  expect(h.del).toHaveBeenCalledWith({ bucket: "test-bucket", objectName: "pdf-async/html/7/1762740000000-AbC_def-123.html" });
  expect((result.output as any).downloadUrl).toContain("https://signed.example/test-bucket/pdf-async/pdf/7/");
});

it("入队核验同一函数：别人前缀/别的桶/任意 gs:// 抛错，本人前缀返回规范地址", () => {
  for (const uri of ["gs://test-bucket/pdf-async/html/8/a.html", "gs://x/pdf-async/html/7/a.html", "gs://x/y", "https://storage.googleapis.com/test-bucket/pdf-async/html/7/a.html", ""]) {
    expect(() => assertOwnPdfHtmlSnapshotUri(uri, 7, "test-bucket")).toThrow("pdf_html_snapshot_not_owned");
  }
  expect(assertOwnPdfHtmlSnapshotUri(" gs://test-bucket/pdf-async/html/7/a.html ", 7, "test-bucket")).toEqual({
    bucket: "test-bucket", objectName: "pdf-async/html/7/a.html", gcsUri: "gs://test-bucket/pdf-async/html/7/a.html",
  });
});
