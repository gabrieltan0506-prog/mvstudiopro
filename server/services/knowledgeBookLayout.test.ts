import { it, expect, vi } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import puppeteer from "puppeteer";
import PDFDocument from "pdfkit";
import { createHash, randomUUID } from "node:crypto";
import { layoutFromSource, type LayoutLibrary } from "../../shared/editableLayout";
import { knowledgeManuscript } from "../../shared/knowledgePublication";
import { validateKnowledgeBookLayoutPlan, type KnowledgeBookLayoutPlan } from "../../shared/knowledgeBookLayout";
import { knowledgeSourceDigest } from "./knowledgePublicationAdvisor";
import { reviewKnowledgeConversation, validateKnowledgeConversationTransition } from "./knowledgeConversationAdvisor";
import { invokeKnowledgePublicationRoutes } from "./knowledgePublicationRoutes";
import { exportKnowledgePublication } from "./knowledgePublicationExport";
import { loadKnowledgeBookLayoutInput, loadKnowledgeBookLayoutView, validateKnowledgeBookLayoutTransition } from "./knowledgeBookLayout";
import { buildKnowledgePublicationHtml } from "../../shared/knowledgePublicationHtml";

// 本组非视觉用例使用有效测试PDF，仍经过正式pdfseparate/pdfunite，不能用伪PDF字节跳过分片合同。
const fixturePageCount = (html:string) => html.includes('<figure class="main-card">') ? 2 : 1;
const fixturePdf = (html:string) => new Promise<Buffer>((resolve,reject)=>{
  const pdf=new PDFDocument({autoFirstPage:false}),chunks:Buffer[]=[];
  pdf.on("data",chunk=>chunks.push(Buffer.from(chunk)));pdf.on("error",reject);
  pdf.on("end",()=>resolve(Buffer.concat(chunks)));
  for(let i=0;i<fixturePageCount(html);i++){pdf.addPage();pdf.text("test-only PDF fixture");}
  pdf.end();
});
const countPdfPages=async(path:string)=>Number(/^Pages:\s+(\d+)/m.exec((await promisify(execFile)('pdfinfo',[path])).stdout)?.[1]);

