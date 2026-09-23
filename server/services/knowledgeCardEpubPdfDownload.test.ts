import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 0923 用户令：上传 EPUB 后给「转好的 PDF」下载按钮。
 * 验：转好的 PDF 存进 Fly 临时转存认的本人前缀、一转完就回调（提炼失败也能下）、存档失败不拖垮提炼。
 */
const uploads: Array<{ objectName: string; bytes: number; contentType: string }> = [];
let uploadShouldFail = false;

vi.mock("./gcs.js", () => ({
  signGsUriV4ReadUrl: (gsUri: string) => `https://signed.test/${gsUri.replace("gs://", "")}`,
  uploadBufferToGcs: async (p: { objectName: string; buffer: Buffer; contentType: string }) => {
    if (uploadShouldFail) throw new Error("gcs down");
    uploads.push({ objectName: p.objectName, bytes: p.buffer.length, contentType: p.contentType });
    return { bucket: "b", objectName: p.objectName, gcsUri: `gs://b/${p.objectName}` };
  },
}));

vi.mock("./knowledgeCardEpubToPdf.js", () => ({
  isEpubFile: (mime: string, name?: string) => /epub/i.test(mime) || /\.epub$/i.test(String(name || "")),
  convertEpubToPdf: async () => ({
    pdf: Buffer.from("%PDF-1.7 fake"),
    mode: "full",
    chapterCount: 3,
    images: { total: 0, downscaled: 0, stripped: 0 },
    shardCount: 1,
    strippedShards: [],
    shardLabels: [],
  }),
}));

vi.mock("../growth/documentExtract.js", () => ({
  extractDocumentText: async () => ({ text: "正文", method: "pdf_text" }),
}));

import { extractKnowledgeCardUploads } from "./knowledgeCardDistill";

beforeEach(() => {
  uploads.length = 0;
  uploadShouldFail = false;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const epub = { gcsUri: "gs://b/uploads/book.epub", mimeType: "application/epub+zip", fileName: "英国文艺复兴戏剧简史.epub" };

describe("EPUB 转好的 PDF 下载", () => {
  it("存进 pdf/u{用户}/ 前缀（Fly 临时转存按这个认本人），回签名链接和 .pdf 文件名", async () => {
    const seen: Array<Array<{ fileName: string; url: string }>> = [];
    const out = await extractKnowledgeCardUploads([epub], { userId: 7, onConvertedPdf: (all) => { seen.push(all); } });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.objectName).toMatch(/^generated\/platform_knowledge_card\/pdf\/u7\/\d+-.+\.pdf$/);
    expect(uploads[0]!.contentType).toBe("application/pdf");
    expect(out.convertedPdfs).toEqual([
      { fileName: "英国文艺复兴戏剧简史.pdf", url: `https://signed.test/b/${uploads[0]!.objectName}` },
    ]);
    // 一转完就回调，不等提炼
    expect(seen).toEqual([out.convertedPdfs]);
  });

  it("存档失败不拖垮读档：照常抽文，只是没有下载按钮", async () => {
    uploadShouldFail = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await extractKnowledgeCardUploads([epub], { userId: 7 });
    expect(out.convertedPdfs).toEqual([]);
    expect(out.documentText).toContain("正文");
  });

  it("没有用户身份（同步抽文路径）不存档", async () => {
    const out = await extractKnowledgeCardUploads([epub]);
    expect(uploads).toHaveLength(0);
    expect(out.convertedPdfs).toEqual([]);
  });
});
