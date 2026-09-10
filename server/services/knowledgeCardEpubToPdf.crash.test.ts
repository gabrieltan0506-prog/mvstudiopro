import JSZip from "jszip";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { EpubChromiumCrashError, convertEpubToPdf, isChromiumCrashError, parseEpub } from "./knowledgeCardEpubToPdf";

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

  it("stripImages：图片换成 1×1 占位，不再解码", async () => {
    const parsed = await parseEpub(await makeEpubWithBigImage(), { stripImages: true });
    expect(parsed.images).toMatchObject({ total: 2, stripped: 2 });
    expect(parsed.chapters[0]).not.toContain("image/jpeg");
    expect(parsed.chapters[0]!.length).toBeLessThan(2000);
  }, 60_000);

  it("Chromium 崩一次 → 剥图重打；崩两次 → 给用户能照办的中文错误，不是 Protocol error", async () => {
    const buffer = await makeEpubWithBigImage();
    let calls = 0;
    const crashOnce = async (html: string) => {
      calls += 1;
      if (calls === 1) throw new EpubChromiumCrashError("Chromium 转 PDF 时崩溃：Protocol error (Runtime.callFunctionOn): Target closed");
      expect(html).not.toContain("image/jpeg");
      return Buffer.from("%PDF-fake");
    };
    const out = await convertEpubToPdf(buffer, { render: crashOnce });
    expect(out.mode).toBe("stripped");
    expect(out.images.stripped).toBe(2);
    expect(calls).toBe(2);

    const alwaysCrash = async () => { throw new EpubChromiumCrashError("Target closed"); };
    await expect(convertEpubToPdf(buffer, { render: alwaysCrash })).rejects.toThrow(/太大.*崩溃两次.*Calibre/);

    // 非崩溃错误不重试，原样抛
    const other = async () => { throw new Error("磁盘满"); };
    await expect(convertEpubToPdf(buffer, { render: other })).rejects.toThrow("磁盘满");
  }, 60_000);

  it("崩溃特征识别", () => {
    expect(isChromiumCrashError(new Error("Protocol error (Runtime.callFunctionOn): Target closed"))).toBe(true);
    expect(isChromiumCrashError(new Error("Navigation timeout of 120000 ms exceeded"))).toBe(false);
  });
});
