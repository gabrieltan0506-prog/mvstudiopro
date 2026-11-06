import { it, expect, vi } from "vitest";
import { layoutFromSource } from "../../shared/editableLayout";
import { knowledgeConversationAnswerSchema } from "../../shared/knowledgeConversation";
import { buildKnowledgeConversationRequest, knowledgeConversationInput, reviewKnowledgeConversation, validateKnowledgeConversationAccess } from "./knowledgeConversationAdvisor";
import { invokeKnowledgePublicationRoutes } from "./knowledgePublicationRoutes";
import { knowledgePublicationChapter } from "../../shared/knowledgePublicationHtml";
const id="00000000-0000-4000-8000-000000000003";
function fixture(){
 const doc=layoutFromSource({kind:"knowledge-publication",owner:"7",sourceId:"chat",title:"水循环",body:"完整原文。最末尾不可丢失。"});
 doc.publication!.conversation=[{request:{id,question:"还需要什么图解？",imagePageIds:[],manuscript:doc.publication!.manuscript}}];
 const ctx={documentId:doc.id,purpose:"conversation" as const,batchIndex:0,attempt:0};
 const answer={kind:"knowledge_conversation_v1",requestId:id,answer:"建议比较蒸发与凝结。",sources:[],supplementalImages:[]};
 return {doc,ctx,answer};
}
it("完整稿、历史和用户问题均进入请求，已选图片有明确身份与状态",()=>{
 const f=fixture(),r=buildKnowledgeConversationRequest(f.doc,f.ctx),text=JSON.stringify(r);
 expect(text).toContain("最末尾不可丢失");expect(text).toContain("还需要什么图解");expect(text).toContain("maxAdditionalImages");
 f.doc.publication!.manuscript+="修改";expect(()=>buildKnowledgeConversationRequest(f.doc,f.ctx)).toThrow("稿件已变化");
});
it("服务端在模型前拒绝伪造请求编号及非本册图片",async()=>{
 const f=fixture(),post=vi.fn(),load=async()=>f.doc as any;
 await expect(validateKnowledgeConversationAccess(7,f.ctx,"00000000-0000-4000-8000-000000000099",{load,post})).rejects.toThrow("编号");
 f.doc.publication!.conversation![0].request.imagePageIds=["00000000-0000-4000-8000-000000000099"];
 await expect(validateKnowledgeConversationAccess(7,f.ctx,id,{load,post})).rejects.toThrow("已完成的图片");expect(post).not.toHaveBeenCalled();
});
it("真实处理函数保存原始与解析结果，恢复成功结果零新增请求",async()=>{
 const f=fixture(),storage=new Map<string,any>(),post=vi.fn(async()=>({status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(f.answer)}]}}]})}));
 const deps={load:async()=>f.doc as any,post,read:async(k:string)=>storage.get(k),save:async(k:string,v:any)=>{storage.set(k,v)}};
 expect((await reviewKnowledgeConversation(7,f.ctx,deps)).answer).toBe(f.answer.answer);
 await reviewKnowledgeConversation(7,f.ctx,deps);expect(post).toHaveBeenCalledTimes(1);
 expect(Array.from(storage.keys()).some(k=>k.endsWith("/raw.json"))).toBe(true);
 expect(Array.from(storage.keys()).some(k=>k.endsWith("/report.json"))).toBe(true);
});
it("补图建议上限为新增八页，不把现有十三图计入八页额度",()=>{
 const f=fixture(),page={sourcePageIds:[f.doc.pages[0].id],title:"变化过程",reason:"现有图缺对照",content:"蒸发与凝结对照图"};
 expect(knowledgeConversationAnswerSchema.parse({...f.answer,supplementalImages:Array.from({length:8},()=>page)}).supplementalImages).toHaveLength(8);
 expect(()=>knowledgeConversationAnswerSchema.parse({...f.answer,supplementalImages:Array.from({length:9},()=>page)})).toThrow();
});
it("付费路由拒绝整册未完成时提前补图，并沿既有路由采用后继合法回答",async()=>{
 const f=fixture(),request=buildKnowledgeConversationRequest(f.doc,f.ctx);request.systemInstruction.parts=[{text:"测试对话，不搜索"}];
 const invalid={...f.answer,supplementalImages:[{sourcePageIds:[f.doc.pages[0].id],title:"过程",reason:"需要对比",content:"蒸发与凝结"}]};
 const store=new Map<string,any>();let count=0;
 const result=await invokeKnowledgePublicationRoutes(request,{prefix:"test/chat",read:async k=>store.get(k),save:async(k,v)=>{store.set(k,v)}},{key:()=>"test-key",fetch:vi.fn(async(_url,init)=>{count++;return new Response(JSON.stringify({model:JSON.parse(String(init?.body)).model,choices:[{finish_reason:"stop",message:{content:JSON.stringify(count===1?invalid:f.answer)}}]}),{status:200})})});
 expect(count).toBe(2);expect(store.get("test/chat/route-openrouter.json").reason).toContain("整册未整理完成");
 expect(JSON.parse(result.text).candidates[0].content.parts[0].text).toContain(f.answer.answer);
});
it("单章渲染保留全册编号，原稿和审校提示不被编号修复改动",()=>{
 const f=fixture(),other={...f.doc.pages[0],id:"00000000-0000-4000-8000-000000000099",headline:"第二章"};f.doc.pages.push(other);
 const review={pages:f.doc.pages.map(p=>({...p,cautions:[{message:"保留的提示",evidence:"原文证据"}]}))} as any;
 const html=knowledgePublicationChapter(f.doc,review,1,"");expect(html).toContain('<span>02</span>');expect(html).toContain("最末尾不可丢失");expect(html).toContain("保留的提示");
});
