import {createHash} from 'node:crypto';
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
 expect(invoke).not.toHaveBeenCalled();
 // 无需核实的章节由原文确定性得出，不再逐章落盘（分工 L2-B）。
 expect(f.data.has('test/pages/1.json')).toBe(false);expect(f.data.get('test/pages/0.json').status).toBe('saved');
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

it('读取已存核实章节遇到一次断线时原位重试，沿用旧结果且不发模型请求',async()=>{
  const f=setup(), invoke=vi.fn();
  const bodies=['已核实的正文。<!-- 待核：原章疑点 -->'];
  const {createHash}=await import('node:crypto');
  const digest=createHash('sha256').update(JSON.stringify(bodies)).digest('hex');
  f.data.set('test/pages/0.json',{status:'saved',digest,body:'已保存正文'});
  let reads=0;
  const read=async(key:string)=>{
    if(key==='test/pages/0.json' && ++reads===1)throw new TypeError('fetch failed');
    return f.evidence.read(key);
  };
  const result=await verifyKnowledgeEditionManuscripts(bodies,{...f.evidence,read},invoke);
  expect(result).toEqual(['已保存正文']);
  expect(reads).toBe(2);
  expect(invoke).not.toHaveBeenCalled();
});

it("云存储瞬态读错最多重试四次，嵌套检查不放大重试次数",async()=>{
  const {guardKnowledgeEditionEvidence}=await import("./knowledgeEditionRecovery");
  vi.useFakeTimers();
  try {
    for(const succeeds of [true,false]){
      const start=Date.now();
      const readTimes:number[]=[];
      const evidence=guardKnowledgeEditionEvidence(guardKnowledgeEditionEvidence({...setup().evidence,read:async()=>{
        readTimes.push(Date.now()-start);
        if(readTimes.length===5 && succeeds)return {ok:true};
        throw new TypeError("fetch failed");
      }}));
      const result=evidence.read("test");
      const assertion=succeeds?expect(result).resolves.toEqual({ok:true}):expect(result).rejects.toThrow("章节检查点");
      await vi.runAllTimersAsync();await assertion;
      expect(readTimes).toEqual([0,3000,8000,23000,53000]);
    }
  }finally{vi.useRealTimers();}
});

it('915个乱序完成批次恢复时首报915，只对177个缺口检索，成稿按原章顺序',async()=>{
  const f=setup();
  const evidence={...f.evidence,listKeys:async(prefix:string)=>Array.from(f.data.keys()).filter(k=>k.startsWith(prefix))};
  const bodies=Array.from({length:1092},(_,i)=>`第${i}章。<!-- 待核：本章史料 -->`);
  const digest=createHash('sha256').update(JSON.stringify(bodies)).digest('hex');
  f.data.set('test/input.json',{digest,bodies});
  const missing=new Set(Array.from({length:177},(_,i)=>i*6));
  for(let i=0;i<bodies.length;i++)if(!missing.has(i)){
    f.data.set(`test/completed/${digest}/${i}.json`,{status:'saved',pageIndex:i,digest,body:`已保存第${i}章`});
  }
  const invoked:number[]=[];
  const invoke=vi.fn(async(_req:any,scope:any)=>{
    invoked.push(Number(scope.prefix.split('search-').pop()));
    return {status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({evidenceState:'missing',sources:[]})}]}}]})};
  });
  const progress=vi.fn();
  const result=await verifyKnowledgeEditionManuscripts(bodies,evidence,invoke as any,progress);
  expect(progress.mock.calls[0][0]).toEqual({doneBatches:915,totalBatches:1092,pass:3});
  expect(invoked.sort((a,b)=>a-b)).toEqual(Array.from(missing));
  expect(result).toHaveLength(1092);
  for(let i=0;i<bodies.length;i++)expect(result[i]).toContain(missing.has(i)?`第${i}章`:`已保存第${i}章`);
  expect(await evidence.listKeys(`test/completed/${digest}/`)).toHaveLength(1092);
});

