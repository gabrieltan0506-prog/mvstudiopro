import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { layoutFromSource } from "../../shared/editableLayout";
import { knowledgeManuscript } from "../../shared/knowledgePublication";
import { knowledgeSourceDigest } from "./knowledgePublicationAdvisor";
import { exportKnowledgePublication } from "./knowledgePublicationExport";
function fixture() {
  const doc = layoutFromSource({
    kind: "knowledge-publication",
    owner: "7",
    sourceId: "real-test",
    title: "水循环",
    body: "水蒸发后形成水汽，凝结形成云。",
  });
  const pub = doc.publication!;
  pub.review = {
    kind: "knowledge_publication_v1",
    title: doc.title,
    sourceDigest: knowledgeSourceDigest(pub.source),
    pages: doc.pages.map(p => ({
      id: p.id,
      headline: p.headline,
      body: p.body,
      imageDescription: "",
      imageStatus: "absent",
      facts: [{ term: "知识要点", statement: "测试中的具体知识主张" }],
      cautions: [],
    })),
  };
  pub.manuscript = knowledgeManuscript(pub.review);
  pub.confirmedManuscript = pub.manuscript;
  const storage = new Map<string, Buffer>();
  const deps = {
    load: vi.fn(async () => ({
      library: { version: 1 as const, owner: "7", documents: [doc] },
      generation: "10",
      updatedAt: null,
    })),
    review: vi.fn(async () => ({ report: pub.review, sourceImages: [] })),
    image: vi.fn(),
    read: vi.fn(async (name: string) => storage.get(name) || null),
    save: vi.fn(async (name: string, buffer: Buffer) => {
      storage.set(name, buffer);
    }),
    file: vi.fn(async (name: string, path: string) => {
      const data = await readFile(path);
      storage.set(name, data);
      return data.length;
    }),
    sign: (name: string) => `https://test.invalid/${name}`,
    pdf: vi.fn(async () => Buffer.from("%PDF" + "test-only".repeat(20))),
    merge: vi.fn(),
  };
  return { doc, deps, storage };
}
describe("出版确认版本与恢复", () => {
  it("同一确认稿导出成功后复用永久成品，不再提交PDF", async () => {
    const f = fixture();
    const result = await exportKnowledgePublication(
      7,
      f.doc.id,
      "10",
      f.deps as any
    );
    expect(result.pdfUrl).toBeTruthy();
    expect(result.chapters).toBe(1);
    const html = Array.from(f.storage.entries())
      .find(([k]) => k.endsWith("阅读稿.html"))![1]
      .toString();
    expect(html).toContain("凝结形成云");
    await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any);
    expect(f.deps.pdf).toHaveBeenCalledTimes(1);
  });
  it("版本冲突、手改未确认、审校伪造均在PDF之前拒绝", async () => {
    const f = fixture();
    await expect(
      exportKnowledgePublication(7, f.doc.id, "9", f.deps as any)
    ).rejects.toThrow("版本");
    f.doc.publication!.manuscript += "新内容";
    await expect(
      exportKnowledgePublication(7, f.doc.id, "10", f.deps as any)
    ).rejects.toThrow("确认");
    f.doc.publication!.manuscript = f.doc.publication!.confirmedManuscript!;
    f.deps.review.mockResolvedValueOnce({
      report: { ...f.doc.publication!.review!, title: "伪造标题" },
      sourceImages: [],
    });
    await expect(
      exportKnowledgePublication(7, f.doc.id, "10", f.deps as any)
    ).rejects.toThrow("回执不一致");
    expect(f.deps.pdf).not.toHaveBeenCalled();
  });
  it("PDF失败保留HTML及确认稿，恢复只补缺失结果", async () => {
    const f = fixture();
    f.deps.pdf.mockRejectedValueOnce(new Error("测试worker不可用"));
    const partial = await exportKnowledgePublication(
      7,
      f.doc.id,
      "10",
      f.deps as any
    );
    expect(partial.htmlUrl).toBeTruthy();
    expect(partial.pdfUrl).toBeUndefined();
    expect(partial.pdfError).toContain("未完成");
    const recovered = await exportKnowledgePublication(
      7,
      f.doc.id,
      "10",
      f.deps as any
    );
    expect(recovered.pdfUrl).toBeTruthy();
    expect(f.doc.publication!.confirmedManuscript).toBe(
      f.doc.publication!.manuscript
    );
  });
});

it('切换模板后预览与PDF输入一致，并且不复用旧模板成品',async()=>{
 const {buildKnowledgePublicationHtml}=await import('../../shared/knowledgePublicationHtml');
 const f=fixture();
 f.doc.publication!.infographicTemplateId='fusion_ink_mountains';
 const first=await exportKnowledgePublication(7,f.doc.id,'10',f.deps as any);
 expect((f.deps.pdf.mock.calls[0] as unknown as [string])[0]).toBe(buildKnowledgePublicationHtml(f.doc,f.doc.publication!.review!,{}));
 f.doc.publication!.infographicTemplateId='fusion_maple_bridge';
 const second=await exportKnowledgePublication(7,f.doc.id,'10',f.deps as any);
 expect(second.pdfUrl).not.toBe(first.pdfUrl);expect(f.deps.pdf).toHaveBeenCalledTimes(2);
 expect((f.deps.pdf.mock.calls[1] as unknown as [string])[0]).toBe(buildKnowledgePublicationHtml(f.doc,f.doc.publication!.review!,{}));
});
