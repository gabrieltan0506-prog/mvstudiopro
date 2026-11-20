import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {verifyKnowledgeEditionManuscripts,verifyKnowledgeEditionManuscriptsDetailed} from './knowledgeEditionFinalVerification';
import {KnowledgeEditionPersistenceError} from './knowledgeEditionRecovery';

// 分工 L2：无需核实章节零存取、核实返回完整结果、单章检查点瞬态失败不整单停、两通道共用待办池。
const envelope=(value:unknown)=>({status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}]})});
const store=(prefix='t')=>{
 const data=new Map<string,any>();const writes:string[]=[],reads:string[]=[];
 const evidence={prefix,read:async(k:string)=>{reads.push(k);return data.get(k)??null;},save:async(k:string,v:any)=>{writes.push(k);data.set(k,structuredClone(v));},
  listKeys:async(p:string)=>Array.from(data.keys()).filter(k=>k.startsWith(p))};
 return {data,writes,reads,evidence};
};
const plain=(i:number)=>`# 手册\n\n## 次要重点｜章${i}\n普通正文${i}。`;
const doubt=(i:number)=>`# 手册\n\n## 次要重点｜章${i}\n原内容${i}。\n\n<!-- 待核：原句「原内容${i}」；问题：条件不清楚 -->`;
const book=()=>Array.from({length:100},(_,i)=>i%10<3?doubt(i):plain(i)); // 30 章待核
/** 替身：按 scope.prefix 缓存回包，模拟路由层「同对象名已有回执即零购买」；purchases 只计真实购买。 */
const cachedInvoke=(data:Map<string,any>,purchases:{prefix:string;channel:string}[],delayFor?:(channel:string)=>number)=>vi.fn(async(req:any,scope:any)=>{
 const key=`${scope.prefix}/route-test.json`;
 if(data.has(key))return data.get(key);
 purchases.push({prefix:scope.prefix,channel:req.executionChannel});
 const wait=delayFor?.(req.executionChannel)||0;
 if(wait)await new Promise(r=>setTimeout(r,wait));
 const i=Number(scope.prefix.match(/(\d+)$/)[1]);
 const value=envelope(req.researchOnly?{evidenceState:'available',sources:[{title:'资料',url:'https://example.invalid/s',content:'条件'}],verificationMarkdown:'有资料'}
  :{pages:[{body:`# 手册\n\n## 次要重点｜章${i}\n已核实${i}。`}]});
 await scope.save(key,value);return value;
});

it('B/E：100章中30章待核，非待核章零存取零调用；结果与旧实现逐字相同；返回完整结构且与verified.json一致',async()=>{
 const {verifyKnowledgeEditionManuscripts:legacy}=await import('./knowledgeEditionFinalVerification.legacySnapshot');
 const bodies=book();
 const old=store(),oldBuy:any[]=[];
 const legacyOut=await legacy(bodies,old.evidence as any,cachedInvoke(old.data,oldBuy) as any);
 const f=store(),buy:any[]=[];
 const out=await verifyKnowledgeEditionManuscriptsDetailed(bodies,f.evidence as any,cachedInvoke(f.data,buy) as any);
 expect(out.bodies).toEqual(legacyOut);
 const saved=f.data.get('t/verified.json');
 expect({bodies:saved.bodies,issues:saved.issues,pendingVerification:saved.pendingVerification,complete:saved.complete}).toEqual(out);
 // verified.json 内容与旧实现逐字一致（别处有读者）。
 expect(saved).toEqual(old.data.get('t/verified.json'));
 const plainIdx=bodies.map((_,i)=>i).filter(i=>i%10>=3);
 const touches=(i:number)=>[...f.writes,...f.reads].some(k=>new RegExp(`(?:pages|completed/[0-9a-f]+|search|revision|candidates)[-/]${i}(?:\\.json|/)`).test(k));
 expect(plainIdx.filter(touches)).toEqual([]);
 expect(buy.every(p=>Number(p.prefix.match(/(\d+)$/)[1])%10<3)).toBe(true);
 expect(buy).toHaveLength(60);
 // 回放：命中 verified.json 返回同样结构，零调用零逐章写。
 const writes=f.writes.length,again=cachedInvoke(f.data,buy);
 expect(await verifyKnowledgeEditionManuscriptsDetailed(bodies,f.evidence as any,again as any)).toEqual(out);
 expect(again).not.toHaveBeenCalled();expect(f.writes.length).toBe(writes);
});

it('B/F：旧任务夹具含非待核章 completed 对象，续作结果不变、首报=已完成数、只补缺口',async()=>{
 const bodies=book();
 const digest=createHash('sha256').update(JSON.stringify(bodies)).digest('hex');
 const f=store();f.data.set('t/input.json',{digest,bodies});
 for(let i=0;i<100;i++)if(i%10>=3||i<50)f.data.set(`t/completed/${digest}/${i}.json`,{status:'saved',pageIndex:i,digest,body:i%10<3?`旧核实${i}`:bodies[i],verification:null,issues:[],pendingVerification:[]});
 const buy:any[]=[],progress=vi.fn();
 const out=await verifyKnowledgeEditionManuscripts(bodies,f.evidence as any,cachedInvoke(f.data,buy) as any,progress);
 expect(progress.mock.calls[0][0]).toEqual({doneBatches:15,totalBatches:30,pass:3});
 for(let i=0;i<100;i++)expect(out[i]).toBe(i%10>=3?bodies[i]:i<50?`旧核实${i}`:`# 手册\n\n## 次要重点｜章${i}\n已核实${i}。`);
 expect(buy).toHaveLength(30);
 // 非待核章旧对象不读不删。
 expect(f.reads.filter(k=>k.includes('/completed/')&&Number(k.split('/').pop()!.split('.')[0])%10>=3)).toEqual([]);
 expect(f.data.has(`t/completed/${digest}/3.json`)).toBe(true);
});

