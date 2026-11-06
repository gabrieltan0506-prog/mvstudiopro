import {describe,it,expect} from 'vitest';
import {validateKnowledgeResearchResult,validateKnowledgeResearch} from './knowledgePublicationResearch';
describe('逐页搜索合同',()=>{
 const expected=[{id:'page-a',headline:'项羽兴亡'},{id:'page-b',headline:'齐桓晋文'}];
 const source={url:'https://example.org/xiangyu',title:'项羽本纪',content:'项羽史料'};
 const make=()=>({kind:'knowledge_research_v1',pages:expected.map(p=>({pageId:p.id,topic:p.headline,queries:[p.headline],findings:[{url:source.url,summary:'史料事实',relevance:'对应本页主题'}]}))});
 it('有效各页映射到真实工具URL，空资料保留原页',()=>{const value=make();value.pages[1].findings=[];const out=validateKnowledgeResearchResult(value,expected,[source]);expect(out.sources[0].pageIds).toEqual(['page-a']);expect(out.pages).toHaveLength(2);expect(out.validation.status).toBe('validated');});
 it.each(['missing','duplicate','topic','unknown','extra'] as const)('%s页错误不能通过合同',kind=>{const value:any=make();if(kind==='missing')value.pages.pop();if(kind==='duplicate')value.pages[1]=value.pages[0];if(kind==='topic')value.pages[0].topic='无关主题';if(kind==='unknown')value.pages[0].pageId='unknown';if(kind==='extra')value.unexpected=true;expect(validateKnowledgeResearchResult(value,expected,[source]).validation.status).toBe('excluded');});
 it('虚构来源排除且有记录，不把回执外URL传给正文',()=>{const value=make();value.pages[0].findings[0].url='https://fake.example.org';const out=validateKnowledgeResearchResult(value,expected,[source]);expect(out.validation.warnings).toHaveLength(1);expect(out.sources[0].pageIds).toEqual(['page-b']);});
 it('不能把其他页的合法来源列为当前页引用',()=>{const review:any={pages:[{id:'page-b',body:'[出处]('+source.url+')',sources:[source]}]};validateKnowledgeResearch(review,[{...source,pageIds:['page-a']}]);expect(review.pages[0].sources).toEqual([]);});
});
