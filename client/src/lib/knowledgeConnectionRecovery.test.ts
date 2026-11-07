import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
vi.mock("@/lib/flyHealthGate", () => ({withFlyHealthGate: (_origin: string, run:()=>Promise<Response>)=>run()}));
import { getJob, pollJobUntilTerminal, JobReceiptUnavailableError } from "./jobs";
import { createKnowledgeReadingController } from "./knowledgeReadingPreparation";
import { knowledgeCardTrackedJobId, submitKnowledgeCardOnce } from "./knowledgeCardTrackedSubmission";
import { useLongTrpcHttpLink } from "./trpcTransportRouting";
const link={jobId:"kc_original",documentId:"11111111-1111-4111-a111-111111111111",batches:1};
const draft={index:0,pages:[{headline:"从原稿整理的标题",body:"非空正文与最后一句，必须完整恢复。"}]};
const base={...link,status:"running",ready:[0],completed:[] as number[],failed:[] as number[],paidUnit:0,maxCredits:0,estimatedCredits:0,drafts:[] as typeof draft[]};
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe("原任务连接恢复",()=>{
 it("HTTP实际返回HTML/错误schema时不伪装成任务终态；两类任务直达既有API",async()=>{
  const requests:string[]=[];
  const server=createServer((req,res)=>{requests.push(req.url!);res.writeHead(200,{'Content-Type':'text/html'});res.end('<!DOCTYPE html><title>gateway</title>');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  vi.stubGlobal('window',{location:{origin:'https://www.mvstudiopro.com',hostname:'www.mvstudiopro.com'}});
  vi.stubEnv('VITE_FLY_API_ORIGIN',`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  try{
   await expect(getJob('kc_original')).rejects.toBeInstanceOf(JobReceiptUnavailableError);
   await expect(getJob('manhua_advisor_original')).rejects.toBeInstanceOf(JobReceiptUnavailableError);
   expect(requests).toEqual(['/api/jobs/kc_original','/api/jobs/manhua_advisor_original']);
  }finally{await new Promise<void>((r,e)=>server.close(err=>err?e(err):r()));}
 });
 it("连续超过六次HTML/断网后仍只GET同一任务，恢复后交付真实正文",async()=>{
  vi.useFakeTimers();const unavailable=vi.fn(),onPoll=vi.fn();let n=0;
  const fetch=vi.fn(async()=>{n++;if(n<=7)return new Response('<html>gateway</html>');if(n===8)throw TypeError('Failed to fetch');return new Response(JSON.stringify({status:'succeeded',output:{distilledMarkdown:'完整原文与结尾'}}),{headers:{'content-type':'application/json'}});});vi.stubGlobal('fetch',fetch);
  const result=pollJobUntilTerminal('kc_original',{maxWaitMs:600000,onUnavailable:unavailable,onPoll,intervalMs:1,maxIntervalMs:10});
  await vi.runAllTimersAsync();expect((await result).output?.distilledMarkdown).toBe('完整原文与结尾');expect(unavailable).toHaveBeenCalled();
  for(const [url,init] of (fetch.mock.calls as unknown as [string,RequestInit][])){expect(url).toContain('/api/jobs/kc_original');expect(init.method).toBe('GET');}
  expect(onPoll.mock.calls.map(([tick])=>tick.status)).toEqual(['succeeded']);
 });
 it("恢复期间用户离开会停止查询，真实failed不进入重提",async()=>{
  vi.useFakeTimers();const controller=new AbortController(),fetch=vi.fn(async()=>new Response('<html>gateway</html>'));vi.stubGlobal('fetch',fetch);
  const done=expect(pollJobUntilTerminal('kc_original',{signal:controller.signal,onUnavailable:()=>{controller.abort(Error('离开页面'));},maxIntervalMs:1})).rejects.toThrow('离开页面');
  await vi.runAllTimersAsync();await done;const count=fetch.mock.calls.length;await vi.advanceTimersByTimeAsync(60000);expect(fetch).toHaveBeenCalledTimes(count);
  fetch.mockResolvedValue(new Response(JSON.stringify({status:'failed',error:'已按你的要求停止读档'})));
  expect((await pollJobUntilTerminal('kc_original',{onUnavailable:vi.fn()})).status).toBe('failed');expect(fetch).toHaveBeenCalledTimes(count+1);
 });
 it("提交回包丢失保留服务端一致ID，不重发POST；明确拒绝原样返回",async()=>{
  const requestId='22222222-2222-4222-a222-222222222222';const id=await knowledgeCardTrackedJobId('1','knowledge_card_distill',requestId);
  expect(id).toBe('kc_'+createHash('sha256').update(JSON.stringify(['1','knowledge_card_distill',requestId])).digest('hex').slice(0,56));
  const post=vi.fn(async()=>{throw Error('Unexpected token <');});expect(await submitKnowledgeCardOnce(post)).toBeUndefined();expect(post).toHaveBeenCalledTimes(1);
  const refusal={data:{code:'FORBIDDEN'},message:'无权访问'};await expect(submitKnowledgeCardOnce(async()=>{throw refusal;})).rejects.toBe(refusal);
  expect(useLongTrpcHttpLink({path:'mvAnalysis.prepareKnowledgeCardCopy'})).toBe(true);expect(useLongTrpcHttpLink({path:'mvAnalysis.enqueueKnowledgeCardLevelDerive'})).toBe(true);
 });
 it("顾问回包丢失和内容GET失败后自行恢复，execute只有一次、非空正文可见",async()=>{
  vi.useFakeTimers();let completed=false,stateReads=0;
  const content=vi.fn(),execute=vi.fn(async()=>{throw Error('流中断');});
  const recover=vi.fn(async()=>{completed=true;return {creditsCharged:0,replayed:true};});
  const state=vi.fn(async()=>{stateReads++;if(stateReads===2)throw Error('502');return {...base,completed:completed?[0]:[],drafts:completed?[draft]:[]};});
  const control=createKnowledgeReadingController({state,execute,recover,content,confirm:async()=>true,progress:vi.fn()});
  await control.update({...link,ready:[0]});await vi.advanceTimersByTimeAsync(20000);await control.wait();
  expect(execute).toHaveBeenCalledTimes(1);expect(recover).toHaveBeenCalledTimes(1);expect(content).toHaveBeenLastCalledWith([draft]);control.stop();
 });
 it("读档本身完成后，相同进度仍能补回丢失的顾问正文",async()=>{
  vi.useFakeTimers();let reads=0;const content=vi.fn(),execute=vi.fn(async()=>({creditsCharged:0}));
  const control=createKnowledgeReadingController({state:async()=>{reads++;if(reads===2)throw Error('GET断开');return {...base,status:'succeeded',completed:reads>2?[0]:[],drafts:reads>2?[draft]:[]};},execute,content,confirm:async()=>true,progress:vi.fn()});
  await control.update({...link,ready:[0]});await vi.advanceTimersByTimeAsync(6000);expect(content).toHaveBeenLastCalledWith([draft]);expect(execute).toHaveBeenCalledTimes(1);control.stop();
 });
 it("原任务已停止、顾问明确失败、换稿和超额均不再发新请求",async()=>{
  vi.useFakeTimers();const execute=vi.fn(async()=>({creditsCharged:0}));
  const stopped=createKnowledgeReadingController({state:async()=>({...base,status:'failed'}),execute,confirm:async()=>true,progress:vi.fn()});await stopped.update({...link,ready:[0]});expect(execute).not.toHaveBeenCalled();await expect(stopped.wait()).rejects.toThrow('已停止');
  const failed=createKnowledgeReadingController({state:async()=>base,execute:async()=>{throw Error('断线');},recover:async()=>({failed:'模型返回失败'}),confirm:async()=>true,progress:vi.fn()});await failed.update({...link,ready:[0]});await vi.advanceTimersByTimeAsync(5000);await expect(failed.wait()).rejects.toThrow('模型返回失败');failed.stop();
  const costly=createKnowledgeReadingController({state:async()=>base,execute:async()=>({creditsCharged:1}),confirm:async()=>true,progress:vi.fn()});await costly.update({...link,ready:[0]});await expect(costly.wait()).rejects.toThrow('超出');await expect(costly.update({...link,jobId:'kc_other',ready:[0]})).rejects.toThrow('另一份');costly.stop();
 });
});

it("超过并发窗口的五批必须全部完成，wait不能在前两批后提前失败",async()=>{
 const completed:number[]=[];
 const state=async()=>({...base,batches:5,ready:[0,1,2,3,4],completed:[...completed],drafts:completed.map(index=>({...draft,index}))});
 const execute=vi.fn(async(_link:unknown,index:number)=>{await new Promise(r=>setTimeout(r,5));completed.push(index);return {creditsCharged:0};});
 const content=vi.fn();
 const control=createKnowledgeReadingController({state,execute,content,confirm:async()=>true,progress:vi.fn()});
 await control.update({...link,batches:5,ready:[0,1,2,3,4]});await control.wait();
 expect(execute).toHaveBeenCalledTimes(5);expect(completed.sort()).toEqual([0,1,2,3,4]);expect(content.mock.calls.at(-1)![0]).toHaveLength(5);control.stop();
});
