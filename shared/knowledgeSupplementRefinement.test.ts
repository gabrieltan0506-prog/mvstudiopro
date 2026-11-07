import {it,expect} from 'vitest';
import {knowledgeSupplementRefinementFromMarkdown} from './knowledgeSupplementRefinement';
const id='11111111-1111-4111-8111-111111111111',request='22222222-2222-4222-8222-222222222222';
const content='# 补充图解\n\n'+Array.from({length:6},(_,i)=>`## 知识对照${i}\n来源：${id}\n${'具体知识包含条件和图示说明。'.repeat(75)}`).join('\n\n');
it('补充Markdown绑定原章节且实际分页5–8页，来源标识不印图',()=>{
 const answer=knowledgeSupplementRefinementFromMarkdown(content,request,[id]);
 expect(answer.supplementalImages).toHaveLength(6);expect(answer.supplementalImages[0].content).not.toContain(id);
 expect(()=>knowledgeSupplementRefinementFromMarkdown(content,request,[])).toThrow('未知章节');
 expect(()=>knowledgeSupplementRefinementFromMarkdown(`## 太短\n来源：${id}\n一句话`,request,[id])).toThrow('5–8页');
 expect(()=>knowledgeSupplementRefinementFromMarkdown(content.repeat(2),request,[id])).toThrow();
});
