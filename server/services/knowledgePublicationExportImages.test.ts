// 1119 E1：导出不再为核对指纹重下 4K 原图——按审校/上次导出记下的版本指纹比对元数据；任何不符都回到原下载路径。
import { describe, it, expect, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { settleKnowledgeInterior } from "./knowledgePublicationBilling";
import { layoutFromSource } from "../../shared/editableLayout";
import { knowledgeManuscript } from "../../shared/knowledgePublication";
import { knowledgeImageFingerprintName, knowledgeSourceDigest } from "./knowledgePublicationAdvisor";
import { exportKnowledgePublication } from "./knowledgePublicationExport";

const SHA = "a".repeat(64);
const BIG = 19 * 1024 * 1024; // 两张 19MB 原图：按「正文 + 原图体积」计重会分成两卷——体积来源变了就会改变分卷。

function fixture() {
  const doc = layoutFromSource({ kind: "knowledge-publication", owner: "7", sourceId: "fp-test", title: "水循环", body: "水蒸发后形成水汽，凝结形成云。" });
  const pub = doc.publication!;
  pub.billing!.confirmed = true;
  const first = doc.pages[0]!;
  doc.pages = [{ ...first, headline: "章一", imageUrl: "gs://test/one.png" }, { ...first, id: crypto.randomUUID(), headline: "章二", imageUrl: "gs://test/two.png" }];
  pub.source.pages = doc.pages.map(({ id, headline, body, imageUrl }) => ({ id, headline, body, imageUrl }));
  pub.review = { kind: "knowledge_publication_v1", title: doc.title, sourceDigest: knowledgeSourceDigest(pub.source),
    pages: doc.pages.map(p => ({ id: p.id, headline: p.headline, body: p.body, imageDescription: "测试原图", imageStatus: "consistent", facts: [{ term: "知识要点", statement: "测试中的具体知识主张" }], cautions: [] })) } as any;
  pub.manuscript = pub.confirmedManuscript = knowledgeManuscript(pub.review!);
  const storage = new Map<string, Buffer>();
  const fingerprints = new Map<string, unknown>();
  const versions = new Map<string, { generation: string; crc32c?: string; byteLength?: number }>([
    ["gs://test/one.png", { generation: "101", crc32c: "c1==", byteLength: BIG }],
    ["gs://test/two.png", { generation: "202", crc32c: "c2==", byteLength: BIG }],
  ]);
  const deduct = vi.fn(async (_o: number, cost: number) => ({ success: true, cost, remainingBalance: 100, source: "personal" as const }));
  const deps = {
    settle: (owner: number, d: any, total: number, images: number) => settleKnowledgeInterior(owner, d, total, images, deduct),
    load: vi.fn(async () => ({ library: { version: 1 as const, owner: "7", documents: [doc] }, generation: "10", updatedAt: "2026-11-19T00:00:00+08:00" })),
    review: vi.fn(async () => ({ report: pub.review, sourceImages: pub.source.pages.map(p => ({ uri: p.imageUrl, sha256: SHA })) })),
    // 下载路径：锁版本读到的图带回 generation / crc32c / 字节数（与真实 readKnowledgeImage 同形）。
    image: vi.fn(async (uri: string) => ({ buffer: Buffer.alloc(BIG), mimeType: "image/png", width: 10, height: 10, sha256: SHA, ...versions.get(uri) })),
    imageVersion: vi.fn(async (uri: string) => versions.get(uri)!),
    imageFingerprint: vi.fn(async (uri: string, generation: string) => fingerprints.get(knowledgeImageFingerprintName(uri, generation)) ?? null),
    recordImage: vi.fn(async (uri: string, image: any) => {
      const name = knowledgeImageFingerprintName(uri, image.generation);
      if (!fingerprints.has(name)) fingerprints.set(name, { kind: "knowledge_image_fingerprint_v1", uri, generation: image.generation, crc32c: image.crc32c, byteLength: image.byteLength, sha256: image.sha256, recordedAt: "t" });
      return true;
    }),
    imageUrl: async (uri: string) => `https://test.invalid/signed/${encodeURIComponent(uri)}`,
    read: vi.fn(async (name: string) => storage.get(name) || null),
    save: vi.fn(async (name: string, buffer: Buffer) => { storage.set(name, buffer); }),
    file: vi.fn(async (name: string, path: string) => { const data = await readFile(path); storage.set(name, data); return data.length; }),
    sign: (name: string) => `https://test.invalid/${name}`,
    measure: vi.fn(async (html: string) => html.includes('data-source-headline="章二"') ? 3 : 2),
    pdf: vi.fn(async (_html: string) => Buffer.from("%PDF" + "test-only".repeat(20))),
    merge: vi.fn(async (_p: string[], target: string) => { await writeFile(target, Buffer.from("%PDF" + "merged-test-only".repeat(20))); }),
    countPages: vi.fn(async () => 5),
  };
  const seed = () => { for (const uri of versions.keys()) { const v = versions.get(uri)!; fingerprints.set(knowledgeImageFingerprintName(uri, v.generation), { kind: "knowledge_image_fingerprint_v1", uri, generation: v.generation, crc32c: v.crc32c, byteLength: v.byteLength, sha256: SHA, recordedAt: "review" }); } };
  return { doc, deps, storage, fingerprints, versions, seed };
}
const renders = (f: ReturnType<typeof fixture>) => (f.deps.pdf.mock.calls as unknown as [string][]).map(([h]) => h).sort();
const html = (f: ReturnType<typeof fixture>) => Array.from(f.storage.entries()).find(([k]) => k.endsWith("阅读稿.html"))![1].toString("utf8");

describe("导出配图核对：元数据比对代替重下原图", () => {
  it("指纹与当前版本一致：零下载，成品 HTML、分卷与每卷渲染输入与下载路径逐字相同", async () => {
    const f = fixture();
    // 第一次：无指纹 → 下载核对（并补记指纹）。
    const a = await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any);
    expect(f.deps.image).toHaveBeenCalledTimes(2);
    const htmlA = html(f), rendersA = renders(f), measuresA = f.deps.measure.mock.calls.length;
    // 清掉成品（模拟另一稿件身份/重新导出全流程），保留指纹；第二次全程只比对元数据。
    f.storage.clear(); f.deps.image.mockClear(); f.deps.pdf.mockClear(); f.deps.measure.mockClear();
    const b = await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any);
    expect(f.deps.image).not.toHaveBeenCalled();
    expect(b.totalPages).toBe(a.totalPages);
    expect(html(f)).toBe(htmlA);
    expect(renders(f)).toEqual(rendersA);
    expect(rendersA).toHaveLength(2); // 两张 19MB 图仍分两卷：体积取自指纹记录，与下载字节数相同。
    expect(f.deps.measure.mock.calls.length).toBe(measuresA);
  });

  it("旧回执（没有指纹）：走原下载核对路径，下载后补记指纹；记下的指纹与下载所得一致", async () => {
    const f = fixture();
    await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any);
    expect(f.deps.image).toHaveBeenCalledTimes(2);
    expect(f.deps.recordImage).toHaveBeenCalledTimes(2);
    expect(f.fingerprints.get(knowledgeImageFingerprintName("gs://test/one.png", "101"))).toMatchObject({ sha256: SHA, byteLength: BIG, crc32c: "c1==" });
  });

  it.each([
    ["generation 已换（图被重写）", (f: ReturnType<typeof fixture>) => { f.versions.set("gs://test/one.png", { generation: "999", crc32c: "c1==", byteLength: BIG }); }],
    ["crc32c 不符", (f: ReturnType<typeof fixture>) => { f.versions.set("gs://test/one.png", { generation: "101", crc32c: "zz==", byteLength: BIG }); }],
    ["字节数不符", (f: ReturnType<typeof fixture>) => { f.versions.set("gs://test/one.png", { generation: "101", crc32c: "c1==", byteLength: BIG - 1 }); }],
    ["指纹 sha256 与审校回执不符", (f: ReturnType<typeof fixture>) => { const n = knowledgeImageFingerprintName("gs://test/one.png", "101"); f.fingerprints.set(n, { ...(f.fingerprints.get(n) as any), sha256: "b".repeat(64) }); }],
    ["指纹记录损坏", (f: ReturnType<typeof fixture>) => { f.fingerprints.set(knowledgeImageFingerprintName("gs://test/one.png", "101"), { kind: "knowledge_image_fingerprint_v1", uri: "gs://test/one.png" }); }],
    ["取元数据出错（网络）", (f: ReturnType<typeof fixture>) => { f.deps.imageVersion.mockImplementation(async (uri: string) => { if (uri.endsWith("one.png")) throw Error("fetch failed"); return f.versions.get(uri)!; }); }],
    ["读指纹出错", (f: ReturnType<typeof fixture>) => { f.deps.imageFingerprint.mockImplementation(async (uri: string, g: string) => { if (uri.endsWith("one.png")) throw Error("gcs_download_failed:503"); return f.fingerprints.get(knowledgeImageFingerprintName(uri, g)) ?? null; }); }],
  ])("元数据不能确认（%s）：只这张图回到下载核对路径", async (_label, mutate) => {
    const f = fixture(); f.seed();
    if (_label === "generation 已换（图被重写）") f.deps.image.mockImplementation(async (uri: string) => ({ buffer: Buffer.alloc(BIG), mimeType: "image/png", width: 10, height: 10, sha256: SHA, ...f.versions.get(uri) }));
    mutate(f);
    const result = await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any);
    expect(f.deps.image.mock.calls.map(c => c[0])).toEqual(["gs://test/one.png"]);
    expect(result.pdfUrl).toBeTruthy();
  });

  it("图真的变了：元数据不符 → 下载 → 指纹与审校回执不同，照旧拒绝导出，不渲染", async () => {
    const f = fixture(); f.seed();
    f.versions.set("gs://test/two.png", { generation: "303", crc32c: "c3==", byteLength: BIG });
    f.deps.image.mockImplementation(async (uri: string) => ({ buffer: Buffer.alloc(BIG), mimeType: "image/png", width: 10, height: 10, sha256: uri.endsWith("two.png") ? "c".repeat(64) : SHA, ...f.versions.get(uri) }));
    await expect(exportKnowledgePublication(7, f.doc.id, "10", f.deps as any)).rejects.toThrow("第2页配图已变化");
    expect(f.deps.pdf).not.toHaveBeenCalled();
  });

  it("补记指纹失败不影响导出", async () => {
    const f = fixture();
    f.deps.recordImage.mockRejectedValue(Error("ENOSPC"));
    const result = await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any);
    expect(result.pdfUrl).toBeTruthy();
  });

  it("只注入读图、未注入元数据读取（旧调用方）：不走元数据路径，也不补记", async () => {
    const f = fixture(); f.seed();
    const { imageVersion: _v, imageFingerprint: _f, recordImage: _r, ...legacy } = f.deps;
    await exportKnowledgePublication(7, f.doc.id, "10", legacy as any);
    expect(f.deps.image).toHaveBeenCalledTimes(2);
    expect(f.deps.imageVersion).not.toHaveBeenCalled();
    expect(f.deps.recordImage).not.toHaveBeenCalled();
  });
});

describe("E2：停写无人读取的逐章 HTML 与逐页 PDF（站长 1120 定）", () => {
  it("导出不再写 source-pages/ 与逐页 PDF；续做所需的 pdf-parts 分片与 manifest 仍写", async () => {
    const f = fixture();
    await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any);
    const keys = Array.from(f.storage.keys());
    expect(keys.some(k => k.includes("/source-pages/"))).toBe(false);
    expect(keys.some(k => k.includes(".pdf.pages/"))).toBe(false);
    expect(keys.filter(k => k.includes("/pdf-parts/"))).toHaveLength(2);
    expect(keys.some(k => k.endsWith("/manifest.json"))).toBe(true);
  });
});