function fixture() {
  const parent=layoutFromSource({kind:"knowledge-publication",owner:"7",sourceId:"layout-test",title:"历史章节",body:"",pages:[
    {pageIndex:1,headline:"周本纪正文",body:"周本纪完整正文。末句一必须保留。"},
    {pageIndex:2,headline:"春秋诸侯正文",body:"诸侯关系完整正文。末句二必须保留。"},
    {pageIndex:3,headline:"秦汉制度图",body:"制度图的完整文字说明。末句三必须保留。"},
  ],images:{3:"gs://test/old.png"}});
  const child=layoutFromSource({kind:"knowledge-publication",owner:"7",sourceId:"layout-extra",title:"补充图",body:"战争图的完整文字说明。末句四必须保留。",images:{1:"gs://test/extra.png"}});
  const image=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64"),sha=createHash("sha256").update(image).digest("hex");
  for(const doc of [parent,child]) {
    const pub=doc.publication!;
    delete pub.billing; // 此组验证历史稿的内容与排版回执，不执行计费。
    pub.review={kind:"knowledge_publication_v1",title:doc.title,sourceDigest:knowledgeSourceDigest(pub.source),pages:doc.pages.map(p=>({id:p.id,headline:p.headline,body:p.body,imageStatus:p.imageUrl?"consistent":"absent",imageDescription:p.imageUrl?"已验测试原图":"",facts:[{term:p.headline,statement:p.body}],cautions:[]}))};
    pub.manuscript=knowledgeManuscript(pub.review);
    // 新布局动作绑定当前完整稿，不能要求用户先导出补充稿才能规划。
    pub.confirmedManuscript=undefined;
  }
  child.publication!.supplementOf={documentId:parent.id,conversationId:randomUUID(),indexes:[0]};
  child.publication!.synchronizedStarted=true;
  parent.publication!.supplementDocumentId=child.id;
  const library:LayoutLibrary={version:1,owner:"7",documents:[parent,child]};
  const objects=new Map<string,Buffer>(),models=new Map<string,any>();
  const deps={
    load:async()=>({library:structuredClone(library),generation:"10",updatedAt:new Date().toISOString()}),
    review:async(_owner:number,id:string)=>{
      const doc=library.documents.find(d=>d.id===id)!;
      return {report:structuredClone(doc.publication!.review!),sourceImages:doc.pages.filter(p=>p.imageUrl).map(p=>({id:p.id,uri:p.imageUrl,sha256:sha,mimeType:"image/png",width:1,height:1}))};
    },
    image:vi.fn(async()=>({buffer:image,sha256:sha,mimeType:"image/png",width:1,height:1})),
    layoutReport:async(_owner:number,doc:string,id:string)=>structuredClone(models.get(`knowledge-publications/user-7/${doc}/conversation/${id}/report.json`)),
    read:async(name:string)=>objects.get(name)||null,
    save:async(name:string,data:Buffer)=>{objects.set(name,data);},
    file:async(name:string,path:string)=>{const bytes=await readFile(path);objects.set(name,bytes);return bytes.length;},
    sign:(name:string)=>`https://example.invalid/${name}`,
    measure:async(html:string)=>fixturePageCount(html),
    pdf:vi.fn(fixturePdf),
    countPages:countPdfPages,
  };
  const order=[parent.pages[0].id,parent.pages[1].id,child.pages[0].id,parent.pages[2].id];
  const makePlan=(sourceDigest:string):KnowledgeBookLayoutPlan=>({kind:"knowledge_book_layout_v1",sourceDigest,chapters:order.map((pageId,i)=>({pageId,design:{palette:i===1?"jade-paper":"ink-cinnabar",layout:i===1?"narrative":"editorial",table:i===2?"bands":"rules",frame:"none",motif:(["bamboo-seal","relation-lines","route-array","bronze-geometric"] as const)[i],reason:"依据本章具体内容组织层次，保持完整正文可读。"}}))});
  return {parent,child,library,objects,models,deps,order,makePlan};
}
async function planned(presentation?: "full" | "concise") {
  const f=fixture();
  if(presentation) {
    const pub=f.parent.publication!,duplicate="周本纪年代细节原图重复说明",unique="末句一必须保留";
    pub.source.detailLevel=presentation;
    const originalBody=duplicate+"。"+unique+"。";
    f.parent.pages[0].body=originalBody;pub.source.pages[0].body=originalBody;pub.review!.pages[0].body=originalBody;
    pub.review!.pages[0].facts=[{term:"年代",statement:duplicate},{term:"限定",statement:unique}];
    pub.review!.pages[2].imageDescription=duplicate+"。已验测试原图";
    pub.review!.sourceDigest=knowledgeSourceDigest(pub.source);pub.manuscript=knowledgeManuscript(pub.review!);
    const originalPlan=f.makePlan;
    f.makePlan=digest=>{
      const plan=originalPlan(digest),imagePageId=f.parent.pages[2].id;
      plan.chapters[0].presentation={reading:{version:1,subtitle:"",accent:"jade",blocks:[{type:"prose",title:"读图与补充",note:"",text:presentation==="full"?unique+"。制度结构参见秦汉制度图；本文保留图中未说明的适用边界。":duplicate+"。"+unique+"。完整解释制度关系、背景与适用边界；少量图卡之外的知识保留文字说明。"}]},imageEvidencePageIds:presentation==="full"?[imagePageId]:[],reason:"制度结构由已审校原图承载，文字说明其适用边界。"};
      return plan;
    };
  }
  const before=structuredClone(f.library),input=await loadKnowledgeBookLayoutInput(7,f.parent.id,f.deps);
  const id=randomUUID(),request={id,question:"请重新排版完整手册",imagePageIds:[],manuscript:f.parent.publication!.manuscript,action:"layout" as const,layoutSourceDigest:input.sourceDigest};
  f.parent.publication!.conversation=[{request}];
  await validateKnowledgeBookLayoutTransition(7,before,f.library,f.deps);
  const context={documentId:f.parent.id,purpose:"conversation" as const,batchIndex:0,attempt:0};
  const fetch=vi.fn(async(_url:any,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    expect(body.messages[1].content[0].text).toContain("末句四必须保留");
    expect(body.tools).toBeUndefined();
    return new Response(JSON.stringify({model:body.model,choices:[{finish_reason:"stop",message:{content:JSON.stringify({kind:"knowledge_conversation_v1",requestId:id,answer:"补充战争图放在春秋诸侯正文后，秦汉制度之前。",sources:[],supplementalImages:[],layoutPlan:f.makePlan(input.sourceDigest)})}}]}),{status:200});
  });
  const read=async(key:string)=>structuredClone(f.models.get(key)),save=async(key:string,value:any)=>{f.models.set(key,structuredClone(value));};
  const run=()=>reviewKnowledgeConversation(7,context,{load:async()=>structuredClone(f.parent) as any,book:async()=>input,read,save,post:(r,e)=>invokeKnowledgePublicationRoutes(r,e,{key:()=>"test-key",fetch})});
  const answer=await run();
  const previous=structuredClone(f.parent),pendingLibrary=structuredClone(f.library);
  f.parent.publication!.conversation![0].response=answer;
  f.parent.publication!.layoutConversationId=id;
  await validateKnowledgeConversationTransition(7,previous,f.parent,read);
  await validateKnowledgeBookLayoutTransition(7,pendingLibrary,f.library,f.deps);
  return {...f,input,fetch,run,read,id};
}
it("真实顾问路由产出方案，经永久回执与保存校验后控制合册和预览，原文原图不变",async()=>{
  const f=await planned(),original=JSON.stringify(f.library);
  const view=await loadKnowledgeBookLayoutView(7,f.parent.id,"10",f.deps);
  expect(view.doc.pages.map(p=>p.id)).toEqual(f.order);
  expect(view.review.pages.map(p=>p.id)).toEqual(f.order);
  expect(view.doc.pages.map(p=>p.imageUrl)).toEqual(["","","gs://test/extra.png","gs://test/old.png"]);
  expect(JSON.stringify(f.library)).toBe(original);
  const result=await exportKnowledgePublication(7,f.parent.id,"10",f.deps);
  expect(result.imagePages).toBe(2);expect(result.totalPages).toBe(6);
  const images=Object.fromEntries(view.doc.pages.filter(p=>p.imageUrl).map(p=>[p.imageUrl,`data:image/png;base64,${Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64").toString("base64")}`]));
  const savedHtml=Array.from(f.objects.entries()).find(([name])=>name.endsWith('/阅读稿.html'))![1].toString('utf8');
  expect(savedHtml.replace(/>\s+</g, "><")).toBe(buildKnowledgePublicationHtml(view.doc,view.review,images).replace(/>\s+</g, "><"));
  const sentHtml=f.deps.pdf.mock.calls.map(([html])=>html).join('\n');
  for(const end of ["末句一必须保留","末句二必须保留","末句三必须保留","末句四必须保留"])expect(sentHtml).toContain(end);
  expect(Array.from(f.objects.keys()).filter(name=>/\.pdf\.pages\/\d+\.pdf$/.test(name))).toHaveLength(6);
  await f.run();await exportKnowledgePublication(7,f.parent.id,"10",f.deps);
  expect(f.fetch).toHaveBeenCalledTimes(1);expect(f.deps.pdf).toHaveBeenCalledTimes(4);
  expect(Array.from(f.models.keys()).some(k=>k.endsWith("/raw.json"))).toBe(true);
  expect(Array.from(f.models.keys()).some(k=>k.endsWith("/report.json"))).toBe(true);
});
it("漏页、重页、未知页与旧摘要在应用前拒绝，已保存顾问方案不能被客户端偷换",async()=>{
  const f=await planned(),plan=f.makePlan(f.input.sourceDigest);
  for(const bad of [{...plan,chapters:plan.chapters.slice(1)},{...plan,chapters:[plan.chapters[0],...plan.chapters.slice(0,3)]},{...plan,sourceDigest:"b".repeat(64)},{...plan,chapters:plan.chapters.map((p,i)=>i? p:{...p,pageId:randomUUID()})}])expect(()=>validateKnowledgeBookLayoutPlan(bad,f.input)).toThrow();
  f.parent.publication!.conversation![0].response!.layoutPlan!.chapters.reverse();
  await expect(loadKnowledgeBookLayoutView(7,f.parent.id,"10",f.deps)).rejects.toThrow("永久回执");
  expect(f.deps.pdf).not.toHaveBeenCalled();
});
it("补充稿正文改变后拒绝旧方案",async()=>{
  const f=await planned();await exportKnowledgePublication(7,f.parent.id,"10",f.deps);
  f.child.publication!.manuscript=f.child.publication!.manuscript.replace("末句四必须保留","末句四追加新内容");
  await expect(loadKnowledgeBookLayoutView(7,f.parent.id,"10",f.deps)).rejects.toThrow("已变化");
  expect(f.fetch).toHaveBeenCalledTimes(1);expect(f.deps.pdf).toHaveBeenCalledTimes(4);
});
it("未得到顾问方案的旧内容重排明确失败，不从标题猜选配色与纹样",async()=>{
  const f=fixture();f.parent.publication!.designMode="content";
  f.parent.publication!.confirmedManuscript=f.parent.publication!.manuscript;f.child.publication!.confirmedManuscript=f.child.publication!.manuscript;
  await expect(exportKnowledgePublication(7,f.parent.id,"10",f.deps)).rejects.toThrow("创作顾问重新排版");
  expect(f.deps.pdf).not.toHaveBeenCalled();
});

