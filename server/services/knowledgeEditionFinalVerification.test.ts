import {knowledgeReviewFromMarkdown} from './knowledgeMarkdownReview';
import {it,expect,vi} from 'vitest';
import {verifyKnowledgeEditionManuscripts} from './knowledgeEditionFinalVerification';
import {knowledgeModulesFromMarkdown} from '../../shared/knowledgeCardEdition';
const setup=()=>{const data=new Map<string,any>();return {data,evidence:{prefix:'test',read:async(k:string)=>data.get(k)||null,save:async(k:string,v:any)=>{data.set(k,v);}}};};
it('检索明确未取证的原章疑点不能因修订省略标记而消失',async()=>{
 const f=setup(),question='原书比例未取得独立证据',source=`正文。<!-- 待核：${question} -->`;
 const invoke=vi.fn(async(req:any)=>({status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(req.researchOnly?{sources:[{title:'其他问题依据',url:'https://example.invalid/source'}],unresolvedQuestions:[question]}:{pages:[{body:'改成作者概括但未查明。'}]})}]}}]})}));
 const [body]=await verifyKnowledgeEditionManuscripts([source],f.evidence,invoke as any);
 expect(body).toContain(`待验证：${question}`);expect(f.data.get('test/verified.json').pendingVerification).toContainEqual({pageIndex:0,message:question});
 expect(f.data.get('test/verified.json').issues).toEqual([]);
});
it('未解决项引用别章疑点必须拒绝，不能串章追加',async()=>{
 const f=setup();const invoke=vi.fn(async(req:any)=>({status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(req.researchOnly?{sources:[{url:'https://example.invalid/source'}],unresolvedQuestions:['另一章问题']}:{pages:[{body:'本章正文'}]})}]}}]})}));
 await expect(verifyKnowledgeEditionManuscripts(['正文。<!-- 待核：本章问题 -->'],f.evidence,invoke as any)).rejects.toThrow('不属于本章');
});
it('同一内容重入顺序变化使用原有序清单，内容或数量变化必须拒绝',async()=>{
 const f=setup(),invoke=vi.fn();const original=['甲的完整内容。','乙的完整内容。'];
 await verifyKnowledgeEditionManuscripts(original,f.evidence,invoke as any);
 expect(await verifyKnowledgeEditionManuscripts([...original].reverse(),f.evidence,invoke as any)).toEqual(original);
 await expect(verifyKnowledgeEditionManuscripts(['甲的完整内容。','改变正文。'],f.evidence,invoke as any)).rejects.toThrow('原稿变化');
 await expect(verifyKnowledgeEditionManuscripts([...original,original[0]],f.evidence,invoke as any)).rejects.toThrow('原稿变化');
 expect(invoke).not.toHaveBeenCalled();
});
it('JSON章内三级标题绑定原章身份，不误报遗漏或重复追加旧正文',async()=>{
 const f=setup(),source='# 手册\n\n## 主要重点｜原章节\n旧说法。<!-- 待核：单位前后矛盾 -->';
 const invoke=vi.fn(async(req:any)=>({status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(req.researchOnly?{sources:[{title:'测试资料',url:'https://example.invalid/source'}]}:{pages:[{body:'### 核实后的解释\n\n新内容与必要条件。',reading:{version:1,blocks:[{type:'prose',title:'核实后的解释',note:'',text:'新内容与必要条件。'}]},cautions:[]}]})}]}}]})}));
 const [body]=await verifyKnowledgeEditionManuscripts([source],f.evidence,invoke as any);
 const modules=knowledgeModulesFromMarkdown(body).modules;
 expect(modules).toHaveLength(1);expect(modules[0]).toMatchObject({headline:'原章节',priority:'primary'});
 expect(body).toContain('新内容与必要条件');expect(body).not.toContain('旧说法');
 expect(f.data.get('test/verified.json').issues).toEqual([]);
 await verifyKnowledgeEditionManuscripts([source],f.evidence,invoke as any);expect(invoke).toHaveBeenCalledTimes(2);
});
it('无实际疑点零联网零额外修订，原文逐字保留，恢复不购买',async()=>{const f=setup(),invoke=vi.fn(),progress=vi.fn();const bodies=['# 食谱\n\n水果200克。','# 血脂\n\n他汀每天10毫克。'];expect(await verifyKnowledgeEditionManuscripts(bodies,f.evidence,invoke as any,progress)).toEqual(bodies);expect(invoke).not.toHaveBeenCalled();expect(progress).not.toHaveBeenCalled();expect(f.data.get('test/verified.json').skipped).toBe(true);await verifyKnowledgeEditionManuscripts(bodies,f.evidence,invoke as any);expect(invoke).not.toHaveBeenCalled();});
it('混合稿只搜索和修订实际疑点组，其他组原样旁路',async()=>{const f=setup(),progress=vi.fn();const invoke=vi.fn(async(req:any)=>({status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(req.researchOnly?{verificationMarkdown:'仅处理单位疑问',sources:[{title:'测试资料',url:'https://example.invalid/source',content:'单位条件'}]}:{pages:[{body:'已厘清单位。'}]})}]}}]})}));const result=await verifyKnowledgeEditionManuscripts(['无疑点的菜谱。','正文。<!-- 待核：两处单位不同，含义不清 -->'],f.evidence,invoke as any,progress);expect(result).toEqual(['无疑点的菜谱。','已厘清单位。']);expect(invoke).toHaveBeenCalledTimes(2);expect((invoke.mock.calls[0][0] as any).researchRequired).toBe(true);expect(f.data.has('test/search-0/request.json')).toBe(false);expect(f.data.has('test/revision-0/request.json')).toBe(false);await verifyKnowledgeEditionManuscripts(['无疑点的菜谱。','正文。<!-- 待核：两处单位不同，含义不清 -->'],f.evidence,invoke as any);expect(invoke).toHaveBeenCalledTimes(2);});
it('空标题不删除，末段补齐且逐页先保存；一页搜索失败不阻断下一页',async()=>{
 const f=setup();const calls:string[]=[];
 const invoke=vi.fn(async(req:any,scope:any)=>{
  calls.push(scope.prefix);
  expect(f.data.has('test/pages/0.json')).toBe(true);
  if(scope.prefix.endsWith('search-0'))throw Error('HTTP 503');
  return {status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(req.researchOnly?{verificationMarkdown:'已有来源'}:{pages:[{body:'# 手册\n\n## 次要重点｜乙\n补齐的正文与来源条件。'}]})}]}}]})};
 });
 const source=['# 手册\n\n## 次要重点｜甲','# 手册\n\n## 次要重点｜乙'];
 const result=await verifyKnowledgeEditionManuscripts(source,f.evidence,invoke as any);
 expect(result[0]).toBe(source[0]);expect(result[1]).toContain('补齐的正文');
 expect(f.data.get('test/pages/0.json').status).toBe('saved');
 expect(f.data.get('test/verified.json').complete).toBe(false);
 expect(calls).toEqual(['test/search-0','test/search-1','test/revision-1']);
 await verifyKnowledgeEditionManuscripts(source,f.evidence,invoke as any);expect(invoke).toHaveBeenCalledTimes(3);
});
it('局部回执未知不新购，保留原页且继续保存其他页',async()=>{
 const f=setup(),invoke=vi.fn();const source=['# 甲\n\n## 次要重点｜空章\n<!-- 待核：失败 -->\n<!-- 回执待确认：未闭合 -->','正常正文。'];
 expect(await verifyKnowledgeEditionManuscripts(source,f.evidence,invoke as any)).toEqual(source);
 expect(invoke).not.toHaveBeenCalled();expect(f.data.get('test/pages/1.json').body).toBe(source[1]);
 expect(f.data.get('test/verified.json').issues[0].kind).toBe('unknown_receipt');
});

