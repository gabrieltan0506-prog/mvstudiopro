import {it,expect,vi} from 'vitest';
import {layoutFromSource} from '../../shared/editableLayout';
import {applyKnowledgeBookLayout} from '../../shared/knowledgeBookLayout';
import {reviewKnowledgeConversation} from './knowledgeConversationAdvisor';
import {knowledgeConversationRetryId} from './knowledgeConversationRetry';
function fixture(level:'full'|'concise'){
 const doc=layoutFromSource({kind:'knowledge-publication',owner:'7',sourceId:'new-epub',title:'饮食运动生活',body:'',pages:Array.from({length:9},(_,i)=>({pageIndex:i+1,headline:`知识${i}`,body:'原始详述。'.repeat(20)})),images:Object.fromEntries(Array.from({length:9},(_,i)=>[i+1,`gs://test/image-${i}.png`]))});
 const digest='d'.repeat(64),id='00000000-0000-4000-8000-000000000001';
 doc.publication!.source.detailLevel=level;
 doc.publication!.conversation=[{request:{id,action:'layout',layoutSourceDigest:digest,question:'按档位排版',imagePageIds:[],manuscript:doc.publication!.manuscript}}];
 const book={sourceDigest:digest,title:doc.title,detailLevel:level,pages:doc.pages.map(page=>({id:page.id,headline:page.headline,body:page.body,hasImage:true,imageStatus:'consistent' as const,imageDescription:'原图明确展示了本章主要知识。',facts:[{term:'知识',statement:'原有知识。'}],cautions:[]}))};
 const data=new Map<string,any>(),ctx={documentId:doc.id,purpose:'conversation' as const,batchIndex:0,attempt:0};
 const answer=(request:any)=>{const input=JSON.parse(request.contents[0].parts[0].text);return {kind:'knowledge_conversation_v1',requestId:input.conversation.requestId,answer:'按既有章节排版。',sources:[],supplementalImages:[],layoutPlan:{kind:'knowledge_book_layout_v1',sourceDigest:digest,chapters:input.bookLayout.pages.map((page:any)=>({pageId:page.id,presentation:{imageEvidencePageIds:level==='full'?[page.id]:[],reason:'原图承载主知识，保留条件。',reading:{version:1,subtitle:'',accent:'jade',blocks:[{type:'prose',title:page.headline,note:'',text:level==='full'?'简要读图提示。':'详细说明条件、因果与未由图片承载的知识。'.repeat(5)}]}}}))}};};
 const deps={load:async()=>doc as any,book:async()=>book,read:async(key:string)=>data.get(key),save:async(key:string,value:any)=>{data.set(key,structuredClone(value));}};
 return {doc,book,ctx,data,deps,answer};
}
it.each(['full','concise'] as const)('新%s JSON分批并发，失败保留在途成功结果，同请求恢复与后继恢复都不重购成功批次',async level=>{
 const f=fixture(level);let failed=false,active=0,peak=0;
 const post=vi.fn(async(request:any,scope:any)=>{expect(request.generationConfig.responseMimeType).toBe('application/json');active++;peak=Math.max(peak,active);try{
  if(scope.prefix.endsWith('/batch-1')&&!failed){failed=true;await new Promise(resolve=>setTimeout(resolve,1));throw Error('测试用明确派发前失败');}
  await new Promise(resolve=>setTimeout(resolve,10));return {status:200,text:JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(f.answer(request))}]}}]})};
 }finally{active--;}});
 await expect(reviewKnowledgeConversation(7,f.ctx,{...f.deps,post})).rejects.toThrow('明确派发前');expect(active).toBe(0);expect(peak).toBe(3);
 expect(Array.from(f.data.keys()).filter(key=>key.endsWith('/report.json'))).toHaveLength(2);
 const original=f.doc.publication!.conversation![0].request;
 const nextId=knowledgeConversationRetryId(7,f.doc.id,original.id);
 f.doc.publication!.conversation!.push({request:{...original,id:nextId,retryOf:original.id}});
 const context={...f.ctx,batchIndex:1};
 const answer=await reviewKnowledgeConversation(7,context,{...f.deps,post});expect(post).toHaveBeenCalledTimes(4);
 expect(answer.layoutPlan!.chapters.map(p=>p.pageId)).toEqual(f.doc.pages.map(p=>p.id));
 const before=JSON.stringify(f.doc.pages);
 const review:any={pages:f.doc.pages.map(page=>({...page,facts:[],cautions:[]}))};
 const view=applyKnowledgeBookLayout(f.doc,review,f.book,answer.layoutPlan);
 expect(view.doc.pages[0].body).toContain(level==='full'?'简要读图提示':'详细说明条件');expect(JSON.stringify(f.doc.pages)).toBe(before);
 await reviewKnowledgeConversation(7,context,{...f.deps,post});expect(post).toHaveBeenCalledTimes(4);
});
it('新任务不能只返回样式冒充正文编排完成',async()=>{
 const f=fixture('full');const post=vi.fn(async(request:any)=>{const answer=f.answer(request);answer.layoutPlan.chapters.forEach((p:any)=>delete p.presentation);return {status:200,text:JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(answer)}]}}]})};});
 await expect(reviewKnowledgeConversation(7,f.ctx,{...f.deps,post})).rejects.toThrow('实际展示正文');
 expect(Array.from(f.data.keys()).some(key=>key.endsWith('/report.json'))).toBe(false);
});
