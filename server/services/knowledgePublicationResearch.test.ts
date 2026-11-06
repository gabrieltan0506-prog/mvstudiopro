import {describe,it,expect} from 'vitest';
import {validateKnowledgeResearchResult,validateKnowledgeResearch,cleanKnowledgeResearchSummary,knowledgeWebSources} from './knowledgePublicationResearch';
describe('逐页搜索局部过滤合同',()=>{
 const expected=[{id:'page-a',headline:'项羽兴亡'},{id:'page-b',headline:'齐桓晋文'}];
 const source={url:'https://example.org/xiangyu',title:'项羽本纪',content:'项羽史料。点击购买，限时优惠！'};
 const make=()=>({kind:'knowledge_research_v1',pages:expected.map(p=>({pageId:p.id,topic:p.headline,queries:[p.headline],findings:[{url:source.url,summary:'项羽在巨鹿破釜沉舟。立即购买，限时优惠！楚汉在垓下决战。',relevance:'对应本页主题'}]}))});
 it('同一资料去营销但保留前后知识，消费者不再接收原广告片段',()=>{const value=make();value.pages[1].findings=[];const out=validateKnowledgeResearchResult(value,expected,[source]);expect(out.sources[0].pageIds).toEqual(['page-a']);expect(out.sources[0].content).toBe('项羽在巨鹿破釜沉舟。楚汉在垓下决战。');expect(out.pages).toHaveLength(2);});
 it.each(['missing','duplicate','topic','unknown','extra'] as const)('%s局部错误不连带丢弃有效资料',kind=>{const value:any=make();if(kind==='missing')value.pages.pop();if(kind==='duplicate')value.pages[1]=value.pages[0];if(kind==='topic')value.pages[0].topic='无关主题';if(kind==='unknown')value.pages[0].pageId='unknown';if(kind==='extra')value.unexpected=true;const out=validateKnowledgeResearchResult(value,expected,[source]);expect(out.sources).toHaveLength(1);expect(out.pages).toHaveLength(2);expect(out.sources[0].content).toContain('破釜沉舟');});
 it('虚构来源排除且有记录，不把回执外URL传给正文',()=>{const value=make();value.pages[0].findings[0].url='https://fake.example.org';const out=validateKnowledgeResearchResult(value,expected,[source]);expect(out.validation.warnings.some(x=>x.includes('不存在'))).toBe(true);expect(out.sources[0].pageIds).toEqual(['page-b']);});
 it('单条缺字段不影响同页下一条有效资料',()=>{const value:any=make();value.pages[0].findings.unshift({url:source.url});const out=validateKnowledgeResearchResult(value,expected,[source]);expect(out.sources).toHaveLength(1);expect(out.pages[0].findings).toHaveLength(1);});
 it('纯营销条目剔除，医学与历史中的普通购买叙述不误删',()=>{expect(cleanKnowledgeResearchSummary('点击购买！限时优惠！')).toBe('');expect(cleanKnowledgeResearchSummary('管仲鼓励购买鹿以影响楚国经济。')).toContain('购买鹿');});
 it('不能把其他页的合法来源列为当前页引用',()=>{const review:any={pages:[{id:'page-b',body:'[出处]('+source.url+')',sources:[source]}]};validateKnowledgeResearch(review,[{...source,pageIds:['page-a']}]);expect(review.pages[0].sources).toEqual([]);});
});

it('逗号内的营销子句不连带删除同句可用事实',()=>{expect(cleanKnowledgeResearchSummary('项羽在巨鹿破釜沉舟，点击购买本书了解详情。')).toBe('项羽在巨鹿破釜沉舟。');expect(cleanKnowledgeResearchSummary('立即购买，项羽在巨鹿破釜沉舟。')).toBe('项羽在巨鹿破釜沉舟。');});
it('一条超长来源不阻断其他有效资料',()=>{const warnings:string[]=[];const out=knowledgeWebSources({web_search:[{link:'https://example.org/a',title:'可用资料',content:'真实内容'},{link:'https://example.org/b',title:'异常资料',content:'x'.repeat(30001)}]},warnings);expect(out).toHaveLength(1);expect(warnings[0]).toContain('超长');});
it('新搜索补充必须有三类触发理由和对应原文锚点，个别无效不影响同页其他资料',()=>{
 const source={url:'https://example.org/water',title:'资料',content:'原始事实'};const finding={url:source.url,summary:'太阳提供能量。',relevance:'解释蒸发',purpose:'fill_explanation',sourceQuote:'水会蒸发',question:'蒸发能量从何而来'};
 const value={kind:'knowledge_research_v1',pages:[{pageId:'a',topic:'水循环',queries:['蒸发 能量'],findings:[{...finding,sourceQuote:'不在原文'},finding]}]};
 const out=validateKnowledgeResearchResult(value,[{id:'a',headline:'水循环',body:'水会蒸发，然后凝结。'}],[source]);expect(out.sources).toHaveLength(1);expect(out.pages[0].findings).toHaveLength(1);expect(out.validation.warnings.some(x=>x.includes('锚点'))).toBe(true);
});
