// 1121 站长「图片质量不要压缩……可以等比例放大缩小，不要牺牲像素」：成品（PDF / 阅读稿 HTML / 只要图片的 PDF / 课件）里的图
// 必须是原图像素、不做有损重编码；预分页测量可以用缩图（只量版面）。本文件钉住本仓库侧（含 pdf-worker 目录下的入版脚本）。
import { describe, it, expect, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import JSZip from "jszip";
import { settleKnowledgeInterior } from "./knowledgePublicationBilling";
import { layoutFromSource, layoutLibrarySchema } from "../../shared/editableLayout";
import { knowledgeManuscript, knowledgeReviewSchema } from "../../shared/knowledgePublication";
import { knowledgeSourceDigest } from "./knowledgePublicationAdvisor";
import { exportKnowledgePublication, KNOWLEDGE_EXPORT_IMAGE_TRANSPORT, KNOWLEDGE_EXPORT_ORIGINAL_RENDER_CONCURRENCY, isTransientKnowledgePdfWorkerError } from "./knowledgePublicationExport";
import { buildKnowledgeBookletHtml } from "../../shared/knowledgeBooklet";
import { pdfImageCompressionScript, pdfImageLoadScript } from "../../pdf-worker/pdfImageCompression";
import { buildKnowledgeCardPdfFile, prepareKnowledgeCardPage } from "./knowledgeCardPdfExport";
import { buildKnowledgePublicationPptx } from "./knowledgePublicationPptx";
import { knowledgePresentationInput } from "./knowledgePresentationAdvisor";

/** 与 knowledgePublicationPptx.test 的夹具同形（不直接导入测试文件，免得把那边的用例在这里重跑一遍）。 */
function makePresentation() {
  const doc = layoutFromSource({ kind: "knowledge-publication", owner: "7", sourceId: "pptx-orig", title: "史记导读", body: "没有统一标准，应按具体条件比较。原稿最后一句。" });
  const pub = doc.publication!; delete (pub as any).billing;
  const review: any = { kind: "knowledge_publication_v1", title: doc.title, sourceDigest: knowledgeSourceDigest(pub.source), pages: doc.pages.map(p => ({ id: p.id, headline: p.headline, body: p.body, imageDescription: "", imageStatus: "absent", facts: [{ term: "比较", statement: "具体条件" }], cautions: [] })) };
  pub.review = review; pub.manuscript = pub.confirmedManuscript = knowledgeManuscript(review);
  pub.presentationRequest = { id: "00000000-0000-4000-8000-000000000002", minSlides: 2, maxSlides: 3, manuscript: pub.manuscript };
  const input = knowledgePresentationInput(doc);
  const plan: any = { kind: "knowledge_presentation_v1", requestId: input.requestId, sourceDigest: input.sourceDigest, minSlides: 2, maxSlides: 3, title: doc.title, fontStyle: "editorial",
    slides: [{ type: "points", title: "核心知识", sourcePageIds: [doc.pages[0]!.id], points: ["没有统一标准。"], notes: "" }, { type: "table", title: "知识对照", sourcePageIds: [doc.pages[0]!.id], columns: ["对象", "特征"], rows: [["本纪", "以帝王为中心"]], notes: "" }] };
  pub.presentationPlan = plan;
  return { doc, review, plan };
}

const SHA = "c".repeat(64);
const own = (h: string) => `data-source-headline="${h}"`;
const thumb = (uri: string) => `https://test.invalid/thumb/${encodeURIComponent(uri)}`;
const original = (uri: string) => `https://test.invalid/original/${encodeURIComponent(uri)}`;

function book(chapters: number, imageBytes: number) {
  const images: Record<number, string> = {};
  for (let i = 1; i <= chapters; i++) images[i] = `gs://test-bucket/img-${i}.png`;
  const doc = layoutFromSource({ kind: "knowledge-publication", owner: "7", sourceId: `orig-${chapters}`, title: "原图测试", body: "",
    pages: Array.from({ length: chapters }, (_, i) => ({ headline: `第${i + 1}章`, body: `第${i + 1}章正文。`.repeat(20), pageIndex: i + 1, knowledgeRole: "illustration" as const })), images } as any);
  const pub = doc.publication!; pub.billing!.confirmed = true;
  pub.review = knowledgeReviewSchema.parse({ kind: "knowledge_publication_v1", title: doc.title, sourceDigest: knowledgeSourceDigest(pub.source),
    pages: doc.pages.map(p => ({ id: p.id, headline: p.headline, body: p.body, imageDescription: "测试原图", imageStatus: "consistent", facts: [{ term: "知识要点", statement: "测试中的具体知识主张" }], cautions: [] })) });
  pub.manuscript = pub.confirmedManuscript = knowledgeManuscript(pub.review);
  const library = layoutLibrarySchema.parse({ version: 1, owner: "7", documents: [doc] });
  const live = library.documents[0]!;
  const storage = new Map<string, Buffer>();
  const deduct = vi.fn(async (_o: number, cost: number) => ({ success: true, cost, remainingBalance: 1e9, source: "personal" as const }));
  let inFlight = 0;
  const stats = { pdfMax: 0, measureMax: 0 };
  const deps = {
    settle: (owner: number, d: any, total: number, n: number) => settleKnowledgeInterior(owner, d, total, n, deduct),
    load: vi.fn(async () => ({ library: structuredClone(library), generation: "10", updatedAt: "2026-11-21T00:00:00+08:00" })),
    review: vi.fn(async () => ({ report: pub.review, sourceImages: live.pages.map(p => ({ uri: p.imageUrl, sha256: SHA })) })),
    image: vi.fn(async () => ({ buffer: Buffer.alloc(imageBytes), mimeType: "image/png", width: 3840, height: 2160, sha256: SHA })),
    imageUrl: vi.fn(async (uri: string) => thumb(uri)),
    originalImageUrl: vi.fn(async (uri: string) => original(uri)),
    read: vi.fn(async (name: string) => storage.get(name) || null),
    save: vi.fn(async (name: string, buffer: Buffer) => { storage.set(name, buffer); }),
    file: vi.fn(async (name: string, path: string) => { const data = await readFile(path); storage.set(name, data); return data.length; }),
    sign: (name: string) => `https://test.invalid/${name}`,
    measure: vi.fn(async (_html: string) => { stats.measureMax = Math.max(stats.measureMax, ++inFlight); await new Promise(r => setTimeout(r, 2)); inFlight--; return 2; }),
    pdf: vi.fn(async (_html: string) => { stats.pdfMax = Math.max(stats.pdfMax, ++inFlight); await new Promise(r => setTimeout(r, 2)); inFlight--; return Buffer.from("%PDF" + "x".repeat(200)); }),
    merge: vi.fn(async (_p: string[], target: string) => { await writeFile(target, Buffer.from("%PDF" + "m".repeat(200))); }),
    countPages: vi.fn(async () => chapters * 2),
  };
  return { doc: live, deps, storage, deduct, stats };
}
const imgTags = (html: string) => html.match(/<img\b[^>]*>/g) ?? [];

describe("成品用原图、测量用缩图（图文手册 PDF / 阅读稿）", () => {
  it("测量稿只引用缩图；成品渲染与阅读稿只引用原图，每张图带 data-pdf-original 且无任何 max-dim/quality 降采样标记", async () => {
    const f = book(6, 15 * 1024 * 1024);
    const result = await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any);
    expect(result.pdfUrl).toBeTruthy();
    const measured = (f.deps.measure.mock.calls as unknown as [string][]).map(([h]) => h);
    const rendered = (f.deps.pdf.mock.calls as unknown as [string][]).map(([h]) => h);
    const reading = Array.from(f.storage.entries()).find(([k]) => k.endsWith("阅读稿.html"))![1].toString("utf8");
    expect(measured).toHaveLength(6); expect(rendered).toHaveLength(6);
    for (const html of measured) { expect(html).toContain("https://test.invalid/thumb/"); expect(html).not.toContain("https://test.invalid/original/"); }
    for (const html of [...rendered, reading]) {
      expect(html).not.toContain("https://test.invalid/thumb/");
      expect(html).not.toMatch(/data-pdf-(max-dim|quality)="/);
      for (const tag of imgTags(html)) expect(tag).not.toMatch(/data-pdf-(max-dim|quality)/);
      const tags = imgTags(html).filter(t => t.includes("https://test.invalid/original/"));
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) expect(tag).toContain('data-pdf-original="1"');
    }
    // 每章成品渲染引用的正是本章原图。
    f.doc.pages.forEach((p, i) => expect(rendered.find(h => h.includes(own(p.headline)))).toContain(original(p.imageUrl)));
    expect(rendered[0]).toContain(original(f.doc.pages[0]!.imageUrl));
    // 测量与成品同一版式（去掉图地址与原图标记后逐字相同），只是图源不同。
    const strip = (h: string) => h.replace(/https:\/\/test\.invalid\/(thumb|original)\//g, "IMG/").replace(/ ?data-pdf-original="1"| ?data-pdf-max-dim="\d+"| ?data-pdf-quality="[\d.]+"/g, "");
    const renderedNoHead = rendered.map(h => strip(h.replace(/<body[^>]*>/, "<body>"))).sort();
    expect(measured.map(h => strip(h.replace(/<body[^>]*>/, "<body>"))).sort()).toEqual(renderedNoHead);
  });

  it("原图（>4MB/张）渲染降到 4 路并发，测量仍 8 路；瞬时故障渲染多重试一次", async () => {
    const f = book(20, 6 * 1024 * 1024);
    let flaky = 2;
    const realPdf = f.deps.pdf.getMockImplementation()!;
    f.deps.pdf.mockImplementation(async (html: string) => {
      if (html.includes(own("第3章")) && flaky-- > 0) throw Error("pdf-worker returned 503");
      return realPdf(html);
    });
    const result = await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any);
    expect(result.pdfUrl).toBeTruthy();
    expect(f.stats.pdfMax).toBeLessThanOrEqual(KNOWLEDGE_EXPORT_ORIGINAL_RENDER_CONCURRENCY);
    expect(f.stats.measureMax).toBe(8);
  }, 30_000);

  it("版本隔离：成品目录换成 orig1，旧 url2 成品不被复用（照常渲染）、也不删；重复导出只结算一次", async () => {
    expect(KNOWLEDGE_EXPORT_IMAGE_TRANSPORT).toBe("orig1");
    const probe = book(3, 1024);
    await exportKnowledgePublication(7, probe.doc.id, "10", probe.deps as any);
    const prefix = Array.from(probe.storage.keys()).find(k => k.endsWith("/manifest.json"))!.replace(/\/manifest\.json$/, "");
    expect(prefix.endsWith("-orig1")).toBe(true);
    // 同一稿件（同 id、同内容）在另一份存储里预置旧 url2 成品。
    const f = { ...probe, storage: new Map<string, Buffer>() };
    const old = prefix.replace(/-orig1$/, "-url2");
    const oldManifest = Buffer.from(JSON.stringify({ htmlBytes: 1, pdfBytes: 10, chapters: 3, imagePages: 3, totalPages: 6 }));
    f.storage.set(`${old}/manifest.json`, oldManifest);
    f.deps.read.mockImplementation(async (name: string) => f.storage.get(name) || null);
    f.deps.save.mockImplementation(async (name: string, b: Buffer) => { f.storage.set(name, b); });
    f.deps.file.mockImplementation(async (name: string, path: string) => { const d = await readFile(path); f.storage.set(name, d); return d.length; });
    f.deps.pdf.mockClear();
    const fresh = await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any);
    expect(f.deps.pdf).toHaveBeenCalledTimes(3);
    expect(fresh.pdfUrl).toContain("-orig1/");
    expect(f.storage.get(`${old}/manifest.json`)).toBe(oldManifest);
    await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any);
    expect(f.deps.pdf).toHaveBeenCalledTimes(3);
  });

  it("预览/测量 HTML（不传原图开关）与原先逐字相同：仍带 2048 标记，无原图标记", () => {
    const base = { title: "t", fragment: true, pages: [{ id: "p1", headline: "h", body: "正文", imageUrl: "https://test.invalid/a.png" }] };
    const plain = buildKnowledgeBookletHtml(base);
    expect(plain).toContain('data-pdf-max-dim="2048"'); expect(plain).not.toContain("data-pdf-original");
    const orig = buildKnowledgeBookletHtml({ ...base, originalImages: true });
    expect(orig).not.toMatch(/data-pdf-(max-dim|quality)="/);
    expect(orig.replace(/ ?data-pdf-original="1"/g, "")).toBe(plain.replace(/ ?data-pdf-max-dim="\d+"| ?data-pdf-quality="[\d.]+"/g, ""));
  });
});

