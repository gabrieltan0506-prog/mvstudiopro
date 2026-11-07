import {it,expect,vi} from 'vitest';
import {verifyKnowledgeEditionManuscripts} from './knowledgeEditionFinalVerification';
const setup=()=>{const data=new Map<string,any>();return {data,evidence:{prefix:'test',read:async(k:string)=>data.get(k)||null,save:async(k:string,v:any)=>{data.set(k,v);}}};};
it('无实际疑点零联网零额外修订，原文逐字保留，恢复不购买',async()=>{const f=setup(),invoke=vi.fn(),progress=vi.fn();const bodies=['# 食谱\n\n水果200克。','# 血脂\n\n他汀每天10毫克。'];expect(await verifyKnowledgeEditionManuscripts(bodies,f.evidence,invoke as any,progress)).toEqual(bodies);expect(invoke).not.toHaveBeenCalled();expect(progress).not.toHaveBeenCalled();expect(f.data.get('test/verified.json').skipped).toBe(true);await verifyKnowledgeEditionManuscripts(bodies,f.evidence,invoke as any);expect(invoke).not.toHaveBeenCalled();});
it('混合稿只搜索和修订实际疑点组，其他组原样旁路',async()=>{const f=setup(),progress=vi.fn();const invoke=vi.fn(async(req:any)=>({status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(req.researchOnly?{verificationMarkdown:'仅处理单位疑问',sources:[]}:{pages:[{body:'已厘清单位。'}]})}]}}]})}));const result=await verifyKnowledgeEditionManuscripts(['无疑点的菜谱。','正文。<!-- 待核：两处单位不同，含义不清 -->'],f.evidence,invoke as any,progress);expect(result).toEqual(['无疑点的菜谱。','已厘清单位。']);expect(invoke).toHaveBeenCalledTimes(2);expect((invoke.mock.calls[0][0] as any).researchRequired).toBe(true);expect(f.data.has('test/search-0/request.json')).toBe(false);expect(f.data.has('test/revision-0/request.json')).toBe(false);await verifyKnowledgeEditionManuscripts(['无疑点的菜谱。','正文。<!-- 待核：两处单位不同，含义不清 -->'],f.evidence,invoke as any);expect(invoke).toHaveBeenCalledTimes(2);});
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
