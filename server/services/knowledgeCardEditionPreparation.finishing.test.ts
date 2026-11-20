import {it,expect,vi} from 'vitest';
import {prepareKnowledgeCardEditions,KNOWLEDGE_EDITION_RECEIPT_WRITE_CONCURRENCY,KNOWLEDGE_EDITION_RECEIPT_CHUNK} from './knowledgeCardEditionPreparation';
// 命题另有专测；这里只验收尾段（存稿→章节回执→分页回执）的写入次数、并发、两档并行与续作。
vi.mock('./knowledgeTopicTitles',()=>({nameKnowledgeEditionTopics:vi.fn(async({markdown}:{markdown:string})=>({markdown,status:'fallback'}))}));

const CHAPTERS=4000;
const source=()=>'# 大书\n\n'+Array.from({length:CHAPTERS},(_,i)=>`## 第${i}章\n\n内容${i}，数值${i+100}。`).join('\n\n')+'\n\n## 注意事项\n\n原书适用条件。';
const invoke=()=>vi.fn(async()=>({status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({pages:[{reading:{blocks:[0,1,2].map(i=>({title:`第${i}章`,type:'prose',text:'理由',note:''}))}}]})}]}}]})}));
const receiptKey=(k:string)=>/\/pages\/(full|concise)\/(chapters|images)\/\d+\.json$/.test(k);
const finishingKey=(k:string)=>/^[^/]+\/(pages\/|editions\.json$)/.test(k);

/** 先跑一次把选节/核实回执存好（收尾段之前的回执），返回只含这些回执的存储。 */
async function warm(prefix:string){
 const storage=new Map<string,any>();
 const call=invoke();
 const result=await prepareKnowledgeCardEditions({sourceMarkdown:source(),targetSections:3,invoke:call as any,
  evidence:{prefix,read:async k=>storage.get(k)??null,save:async(k,v)=>{storage.set(k,structuredClone(v));}}});
 const pre=new Map(Array.from(storage).filter(([k])=>!finishingKey(k)));
 return {full:storage,pre,result,calls:call.mock.calls.length};
}

