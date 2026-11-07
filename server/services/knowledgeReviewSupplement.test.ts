import {expect,it} from 'vitest';
import {supplementKnowledgeReview} from './knowledgeReviewSupplement';
import {validateKnowledgeResearchResult} from './knowledgePublicationResearch';
import {knowledgeReadingMarkdown} from '../../shared/knowledgePublicationLayout';
import type {KnowledgeReview} from '../../shared/knowledgePublication';

const fixture=()=>{
 const id='11111111-1111-4111-8111-111111111111',url='https://example.org/source',quote='原文年代存在两种说法';
 const reading={version:1 as const,subtitle:'',accent:'jade' as const,blocks:[{type:'prose' as const,title:'原始论述',text:quote,note:''}]};
 const review:KnowledgeReview={kind:'knowledge_publication_v1',sourceDigest:'a'.repeat(64),title:'史料核对',pages:[{id,headline:'年代核对',body:knowledgeReadingMarkdown(reading),reading,imageDescription:'',imageStatus:'absent',facts:[{term:'年代',statement:quote}],cautions:[]}]};
 const research=validateKnowledgeResearchResult({kind:'knowledge_research_v1',pages:[{pageId:id,topic:'年代核对',queries:['年代'],findings:[{url,summary:'原始文献分别记载两个不同事件，应区分事件后再比较年代。',relevance:'解释两种年代的语境',purpose:'resolve_conflict',sourceQuote:quote,question:'是否属于同一事件'}]}]},[{id,headline:'年代核对',body:quote}],[{url,title:'原始文献',content:'两种说法指向不同事件。'}]);
 return {review,research};
};
it('矛盾核实直接进入原正文和事实索引，不加页号、不覆盖原论述',()=>{
 const f=fixture(),before=structuredClone(f.review),result=supplementKnowledgeReview(f.review,f.research);
 expect(result.pending).toHaveLength(0);expect(f.review).toEqual(before);
 expect(result.review.pages[0].body).toContain('原文年代存在两种说法');
 expect(result.review.pages[0].body).toContain('应区分事件后再比较年代');
 expect(result.review.pages[0].body).toContain('[原始文献](https://example.org/source)');
 expect(result.review.pages[0].body).not.toMatch(/第\s*\d+\s*页|页号/);
 expect(result.review.pages[0].facts.at(-1)?.statement).toContain('两个不同事件');
});
it('容量不足保留全部原文与完整补充回执，不截断正文或宣称已补完',()=>{
 const f=fixture(),page=f.review.pages[0];
 page.reading!.blocks=Array.from({length:40},(_,i)=>({type:'prose',title:`论述${i}`,text:'原文完整保留',note:''}));page.body=knowledgeReadingMarkdown(page.reading!);
 const original=structuredClone(page.reading!.blocks),result=supplementKnowledgeReview(f.review,f.research);
 expect(result.review.pages[0].reading!.blocks).toEqual(original);
 expect(result.review.pages[0].sources).toBeUndefined();
 expect(result.pending).toHaveLength(1);expect(result.pending[0].finding).toEqual(f.research.pages[0].findings[0]);
 expect(result.review.pages[0].cautions.at(-1)?.message).toContain('不能视为补充完整');
});
it('Markdown真实补充进入原文后、事实及来源，重复恢复不重复追加',()=>{
 const f=fixture();delete f.review.pages[0].reading;
 f.review.pages[0].body='## 核心知识\n\n原文年代存在两种说法\n\n## 后续知识\n\n作者独家经验：先分辨事件。';
 const original=f.review.pages[0].body;
 const result=supplementKnowledgeReview(f.review,f.research);
 const page=result.review.pages[0];
 expect(page.body.indexOf('应区分事件')).toBeGreaterThan(page.body.indexOf('原文年代'));
 expect(page.body.indexOf('应区分事件')).toBeLessThan(page.body.indexOf('## 后续知识'));
 expect(page.body).toContain('作者独家经验');expect(page.body).not.toContain('核对与说明');
 expect(page.reading).toBeUndefined();expect(page.sources).toHaveLength(1);
 expect(page.facts.at(-1)?.statement).toContain('两个不同事件');expect(result.pending).toHaveLength(0);
 expect(f.review.pages[0].body).toBe(original);
 expect(supplementKnowledgeReview(result.review,f.research).review).toEqual(result.review);
});
it('无真实适用来源保留Markdown原稿，表格锚点不被插成两半',()=>{
 const f=fixture();delete f.review.pages[0].reading;
 const table='| 问题 | 原文 |\n|---|---|\n| 年代 | 原文年代存在两种说法 |';
 f.review.pages[0].body=table+'\n\n其他知识。';
 const result=supplementKnowledgeReview(f.review,f.research);
 expect(result.review.pages[0].body.startsWith(table+'\n\n')).toBe(true);
 expect(supplementKnowledgeReview(f.review,{...f.research,sources:[]}).review).toEqual(f.review);
});