describe("排版服务入版脚本（pdf-worker）", () => {
  const fakeImage = (attrs: Record<string, string>, src: string) => {
    const img: any = { src, srcset: "", naturalWidth: 3840, naturalHeight: 2160, complete: true,
      getAttribute: (k: string) => attrs[k] ?? null, decode: async () => undefined, addEventListener: () => undefined };
    return img;
  };
  it("data-pdf-original 的图不缩放不重编码；无标记的旧图仍走原压缩（对照）", async () => {
    const orig = fakeImage({ "data-pdf-original": "1" }, "https://test.invalid/original/a.png");
    const legacy = fakeImage({}, "https://test.invalid/legacy.png");
    const drawn: number[][] = [];
    const document = { images: [orig, legacy], createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage: (_i: unknown, _x: number, _y: number, w: number, h: number) => drawn.push([w, h]), set fillStyle(_v: string) {} }), toDataURL: () => "data:image/jpeg;base64,AAAA" }) };
    await new Function("document", `return ${pdfImageCompressionScript(2048)}`)(document);
    expect(orig.src).toBe("https://test.invalid/original/a.png");
    expect(legacy.src).toBe("data:image/jpeg;base64,AAAA");
    expect(drawn).toEqual([[1200, 675]]);
  });
  it("原图等待放宽；等完仍未载入即报错（按瞬时故障重试），不打缺图成品", async () => {
    const loaded = fakeImage({ "data-pdf-original": "1" }, "a");
    const missing = { ...fakeImage({ "data-pdf-original": "1" }, "b"), complete: false, naturalWidth: 0 };
    const doc = (imgs: any[]) => ({ images: imgs, querySelectorAll: () => imgs.filter(i => i.getAttribute("data-pdf-original") === "1") });
    const run = (imgs: any[]) => new Function("document", "setTimeout", `return ${pdfImageLoadScript(20_000, 180_000)}`)(doc(imgs), (fn: () => void) => fn());
    await expect(run([loaded])).resolves.toBeUndefined();
    const error = await run([loaded, missing]).catch((e: unknown) => e);
    expect(String(error)).toMatch(/original image load timeout: 1/);
    expect(isTransientKnowledgePdfWorkerError(error)).toBe(true);
    expect(pdfImageLoadScript(20_000, 180_000)).toContain("180000");
  });
});

