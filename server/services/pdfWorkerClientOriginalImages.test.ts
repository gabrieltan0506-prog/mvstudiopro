import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPdfBufferFromWorker } from "./pdfWorkerClient";
import { KNOWLEDGE_BOOKLET_ORIGINAL_IMAGE_ATTR } from "../../shared/knowledgeBooklet";

const respond = (headers: Record<string, string>) => vi.fn(async () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "content-type": "application/pdf", ...headers } }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("成品原图握手：排版服务未确认按原图入版时不收成品", () => {
  it("请求带原图标记而排版服务没有回报（旧版本会把图压小）：拒收并提示稍后重试", async () => {
    vi.stubEnv("CLOUD_RUN_PDF_URL", "https://pdf.example");
    vi.stubGlobal("fetch", respond({}));
    await expect(fetchPdfBufferFromWorker(`<img ${KNOWLEDGE_BOOKLET_ORIGINAL_IMAGE_ATTR} src="https://x/a.png">`)).rejects.toThrow("不接受压缩过的配图");
  });
  it("排版服务回报已按原图入版：正常收下", async () => {
    vi.stubEnv("CLOUD_RUN_PDF_URL", "https://pdf.example");
    vi.stubGlobal("fetch", respond({ "X-Pdf-Original-Images": "1" }));
    expect((await fetchPdfBufferFromWorker(`<img ${KNOWLEDGE_BOOKLET_ORIGINAL_IMAGE_ATTR} src="https://x/a.png">`)).length).toBe(4);
  });
  it("不带原图标记的其他 PDF（分析报告等）：不受握手影响", async () => {
    vi.stubEnv("CLOUD_RUN_PDF_URL", "https://pdf.example");
    vi.stubGlobal("fetch", respond({}));
    expect((await fetchPdfBufferFromWorker(`<p>报告</p>`)).length).toBe(4);
  });
});