it("实际Chromium打印按顾问顺序保留全部章节、图卡、正文与连续页码",async()=>{
  const f=await planned(),browser=await puppeteer.launch({headless:true});
  try {
    const page=await browser.newPage();
    await page.setViewport({width:1800,height:1000});
    const errors:string[]=[];
    page.on("pageerror",e=>errors.push(String(e)));
    const render=async(html:string)=>{
      await page.setContent(html,{waitUntil:"load"});
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-booklet-root]')).every(root=>root.getAttribute('data-ready')==='true'),{timeout:30000});
    };
    const measure=async(html:string)=>{await render(html);return page.$$eval('[data-booklet-root] .folio',pages=>pages.length);};
    const parts:{chapters:(string|null|undefined)[];images:number;pages:(string|null)[];texts:(string|null)[];overflow:boolean;palettes:string[]}[]=[];
    const pdf=async(html:string)=>{
      await render(html);
      const result=await page.evaluate(()=>({
        chapters:Array.from(document.querySelectorAll('[data-booklet-root]')).map(root=>root.querySelector('[data-source-id]')?.getAttribute('data-source-id')),
        images:document.querySelectorAll('.main-card img').length,
        pages:Array.from(document.querySelectorAll('.folio .page-number')).map(e=>e.textContent),
        texts:Array.from(document.querySelectorAll('#reading-pages')).map(e=>e.textContent),
        overflow:Array.from(document.querySelectorAll('.folio,.reading-column')).some(e=>e.scrollHeight>e.clientHeight+2),
        palettes:Array.from(document.querySelectorAll('[data-booklet-root]')).map(e=>getComputedStyle(e).getPropertyValue('--paper')),
      }));
      parts.push(result);
      expect(result.overflow).toBe(false);expect(errors).toEqual([]);
      const bytes=Buffer.from(await page.pdf({preferCSSPageSize:true,printBackground:true}));
      if(process.env.KNOWLEDGE_LAYOUT_EVIDENCE){
        await mkdir(process.env.KNOWLEDGE_LAYOUT_EVIDENCE,{recursive:true});
        await writeFile(process.env.KNOWLEDGE_LAYOUT_EVIDENCE+`/fixture-part-${parts.length}.pdf`,bytes);
        await writeFile(process.env.KNOWLEDGE_LAYOUT_EVIDENCE+'/measurements.json',JSON.stringify(parts,null,2));
        const extra=result.chapters.includes(f.child.pages[0].id)?await page.$('.reading-folio'):null;
        await extra?.screenshot({path:process.env.KNOWLEDGE_LAYOUT_EVIDENCE+'/supplement-reading.png'});
      }
      return bytes;
    };
    const result=await exportKnowledgePublication(7,f.parent.id,'10',{...f.deps,pdf,measure});
    expect(result.pdfError).toBeUndefined();expect(result.totalPages).toBe(6);expect(result.pdfBytes).toBeGreaterThan(10000);
    expect(result.imagePages).toBe(2);
    expect(parts.flatMap(p=>p.chapters)).toEqual(f.order);
    expect(parts.reduce((sum,p)=>sum+p.images,0)).toBe(2);
    expect(parts.flatMap(p=>p.pages)).toEqual(Array.from({length:6},(_,i)=>String(i+1).padStart(2,'0')+' / 06'));
    const texts=parts.flatMap(p=>p.texts);
    for(const [i,n] of Array.from(["一","二","四","三"].entries()))expect(texts[i]).toContain('末句'+n+'必须保留');
    expect(new Set(parts.flatMap(p=>p.palettes)).size).toBe(2);
    const savedPdf=Array.from(f.objects.entries()).find(([name])=>name.endsWith('/阅读稿.pdf'))![1];
    expect(savedPdf.length).toBe(result.pdfBytes);
    if(process.env.KNOWLEDGE_LAYOUT_EVIDENCE)await writeFile(process.env.KNOWLEDGE_LAYOUT_EVIDENCE+'/fixture.pdf',savedPdf);
  }finally{await browser.close();}
},60000);