describe("只要图片的 PDF 与课件：原图原字节入版", () => {
  const noisy = async (w: number, h: number, format: "png" | "jpeg") => {
    const raw = Buffer.alloc(w * h * 3); for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
    const s = sharp(raw, { raw: { width: w, height: h, channels: 3 } });
    return format === "png" ? s.png().toBuffer() : s.jpeg({ quality: 95 }).toBuffer();
  };
  it("3840×2160 PNG/JPEG 与 3:2 小图：原字节入版、不经重编码；PDF 内嵌像素尺寸 = 原图", async () => {
    const png = await noisy(3840, 2160, "png"), jpeg = await noisy(3840, 2160, "jpeg"), narrow = await noisy(1536, 1024, "png");
    for (const input of [png, jpeg, narrow]) expect((await prepareKnowledgeCardPage(input)).image).toBe(input);
    expect((await prepareKnowledgeCardPage(narrow)).background).not.toBeNull();
    const { filePath, dir } = await buildKnowledgeCardPdfFile([async () => png, async () => jpeg, async () => narrow]);
    try {
      const pdf = await readFile(filePath);
      const text = pdf.toString("latin1");
      expect(pdf.indexOf(jpeg)).toBeGreaterThan(0); // JPEG 原字节整段在 PDF 里
      expect(text.match(/\/DCTDecode/g)).toHaveLength(1); // 只有那张原 JPEG；PNG 未被转成有损 JPEG
      expect(text).toMatch(/\/Width 3840[\s\S]{0,200}\/Height 2160|\/Height 2160[\s\S]{0,200}\/Width 3840/);
      expect(text).toMatch(/\/Width 1536[\s\S]{0,200}\/Height 1024|\/Height 1024[\s\S]{0,200}\/Width 1536/);
    } finally { await (await import("node:fs/promises")).rm(dir, { recursive: true, force: true }); }
  }, 60_000);

  it("课件图片页：媒体文件就是原图字节（不再缩到 1800 宽、不 JPEG 重编码）", async () => {
    const png = await noisy(3840, 2160, "png");
    const f = makePresentation();
    f.doc.pages[0]!.imageUrl = "gs://test/image.png";
    f.plan.slides[0] = { type: "image", title: "图解", sourcePageIds: [f.doc.pages[0]!.id], imagePageId: f.doc.pages[0]!.id, points: ["图解说明"], notes: "" } as any;
    const r = await buildKnowledgePublicationPptx(f.doc, f.review, { "gs://test/image.png": `data:image/png;base64,${png.toString("base64")}` }, f.plan);
    const zip = await JSZip.loadAsync(r.buffer);
    const media = await Promise.all(Object.keys(zip.files).filter(n => n.startsWith("ppt/media/") && !zip.files[n]!.dir).map(n => zip.file(n)!.async("nodebuffer")));
    expect(media.some(m => m.equals(png))).toBe(true);
    const meta = await Promise.all(media.map(m => sharp(m).metadata().catch(() => null)));
    expect(meta.some(m => m?.width === 3840 && m?.height === 2160)).toBe(true);
  }, 60_000);
});
