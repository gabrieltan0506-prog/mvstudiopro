import { expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { layoutFromSource } from "../../shared/editableLayout";
import { knowledgeManuscript } from "../../shared/knowledgePublication";
import type { KnowledgeBookLayoutInput } from "../../shared/knowledgeBookLayout";
import { buildKnowledgeConversationRequest, knowledgeConversationInput, reviewKnowledgeConversation } from "./knowledgeConversationAdvisor";
import { invokeKnowledgePublicationRoutes } from "./knowledgePublicationRoutes";

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
function fixture(size = 8500) {
  const doc = layoutFromSource({kind:"knowledge-publication",owner:"7",sourceId:"layout-capacity",title:"完整知识手册",body:"",pages:
    Array.from({length:6},(_,i)=>({pageIndex:i+1,headline:`知识${i+1}`,body:`第${i+1}段开头${"知".repeat(size)}第${i+1}段末句不可丢失。`}))});
  const pub = doc.publication!;
  pub.review = {kind:"knowledge_publication_v1",sourceDigest:"b".repeat(64),title:doc.title,pages:doc.pages.map(p=>({
    id:p.id,headline:p.headline,body:p.body,imageStatus:"absent",imageDescription:"",facts:[{term:p.headline,statement:p.body}],cautions:[],
  }))};
  pub.manuscript = knowledgeManuscript(doc);
  const book: KnowledgeBookLayoutInput = {sourceDigest:"a".repeat(64),title:doc.title,pages:doc.pages.map((p,i)=>({
    id:p.id,headline:p.headline,body:p.body,hasImage:false,imageDescription:"",cautions:[],facts:pub.review!.pages[i].facts,
  }))};
  const id = randomUUID();
  pub.conversation = [{request:{id,action:"layout",question:"完整保留原文，统一整册排版。",imagePageIds:[],layoutSourceDigest:book.sourceDigest,manuscript:pub.manuscript}}];
  const ctx = {documentId:doc.id,purpose:"conversation" as const,batchIndex:0,attempt:0};
  return {doc,book,ctx,id};
}
it("超限重复正文仅压缩传输副本，完整书稿、审校与身份保持不变",()=>{
  const f=fixture(),before=JSON.stringify(f.doc),canonical=knowledgeConversationInput(f.doc,f.ctx,f.book);
  expect(bytes(canonical)).toBeGreaterThan(750000);
  const request=buildKnowledgeConversationRequest(f.doc,f.ctx,[],f.book);
  const wire=JSON.parse((request.contents[0].parts[0] as {text:string}).text);
  expect(bytes(wire)).toBeLessThan(750000);
  expect(wire.bookLayout).toEqual(f.book);
  expect(wire.conversation.layout.review).toEqual(f.doc.publication!.review);
  expect(wire.conversation.manuscriptReference.pageIds).toEqual(f.doc.pages.map(p=>p.id));
  expect(knowledgeManuscript({title:wire.sourceReference.title,pages:wire.sourceReference.pageIds.map((id:string)=>wire.bookLayout.pages.find((p:any)=>p.id===id))})).toBe(canonical.conversation.manuscript);
  expect(wire.conversation.history).toEqual(canonical.conversation.history);
  expect(wire.conversation.question).toBe(canonical.conversation.question);
  expect(JSON.stringify(f.doc)).toBe(before);
  expect(knowledgeConversationInput(f.doc,f.ctx,f.book)).toEqual(canonical);
});
it("原本未超限的布局请求维持原传输字节，普通对话不绕过容量门",()=>{
  const f=fixture(5),expected=JSON.stringify(knowledgeConversationInput(f.doc,f.ctx,f.book));
  expect((buildKnowledgeConversationRequest(f.doc,f.ctx,[],f.book).contents[0].parts[0] as {text:string}).text).toBe(expected);
  const large=fixture(15000);delete large.doc.publication!.conversation![0].request.action;
  delete large.doc.publication!.conversation![0].request.layoutSourceDigest;
  expect(()=>buildKnowledgeConversationRequest(large.doc,large.ctx)).toThrow("手册对话超过单次容量");
});
it("副本内容有差异时拒绝压缩，真正独有内容超限时仍拒绝发送",()=>{
  const mismatch=fixture();mismatch.book.pages[0].body+="不能悄悄删掉的差异";
  expect(()=>buildKnowledgeConversationRequest(mismatch.doc,mismatch.ctx,[],mismatch.book)).toThrow("正文副本不一致");
  const large=fixture(15000);
  expect(()=>buildKnowledgeConversationRequest(large.doc,large.ctx,[],large.book)).toThrow("手册对话超过单次容量");
});
it("补充稿章节仍完整进入布局输入，原稿引用只绑定原册章节",()=>{
  const f=fixture(),extra={...f.book.pages[0],id:randomUUID(),headline:"补充知识",body:"补充稿全文与末句"};
  f.book.pages.push(extra);
  const wire=JSON.parse((buildKnowledgeConversationRequest(f.doc,f.ctx,[],f.book).contents[0].parts[0] as {text:string}).text);
  expect(wire.bookLayout.pages.at(-1)).toEqual(extra);
  expect(wire.sourceReference.pageIds).toEqual(f.doc.pages.map(p=>p.id));
});
it("压缩输入走真实Markdown路由、永久方案保存和恢复，恢复不新增模型请求",async()=>{
  const f=fixture(),storage=new Map<string,any>();
  const read=async(k:string)=>storage.get(k),save=async(k:string,v:any)=>{storage.set(k,v)};
  const md="|章节标识|模板|配色|版式|表格|边框|纹样|理由|\n|---|---|---|---|---|---|---|---|\n"+
    f.book.pages.map(p=>`|${p.id}||jade-paper|editorial|rules|none|herb-leaf|结合完整文字安排留白|`).join("\n");
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>new Response(JSON.stringify({model:JSON.parse(String(init?.body)).model,choices:[{finish_reason:"stop",message:{content:md}}]}),{status:200}));
  const deps={load:async()=>f.doc as any,book:async()=>f.book,read,save,
    post:(request:any,evidence:any)=>invokeKnowledgePublicationRoutes(request,evidence,{key:()=>"test-key",fetch})};
  const canonical=knowledgeConversationInput(f.doc,f.ctx,f.book);
  const result=await reviewKnowledgeConversation(7,f.ctx,deps);
  expect(result.layoutPlan?.chapters.map(p=>p.pageId)).toEqual(f.book.pages.map(p=>p.id));
  const report=Array.from(storage.entries()).find(([k])=>k.endsWith("/report.json"))![1];
  expect(report.fingerprint).toBe(createHash("sha256").update(JSON.stringify(canonical)).digest("hex"));
  expect(await reviewKnowledgeConversation(7,f.ctx,deps)).toEqual(result);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(Array.from(storage.keys()).some(k=>k.endsWith("/raw.json"))).toBe(true);
});