it('D：一章检查点写入瞬态失败放回队尾，稍后成功，整单不失败，购买次数不增加；已存request.json逐字回放',async()=>{
 vi.useFakeTimers();
 try{
  const bodies=book(),f=store(),buy:any[]=[];
  let failed=0;
  const save=f.evidence.save;
  // 第 0 章检索回包已落盘后，report.json 写入失败（存取层四次原位重试后仍失败）。
  f.evidence.save=async(k:string,v:any)=>{if(k==='t/search-0/report.json'&&failed<5){failed++;throw new TypeError('fetch failed');}return save(k,v);};
  const requests=new Map<string,string>();
  const invoke=cachedInvoke(f.data,buy);
  const wrapped=vi.fn(async(req:any,scope:any)=>{const k=`${scope.prefix}/request.json`;const s=JSON.stringify(f.data.get(k));if(requests.has(k))expect(s).toBe(requests.get(k));else requests.set(k,s);return invoke(req,scope);});
  const run=verifyKnowledgeEditionManuscriptsDetailed(bodies,f.evidence as any,wrapped as any,undefined,{checkpointRequeueMs:[1000,2000,3000]});
  await vi.runAllTimersAsync();
  const out=await run;
  expect(failed).toBe(5);
  expect(out.bodies[0]).toContain('已核实0');expect(out.issues).toEqual([]);
  expect(buy).toHaveLength(60); // 与无故障时相同：重试走回执复用，不重买
  expect(wrapped.mock.calls.length).toBeGreaterThan(60);
 }finally{vi.useRealTimers();}
});

it('D：超过三次放回仍失败才整单抛出（可由 runner 延迟重排），不变量错误立即停',async()=>{
 vi.useFakeTimers();
 try{
  const bodies=[doubt(0),doubt(1)],f=store();
  f.evidence.save=async(k:string)=>{if(k.startsWith('t/candidates-0'))throw new TypeError('fetch failed');};
  const run=verifyKnowledgeEditionManuscripts(bodies,f.evidence as any,vi.fn() as any,undefined,{checkpointRequeueMs:[10,20,30]}).catch(e=>e);
  await vi.runAllTimersAsync();
  const err=await run;
  expect(err).toBeInstanceOf(KnowledgeEditionPersistenceError);
 }finally{vi.useRealTimers();}
 const g=store();
 const invoke=vi.fn(async()=>{throw Error('核实输入变化，不能重新购买');});
 await expect(verifyKnowledgeEditionManuscripts([doubt(0),doubt(1),doubt(2)],g.evidence as any,invoke as any,undefined,{checkpointRequeueMs:[10]})).rejects.toThrow('输入变化');
});

it('A：通道A慢、B快，B 在 A 满载时接走 A 名下未开始的章节，总耗时显著下降；新建请求用实际领取工位的通道',async()=>{
 vi.useFakeTimers();
 try{
  const bodies=Array.from({length:40},(_,i)=>doubt(i));
  const f=store(),buy:{prefix:string;channel:string}[]=[];
  const delay=(c:string)=>c==='evolink'?10000:1000;
  const start=Date.now();
  const run=verifyKnowledgeEditionManuscripts(bodies,f.evidence as any,cachedInvoke(f.data,buy,delay) as any,undefined,{channelMax:4});
  await vi.runAllTimersAsync();await run;
  const elapsed=Date.now()-start;
  // 不互借：evolink 名下 20 章、4 路、每章两次 10s → 5 轮 × 20s = 100s。
  expect(elapsed).toBeLessThan(50000);
  // 偶数序号原属 evolink；被 openrouter 接走的章节新建请求标 openrouter。
  const stolen=buy.filter(p=>p.prefix.includes('search-')&&Number(p.prefix.match(/(\d+)$/)[1])%2===0&&p.channel==='openrouter');
  expect(stolen.length).toBeGreaterThan(0);
  for(const p of stolen){const i=p.prefix.match(/(\d+)$/)[1];expect(f.data.get(`t/search-${i}/request.json`).request.executionChannel).toBe('openrouter');}
  // 同章检索与修订用同一领取通道。
  for(const p of buy.filter(p=>p.prefix.includes('revision-')))expect(p.channel).toBe(buy.find(q=>q.prefix===`t/search-${p.prefix.match(/(\d+)$/)[1]}`)!.channel);
 }finally{vi.useRealTimers();}
});

it('A：已存 request.json 的章节无论被哪个通道领取都按原请求回放',async()=>{
 const bodies=[doubt(0),doubt(1)],f=store(),seen:any[]=[];
 const digest=createHash('sha256').update(JSON.stringify(bodies)).digest('hex');
 const original={marker:'原请求',executionChannel:'evolink',researchOnly:true};
 f.data.set('t/input.json',{digest,bodies});f.data.set('t/search-0/request.json',{digest,request:original});
 const invoke=vi.fn(async(req:any)=>{seen.push(req);return envelope(req.researchOnly?{evidenceState:'missing',sources:[]}:{pages:[{body:'x'}]});});
 await verifyKnowledgeEditionManuscripts(bodies,f.evidence as any,invoke as any);
 expect(seen.find(r=>r.marker)).toEqual(original);
 expect(f.data.get('t/search-0/request.json').request).toEqual(original);
});