it("顾问两档展示方案实际进入PDF正文，底稿与原审校保持完整",async()=>{
  for(const level of ["full","concise"] as const){
    const f=await planned(level),original=JSON.stringify(f.library);
    expect(f.input.detailLevel).toBe(level);
    expect(f.input.pages[2].imageStatus).toBe("consistent");
    expect(f.input.pages[0].facts?.length).toBeGreaterThan(0);
    const view=await loadKnowledgeBookLayoutView(7,f.parent.id,"10",f.deps);
    expect(view.doc.pages[0].body).toContain(level==="full"?"制度结构参见秦汉制度图":"完整解释制度关系");
    expect(view.review.pages[0].body).toBe(view.doc.pages[0].body);
    expect(view.doc.publication!.source.pages[0].body).toContain("末句一必须保留");
    await exportKnowledgePublication(7,f.parent.id,"10",f.deps);
    expect(f.deps.pdf.mock.calls[0][0]).toContain(level==="full"?"制度结构参见秦汉制度图":"完整解释制度关系");
    expect(f.deps.pdf.mock.calls[0][0]).toContain("末句一必须保留");
    if(level==="full")expect(f.deps.pdf.mock.calls[0][0]).not.toContain("周本纪年代细节原图重复说明");
    else expect(f.deps.pdf.mock.calls[0][0]).toContain("周本纪年代细节原图重复说明");
    expect(JSON.stringify(f.library)).toBe(original);
  }
});
it("完整版去重不接受未看图、未知图、不确定图或无图片依据",async()=>{
  const f=await planned("full"),plan=f.makePlan(f.input.sourceDigest);
  for(const ids of [[],[f.parent.pages[0].id],[randomUUID()],[f.parent.pages[2].id,f.parent.pages[2].id]]){
    const bad=structuredClone(plan);bad.chapters[0].presentation!.imageEvidencePageIds=ids;
    expect(()=>validateKnowledgeBookLayoutPlan(bad,f.input)).toThrow(/原图|承载知识/);
  }
  const uncertain=structuredClone(f.input);uncertain.pages[2].imageStatus="uncertain";
  expect(()=>validateKnowledgeBookLayoutPlan(plan,uncertain)).toThrow("已实际审校且一致");
  const empty=structuredClone(f.input);empty.pages[2].imageDescription="";
  expect(()=>validateKnowledgeBookLayoutPlan(plan,empty)).toThrow("已实际审校且一致");
});
