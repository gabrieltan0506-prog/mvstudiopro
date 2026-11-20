// 1121 站长定「原像素 + 高品质 JPEG 95，PDF 最多 280MB」：派生件（真实 sharp + 替身存储）与排版前容量估算。
import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { ensureKnowledgeExportImage, knowledgeExportImageUri, resetKnowledgeExportImageCache } from "./knowledgeExportImage";
import { KNOWLEDGE_EXPORT_DEFAULT_JPEG_QUALITY, KNOWLEDGE_EXPORT_IMAGE_QUALITY_OPTIONS, KNOWLEDGE_EXPORT_PDF_NOTICE_BYTES, estimateKnowledgeExportSize, knowledgeExportJpegQuality } from "../../shared/knowledgeExportCapacity";

const MB = 1024 * 1024;
function memoryStore(objects: Map<string, Buffer>) {
  const calls = { encodeReads: 0, creates: 0 };
  return {
    calls,
    async stat(uri: string) { const b = objects.get(uri); return b ? { byteLength: b.length } : null; },
    async read(uri: string) { const b = objects.get(uri); if (!b) throw Error("gcs_stat_failed:404"); if (!/export-full/.test(uri)) calls.encodeReads++; return b; },
    async create(bucket: string, objectName: string, buffer: Buffer) { const uri = `gs://${bucket}/${objectName}`; if (!objects.has(uri)) { objects.set(uri, buffer); calls.creates++; } },
  };
}
const synthetic = async () => {
  const w = 3840, h = 2160, raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; raw[i] = (x * 255 / w) | 0; raw[i + 1] = (y * 255 / h) | 0; raw[i + 2] = ((x ^ y) & 0xff); }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
};

describe("成品配图派生件 ensureKnowledgeExportImage", () => {
  beforeEach(() => resetKnowledgeExportImageCache());
  it("PNG 原图：像素尺寸不变、JPEG 4:4:4、质量参数生效；存回 export-full/<名>.q<质量>.jpg；二次调用零重编码", async () => {
    const objects = new Map<string, Buffer>([["gs://b/dir/a.png", await synthetic()]]);
    const store = memoryStore(objects);
    const q95 = await ensureKnowledgeExportImage("gs://b/dir/a.png", 95, store);
    expect(q95.uri).toBe("gs://b/dir/export-full/a.png.q95.jpg");
    expect(knowledgeExportImageUri("gs://b/dir/a.png", 95).uri).toBe(q95.uri);
    const meta = await sharp(objects.get(q95.uri)!).metadata();
    expect([meta.format, meta.width, meta.height, meta.chromaSubsampling]).toEqual(["jpeg", 3840, 2160, "4:4:4"]);
    expect([q95.width, q95.height, q95.bytes]).toEqual([3840, 2160, objects.get(q95.uri)!.length]);
    const q80 = await ensureKnowledgeExportImage("gs://b/dir/a.png", 80, store);
    expect(q80.bytes).toBeLessThan(q95.bytes);
    expect(store.calls).toEqual({ encodeReads: 2, creates: 2 });
    // 同进程再取：缓存命中；换进程（清缓存）再取：对象已在，只读派生件，不读原图、不重编码、不重建。
    await ensureKnowledgeExportImage("gs://b/dir/a.png", 95, store);
    resetKnowledgeExportImageCache();
    const again = await ensureKnowledgeExportImage("gs://b/dir/a.png", 95, store);
    expect(again).toEqual(q95);
    expect(store.calls).toEqual({ encodeReads: 2, creates: 2 });
    expect(objects.has("gs://b/dir/a.png")).toBe(true); // 原图不动
  }, 60_000);
  it("JPEG 原图：直接用原字节与原地址，不重编码、不另存", async () => {
    const jpeg = await sharp(await synthetic()).jpeg({ quality: 97 }).toBuffer();
    const objects = new Map<string, Buffer>([["gs://b/c.jpg", jpeg]]);
    const store = memoryStore(objects);
    const got = await ensureKnowledgeExportImage("gs://b/c.jpg", 95, store);
    expect(got).toMatchObject({ uri: "gs://b/c.jpg", bytes: jpeg.length, width: 3840, height: 2160, quality: "original-jpeg" });
    expect(store.calls.creates).toBe(0);
  }, 60_000);
  it("失败抛明确错误（不静默回退缩图），且失败不留缓存", async () => {
    const store = memoryStore(new Map());
    await expect(ensureKnowledgeExportImage("gs://b/missing.png", 95, store)).rejects.toThrow(/成品高清配图生成失败（质量 95）.*未用降采样图代替/);
    await expect(ensureKnowledgeExportImage("gs://b/missing.png", 95, store)).rejects.toThrow(/成品高清配图生成失败/);
  });
});

