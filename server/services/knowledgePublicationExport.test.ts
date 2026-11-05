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

async function assertSplitRecovery(shiftCounts: boolean) {
 const {writeFile}=await import('node:fs/promises');
 const f=fixture(),pub=f.doc.publication!;
 const first=f.doc.pages[0];f.doc.pages=[{...first,headline:'章一',imageUrl:'gs://test/one.png'},{...first,id:crypto.randomUUID(),headline:'章二',imageUrl:'gs://test/two.png'}];
 pub.source.pages=f.doc.pages.map(({id,headline,body,imageUrl})=>({id,headline,body,imageUrl}));
 pub.review={...pub.review!,sourceDigest:knowledgeSourceDigest(pub.source),pages:f.doc.pages.map(p=>({...pub.review!.pages[0],id:p.id,headline:p.headline,body:p.body,imageStatus:'consistent',imageDescription:'测试原图'}))};
 pub.manuscript=pub.confirmedManuscript=knowledgeManuscript(pub.review);
 const sha='a'.repeat(64);f.deps.review.mockResolvedValue({report:pub.review,sourceImages:pub.source.pages.map(p=>({uri:p.imageUrl,sha256:sha}))} as any);
 f.deps.image.mockResolvedValue({buffer:Buffer.alloc(19*1024*1024),mimeType:'image/png',sha256:sha});
 let shifted=false;
 const measure=vi.fn(async(html:string)=>html.includes('章二')?(shifted?2:3):(shifted?3:2));
 const renders:string[]=[];let failSecond=true;
 f.deps.pdf.mockImplementation(async(html?:string)=>{renders.push(html!);if(html!.includes('data-booklet-page-offset="2"')&&failSecond){failSecond=false;throw Error('第二段测试失败');}return Buffer.from('%PDF'+ 'test-only'.repeat(20));});
 f.deps.merge.mockImplementation(async(_paths?:string[],target?:string)=>{await writeFile(target!,Buffer.from('%PDF'+'merged-test-only'.repeat(20)));});
 const deps={...f.deps,measure};
 const partial=await exportKnowledgePublication(7,f.doc.id,'10',deps as any);
 expect(partial.pdfUrl).toBeUndefined();expect(partial.htmlUrl).toBeTruthy();
 shifted=shiftCounts;
 const complete=await exportKnowledgePublication(7,f.doc.id,'10',deps as any);
 expect(complete.pdfUrl).toBeTruthy();expect(f.deps.pdf).toHaveBeenCalledTimes(shiftCounts?4:3);expect(measure).toHaveBeenCalledTimes(4);
 expect(renders[0]).toContain('data-booklet-page-offset="0" data-booklet-total-pages="5" data-booklet-expected-pages="2"');
 expect(renders[1]).toContain('data-booklet-page-offset="2" data-booklet-total-pages="5" data-booklet-expected-pages="3"');
 if(shiftCounts){
  expect(renders[2]).toContain('data-booklet-page-offset="0" data-booklet-total-pages="5" data-booklet-expected-pages="3"');
  expect(renders[3]).toContain('data-booklet-page-offset="3" data-booklet-total-pages="5" data-booklet-expected-pages="2"');
 }else expect(renders[2]).toBe(renders[1]);
 expect(Array.from(f.storage.keys()).filter(k=>k.endsWith('/0-0-2-5.pdf'))).toHaveLength(1);
}
it('大手册分段使用全书页码，失败恢复只补缺失段',()=>assertSplitRecovery(false));
it('部分恢复总页数相同但分段页数变化时不复用旧分段',()=>assertSplitRecovery(true));
