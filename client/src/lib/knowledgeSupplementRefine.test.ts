import {it,expect,vi} from 'vitest';
import {layoutFromSource} from '@shared/editableLayout';
import {refineKnowledgeSupplement} from './knowledgeSupplementRefine';
it('直接补充保留原图与原文，恢复相同回复零新增调用',async()=>{
 let doc=layoutFromSource({kind:'knowledge-publication',owner:'7',sourceId:'parent',title:'原册',body:'全部原文',detailLevel:'concise'});
 doc.pages[0].imageUrl='https://example.test/original.png';doc.publication!.review={kind:'knowledge_publication_v1',sourceDigest:'a'.repeat(64),title:'原册',pages:[]} as any;
 const before=structuredClone({pages:doc.pages,manuscript:doc.publication!.manuscript});
 const send=vi.fn(async(requestId:string)=>JSON.stringify({kind:'knowledge_conversation_v1',requestId,answer:'新增补充',sources:[],supplementalImages:Array.from({length:6},(_,i)=>({sourcePageIds:[doc.pages[0].id],title:`主题${i}`,reason:'补充次要知识',content:'有条件的具体知识与图示说明。'.repeat(75)}))}));
 const deps={current:()=>doc,save:async(next:typeof doc)=>{doc=next;},quote:async()=>({maxCredits:0}),send};
 const result=await refineKnowledgeSupplement(doc,deps);expect(result.selection.indexes).toHaveLength(6);expect(send).toHaveBeenCalledTimes(1);
 expect({pages:doc.pages,manuscript:doc.publication!.manuscript}).toEqual(before);
 expect((await refineKnowledgeSupplement(doc,deps)).selection).toEqual(result.selection);expect(send).toHaveBeenCalledTimes(1);
});
it('请求中断保留原ID与稿件，恢复不创建新记录；未知其他请求先阻断',async()=>{
 let doc=layoutFromSource({kind:'knowledge-publication',owner:'7',sourceId:'parent',title:'原册',body:'全部原文',detailLevel:'concise'});doc.pages[0].imageUrl='https://example.test/original.png';doc.publication!.review={} as any;
 const ids:string[]=[];const deps={current:()=>doc,save:async(next:typeof doc)=>{doc=next;},quote:async()=>({maxCredits:0}),send:async(id:string)=>{ids.push(id);throw Error('保留原请求');}};
 await expect(refineKnowledgeSupplement(doc,deps)).rejects.toThrow('保留原请求');await expect(refineKnowledgeSupplement(doc,deps)).rejects.toThrow('保留原请求');
 expect(new Set(ids).size).toBe(1);expect(doc.publication!.conversation).toHaveLength(1);
 doc.publication!.conversation![0].request.action='layout';await expect(refineKnowledgeSupplement(doc,deps)).rejects.toThrow('原整理请求');expect(ids).toHaveLength(2);
});
