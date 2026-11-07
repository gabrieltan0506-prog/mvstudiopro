import {describe,it,expect} from 'vitest';
import {knowledgeVerificationTriggers} from './knowledgeVerificationPolicy';
import {buildKnowledgeConsistencyRequest} from './knowledgePublicationAdvisor';

const fact=(statement:string,headline='血脂管理')=>({pageId:'p1',term:headline,headline,statement});
describe('最终事实查证触发条件',()=>{
  it('药名数值或健康话题本身不触发，只有实际疑问触发',()=>{
    const facts=[fact('他汀每天3毫克可降低血脂。LDL正常参考值＜3.12毫摩尔/升。')];
    expect(knowledgeVerificationTriggers(facts)).toEqual([]);
    expect(buildKnowledgeConsistencyRequest('血脂管理','digest',facts).researchRequired).toBe(false);
    const questions=[fact('原文。<!-- 待核：两处LDL参考值不同，适用条件不明确 -->')];
    expect(knowledgeVerificationTriggers(questions)[0]).toMatchObject({pageId:'p1',factIndex:0,quote:'两处LDL参考值不同，适用条件不明确',reasons:['uncertainty_or_conflict']});
    expect(buildKnowledgeConsistencyRequest('血脂管理','digest',questions).researchRequired).toBe(true);
  });
  it('菜谱用量、版式和一般叙述不强制搜索，不因关键词直接改正文',()=>{
    const source='材料：香菇100克，水300毫升。切片煮熟。';
    expect(knowledgeVerificationTriggers([fact(source)])).toEqual([]);
    expect(knowledgeVerificationTriggers([fact('表格用绿色边框。','版式')])).toEqual([]);
    expect(buildKnowledgeConsistencyRequest('食谱','digest',[fact(source)]).researchRequired).toBe(false);
    expect(source).toContain('100克');
  });
  it('正常否定也只交给核实顾问判断，检测函数不删句或改义',()=>{
    const statement='不能自行停药。没有证据证明按摩能降低血脂。';
    const input=[fact(statement)];
    expect(knowledgeVerificationTriggers(input)).toEqual([]);
    expect(input[0].statement).toBe(statement);
  });
});

import {KNOWLEDGE_VERIFICATION_EDIT_POLICY,knowledgeVerificationQueries,knowledgeVerificationSourceEvidence} from './knowledgeVerificationPolicy';
import {invokeKnowledgePublicationRoutes} from './knowledgePublicationRoutes';
import {vi} from 'vitest';

it('检索原句不只搜书名；查不到保留作者经验且不捏造治疗建议',()=>{
 const facts=[fact('疑点：作者认为香菇能溶解胆固醇，作用含义不清。')];
 const request=buildKnowledgeConsistencyRequest('独家配方手册','digest',facts);
 const payload=JSON.parse((request.contents[0].parts[0] as {text:string}).text);
 expect(payload.verificationQueries).toEqual(knowledgeVerificationQueries(facts));
 expect(payload.verificationQueries[0].query).toContain(facts[0].statement);
 expect(request.systemInstruction.parts[0].text).toContain('不用整本书名');
 expect(request.systemInstruction.parts[0].text).toContain(KNOWLEDGE_VERIFICATION_EDIT_POLICY);
 expect(request.systemInstruction.parts[0].text).toContain('不能将查不到资料改写为“无效”');
 expect(request.systemInstruction.parts[0].text).toContain('正文统一简短标为“作者独家经验”');
 expect(request.systemInstruction.parts[0].text).not.toContain('从最终正文删除');
});

it('销售和转载保留追溯但不独立作证，来源缺失不删原书或拒收正文',async()=>{
 const source={url:'https://mbook.kongfz.com/1/2/',title:'作者独家保健手册',content:'图书出版社，作者自述方法；加入购物车'};
 const request=buildKnowledgeConsistencyRequest('独家手册','digest',[fact('作者声称这个方法能降低胆固醇。')]);
 request.executionChannel='evolink';const storage=new Map<string,any>();
 const fetch=vi.fn(async()=>new Response(JSON.stringify({model:'glm-5.3-flashx',web_search:[{link:source.url,title:source.title,content:source.content}],choices:[{finish_reason:'stop',message:{content:'精简保留原书方法，正文标为作者独家经验。'}}]})));
 const evidence={prefix:'source-use',read:async(k:string)=>storage.get(k)||null,save:async(k:string,v:unknown)=>{storage.set(k,structuredClone(v));}};
 const first=await invokeKnowledgePublicationRoutes(request,evidence,{key:()=> 'test-key',fetch});
 const report=JSON.parse(JSON.parse(first.text).candidates[0].content.parts[0].text);
 expect(report.evidenceState).toBe('missing');expect(report.sources).toEqual([]);
 expect(report.retrievedSources).toEqual([source]);expect(report.excludedSources).toHaveLength(1);
 expect(report.verificationMarkdown).toContain('作者独家经验');
 await invokeKnowledgePublicationRoutes(request,evidence,{key:()=> 'test-key',fetch});expect(fetch).toHaveBeenCalledTimes(1);
 expect(knowledgeVerificationSourceEvidence([{url:'https://www.nhc.gov.cn/example',title:'膳食资料',content:'适用条件与研究结论'}]).sources).toHaveLength(1);
 expect(knowledgeVerificationSourceEvidence([]).evidenceState).toBe('missing');
});


it('无疑点不搜索，明确指出的疑点才核实',()=>{
 expect(knowledgeVerificationTriggers([fact('燕麦含膳食纤维，有助改善血脂。每天吃水果200克。作者独家经验：做菜先分好调味料。')])).toEqual([]);
 expect(buildKnowledgeConsistencyRequest('饮食科普','digest',[fact('每天吃水果200克。')]).researchRequired).toBe(false);
 expect(knowledgeVerificationTriggers([fact('他汀每天10毫克，影响药物代谢。')])).toEqual([]);
 expect(knowledgeVerificationTriggers([fact('疑点：这种食品被称可替代药物，原文依据无法确认。')]).length).toBeGreaterThan(0);
});
