import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  buildContactSheets,
  formatKnowledgeCardPageRef,
  knowledgeCardPageObjectName,
  parseKnowledgeCardPageRefs,
  prepareKnowledgeCardDocumentPages,
  resolveKnowledgeCardReferencePageUrls,
  splitPdfTextByPage,
  stripKnowledgeCardPageRefs,
  KNOWLEDGE_CARD_SHEET_CELLS,
} from "./knowledgeCardDocumentPages";
import { buildEpubPrintHtml, convertEpubToPdf, parseEpub, renderHtmlToPdf } from "./knowledgeCardEpubToPdf";

const DOC_KEY = "0123456789abcdef";

describe("参考原页标记", () => {
  it("formats, parses (dedupe, multi-page) and strips", () => {
    const marker = formatKnowledgeCardPageRef(DOC_KEY, [41, 161]);
    expect(marker).toBe(`〔参考原页 ${DOC_KEY}:p41,p161〕`);
    const md = `## 扶阳操\n- 第一式站桩\n${marker}\n\n## 早餐\n- 因人施养\n〔参考原页 ${DOC_KEY}:p161、p2〕`;
    expect(parseKnowledgeCardPageRefs(md)).toEqual([
      { docKey: DOC_KEY, pageNumber: 41 },
      { docKey: DOC_KEY, pageNumber: 161 },
      { docKey: DOC_KEY, pageNumber: 2 },
    ]);
    const stripped = stripKnowledgeCardPageRefs(md);
    expect(stripped).not.toContain("参考原页");
    expect(stripped).toContain("- 第一式站桩");
    expect(stripped).toContain("## 早餐");
  });

  it("ignores malformed markers", () => {
    expect(parseKnowledgeCardPageRefs("〔参考原页 abc:p1〕 〔参考原页 0123456789abcdef:x9〕")).toEqual([]);
  });

  it("resolves only existing pages under the user's prefix, in marker order, capped", async () => {
    const seen: string[] = [];
    const urls = await resolveKnowledgeCardReferencePageUrls({
      userId: 7,
      pageText: `x ${formatKnowledgeCardPageRef(DOC_KEY, [3, 5, 9, 11, 13])}`,
      limit: 4,
      signIfExists: async (objectName) => {
        seen.push(objectName);
        return objectName.endsWith("p-005.jpg") ? null : `https://signed/${objectName}`;
      },
    });
    expect(seen[0]).toBe(knowledgeCardPageObjectName(7, DOC_KEY, 3));
    expect(seen).toHaveLength(4);
    expect(urls.map((u) => u.pageNumber)).toEqual([3, 9, 11]);
    expect(urls[0]!.url).toContain("knowledge-card-distill/pages/u7/0123456789abcdef/p-003.jpg");
  });
});

describe("splitPdfTextByPage", () => {
  it("splits on form feed and drops the trailing empty page", () => {
    expect(splitPdfTextByPage("第一页  \n\n\n第一页续\f第二页\f")).toEqual(["第一页\n\n第一页续", "第二页"]);
  });
});

