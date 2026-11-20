// 1121 导出随书规模：用替身（不启动排版服务/浏览器、不连云存储）按 8 / 80 / 300 章跑整册导出编排，
// 核对分段数、并发上限、合并层级、续做只补缺段，以及分项进度（只增不减、最终等于总段数、部分完成停在实际位置）。
// 测试数据经正式合同生成：layoutFromSource（editableLayoutSchema）+ layoutLibrarySchema + knowledgeReviewSchema。
import { describe, it, expect, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { settleKnowledgeInterior } from "./knowledgePublicationBilling";
import { layoutFromSource, layoutLibrarySchema } from "../../shared/editableLayout";
import { knowledgeManuscript, knowledgeReviewSchema } from "../../shared/knowledgePublication";
import { knowledgeSourceDigest } from "./knowledgePublicationAdvisor";
import { exportKnowledgePublication, KNOWLEDGE_EXPORT_PART_CONCURRENCY, type KnowledgeExportProgress } from "./knowledgePublicationExport";

const SHA = "b".repeat(64);
const IMAGE_BYTES = 1024 * 1024; // 2048 长边 q85 派生件的量级
const own = (headline: string) => `data-source-headline="${headline}"`;
/** 每章固定页数（1–3 页），便于核对全书页码。 */
const pagesOf = (index: number) => 1 + (index % 3);

function book(chapters: number) {
  const images: Record<number, string> = {};
  // 约六成章节带图（今晚那本 80 页 48 图的比例）。
  for (let i = 1; i <= chapters; i++) if (i % 5 < 3) images[i] = `gs://test-bucket/img-${i}.png`;
  const doc = layoutFromSource({
    kind: "knowledge-publication", owner: "7", sourceId: `scale-${chapters}`, title: `规模测试 ${chapters} 章`, body: "",
    pages: Array.from({ length: chapters }, (_, i) => ({ headline: `第${i + 1}章`, body: `第${i + 1}章正文。`.repeat(60), pageIndex: i + 1, knowledgeRole: "illustration" as const })),
    images,
  } as any);
  const pub = doc.publication!;
  pub.billing!.confirmed = true;
  pub.review = knowledgeReviewSchema.parse({
    kind: "knowledge_publication_v1", title: doc.title, sourceDigest: knowledgeSourceDigest(pub.source),
    pages: doc.pages.map(p => ({ id: p.id, headline: p.headline, body: p.body, imageDescription: p.imageUrl ? "测试原图" : "", imageStatus: p.imageUrl ? "consistent" : "absent", facts: [{ term: "知识要点", statement: "测试中的具体知识主张" }], cautions: [] })),
  });
  pub.manuscript = pub.confirmedManuscript = knowledgeManuscript(pub.review);
  const library = layoutLibrarySchema.parse({ version: 1, owner: "7", documents: [doc] });
  const live = library.documents[0]!;
  const indexOf = (html: string) => live.pages.findIndex(p => html.includes(own(p.headline)));
  const storage = new Map<string, Buffer>();
  const stats = { measureInFlight: 0, measureMax: 0, pdfInFlight: 0, pdfMax: 0, maxPartHtml: 0, maxPartPdf: 0, mergeGroups: [] as number[] };
  const deduct = vi.fn(async (_o: number, cost: number) => ({ success: true, cost, remainingBalance: 1e9, source: "personal" as const }));
  const deps = {
    settle: (owner: number, d: any, total: number, imgs: number) => settleKnowledgeInterior(owner, d, total, imgs, deduct),
    load: vi.fn(async () => ({ library: structuredClone(library), generation: "10", updatedAt: "2026-11-21T00:00:00+08:00" })),
    review: vi.fn(async () => ({ report: pub.review, sourceImages: live.pages.filter(p => p.imageUrl).map(p => ({ uri: p.imageUrl, sha256: SHA })) })),
    image: vi.fn(async () => ({ buffer: Buffer.alloc(IMAGE_BYTES), mimeType: "image/jpeg", width: 2048, height: 1536, sha256: SHA })),
    imageUrl: async (uri: string) => `https://test.invalid/signed/${encodeURIComponent(uri)}`,
    // 成品派生件替身：编排规模测试不测容量（容量另见 knowledgeExportCapacity 测试），给小体积。
    exportImage: vi.fn(async (uri: string, quality: number) => ({ uri: `${uri}.q${quality}.jpg`, bytes: 64 * 1024, width: 3840, height: 2160, quality })),
    read: vi.fn(async (name: string) => storage.get(name) || null),
    save: vi.fn(async (name: string, buffer: Buffer) => { storage.set(name, buffer); }),
    file: vi.fn(async (name: string, path: string) => { const data = await readFile(path); storage.set(name, data); return data.length; }),
    sign: (name: string) => `https://test.invalid/${name}`,
    measure: vi.fn(async (html: string) => {
      stats.measureMax = Math.max(stats.measureMax, ++stats.measureInFlight);
      await new Promise(r => setTimeout(r, 1));
      stats.measureInFlight--;
      return pagesOf(indexOf(html));
    }),
    pdf: vi.fn(async (html: string) => {
      stats.pdfMax = Math.max(stats.pdfMax, ++stats.pdfInFlight);
      stats.maxPartHtml = Math.max(stats.maxPartHtml, Buffer.byteLength(html));
      await new Promise(r => setTimeout(r, 1));
      stats.pdfInFlight--;
      const bytes = Buffer.from("%PDF" + `part-${indexOf(html)}-`.repeat(20));
      stats.maxPartPdf = Math.max(stats.maxPartPdf, bytes.length);
      return bytes;
    }),
    merge: vi.fn(async (paths: string[], target: string) => { stats.mergeGroups.push(paths.length); await writeFile(target, Buffer.from("%PDF" + "merged".repeat(30))); }),
    countPages: vi.fn(async () => live.pages.reduce((n, _p, i) => n + pagesOf(i), 0)),
  };
  return { doc: live, deps, storage, stats, deduct };
}

const progressOf = () => { const seen: KnowledgeExportProgress[] = []; return { seen, on: (p: KnowledgeExportProgress) => { seen.push(p); } }; };
const assertMonotone = (seen: KnowledgeExportProgress[]) => {
  for (let i = 1; i < seen.length; i++) expect(seen[i]!.done).toBeGreaterThanOrEqual(seen[i - 1]!.done);
  for (const p of seen) { expect(p.label).toBeTruthy(); expect(p.label).not.toMatch(/GLM|DeepSeek|OpenRouter|EvoLink|GPT|puppeteer|pdf-worker|Cloud Run/i); }
};

describe("导出编排随规模（替身）", () => {
  for (const chapters of [8, 80, 300]) {
    it(`${chapters} 章：每章一段、并发 ≤${KNOWLEDGE_EXPORT_PART_CONCURRENCY}、合并分层 ≤24、进度单调到总段数`, async () => {
      const f = book(chapters);
      const progress = progressOf();
      const t0 = Date.now();
      const result = await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any, {}, progress.on);
      const ms = Date.now() - t0;
      const totalPages = f.doc.pages.reduce((n, _p, i) => n + pagesOf(i), 0);
      expect(result.pdfUrl).toBeTruthy();
      expect(result.totalPages).toBe(totalPages);
      // 段数 = 章数：测量与渲染各一次/段。
      expect(f.deps.measure).toHaveBeenCalledTimes(chapters);
      expect(f.deps.pdf).toHaveBeenCalledTimes(chapters);
      expect(f.stats.measureMax).toBeLessThanOrEqual(KNOWLEDGE_EXPORT_PART_CONCURRENCY);
      expect(f.stats.pdfMax).toBeLessThanOrEqual(KNOWLEDGE_EXPORT_PART_CONCURRENCY);
      // 合并：每组 ≤24 个文件，层数 = ceil(log24(段数))。
      expect(Math.max(...f.stats.mergeGroups)).toBeLessThanOrEqual(24);
      const expectedMerges = chapters <= 24 ? 1 : Math.ceil(chapters / 24) + (Math.ceil(chapters / 24) > 1 ? 1 : 0);
      expect(f.deps.merge).toHaveBeenCalledTimes(expectedMerges);
      // 全书页码：分片名带 offset-count-total。
      const parts = Array.from(f.storage.keys()).filter(k => k.includes("/pdf-parts/"));
      expect(parts).toHaveLength(chapters);
      expect(parts.every(k => k.endsWith(`-${totalPages}.pdf`))).toBe(true);
      assertMonotone(progress.seen);
      const renders = progress.seen.filter(p => p.phase === "render");
      expect(renders.at(-1)).toMatchObject({ done: chapters, total: chapters, reused: 0 });
      expect(progress.seen.filter(p => p.phase === "measure").at(-1)!.label).toBe(`测量各段版面 ${chapters}/${chapters} 段`);
      expect(progress.seen.map(p => p.phase).filter((p, i, a) => p !== a[i - 1])).toEqual(["prepare", "measure", "render", "merge", "finishing"]);
      expect(progress.seen.at(-1)).toMatchObject({ done: chapters, total: chapters });
      console.log(`[scale] chapters=${chapters} pages=${totalPages} parts=${parts.length} merges=${f.stats.mergeGroups.join(",")} maxPartHtml=${f.stats.maxPartHtml} measureMax=${f.stats.measureMax} pdfMax=${f.stats.pdfMax} progressEvents=${progress.seen.length} ms=${ms}`);
    }, 120_000);
  }

  it("300 章：3 段渲染失败 → 部分完成，进度如实停在 297/300；续做只补这 3 段、复用 297 段并计入已完成", async () => {
    const f = book(300);
    const broken = new Set(["第7章", "第150章", "第299章"]);
    const realPdf = f.deps.pdf.getMockImplementation()!;
    f.deps.pdf.mockImplementation(async (html: string) => {
      if (Array.from(broken).some(h => html.includes(own(h)))) throw Error("导出没有返回有效PDF");
      return realPdf(html);
    });
    const first = progressOf();
    const partial = await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any, {}, first.on);
    expect(partial.pdfUrl).toBeUndefined();
    expect(partial.pdfError).toContain("3段未完成");
    expect(f.deduct).not.toHaveBeenCalled();
    assertMonotone(first.seen);
    expect(first.seen.at(-1)).toMatchObject({ phase: "partial", done: 297, total: 300, failed: 3 });
    expect(f.deps.merge).not.toHaveBeenCalled();

    broken.clear();
    f.deps.pdf.mockClear(); f.deps.measure.mockClear();
    const second = progressOf();
    const done = await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any, {}, second.on);
    expect(done.pdfUrl).toBeTruthy();
    expect(f.deps.pdf).toHaveBeenCalledTimes(3);
    // 预分页结果不落盘：续做会把 300 段重新测量一遍（见回报，未改）。
    expect(f.deps.measure).toHaveBeenCalledTimes(300);
    assertMonotone(second.seen);
    expect(second.seen.filter(p => p.phase === "render").at(-1)).toMatchObject({ done: 300, total: 300, reused: 297 });
    expect(f.deduct).toHaveBeenCalledTimes(1);
  }, 120_000);

  it("80 章：1 段预分页两轮都失败 → 不打印，进度停在 0/80 并说明测量未完成", async () => {
    const f = book(80);
    const realMeasure = f.deps.measure.getMockImplementation()!;
    f.deps.measure.mockImplementation(async (html: string) => { if (html.includes(own("第40章"))) throw Error("预分页结果无效"); return realMeasure(html); });
    const progress = progressOf();
    const result = await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any, {}, progress.on);
    expect(result.pdfUrl).toBeUndefined();
    expect(f.deps.pdf).not.toHaveBeenCalled();
    assertMonotone(progress.seen);
    expect(progress.seen.some(p => p.label.includes("补测 1 段"))).toBe(true);
    expect(progress.seen.at(-1)).toMatchObject({ phase: "partial", done: 0, total: 80, failed: 1 });
  }, 120_000);

  it("不传进度回调（旧调用方）结果不变；回调抛错不影响导出", async () => {
    const a = book(8), b = book(8);
    const plain = await exportKnowledgePublication(7, a.doc.id, "10", a.deps as any);
    const noisy = await exportKnowledgePublication(7, b.doc.id, "10", b.deps as any, {}, () => { throw Error("显示层出错"); });
    expect(plain.pdfUrl).toBeTruthy(); expect(noisy.pdfUrl).toBeTruthy();
    expect(noisy.totalPages).toBe(plain.totalPages);
    expect(a.deps.pdf).toHaveBeenCalledTimes(8); expect(b.deps.pdf).toHaveBeenCalledTimes(8);
  });
});
