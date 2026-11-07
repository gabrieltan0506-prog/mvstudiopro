import {expect,it,vi} from 'vitest';
import {verifyKnowledgeEditionManuscripts} from './knowledgeEditionFinalVerification';
const envelope=(value:unknown)=>({status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}]})});
const setup=()=>{const data=new Map<string,any>();return {data,evidence:{prefix:'parallel',read:async(k:string)=>data.get(k)||null,save:async(k:string,v:any)=>{data.set(k,v);}}};};
const page=(i:number)=>`# 手册\n\n## 章节${i}\n原内容${i}。\n\n<!-- 待核：原句「原内容${i}」；问题：条件不清楚 -->`;
it('不同章节同时检索，同章先搜索再修订，乱序结束仍按原章节保存',async()=>{
 const f=setup(),searches:{i:number;channel:string;resolve:(value:any)=>void}[]=[];const revised:number[]=[];const progress:any[]=[];
 const invoke=vi.fn(async(req:any,scope:any)=>{
  const i=Number(scope.prefix.match(/(?:search|revision)-(\d+)$/)[1]);
  if(req.researchOnly)return new Promise(resolve=>searches.push({i,channel:req.executionChannel,resolve}));
  revised.push(i);expect(f.data.has(`parallel/search-${i}/report.json`)).toBe(true);
  return envelope({pages:[{body:`# 手册\n\n## 章节${i}\n已按资料补齐条件${i}。`}]});
 });
 const source=[page(0),page(1)];const result=verifyKnowledgeEditionManuscripts(source,f.evidence,invoke as any,async p=>{progress.push(p);});
 await vi.waitFor(()=>expect(searches).toHaveLength(2));expect(revised).toEqual([]);
 expect(searches.map(s=>s.channel).sort()).toEqual(['evolink','openrouter']);
 const found={evidenceState:'available',sources:[{title:'测试资料',url:'https://example.invalid/source',content:'对应条件'}],verificationMarkdown:'资料支持'};
 searches.find(s=>s.i===1)!.resolve(envelope(found));await vi.waitFor(()=>expect(revised).toEqual([1]));
 searches.find(s=>s.i===0)!.resolve(envelope(found));
 const out=await result;expect(out[0]).toContain('条件0');expect(out[1]).toContain('条件1');
 expect(progress.filter(p=>p.pass===3).map(p=>p.doneBatches)).toEqual([0,1,2]);expect(progress.at(-1)).toMatchObject({pass:4,doneBatches:2});
 expect(f.data.get('parallel/verified.json').complete).toBe(true);
 const count=invoke.mock.calls.length;await verifyKnowledgeEditionManuscripts(source,f.evidence,invoke as any);expect(invoke).toHaveBeenCalledTimes(count);
});
it('12个问题章每供应商最多5个工位，无资料各自标待验证且整册放行',async()=>{
 const f=setup();const waiting:{channel:string;resolve:()=>void}[]=[];const active:Record<string,number>={},peak:Record<string,number>={};
 const invoke=vi.fn(async(req:any)=>new Promise(resolve=>{
  expect(req.researchOnly).toBe(true);const channel=req.executionChannel;
  active[channel]=(active[channel]||0)+1;peak[channel]=Math.max(peak[channel]||0,active[channel]);
  waiting.push({channel,resolve:()=>{active[channel]--;resolve(envelope({evidenceState:'missing',sources:[],verificationMarkdown:'无可用资料'}));}});
 }));
 const result=verifyKnowledgeEditionManuscripts(Array.from({length:12},(_,i)=>page(i)),f.evidence,invoke as any);
 await vi.waitFor(()=>expect(waiting).toHaveLength(10));for(const item of [...waiting])item.resolve();
 await vi.waitFor(()=>expect(waiting).toHaveLength(12));for(const item of waiting.slice(10))item.resolve();
 const out=await result;expect(out).toHaveLength(12);expect(out.every(s=>s.includes('待验证：'))).toBe(true);
 expect(peak).toEqual({openrouter:5,evolink:5});expect(invoke).toHaveBeenCalledTimes(12);
 expect(f.data.get('parallel/verified.json').pendingVerification).toHaveLength(12);expect(f.data.get('parallel/verified.json').complete).toBe(true);
});
