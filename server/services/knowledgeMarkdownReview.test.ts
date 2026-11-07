import { describe,it,expect } from 'vitest';
import { knowledgeReviewFromMarkdown } from './knowledgeMarkdownReview';
import { buildKnowledgeReviewRequest } from './knowledgePublicationAdvisor';
import { resolveKnowledgePublicationTemplate, knowledgePublicationTemplates } from '../../shared/knowledgePublicationTemplates';
const source={title:'资料',pages:[{id:'11111111-1111-4111-8111-111111111111',headline:'知识',body:'完整原文',imageUrl:''}]};
const digest='a'.repeat(64);
describe('Markdown正文与模板选择独立保留',()=>{
 it('普通Markdown含引号表格无需JSON转义且正文原样保留',()=>{
   const body='# 内容\n\n“引用”与 {非JSON}\n\n|甲|乙|\n|---|---|\n|1|2|';
   const out=knowledgeReviewFromMarkdown(body,source,digest);
   expect(out.pages[0].body).toBe(body);expect(out.pages[0].id).toBe(source.pages[0].id);
   expect(out.pages[0].reading).toBeUndefined();
 });
 it('完整事实索引无正文尾部丢失',()=>{
   const body='正文'.repeat(4000)+'最后一个事实';
   expect(knowledgeReviewFromMarkdown(body,source,digest).pages[0].facts.map(f=>f.statement).join('')).toBe(body);
 });
 it('请求不再要求JSON或每页装饰',()=>{
   const request=buildKnowledgeReviewRequest(source,digest,new Map());
   expect(request.generationConfig.responseMimeType).toBe('text/markdown');
   expect(request.researchAfterReview).toBeUndefined();
   expect(request.systemInstruction.parts[0].text).not.toContain('reading={');
 });
 it('用户选择的模板仍优先于自动模板',()=>{
   const [manual,automatic]=knowledgePublicationTemplates;
   expect(resolveKnowledgePublicationTemplate(manual.id,automatic.id)?.id).toBe(manual.id);
 });
 it('有图不伪造已通过审校',()=>{
   const out=knowledgeReviewFromMarkdown('正文',{...source,pages:[{...source.pages[0],imageUrl:'gs://test/image.png'}]},digest);
   expect(out.pages[0].imageStatus).toBe('uncertain');expect(out.pages[0].cautions).not.toHaveLength(0);
 });
});

import { invokeKnowledgePublicationRoutes } from './knowledgePublicationRoutes';
it('两段独立正文双通道同时发送，回放不新增调用且保留全部正文',async()=>{
 const book={...source,pages:[source.pages[0],{...source.pages[0],id:'22222222-2222-4222-8222-222222222222'}]};
 const request=buildKnowledgeReviewRequest(book,digest,new Map());
 const storage=new Map<string,any>();let calls=0;let active=0;let peak=0;const models:string[]=[];
 const evidence={prefix:'md',read:async(k:string)=>storage.get(k)||null,save:async(k:string,v:unknown)=>{storage.set(k,structuredClone(v));}};
 const deps={key:()=> 'test-key',fetch:async (_url:any,options:any)=>{
   calls++;active++;peak=Math.max(peak,active);
   const payload=JSON.parse(options.body);models.push(payload.model);expect(payload.response_format).toBeUndefined();
   await new Promise(resolve=>setTimeout(resolve,10));active--;
   return new Response(JSON.stringify({model:payload.model,choices:[{finish_reason:'stop',message:{content:'## 知识\n\n保留完整正文"没有JSON转义"'}}]}));
 }};
 const result=JSON.parse((await invokeKnowledgePublicationRoutes(request,evidence,deps)).text);
 expect(peak).toBe(2);expect(calls).toBe(2);expect(new Set(models).size).toBe(2);
 expect(JSON.parse(result.candidates[0].content.parts[0].text).pages.map((p:any)=>p.id)).toEqual(book.pages.map(p=>p.id));
 await invokeKnowledgePublicationRoutes(request,evidence,deps);expect(calls).toBe(2);
});

it('前期疑点立即另存，正文不显示内部标注且不触发搜索',()=>{
 const out=knowledgeReviewFromMarkdown('保留作者方法。<!-- 待核：两处数值是否同一单位 -->',source,digest);
 expect(out.pages[0].body).toBe('保留作者方法。');
 expect(out.pages[0].cautions.some(c=>c.evidence.includes('两处数值'))).toBe(true);
 const request=buildKnowledgeReviewRequest(source,digest,new Map());expect(request.researchOnly).toBeUndefined();expect(request.researchAfterReview).toBeUndefined();
});
