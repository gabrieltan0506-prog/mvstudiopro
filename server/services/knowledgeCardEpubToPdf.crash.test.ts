import JSZip from "jszip";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EpubChromiumCrashError, convertEpubToPdf, isChromiumCrashError, mergePdfShards, parseEpub, renderHtmlToPdf, splitEpubChaptersIntoShards, stripInlineImagesFromHtml } from "./knowledgeCardEpubToPdf";

async function makeEpubWithBigImage(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file("OEBPS/content.opf", `<?xml version="1.0"?><package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>大图书</dc:title></metadata><manifest><item id="c0" href="c0.xhtml" media-type="application/xhtml+xml"/><item id="big" href="big.png" media-type="image/png"/><item id="tiny" href="tiny.png" media-type="image/png"/></manifest><spine><itemref idref="c0"/></spine></package>`);
  // 3000×3000 噪点 PNG，压不动，>300KB
  const noise = Buffer.alloc(3000 * 3000 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
  zip.file("OEBPS/big.png", await sharp(noise, { raw: { width: 3000, height: 3000, channels: 3 } }).png().toBuffer());
  zip.file("OEBPS/tiny.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
  zip.file("OEBPS/c0.xhtml", `<html><body><h1>章</h1><img src="big.png"/><img src="tiny.png"/></body></html>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("EPUB 大图与 Chromium 崩溃兜底", () => {
  it("大位图内联前缩到长边 1400 并转 JPEG；小图原样保留 PNG", async () => {
    const parsed = await parseEpub(await makeEpubWithBigImage());
    expect(parsed.images).toMatchObject({ total: 2, downscaled: 1, stripped: 0 });
    const html = parsed.chapters[0]!;
    expect(html).toContain("data:image/png;base64");
    const jpeg = /data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/.exec(html);
    expect(jpeg).toBeTruthy();
    const meta = await sharp(Buffer.from(jpeg![1]!, "base64")).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(1400);
  }, 60_000);

  it("透明 PNG 缩图后底色压白，不变黑", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file("META-INF/container.xml", `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
    zip.file("OEBPS/content.opf", `<?xml version="1.0"?><package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>透明</dc:title></metadata><manifest><item id="c0" href="c0.xhtml" media-type="application/xhtml+xml"/><item id="a" href="a.png" media-type="image/png"/></manifest><spine><itemref idref="c0"/></spine></package>`);
    // 3000×3000：透明区 RGB 是噪点（PNG 压不小）+ 中间一块不透明黑；alpha=0 处压白后必须是白
    const rgba = Buffer.alloc(3000 * 3000 * 4);
    for (let i = 0; i < 3000 * 3000; i++) {
      const x = i % 3000, y = Math.floor(i / 3000);
      const inBox = x > 1200 && x < 1800 && y > 1200 && y < 1800;
      const n = (i * 2654435761) >>> 24;
      rgba[i * 4] = inBox ? 0 : n; rgba[i * 4 + 1] = inBox ? 0 : n ^ 0x5a; rgba[i * 4 + 2] = inBox ? 0 : n ^ 0xa5;
      rgba[i * 4 + 3] = inBox ? 255 : 0;
    }
    zip.file("OEBPS/a.png", await sharp(rgba, { raw: { width: 3000, height: 3000, channels: 4 } }).png().toBuffer());
    zip.file("OEBPS/c0.xhtml", `<html><body><img src="a.png"/></body></html>`);
    const parsed = await parseEpub(await zip.generateAsync({ type: "nodebuffer" }));
    expect(parsed.images.downscaled).toBe(1);
    const jpeg = /data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/.exec(parsed.chapters[0]!)![1]!;
    const { data, info } = await sharp(Buffer.from(jpeg, "base64")).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => [data[(y * info.width + x) * 3]!, data[(y * info.width + x) * 3 + 1]!, data[(y * info.width + x) * 3 + 2]!];
    expect(px(2, 2).every((v) => v > 200)).toBe(true); // 透明角 → 白
    expect(px(Math.floor(info.width / 2), Math.floor(info.height / 2)).every((v) => v < 60)).toBe(true); // 中间黑块仍黑
  }, 60_000);

  it("stripImages：图片换成 1×1 占位，不再解码", async () => {
    const parsed = await parseEpub(await makeEpubWithBigImage(), { stripImages: true });
    expect(parsed.images).toMatchObject({ total: 2, stripped: 2 });
    expect(parsed.chapters[0]).not.toContain("image/jpeg");
    expect(parsed.chapters[0]!.length).toBeLessThan(2000);
  }, 60_000);

  it("分片：按累计字节切，单章超限自成一片，顺序不变", () => {
    const ch = (n: number) => "x".repeat(n);
    expect(splitEpubChaptersIntoShards([ch(10), ch(10), ch(10)], 25)).toEqual([[0, 1], [2]]);
    expect(splitEpubChaptersIntoShards([ch(100), ch(5), ch(5)], 25)).toEqual([[0], [1, 2]]);
    expect(splitEpubChaptersIntoShards([ch(5)], 25)).toEqual([[0]]);
    expect(splitEpubChaptersIntoShards([], 25)).toEqual([]);
  });

  it("stripInlineImagesFromHtml 只换掉内联位图，占位符不重复替换", () => {
    const html = '<img src="data:image/jpeg;base64,AAAA"/><img src="data:image/png;base64,BBBB"/><p>字</p>';
    const once = stripInlineImagesFromHtml(html);
    expect(once.stripped).toBe(2);
    expect(once.html).not.toContain("image/jpeg");
    expect(once.html).toContain("<p>字</p>");
    expect(stripInlineImagesFromHtml(once.html).stripped).toBe(0);
  });

  it("三片里只有第 2 片崩：只剥第 2 片的图重打，其它片保留插图；两次都崩报出是哪几章", async () => {
    const buffer = await makeEpubWithBigImage();
    // 把同一章复制成 3 章，用极小 shardMaxBytes 逼成 3 片
    const parsed = await parseEpub(buffer);
    const parse3 = async () => ({ ...parsed, chapters: [parsed.chapters[0]!, parsed.chapters[0]!, parsed.chapters[0]!] });
    const seen: string[] = [];
    let shard2Calls = 0;
    const render = async (html: string) => {
      seen.push(html);
      if (seen.length === 2) { shard2Calls += 1; throw new EpubChromiumCrashError("Target closed"); }
      return Buffer.from(`%PDF-shard-${seen.length}`);
    };
    const merged: Buffer[][] = [];
    const out = await convertEpubToPdf(buffer, { render, parse: parse3 as never, shardMaxBytes: 1, merge: async (pdfs) => { merged.push(pdfs); return Buffer.concat(pdfs); } });
    expect(out.shardCount).toBe(3);
    expect(out.strippedShards).toEqual([2]);
    expect(out.mode).toBe("stripped");
    expect(seen).toHaveLength(4); // 片1、片2(崩)、片2 剥图、片3
    expect(seen[0]).toContain("image/jpeg");
    expect(seen[2]).not.toContain("image/jpeg");
    expect(seen[3]).toContain("image/jpeg");
    expect(merged[0]).toHaveLength(3);

    const alwaysCrash = async () => { throw new EpubChromiumCrashError("Target closed"); };
    await expect(convertEpubToPdf(buffer, { render: alwaysCrash, parse: parse3 as never, shardMaxBytes: 1 })).rejects.toThrow(/第 1\/3 片（第 1–1 章）.*崩溃两次.*Calibre/);

    // 非崩溃错误不重试，原样抛
    const other = async () => { throw new Error("磁盘满"); };
    await expect(convertEpubToPdf(buffer, { render: other })).rejects.toThrow("磁盘满");
  }, 60_000);

  it("真 Chromium + 真 pdfunite：4 章逼成 4 片，合并后页数 ≥ 4 且是合法 PDF", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file("META-INF/container.xml", `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
    const items = Array.from({ length: 4 }, (_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join("");
    const refs = Array.from({ length: 4 }, (_, i) => `<itemref idref="c${i}"/>`).join("");
    zip.file("OEBPS/content.opf", `<?xml version="1.0"?><package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>分片书</dc:title></metadata><manifest>${items}</manifest><spine>${refs}</spine></package>`);
    for (let i = 0; i < 4; i++) zip.file(`OEBPS/c${i}.xhtml`, `<html><body><h1>第${i + 1}章</h1><p>${"分片打印。".repeat(80)}</p></body></html>`);
    const out = await convertEpubToPdf(await zip.generateAsync({ type: "nodebuffer" }), { shardMaxBytes: 1, render: renderHtmlToPdf, merge: mergePdfShards });
    expect(out.shardCount).toBe(4);
    expect(out.mode).toBe("normal");
    expect(out.pdf.subarray(0, 4).toString()).toBe("%PDF");
    const { writeFile: wf, mkdtemp: md, rm: rmdir } = await import("node:fs/promises");
    const { tmpdir: td } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await md(join(td(), "kc-epub-test-"));
    try {
      const file = join(dir, "m.pdf");
      await wf(file, out.pdf);
      const { stdout } = await promisify(execFile)("pdfinfo", [file]);
      const pages = Number(/Pages:\s+(\d+)/.exec(stdout)?.[1] || 0);
      expect(pages).toBeGreaterThanOrEqual(4);
    } finally {
      await rmdir(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("崩溃特征识别", () => {
    expect(isChromiumCrashError(new Error("Protocol error (Runtime.callFunctionOn): Target closed"))).toBe(true);
    expect(isChromiumCrashError(new Error("Navigation timeout of 120000 ms exceeded"))).toBe(false);
  });
});