describe("成品容量估算（只估算、不拦截）与画质四档", () => {
  it("四档与默认值；稿件选项换算成编码质量，缺省或不认识的值按 0.95", () => {
    expect(KNOWLEDGE_EXPORT_IMAGE_QUALITY_OPTIONS).toEqual([0.95, 0.85, 0.75, 0.65]);
    expect(KNOWLEDGE_EXPORT_DEFAULT_JPEG_QUALITY).toBe(95);
    expect([0.95, 0.85, 0.75, 0.65].map(q => knowledgeExportJpegQuality(q))).toEqual([95, 85, 75, 65]);
    expect(knowledgeExportJpegQuality(undefined)).toBe(95);
    expect(knowledgeExportJpegQuality(0.5)).toBe(95);
  });
  it("48 张 4K 图：0.95 约 200MB、0.85 约 120MB、0.75 约 92MB、0.65 约 78MB（与站长这本书的实测相符），都在提示线内", () => {
    const book = Array.from({ length: 48 }, () => ({ pixels: 3840 * 2160 }));
    const mb = (q: 95 | 85 | 75 | 65) => estimateKnowledgeExportSize(book, { quality: q }).imageBytes / MB;
    expect(mb(95)).toBeGreaterThan(185); expect(mb(95)).toBeLessThan(205);
    expect(mb(85)).toBeGreaterThan(112); expect(mb(85)).toBeLessThan(126);
    expect(mb(75)).toBeGreaterThan(86); expect(mb(75)).toBeLessThan(98);
    expect(mb(65)).toBeGreaterThan(72); expect(mb(65)).toBeLessThan(83);
    expect(estimateKnowledgeExportSize(book, { quality: 95 }).overNotice).toBe(false);
  });
  it("超过 280MB 只给提示，不抛错", () => {
    const big = Array.from({ length: 150 }, () => ({ pixels: 3840 * 2160 }));
    const estimate = estimateKnowledgeExportSize(big, { quality: 95 });
    expect(estimate.totalBytes).toBeGreaterThan(KNOWLEDGE_EXPORT_PDF_NOTICE_BYTES);
    expect(estimate.overNotice).toBe(true);
  });
});

import { buildKnowledgeBookletHtml, KNOWLEDGE_BOOKLET_WATERMARK, stripKnowledgeBookletWatermark } from "../../shared/knowledgeBooklet";
describe("付费用户的手册不打宣传水印", () => {
  it("只清空水印文字，其余 HTML 逐字不变（分页不受影响）", () => {
    const html = buildKnowledgeBookletHtml({ title: "t", fragment: true, pages: [{ id: "p1", headline: "h", body: "正文", imageUrl: "" }] } as Parameters<typeof buildKnowledgeBookletHtml>[0]);
    expect(html).toContain(`>${KNOWLEDGE_BOOKLET_WATERMARK}</text>`);
    const clean = stripKnowledgeBookletWatermark(html);
    expect(clean).not.toContain(`>${KNOWLEDGE_BOOKLET_WATERMARK}</text>`);
    expect(clean.length).toBe(html.length - KNOWLEDGE_BOOKLET_WATERMARK.length * (html.split(`>${KNOWLEDGE_BOOKLET_WATERMARK}</text>`).length - 1));
  });
});