it('正式Markdown解析后的未解cautions标待验证并放行，恢复零调用',async()=>{
 const f=setup();const original='# 手册\n\n## 方法\n原有步骤。\n\n<!-- 待核：原句「原有步骤」；问题：条件不清楚 -->';
 const invoke=vi.fn(async(req:any)=>{
  const value=req.researchOnly?{verificationMarkdown:'有资料但仍有条件未明',sources:[{title:'测试资料',url:'https://example.invalid/source',content:'部分条件'}]}:knowledgeReviewFromMarkdown(original,{title:'手册',pages:[{id:'00000000-0000-4000-8000-000000000001',headline:'方法',body:original,imageUrl:''}]},'a'.repeat(64));
  return {status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}]})};
 });
 const out=await verifyKnowledgeEditionManuscripts([original],f.evidence,invoke as any);
 expect(out[0]).toContain('待验证：');expect(out[0]).not.toContain('<!-- 待核：');
 expect(f.data.get('test/verified.json').complete).toBe(true);
 expect(f.data.get('test/verified.json').pendingVerification).toHaveLength(1);
 expect(f.data.get('test/verified.json').issues).toEqual([]);
 const calls=invoke.mock.calls.length;await verifyKnowledgeEditionManuscripts([original],f.evidence,invoke as any);expect(invoke).toHaveBeenCalledTimes(calls);
});

it('实际检索无可用资料保留原文标待验证，只搜索不另购改写且放行',async()=>{
 const f=setup(),invoke=vi.fn(async()=>({status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({verificationMarkdown:'未找到可用资料',evidenceState:'missing',sources:[]})}]}}]})}));
 const source='# 手册\n\n## 方法\n原书的方法仍完整保留。\n\n<!-- 待核：原句「原书的方法」；问题：条件不清楚 -->';
 const out=await verifyKnowledgeEditionManuscripts([source],f.evidence,invoke as any);
 expect(out[0]).toContain('原书的方法仍完整保留');expect(out[0]).toContain('待验证：');
 expect(invoke).toHaveBeenCalledTimes(1);expect(f.data.get('test/verified.json').complete).toBe(true);
 expect(f.data.get('test/verified.json').pendingVerification).toHaveLength(1);
 await verifyKnowledgeEditionManuscripts([source],f.evidence,invoke as any);expect(invoke).toHaveBeenCalledTimes(1);
});