it('旧单只迁移已保存的回执，中断后直接从已建清单恢复',async()=>{
  const f=setup();
  const bodies=['旧章。<!-- 待核：旧史料 -->'];
  const digest=createHash('sha256').update(JSON.stringify(bodies)).digest('hex');
  f.data.set('test/input.json',{digest,bodies});
  f.data.set('test/pages/0.json',{digest,status:'saved',body:'旧核实正文'});
  let interrupt=true;
  const evidence={...f.evidence,listKeys:async(prefix:string)=>Array.from(f.data.keys()).filter(k=>k.startsWith(prefix)),
    save:async(key:string,value:unknown)=>{
      if(key==='test/verified.json'&&interrupt)throw Error('测试中断');
      await f.evidence.save(key,value);
    }};
  const invoke=vi.fn(),progress=vi.fn();
  await expect(verifyKnowledgeEditionManuscripts(bodies,evidence,invoke)).rejects.toThrow('章节检查点');
  interrupt=false;
  f.data.delete('test/pages/0.json');
  expect(await verifyKnowledgeEditionManuscripts(bodies,evidence,invoke,progress)).toEqual(['旧核实正文']);
  expect(progress.mock.calls[0][0].doneBatches).toBe(1);
  expect(invoke).not.toHaveBeenCalled();
});

it('完成清单暂时读不到时停止，不把清单当空重派',async()=>{
  const f=setup(),invoke=vi.fn(),bodies=['正文。<!-- 待核：资料 -->'];
  const digest=createHash('sha256').update(JSON.stringify(bodies)).digest('hex');
  f.data.set('test/input.json',{digest,bodies});
  const evidence={...f.evidence,listKeys:async()=>{throw Error('gcs_list_failed:503');}};
  await expect(verifyKnowledgeEditionManuscripts(bodies,evidence,invoke)).rejects.toThrow('章节检查点');
  expect(invoke).not.toHaveBeenCalled();
});

it("核实任务只对检查点网络故障安排四次原单重试",async()=>{
  const {guardKnowledgeEditionEvidence, isTransientEditionCheckpointError, editionCheckpointRequeueDelay}=await import("./knowledgeEditionRecovery");
  for(const [message,expected] of [["gcs_upload_failed:503:busy",true],["gcs_upload_failed:403:denied",false]] as const){
    const evidence=guardKnowledgeEditionEvidence({...setup().evidence,save:async()=>{throw Error(message);}});
    vi.useFakeTimers();
    let err;
    try {
      const result=evidence.save("test",{}).catch(e=>e);
      await vi.runAllTimersAsync();err=await result;
    }finally{vi.useRealTimers();}
    expect(isTransientEditionCheckpointError(err)).toBe(expected);
  }
  expect([1,2,3,4,5].map(editionCheckpointRequeueDelay)).toEqual([3000,5000,15000,30000,undefined]);
});

it("待发送回执写入断线：四次延迟重写同一对象，只在保存成功后派发一次",async()=>{
  const {guardKnowledgeEditionEvidence}=await import("./knowledgeEditionRecovery");
  const request={state:"pending",requestDigest:"test-digest"};
  const upstream=vi.fn();
  const saved=new Map<string,unknown>();
  const writes:{key:string;value:unknown;ms:number}[]=[];
  vi.useFakeTimers();
  try {
    const start=Date.now();
    const evidence=guardKnowledgeEditionEvidence(guardKnowledgeEditionEvidence({...setup().evidence,
      save:async(key,value)=>{
        writes.push({key,value,ms:Date.now()-start});
        saved.set(key,value);
        if(writes.length<5)throw new TypeError("fetch failed");
      }}));
    const send=evidence.save("search/test.pending.json",request).then(upstream);
    await vi.advanceTimersByTimeAsync(52999);
    expect(upstream).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);await send;
    expect(writes.map(w=>w.ms)).toEqual([0,3000,8000,23000,53000]);
    expect(writes.every(w=>w.key==="search/test.pending.json" && w.value===request)).toBe(true);
    expect(saved.size).toBe(1);expect(upstream).toHaveBeenCalledTimes(1);
  }finally{vi.useRealTimers();}
});
