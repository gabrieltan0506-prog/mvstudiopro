import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {__setKnowledgeCardDistillGatewayInvokerForTest,makeKnowledgeCardPageSelector} from './knowledgeCardDistill';
import {pageTriageTestHooks,invokePageTriageJson} from './knowledgeCardPageTriage';
import {KNOWLEDGE_CARD_DISTILL_MODEL_GLM} from '../../shared/knowledgeCardDistillModels';
const sheets=(n:number)=>Array.from({length:n},(_,i)=>({index:i,pageNumbers:[i+1],imageUrl:`https://example.invalid/${i+1}.png`,gcsUri:`gs://test/${i+1}`}));
const answer=(n:number)=>JSON.stringify({pages:[{page:n,reason:'测试结构页'},{page:99999,reason:'不属于本批，必须过滤'}]});
beforeEach(()=>{vi.stubEnv('OPENROUTER_API_KEY','test-key');vi.stubEnv('EVOLINK_API_KEY','test-key');vi.stubEnv('KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS','0');});
afterEach(()=>{__setKnowledgeCardDistillGatewayInvokerForTest(null);vi.unstubAllEnvs();});
it('31张分4批同时在途，双供应商各2批，乱序回包按原批序归位且进度不倒退',async()=>{
 const calls:{p:any;resolve:(v:string)=>void}[]=[];
 __setKnowledgeCardDistillGatewayInvokerForTest(p=>new Promise(resolve=>calls.push({p,resolve})));
 const progress:number[]=[];
 const result=makeKnowledgeCardPageSelector(KNOWLEDGE_CARD_DISTILL_MODEL_GLM)(sheets(31),31,async done=>{progress.push(done);});
 await vi.waitFor(()=>expect(calls).toHaveLength(4));
 expect(calls.map(c=>c.p.gateway).sort()).toEqual(['evolink','evolink','openrouter','openrouter']);
 expect(calls.map(c=>c.p.imageUrls.length).sort()).toEqual([7,8,8,8]);
 for(const c of [...calls].reverse()){const first=Number(c.p.imageUrls[0].match(/\/(\d+)\.png/)[1]);c.resolve(answer(first));}
 expect((await result).map(x=>x.pageNumber)).toEqual([1,9,17,25]);
 expect(progress).toEqual([...progress].sort((a,b)=>a-b));expect(progress.at(-1)).toBe(31);
 expect(calls).toHaveLength(4);
});
// 2026-11-08 动态并发：每通道按本通道批数一轮发完（≥原5路，≤通道上限），12批两通道各6路同时在途。
it('两通道按批数动态并发一轮发完，不重复发送成功批',async()=>{
 const calls:{p:any;resolve:(v:string)=>void;finished:boolean}[]=[];
 const active={openrouter:0,evolink:0},peak={openrouter:0,evolink:0};
 __setKnowledgeCardDistillGatewayInvokerForTest(p=>new Promise(resolve=>{
  const route=p.gateway as keyof typeof active;active[route]++;peak[route]=Math.max(peak[route],active[route]);
  calls.push({p,finished:false,resolve:v=>{active[route]--;resolve(v);}});
 }));
 const result=makeKnowledgeCardPageSelector(KNOWLEDGE_CARD_DISTILL_MODEL_GLM)(sheets(96),96);
 await vi.waitFor(()=>expect(calls).toHaveLength(12));
 expect(peak).toEqual({openrouter:6,evolink:6});
 for(const c of [...calls]){c.finished=true;c.resolve(answer(Number(c.p.imageUrls[0].match(/\/(\d+)\.png/)[1])));}
 expect(await result).toHaveLength(12);expect(calls).toHaveLength(12);
 expect(new Set(calls.map(c=>c.p.imageUrls[0])).size).toBe(12);
});
it('一批普通失败不丢其他批，也不重读已成功批',async()=>{
 const seen:string[]=[];
 __setKnowledgeCardDistillGatewayInvokerForTest(async p=>{
  seen.push(p.imageUrls![0]);const n=Number(p.imageUrls![0].match(/\/(\d+)\.png/)![1]);
  if(n===9)throw Error('HTTP 401 test upstream exhausted');return answer(n);
 });
 const result=await makeKnowledgeCardPageSelector(KNOWLEDGE_CARD_DISTILL_MODEL_GLM)(sheets(31),31);
 expect(result.map(x=>x.pageNumber)).toEqual([1,17,25]);expect(seen).toHaveLength(4);
});
it('取消终止在途并停止领新批，等待已启动批次收尾',async()=>{
 const abort=new AbortController();let calls=0;
 __setKnowledgeCardDistillGatewayInvokerForTest(p=>new Promise((_resolve,reject)=>{calls++;p.abortSignal!.addEventListener('abort',()=>reject(p.abortSignal!.reason),{once:true});}));
 const running=makeKnowledgeCardPageSelector(KNOWLEDGE_CARD_DISTILL_MODEL_GLM,abort.signal)(sheets(96),96);
 const rejected=expect(running).rejects.toThrow('test cancel');
 await vi.waitFor(()=>expect(calls).toBe(12));abort.abort(new Error('test cancel'));await rejected;expect(calls).toBe(12);
});
it('DeepSeek首选EvoLink的批失败后仍回退同模型OpenRouter',async()=>{
 vi.stubEnv('OPENROUTER_API_KEY','test-key');vi.stubEnv('EVOLINK_API_KEY','test-key');const seen:string[]=[];
 const result=await pageTriageTestHooks.run({chat:async gw=>{seen.push(gw.name);if(gw.name==='evolink')throw Error('test upstream');return answer(1);}},()=>invokePageTriageJson({system:'测试',userText:'测试',imageUrls:[],primary:'evolink'}));
 expect(result).toContain('"page":1');expect(seen).toEqual(['evolink','openrouter']);
});

it('GLM并发首选通道失败后仍先换同模型供应商',async()=>{
 const seen:string[]=[];
 __setKnowledgeCardDistillGatewayInvokerForTest(async p=>{seen.push(`${p.gateway}:${p.tier}`);if(p.gateway==='openrouter')throw Error('HTTP 503 test upstream');return answer(1);});
 expect((await makeKnowledgeCardPageSelector(KNOWLEDGE_CARD_DISTILL_MODEL_GLM)(sheets(8),8)).map(x=>x.pageNumber)).toEqual([1]);
 expect(seen).toEqual(['openrouter:glm','evolink:glm']);
});