it('4000章收尾段：零量页、写入次数确定、每档并发≤上限、两档并行耗时接近单档',async()=>{
 const {full:reference,pre,result:ref}=await warm('big');
 const storage=new Map(pre);
 const measure=vi.fn(async()=>1);
 let writes=0;const inflight={full:0,concise:0},peak={full:0,concise:0};
 const spans:Record<string,[number,number]>={};
 const DELAY=4;
 const started=Date.now();
 const steps:{step?:string;done:number;total:number}[]=[];
 const result=await prepareKnowledgeCardEditions({sourceMarkdown:source(),targetSections:3,invoke:invoke() as any,measure,
  onProgress:p=>{steps.push({step:p.step,done:p.doneBatches,total:p.totalBatches});},
  evidence:{prefix:'big',read:async k=>storage.get(k)??null,save:async(k,v)=>{
   if(finishingKey(k))writes++;
   const level=k.match(/\/pages\/(full|concise)\//)?.[1] as 'full'|'concise'|undefined;
   if(level&&receiptKey(k)){
    inflight[level]++;peak[level]=Math.max(peak[level],inflight[level]);
    const span=spans[level]||=[Date.now(),0];
    await new Promise(r=>setTimeout(r,DELAY));inflight[level]--;span[1]=Date.now();
   }
   storage.set(k,structuredClone(v));}}});
 const elapsed=Date.now()-started;
 expect(measure).not.toHaveBeenCalled();
 expect(result).toEqual(ref);
 expect(result.editionPageCounts.full.readingPages).toBeNull();expect(result.editionPageCounts.concise.readingPages).toBeNull();
 expect(Array.from(storage.keys()).some(k=>k.endsWith('reading-layout.json'))).toBe(false);
 // 写入次数：每档 manuscript + counts + 每章/每页回执 + 每批块标记与整批标记，再加 editions.json。
 const receipts=Array.from(storage.keys()).filter(receiptKey);
 const batches=(['full','concise'] as const).flatMap(level=>(['chapters','images'] as const).map(kind=>receipts.filter(k=>k.includes(`/pages/${level}/${kind}/`)).length)).filter(n=>n>0);
 const markers=batches.reduce((sum,n)=>sum+1+(n>KNOWLEDGE_EDITION_RECEIPT_CHUNK?Math.ceil(n/KNOWLEDGE_EDITION_RECEIPT_CHUNK):0),0);
 expect(receipts.length).toBeGreaterThan(2*CHAPTERS);
 expect(writes).toBe(2+2+receipts.length+markers+1);
 expect(peak.full).toBeLessThanOrEqual(KNOWLEDGE_EDITION_RECEIPT_WRITE_CONCURRENCY);expect(peak.concise).toBeLessThanOrEqual(KNOWLEDGE_EDITION_RECEIPT_WRITE_CONCURRENCY);
 expect(peak.full).toBe(KNOWLEDGE_EDITION_RECEIPT_WRITE_CONCURRENCY);
 // 两档并行：两档回执写入时间段重叠，总耗时明显小于两档串行之和。
 expect(spans.concise![0]).toBeLessThan(spans.full![1]);
 // 收尾段实际写入时长（两档回执最早开始到最晚结束）应接近单档、远小于两档之和。
 const finishSpan=Math.max(spans.full![1],spans.concise![1])-Math.min(spans.full![0],spans.concise![0]);
 const perLevel=(span:[number,number])=>span[1]-span[0];
 expect(finishSpan).toBeLessThan(0.75*(perLevel(spans.full!)+perLevel(spans.concise!)));
 expect(elapsed).toBeGreaterThan(finishSpan);
 // 收尾段进度：两档合计、只增不减，常规节流之外子步骤起止都有上报。
 const finishing=steps.filter(s=>s.step==='保存完整版和精华版正文和章节'||s.step==='计算并保存完整版和精华版图文分页');
 expect(finishing.length).toBeGreaterThanOrEqual(6);
 for(let i=1;i<finishing.length;i++)expect(finishing[i]!.done).toBeGreaterThanOrEqual(finishing[i-1]!.done);
 expect(finishing.at(-1)).toMatchObject({done:receipts.length,total:receipts.length});
 // 与参照运行逐键逐值相同。
 expect(new Set(storage.keys())).toEqual(new Set(reference.keys()));
 for(const [k,v] of Array.from(reference))expect(storage.get(k)).toEqual(v);
},60_000);

it('章节回执写到一半瞬态失败：续作只补未完成的块，最终存储与结果与一次跑完逐字相同',async()=>{
 const {full:reference,pre,result:ref}=await warm('cut');
 const storage=new Map(pre);
 let fullChapterWrites=0,armed=true;
 const uploads:string[]=[];
 const evidence={prefix:'cut',read:async(k:string)=>storage.get(k)??null,save:async(k:string,v:any)=>{
  if(/\/pages\/full\/chapters\/\d+\.json$/.test(k)&&++fullChapterWrites===2000&&armed){armed=false;throw Error('ENOSPC: no space left on device');}
  uploads.push(k);storage.set(k,structuredClone(v));}};
 const call=invoke();
 const params={sourceMarkdown:source(),targetSections:3,invoke:call as any,evidence};
 await expect(prepareKnowledgeCardEditions(params)).rejects.toThrow('章节检查点保存或读取失败');
 expect(storage.has('cut/editions.json')).toBe(false);
 const firstRun=new Set(uploads.filter(receiptKey));const firstRunCalls=call.mock.calls.length;
 const doneParts=Array.from(storage.keys()).filter(k=>/\/pages\/full\/chapters\.part-\d+\.json$/.test(k)).length;
 expect(doneParts).toBeGreaterThanOrEqual(3);
 uploads.length=0;
 const result=await prepareKnowledgeCardEditions(params);
 // 夹具的精华选节按设计失败（记 selection 问题、不落选节回执），每轮都会重试选节；收尾段本身不增加任何模型调用。
 expect(call.mock.calls.length).toBe(2*firstRunCalls);
 // 已落块标记的章节不再上传；两档已存的原稿不再重写。
 expect(uploads.filter(k=>/\/pages\/full\/chapters\/\d+\.json$/.test(k)).length).toBe(CHAPTERS+1-doneParts*KNOWLEDGE_EDITION_RECEIPT_CHUNK);
 expect(firstRun.size).toBeGreaterThan(doneParts*KNOWLEDGE_EDITION_RECEIPT_CHUNK);
 expect(uploads.some(k=>k.endsWith('/pages/full/manuscript.json'))).toBe(false);
 expect(result).toEqual(ref);
 expect(new Set(storage.keys())).toEqual(new Set(reference.keys()));
 for(const [k,v] of Array.from(reference))expect(JSON.stringify(storage.get(k))).toBe(JSON.stringify(v));
 // 整批完成标记命中后再跑收尾（删掉 editions.json 模拟最后一步前中断）：回执零上传。
 storage.delete('cut/editions.json');uploads.length=0;
 expect(await prepareKnowledgeCardEditions(params)).toEqual(ref);
 expect(uploads.filter(receiptKey)).toEqual([]);
},60_000);

it('旧任务成稿（v4，editions.json 已存）回放：零模型调用、零量页、零写入，返回结构与原逻辑相同',async()=>{
 const {createHash}=await import('node:crypto');
 const sourceMarkdown='# 原稿';
 const markdown='<!-- knowledge-edition:v2:full -->\n# 原稿\n\n## 图解｜原章\n\n具体内容。';
 const prior={inputDigest:createHash('sha256').update(sourceMarkdown).digest('hex'),compositionVersion:'original-sections-json-selection-v4',
  result:{fullEditionMarkdown:markdown,markdown:markdown.replace('v2:full','v2:concise'),verificationProcessed:true,editionIssues:[],sections:1,
   editionPageCounts:{full:{imagePages:48,readingPages:0},concise:{imagePages:30,readingPages:12}}}};
 const call=vi.fn(),save=vi.fn(),measure=vi.fn();
 const result=await prepareKnowledgeCardEditions({sourceMarkdown,invoke:call,measure,evidence:{prefix:'old',read:async k=>k==='old/editions.json'?prior:null,save}});
 expect(call).not.toHaveBeenCalled();expect(measure).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
 expect(Object.keys(result).sort()).toEqual(Object.keys(prior.result).sort());
 expect(result.editionPageCounts.full).toMatchObject({imagePages:1,readingPages:0});
 expect(result.editionPageCounts.concise).toMatchObject({imagePages:1,readingPages:12});
 expect(Object.keys(result.editionPageCounts.full).sort()).toEqual(['imagePages','pageBudget','readingPages']);
});