async function makeEpub(chapters: number): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const items = Array.from({ length: chapters }, (_, i) => `<item id="c${i}" href="text/c${i}.xhtml" media-type="application/xhtml+xml"/>`).join("");
  const refs = Array.from({ length: chapters }, (_, i) => `<itemref idref="c${i}"/>`).join("");
  zip.file("OEBPS/content.opf", `<?xml version="1.0"?><package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>测试书</dc:title></metadata><manifest>${items}<item id="css" href="style.css" media-type="text/css"/><item id="img" href="img/a.png" media-type="image/png"/></manifest><spine>${refs}</spine></package>`);
  zip.file("OEBPS/style.css", "h1{color:#123}");
  // 1×1 PNG
  zip.file("OEBPS/img/a.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
  for (let i = 0; i < chapters; i++) {
    zip.file(`OEBPS/text/c${i}.xhtml`, `<html><head><link rel="stylesheet" href="../style.css"/></head><body><h1>第${i + 1}章 养生要点</h1><p>${"顺应自然节律，收摄精气神。".repeat(60)}</p><img src="../img/a.png"/><script>alert(1)</script></body></html>`);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("EPUB → PDF → 逐页备料（真实 Chromium + poppler）", () => {
  it("parses spine order, inlines assets, drops scripts", async () => {
    const parsed = await parseEpub(await makeEpub(3));
    expect(parsed.title).toBe("测试书");
    expect(parsed.chapters).toHaveLength(3);
    expect(parsed.chapters[0]).toContain("data:image/png;base64");
    expect(parsed.chapters[0]).toContain("h1{color:#123}");
    expect(parsed.chapters[0]).not.toContain("<script");
    expect(buildEpubPrintHtml(parsed)).toContain("kc-chapter");
  }, 30_000);

  it("converts to a multi-page PDF and prepares pages: text per page, contact sheets, only selected pages rendered + uploaded", async () => {
    const { pdf, chapterCount } = await convertEpubToPdf(await makeEpub(4));
    expect(chapterCount).toBe(4);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");

    const uploads: string[] = [];
    const stages: string[] = [];
    let sheetsSeen = 0;
    const set = await prepareKnowledgeCardDocumentPages({
      buffer: pdf,
      fileName: "测试书.epub",
      userId: 42,
      selectPages: async (sheets, pageCount) => {
        sheetsSeen = sheets.length;
        expect(pageCount).toBeGreaterThanOrEqual(4);
        expect(sheets[0]!.pageNumbers[0]).toBe(1);
        expect(sheets[0]!.imageDataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
        return [{ pageNumber: 2, reason: "章节标题版式" }, { pageNumber: 2 }, { pageNumber: 9999 }];
      },
      onProgress: async (stage) => { stages.push(stage); },
      uploadPage: async (objectName) => { uploads.push(objectName); return `gs://bucket/${objectName}`; },
    });
    expect(set.docKey).toMatch(/^[0-9a-f]{16}$/);
    expect(set.pageCount).toBe(set.pages.length);
    expect(set.pages[0]!.text).toContain("第1章");
    expect(set.selectedPages).toEqual([2]);
    expect(uploads).toEqual([knowledgeCardPageObjectName(42, set.docKey, 2)]);
    expect(set.pages[1]!.imageDataUrl?.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(set.pages[1]!.imageGcsUri).toContain("/p-002.jpg");
    expect(set.pages[1]!.reason).toBe("章节标题版式");
    expect(set.pages[0]!.imageDataUrl).toBeUndefined();
    expect(sheetsSeen).toBe(Math.ceil(set.pageCount / KNOWLEDGE_CARD_SHEET_CELLS));
    expect(stages).toEqual(expect.arrayContaining(["text", "thumbs", "select", "render"]));
  }, 120_000);

  it("renderHtmlToPdf produces a PDF for plain HTML", async () => {
    const pdf = await renderHtmlToPdf("<html><body><h1>只有一页</h1></body></html>");
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  }, 60_000);
});

describe("buildContactSheets", () => {
  it("packs 12 thumbnails per sheet with page labels", async () => {
    const sharp = (await import("sharp")).default;
    const thumbs = new Map<number, Buffer>();
    for (let i = 1; i <= 14; i++) {
      thumbs.set(i, await sharp({ create: { width: 160, height: 90, channels: 3, background: "#ccc" } }).jpeg().toBuffer());
    }
    const sheets = await buildContactSheets(thumbs);
    expect(sheets).toHaveLength(2);
    expect(sheets[0]!.pageNumbers).toHaveLength(12);
    expect(sheets[1]!.pageNumbers).toEqual([13, 14]);
    const meta = await sharp(Buffer.from(sheets[0]!.imageDataUrl.split(",")[1]!, "base64")).metadata();
    expect(meta.width).toBeGreaterThan(1000);
  });
});
