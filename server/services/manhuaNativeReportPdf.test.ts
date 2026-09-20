import { describe, expect, it, vi } from "vitest";
import {
  nativeReportPdfObjectName,
  renderNativeReportPdfFromHtmlObject,
  type NativeReportPdfDeps,
} from "./manhuaNativeReportPdf.js";

const HTML_OBJECT = "manhua-template-learn/reports/tpl_native_abc_ep002.html";

function makeDeps(over: Partial<NativeReportPdfDeps> = {}): NativeReportPdfDeps {
  return {
    downloadHtml: vi.fn(async () => "<html><body>报告</body></html>"),
    htmlToPdf: vi.fn(async () => Buffer.from("%PDF-1.7\n真 PDF 内容")),
    upload: vi.fn(async () => undefined),
    sign: vi.fn(async (bucket, objectName) => `https://signed.example/${bucket}/${objectName}`),
    ...over,
  };
}

describe("审片报告导出 PDF", () => {
  it("对象名只换扩展名，身份跟着 HTML 报告", () => {
    expect(nativeReportPdfObjectName(HTML_OBJECT))
      .toBe("manhua-template-learn/reports/tpl_native_abc_ep002.pdf");
    expect(() => nativeReportPdfObjectName("reports/x.htm")).toThrow(".html");
    expect(() => nativeReportPdfObjectName("")).toThrow(".html");
  });

  it("串起来：下载 HTML → worker 出 PDF → 落 PDF 桶 → 返回 attachment 签名链", async () => {
    const deps = makeDeps();
    const out = await renderNativeReportPdfFromHtmlObject({ htmlObjectName: HTML_OBJECT }, deps);
    expect(deps.downloadHtml).toHaveBeenCalledWith(HTML_OBJECT);
    expect(out.pdfObjectName).toBe("manhua-template-learn/reports/tpl_native_abc_ep002.pdf");
    expect(out.bytes).toBeGreaterThan(0);
    expect(out.pdfUrl).toContain("tpl_native_abc_ep002.pdf");
    const uploaded = vi.mocked(deps.upload).mock.calls[0]![0];
    expect(uploaded.buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("worker 回错误页（不是 PDF）必须拒绝交付，不许上传", async () => {
    const deps = makeDeps({ htmlToPdf: vi.fn(async () => Buffer.from("<html>502 Bad Gateway</html>")) });
    await expect(renderNativeReportPdfFromHtmlObject({ htmlObjectName: HTML_OBJECT }, deps))
      .rejects.toThrow("不是 PDF");
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.sign).not.toHaveBeenCalled();
  });

  it("worker 回空、或报告 HTML 为空，都不许交付", async () => {
    const empty = makeDeps({ htmlToPdf: vi.fn(async () => Buffer.alloc(0)) });
    await expect(renderNativeReportPdfFromHtmlObject({ htmlObjectName: HTML_OBJECT }, empty))
      .rejects.toThrow("空内容");
    const noHtml = makeDeps({ downloadHtml: vi.fn(async () => "   ") });
    await expect(renderNativeReportPdfFromHtmlObject({ htmlObjectName: HTML_OBJECT }, noHtml))
      .rejects.toThrow("HTML 为空");
    expect(noHtml.htmlToPdf).not.toHaveBeenCalled();
  });
});
