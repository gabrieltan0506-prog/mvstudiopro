import {it,expect,vi} from 'vitest';
import JSZip from 'jszip';
import {layoutFromSource} from '../../shared/editableLayout';
import {knowledgeManuscript} from '../../shared/knowledgePublication';
import {buildKnowledgePublicationPptx,exportKnowledgePublicationPptx} from './knowledgePublicationPptx';
import {loadKnowledgePublicationExport} from './knowledgePublicationExport';
import {knowledgeSourceDigest} from './knowledgePublicationAdvisor';
import {knowledgePresentationInput} from './knowledgePresentationAdvisor';
import type {KnowledgePresentationPlan} from '../../shared/knowledgePresentation';
export const makePresentation=()=>{
 const doc=layoutFromSource({kind:'knowledge-publication',owner:'7',sourceId:'pptx-test',title:'史记导读',body:'没有统一标准，应按具体条件比较。原稿最后一句。'});
 const pub=doc.publication!;const review:any={kind:'knowledge_publication_v1',title:doc.title,sourceDigest:knowledgeSourceDigest(pub.source),pages:doc.pages.map(p=>({id:p.id,headline:p.headline,body:p.body,imageDescription:'',imageStatus:'absent',facts:[{term:'比较',statement:'具体条件'}],cautions:[{kind:'uncertain',evidence:'原文证据',message:'原文没有答案，待核对'}]}))};
 pub.review=review;pub.manuscript=knowledgeManuscript(review);pub.confirmedManuscript=pub.manuscript;pub.presentationRequest={id:'00000000-0000-4000-8000-000000000002',minSlides:2,maxSlides:3,manuscript:pub.manuscript};
 const input=knowledgePresentationInput(doc);
 const plan:KnowledgePresentationPlan={kind:'knowledge_presentation_v1',requestId:input.requestId,sourceDigest:input.sourceDigest,minSlides:2,maxSlides:3,title:doc.title,fontStyle:'editorial',slides:[{type:'points',title:'核心知识',sourcePageIds:[doc.pages[0].id],points:['没有统一标准，应按具体条件比较。','原稿最后一句。'],notes:''},{type:'table',title:'知识对照',sourcePageIds:[doc.pages[0].id],columns:['对象','特征'],rows:[['本纪','以帝王为中心'],['列传','以人物为中心']],notes:''}]};
 pub.presentationPlan=plan;
 return {doc,review,plan,receipt:{report:review,sourceImages:[]},prefix:'test/owner7/exports/digest'};
};
it('实际PPTX一条提纲一页，保留原生表格与宋黑字体，内部疑点仅在备注',async()=>{
 const f=makePresentation(),r=await buildKnowledgePublicationPptx(f.doc,f.review,{},f.plan),z=await JSZip.loadAsync(r.buffer);
 const slides=Object.keys(z.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n));expect(slides).toHaveLength(2);expect(r.slides).toBe(2);
 const xml=(await Promise.all(slides.map(n=>z.file(n)!.async('string')))).join('');
 expect(xml).toContain('<a:tbl>');expect(xml).toContain('没有统一标准');expect(xml).toContain('原稿最后一句');expect(xml).toContain('Noto Serif CJK SC');expect(xml).toContain('Noto Sans CJK');expect(xml).not.toContain('原文没有答案');
 const notes=(await Promise.all(Object.keys(z.files).filter(n=>/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).map(n=>z.file(n)!.async('string')))).join('');expect(notes).toContain('原文没有答案');
});
it('范围不符在写文件前失败，不自动续页或截断',async()=>{
 const f=makePresentation();f.plan.minSlides=3;await expect(buildKnowledgePublicationPptx(f.doc,f.review,{},f.plan)).rejects.toThrow('页数范围');
});
it('最大合法表格与要点仍各一页',async()=>{
 const f=makePresentation();f.plan.slides[0]={...f.plan.slides[0],type:'points',points:Array(5).fill('字'.repeat(60))};f.plan.slides[1]={...f.plan.slides[1],type:'table',columns:Array(4).fill('表头'.repeat(6)),rows:Array.from({length:5},()=>Array(4).fill('字'.repeat(20)))};
 expect((await buildKnowledgePublicationPptx(f.doc,f.review,{},f.plan)).slides).toBe(2);
});
it('PPTX和PDF共享云稿版本、确认稿与权威审校校验',async()=>{
 const f=makePresentation(),deps:any={load:async()=>({library:{documents:[f.doc]},generation:'10'}),review:async()=>f.receipt};
 expect((await loadKnowledgePublicationExport(7,f.doc.id,'10',deps)).doc.id).toBe(f.doc.id);
 await expect(loadKnowledgePublicationExport(7,f.doc.id,'9',deps)).rejects.toThrow('版本');f.doc.publication!.manuscript+='改动';await expect(loadKnowledgePublicationExport(7,f.doc.id,'10',deps)).rejects.toThrow('确认');
});
it('课件按提纲缓存，重复下载不调用模型、不重渲染',async()=>{
 const f=makePresentation(),storage=new Map<string,Buffer>(),deps={load:vi.fn(async()=>f),plan:async()=>f.plan,read:async(k:string)=>storage.get(k)||null,save:async(k:string,b:Buffer)=>{storage.set(k,b)},sign:(k:string)=>'https://test.invalid/'+k,build:vi.fn(buildKnowledgePublicationPptx)};
 const a=await exportKnowledgePublicationPptx(7,f.doc.id,'10',deps),b=await exportKnowledgePublicationPptx(7,f.doc.id,'10',deps);expect(a).toEqual(b);expect(deps.build).toHaveBeenCalledTimes(1);expect(a.slides).toBe(2);
});
it('只读取提纲选用的原图，原图版本变化拒绝渲染',async()=>{
 const f=makePresentation();f.doc.pages[0].imageUrl='gs://test/image.png';(f.receipt.sourceImages as any[]).push({uri:'gs://test/image.png',sha256:'old'});
 const image=vi.fn(async()=>({sha256:'new',buffer:Buffer.from('image')})),build=vi.fn();
 f.plan.slides[0]={type:'image',title:'图解',sourcePageIds:[f.doc.pages[0].id],imagePageId:f.doc.pages[0].id,points:['图解说明'],notes:''};
 await expect(exportKnowledgePublicationPptx(7,f.doc.id,'10',{load:async()=>f,plan:async()=>f.plan,read:async()=>null,image:image as any,build})).rejects.toThrow('原图已变化');expect(build).not.toHaveBeenCalled();
});

it.each([1,2,3,4])('拒绝%d项版式中的密集换行，不将溢出页面当成成功导出',async(count)=>{
 const f=makePresentation();
 f.plan.slides[1]={type:'points',title:'边界检查',sourcePageIds:[f.doc.pages[0].id],points:Array(count).fill('字\n'.repeat(20)+'末'),notes:''};
 await expect(buildKnowledgePublicationPptx(f.doc,f.review,{},f.plan)).rejects.toThrow('单页内容超出');
});
it.each([1,2,3,4])('%d项版式的合法最长普通文本保留末字',async(count)=>{
 const f=makePresentation();
 f.plan.slides[1]={type:'points',title:'边界检查',sourcePageIds:[f.doc.pages[0].id],points:Array(count).fill('字'.repeat(59)+'末'),notes:''};
 const r=await buildKnowledgePublicationPptx(f.doc,f.review,{},f.plan),z=await JSZip.loadAsync(r.buffer);
 expect(r.slides).toBe(2);expect(await z.file('ppt/slides/slide2.xml')!.async('string')).toContain('末');
});
