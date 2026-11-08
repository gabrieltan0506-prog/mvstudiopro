import {settleKnowledgeInterior} from "./knowledgePublicationBilling";
import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { layoutFromSource } from "../../shared/editableLayout";
import { knowledgeManuscript } from "../../shared/knowledgePublication";
import { knowledgeSourceDigest } from "./knowledgePublicationAdvisor";
import { exportKnowledgePublication, loadKnowledgePublicationExport } from "./knowledgePublicationExport";
function fixture() {
  const doc = layoutFromSource({
    kind: "knowledge-publication",
    owner: "7",
    sourceId: "real-test",
    title: "水循环",
    body: "水蒸发后形成水汽，凝结形成云。",
  });
  const pub = doc.publication!;
  pub.billing!.confirmed=true;
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
  const deduct=vi.fn(async (_owner:number,cost:number)=>({success:true,cost,remainingBalance:100,source:"personal" as const}));
  const deps = {
    settle: (owner:number,doc:any,total:number,images:number)=>settleKnowledgeInterior(owner,doc,total,images,deduct),
    load: vi.fn(async () => ({
      library: { version: 1 as const, owner: "7", documents: [doc] },
      generation: "10",
      updatedAt: "2026-11-07T00:00:00+08:00",
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
    savePages: vi.fn(async(bytes:Buffer,save:(i:number,b:Buffer)=>Promise<void>)=>{await save(0,bytes);}),
    countPages: vi.fn(async () => 7),
  };
  return { doc, deps, storage, deduct };
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
    expect(result.totalPages).toBe(7);
    expect(result.billing).toMatchObject({readingPages:7,unitCredits:8,chargedCredits:56});
    expect(result.imagePages).toBe(0);
    const html = Array.from(f.storage.entries())
      .find(([k]) => k.endsWith("阅读稿.html"))![1]
      .toString();
    expect(html).toContain("凝结形成云");
    await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any);
    expect(f.deps.pdf).toHaveBeenCalledTimes(1);
    expect(f.deps.countPages).toHaveBeenCalledTimes(1);
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
    expect(f.deduct).not.toHaveBeenCalled();
    expect(partial.totalPages).toBeUndefined();
    expect(partial.imagePages).toBeUndefined();
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

it('任一分段计页失败时先保留HTML，全部计页成功后才打印正确全册页码',async()=>{
 const {writeFile}=await import('node:fs/promises');
 const f=fixture(),pub=f.doc.publication!;
 const first=f.doc.pages[0];
 f.doc.pages=[{...first,headline:'第一章'},{...first,id:crypto.randomUUID(),headline:'第二章'}];
 pub.source.pages=f.doc.pages.map(({id,headline,body,imageUrl})=>({id,headline,body,imageUrl}));
 pub.review={...pub.review!,sourceDigest:knowledgeSourceDigest(pub.source),pages:f.doc.pages.map(p=>({...pub.review!.pages[0],id:p.id,headline:p.headline,body:p.body}))};
 pub.manuscript=pub.confirmedManuscript=knowledgeManuscript(pub.review);
 f.deps.review.mockResolvedValue({report:pub.review,sourceImages:[]});
 // 各段并发计页：按内容返回（真实计页即按内容），第二章首次失败一次。
 let secondFails=true;
 const measure=vi.fn(async(html:string)=>{if(html.includes('第二章')){if(secondFails){secondFails=false;throw Error('第二章计页暂时失败');}return 3;}return 2;});
 f.deps.merge.mockImplementation(async(_paths?:string[],target?:string)=>{await writeFile(target!,Buffer.from('%PDF'+'merged-test-only'.repeat(20)));});
 f.deps.countPages.mockResolvedValue(5);
 const partial=await exportKnowledgePublication(7,f.doc.id,'10',{...f.deps,measure} as any);
 expect(partial.htmlUrl).toBeTruthy();expect(partial.pdfUrl).toBeUndefined();
 expect(partial.pdfError).toContain('未完成');
 expect(f.deps.pdf).not.toHaveBeenCalled();expect(f.deduct).not.toHaveBeenCalled();
 expect(Array.from(f.storage.keys()).some(k=>k.includes('/pdf-parts/'))).toBe(false);
 const complete=await exportKnowledgePublication(7,f.doc.id,'10',{...f.deps,measure} as any);
 expect(complete.totalPages).toBe(5);expect(complete.pdfUrl).toBeTruthy();
 const renders=f.deps.pdf.mock.calls as unknown as [string][];
 expect(renders).toHaveLength(2);
 // 各段并发渲染，调用顺序不定；按段内容核对页码偏移。
 expect(renders.find(([h])=>h.includes('第一章'))![0]).toContain('data-booklet-page-offset="0" data-booklet-total-pages="5" data-booklet-expected-pages="2"');
 expect(renders.find(([h])=>h.includes('第二章'))![0]).toContain('data-booklet-page-offset="2" data-booklet-total-pages="5" data-booklet-expected-pages="3"');
 expect(complete.billing?.readingPages).toBe(5);
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
 expect(complete.imagePages).toBe(2);expect(complete.totalPages).toBe(7);
 expect(complete.pdfUrl).toBeTruthy();expect(f.deps.pdf).toHaveBeenCalledTimes(shiftCounts?4:3);expect(measure).toHaveBeenCalledTimes(4);
 // 第一轮两段并发渲染（顺序不定），第二段失败；续跑只补失败段，成功段复用缓存。
 const firstRound=renders.slice(0,2);
 expect(firstRound.find(h=>h.includes('章一'))!.includes('data-booklet-page-offset="0" data-booklet-total-pages="5" data-booklet-expected-pages="2"')).toBe(true);
 expect(firstRound.find(h=>h.includes('章二'))!.includes('data-booklet-page-offset="2" data-booklet-total-pages="5" data-booklet-expected-pages="3"')).toBe(true);
 if(shiftCounts){
  const second=renders.slice(2);
  // 分段页数变化：章一改为3页、章二2页，两段都按新偏移重渲（不复用旧分段）。断言只比布尔，避免巨型HTML差异输出。
  expect(second).toHaveLength(2);
  expect(second.find(h=>h.includes('章一'))!.includes('data-booklet-page-offset="0" data-booklet-total-pages="5" data-booklet-expected-pages="3"')).toBe(true);
  expect(second.find(h=>h.includes('章二'))!.includes('data-booklet-page-offset="3" data-booklet-total-pages="5" data-booklet-expected-pages="2"')).toBe(true);
 }else expect(renders[2]).toBe(firstRound.find(h=>h.includes('章二')));
 expect(Array.from(f.storage.keys()).filter(k=>k.endsWith('/0-0-2-5.pdf'))).toHaveLength(1);
}
it('大手册分段使用全书页码，失败恢复只补缺失段',()=>assertSplitRecovery(false));
it('部分恢复总页数相同但分段页数变化时不复用旧分段',()=>assertSplitRecovery(true));

 it("旧PDF补读实际页数并保存，恢复不重新生成", async () => {
   const f = fixture();
   await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any);
   const key = Array.from(f.storage.keys()).find(key => key.endsWith("/manifest.json"))!;
   const manifest = JSON.parse(f.storage.get(key)!.toString());
   delete manifest.totalPages; delete manifest.imagePages;
   f.storage.set(key, Buffer.from(JSON.stringify(manifest)));
   f.deps.countPages.mockResolvedValueOnce(9);
   const recovered = await exportKnowledgePublication(7, f.doc.id, "10", f.deps as any);
   expect(recovered.totalPages).toBe(9);
   expect(f.deps.pdf).toHaveBeenCalledTimes(1);
   expect(JSON.parse(f.storage.get(key)!.toString()).totalPages).toBe(9);
 });

 it("从实际PDF读取总页数，不把章节数当页数", async () => {
   const f = fixture();
   const objects = [
     "<< /Type /Catalog /Pages 2 0 R >>",
     "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R] /Count 4 >>",
     ...Array.from({ length: 4 }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>"),
   ];
   let pdf = "%PDF-1.4\n";
   const offsets = [0];
   objects.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
   const xref = Buffer.byteLength(pdf);
   pdf += `xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
   f.deps.pdf.mockResolvedValue(Buffer.from(pdf));
   const { countPages: _unused, ...deps } = f.deps;
   const result = await exportKnowledgePublication(7, f.doc.id, "10", deps as any);
   expect(result.chapters).toBe(1);
   expect(result.totalPages).toBe(4);
   expect(result.imagePages).toBe(0);
 });

it("补充稿分别验真后才合册，保留两册正文并拒绝未确认、错归属及递归",async()=>{
 const parent=fixture(),extra=fixture();extra.doc.id="00000000-0000-4000-8000-000000000099";
 const ep=extra.doc.publication!;extra.doc.pages[0].id="00000000-0000-4000-8000-000000000098";ep.source.pages[0].id=extra.doc.pages[0].id;ep.review!.pages[0].id=extra.doc.pages[0].id;
 // 使用一张有明确SHA的测试图片；图片源读取和供应商不在此离线用例中。
 const uri="gs://test-bucket/supplement.png";extra.doc.pages[0].imageUrl=uri;ep.source.pages[0].imageUrl=uri;
 ep.review!.pages[0].imageStatus="consistent";ep.review!.pages[0].imageDescription="已读取的蒸发与凝结对照测试图片";ep.review!.sourceDigest=knowledgeSourceDigest(ep.source);ep.manuscript=knowledgeManuscript(ep.review!);ep.confirmedManuscript=ep.manuscript;
 ep.supplementOf={documentId:parent.doc.id,conversationId:"00000000-0000-4000-8000-000000000097",indexes:[0]};ep.synchronizedStarted=true;parent.doc.publication!.supplementDocumentId=extra.doc.id;
 const sourceImages=[{id:extra.doc.pages[0].id,uri,sha256:"a".repeat(64),mimeType:"image/png",width:10,height:10}];
 const deps={...parent.deps,load:async()=>({library:{version:1 as const,owner:"7",documents:[parent.doc,extra.doc]},generation:"10",updatedAt:parent.doc.updatedAt}),review:async(_owner:number,id:string)=>id===parent.doc.id?{report:parent.doc.publication!.review!,sourceImages:[]}:{report:ep.review!,sourceImages}};
 const result=await loadKnowledgePublicationExport(7,parent.doc.id,"10",deps,true);
 expect(result.doc.pages.map(p=>p.id)).toEqual([parent.doc.pages[0].id,extra.doc.pages[0].id]);expect(result.review.pages).toHaveLength(2);expect(result.receipt.sourceImages).toHaveLength(1);
 expect((await loadKnowledgePublicationExport(7,parent.doc.id,"10",deps)).doc.pages).toHaveLength(1);
 ep.confirmedManuscript=undefined;await expect(loadKnowledgePublicationExport(7,parent.doc.id,"10",deps,true)).rejects.toThrow("确认");ep.confirmedManuscript=ep.manuscript;ep.supplementDocumentId=parent.doc.id;await expect(loadKnowledgePublicationExport(7,parent.doc.id,"10",deps,true)).rejects.toThrow("归属");
});

it('扣费回包丢失后复用已存PDF和同一账本键，不再渲染或重复扣款',async()=>{
 const f=fixture(),charges=new Map<string,number>();let lose=true;
 const deduct=vi.fn(async(_owner:number,cost:number,_action:string,_description?:string,options?:{chargeKey?:string})=>{
  const key=options!.chargeKey!;
  if(charges.has(key))return {success:true,cost:charges.get(key)!,source:'personal' as const,remainingBalance:0,alreadyCharged:true};
  charges.set(key,cost);if(lose){lose=false;throw Error('模拟扣款成功后回包丢失');}
  return {success:true,cost,source:'personal' as const,remainingBalance:0};
 });
 f.deps.settle=(owner,doc,total,images)=>settleKnowledgeInterior(owner,doc,total,images,deduct);
 await expect(exportKnowledgePublication(7,f.doc.id,'10',f.deps)).rejects.toThrow('回包丢失');
 const result=await exportKnowledgePublication(7,f.doc.id,'10',f.deps);
 expect(result.billing).toMatchObject({chargedCredits:56,alreadyCharged:true});expect(result.pdfUrl).toBeTruthy();
 expect(charges.size).toBe(1);expect(f.deps.pdf).toHaveBeenCalledTimes(1);expect(f.deps.countPages).toHaveBeenCalledTimes(1);
});
it('新稿未确认费率不能渲染收费；旧稿恢复下载不追溯扣款',async()=>{
 const f=fixture();f.doc.publication!.billing!.confirmed=false;
 await expect(exportKnowledgePublication(7,f.doc.id,'10',f.deps)).rejects.toThrow('确认内文');expect(f.deps.pdf).not.toHaveBeenCalled();expect(f.deduct).not.toHaveBeenCalled();
 delete f.doc.publication!.billing;
 expect((await exportKnowledgePublication(7,f.doc.id,'10',f.deps)).pdfUrl).toBeTruthy();expect(f.deduct).not.toHaveBeenCalled();
});
