import {it,expect,vi} from 'vitest';
import {editionStepPosition} from '../../shared/knowledgeEditionSteps';
import {prepareKnowledgeCardEditions} from './knowledgeCardEditionPreparation';
import {knowledgeEditionParts} from '../../shared/knowledgeCardEdition';
import {planKnowledgeCardPages} from '../../shared/knowledgeCardPagination';
// 主题命题另有专测（knowledgeTopicTitles.test.ts）；这里只验整理与分页链路的调用次数，命题按回退原样返回。
vi.mock('./knowledgeTopicTitles',()=>({nameKnowledgeEditionTopics:vi.fn(async({markdown}:{markdown:string})=>({markdown,status:'fallback'}))}));

it('正式两档只选择原章，完整知识不二次浓缩；逐页保存且恢复零调用',async()=>{
 const storage=new Map<string,any>();
 const chapters=Array.from({length:18},(_,i)=>`## 原始主题${i}\n\n步骤${i}：保留数值${100+i}克、每周3次。\n\n| 项目 | 条件 |\n|---|---|\n| 项${i} | 每天${i+1}次 |`);
 const sourceMarkdown='# 原书\n\n'+chapters.join('\n\n')+'\n\n## 注意事项\n\n此处保留原书适用条件，不能遗漏。';
 const invoke=vi.fn(async(request:any)=>{
  expect(request.researchOnly).not.toBe(true);
  expect(request.generationConfig.responseMimeType).toBe('application/json');
  const prompt=request.systemInstruction.parts.map((p:any)=>p.text).join('');
  expect(prompt).not.toContain('四分之一');expect(prompt).not.toContain('归并主题');
  return {status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({pages:[{body:'模型错误改写',reading:{blocks:[0,1,2].map(i=>({title:`原始主题${i}`,type:'prose',text:'只选身份，不采用模型改写内容',note:''}))}}]})}]}}]})};
 });
 const evidence={prefix:'test/edition',read:async(k:string)=>storage.get(k)||null,save:async(k:string,v:any)=>{storage.set(k,v);}};
 const steps:string[]=[];const measure=vi.fn(async()=>2);
 const result=await prepareKnowledgeCardEditions({sourceMarkdown,evidence,measure,invoke:invoke as any,targetSections:3,
   onProgress:p=>{if(p.step&&steps.at(-1)!==p.step)steps.push(p.step);}
 });
 // 收尾段两档并行：步骤文案同时带两档名；准备阶段不再实排量文字页。
 expect(steps.slice(steps.indexOf('合并已核实章节'))).toEqual(['合并已核实章节','整理完整版和精华版标题','保存完整版和精华版正文和章节','计算并保存完整版和精华版图文分页','保存两版成稿']);
 expect(editionStepPosition('合并已核实章节',false).editionStepNumber).toBe(5);
 expect(measure).not.toHaveBeenCalled();
 const full=knowledgeEditionParts(result.fullEditionMarkdown)!,concise=knowledgeEditionParts(result.markdown)!;
 for(let i=0;i<18;i++)for(const edition of [full,concise]){
  expect(edition.knowledge).toContain(`保留数值${100+i}克`);expect(edition.knowledge).toContain(`| 项${i} | 每天${i+1}次 |`);
 }
 expect(full.knowledge).not.toContain('模型错误改写');
 expect(full.reading).toContain('原书适用条件');expect(concise.reading).toContain('原始主题17');
 expect(concise.images).not.toContain('原始主题17');
 expect(result.editionPageCounts.full.readingPages).toBeNull();
 expect(storage.get('test/edition/pages/full/counts.json')).toMatchObject({readingPages:null,imagePages:result.editionPageCounts.full.imagePages});
 expect(Array.from(storage.keys()).some(k=>k.endsWith('reading-layout.json'))).toBe(false);
 for(const [level,markdown] of [['full',result.fullEditionMarkdown],['concise',result.markdown]]){
  const plan=planKnowledgeCardPages(markdown);expect(plan.pages.every(p=>p.length<=1200)).toBe(true);
  for(let i=0;i<plan.pages.length;i++)expect(storage.get(`test/edition/pages/${level}/images/${i}.json`).body).toBe(plan.pages[i]);
 }
 expect(storage.get('test/edition/source.json').markdown).toBe(sourceMarkdown);
 const count=invoke.mock.calls.length;expect(count).toBe(1);
 await prepareKnowledgeCardEditions({sourceMarkdown,evidence,measure:async()=>2,invoke:invoke as any,targetSections:3});expect(invoke).toHaveBeenCalledTimes(count);
 await expect(prepareKnowledgeCardEditions({sourceMarkdown:sourceMarkdown+'改稿',evidence,invoke:invoke as any})).rejects.toThrow('版本变化');
});

it('无须选节的短稿不调用模型，原有说明进入两档文字生产者',async()=>{
 const storage=new Map<string,any>(),invoke=vi.fn();
 const result=await prepareKnowledgeCardEditions({sourceMarkdown:'# 知识\n\n## 方法\n\n完整步骤12次。\n\n注意：原有条件不得删除。',
 evidence:{prefix:'short',read:async k=>storage.get(k)||null,save:async(k,v)=>{storage.set(k,v);}},invoke,measure:async()=>1});
 expect(invoke).not.toHaveBeenCalled();
 for(const md of [result.fullEditionMarkdown,result.markdown]){
  const parts=knowledgeEditionParts(md)!;expect(parts.images).toContain('完整步骤12次');expect(parts.reading).toContain('原有条件不得删除');
 }
});

it('精华选节失败不拖停整册，保留完整稿与逐页输出并明确未完成',async()=>{
 const storage=new Map<string,any>();
 const sourceMarkdown='# 原书\n\n'+Array.from({length:15},(_,i)=>`## 原章${i}\n\n原内容${i}，原数值${i+100}。`).join('\n\n');
 const result=await prepareKnowledgeCardEditions({sourceMarkdown,targetSections:3,
 evidence:{prefix:'failed',read:async k=>storage.get(k)||null,save:async(k,v)=>{storage.set(k,v);}},
 invoke:vi.fn(async()=>{throw Error('原请求回执尚未闭合');}),measure:async()=>3});
 expect(result.verificationProcessed).toBe(false);expect(result.editionIssues.some((i:any)=>i.kind==='selection')).toBe(true);
 expect(result.editionPageCounts.concise.imagePages).toBe(0);
 expect(knowledgeEditionParts(result.fullEditionMarkdown)!.knowledge).toContain('原数值114');
 expect(knowledgeEditionParts(result.markdown)!.reading).toContain('原数值114');
 expect(storage.get('failed/pages/full/images/0.json')).toBeTruthy();
});

it('旧浓缩缓存不能冒充本轮恢复结果，也不自动重新购买',async()=>{
 const {createHash}=await import('node:crypto');
 const sourceMarkdown='# 原稿\n\n## 原章\n全部知识。';const invoke=vi.fn();
 await expect(prepareKnowledgeCardEditions({sourceMarkdown,invoke,evidence:{prefix:'old',
 read:async()=>({inputDigest:createHash('sha256').update(sourceMarkdown).digest('hex'),result:{fullEditionMarkdown:'旧浓缩'}}),save:vi.fn()}})).rejects.toThrow('旧版浓缩结果');
 expect(invoke).not.toHaveBeenCalled();
});

it('末段修订省略优先级标签时仍保留原选节身份',async()=>{
 const storage=new Map<string,any>();
 const invoke=vi.fn(async(request:any)=>({status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(request.researchOnly
 ?{sourceDigest:'test',findings:[],verificationMarkdown:'已取得对应原句资料',sources:[{title:'测试资料',url:'https://example.invalid/source',content:'原章条件资料'}]}
 :{pages:[{body:'# 原书\n\n## 原章\n\n原内容，已保留。'}]})}]}}]})}));
 const result=await prepareKnowledgeCardEditions({sourceMarkdown:'# 原书\n\n## 原章\n\n原内容。\n<!-- 待核：原句存在疑点 -->',invoke:invoke as any,
 evidence:{prefix:'priority',read:async k=>storage.get(k)||null,save:async(k,v)=>{storage.set(k,v);}},measure:async()=>1});
 expect(invoke).toHaveBeenCalledTimes(2);
 expect(knowledgeEditionParts(result.markdown)!.images).toContain('原章');
});

it('选节后存储中断恢复沿用稳定回执，不再调用同一选择',async()=>{
 const storage=new Map<string,any>();let fail=true;
 const chapters=Array.from({length:15},(_,i)=>`## 原章${i}\n\n完整内容${i}。`);
 const sourceMarkdown='# 原书\n\n'+chapters.join('\n\n')+'\n\n## 注意事项\n\n原有操作条件。';
 const invoke=vi.fn(async()=>({status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({pages:[{reading:{blocks:[0,1,2].map(i=>({title:`原章${i}`,type:'prose',text:'选择理由',note:''}))}}]})}]}}]})}));
 const evidence={prefix:'resume',read:async(k:string)=>storage.get(k)||null,save:async(k:string,v:any)=>{
  if(k==='resume/final-verification/verified.json'&&fail){fail=false;throw Error('模拟存储失败');}storage.set(k,v);
 }};
 const params={sourceMarkdown,targetSections:3,invoke:invoke as any,evidence,measure:async()=>1};
 await expect(prepareKnowledgeCardEditions(params)).rejects.toThrow('章节检查点保存或读取失败，保留任务等待恢复');
 expect(invoke).toHaveBeenCalledTimes(1);
 const result=await prepareKnowledgeCardEditions(params);
 expect(invoke).toHaveBeenCalledTimes(1);expect(result.verificationProcessed).toBe(true);
 expect(Array.from(storage.keys()).some(k=>/^resume\/selection-[a-f0-9]{64}\/result.json$/.test(k))).toBe(true);
});


it('没有真实文字说明时不得把完整版标记为整理成功',async()=>{
 const storage=new Map<string,any>();
 const result=await prepareKnowledgeCardEditions({sourceMarkdown:'# 原书\n\n## 方法\n\n图：流程图\n- 唯一步骤',
 evidence:{prefix:'no-reading',read:async k=>storage.get(k)||null,save:async(k,v)=>{storage.set(k,v);}},invoke:vi.fn(),measure:async()=>1});
 expect(result.verificationProcessed).toBe(false);
 expect(result.editionIssues.some((issue:any)=>issue.kind==='missing_reading')).toBe(true);
 expect(result.editionPageCounts.full.readingPages).toBeNull();
});

it('无搜索结果的待验证稿件正式两档放行，状态与可见标记一致',async()=>{
 const storage=new Map<string,any>();
 const invoke=vi.fn(async()=>({status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({verificationMarkdown:'无可用资料',evidenceState:'missing',sources:[]})}]}}]})}));
 const result=await prepareKnowledgeCardEditions({sourceMarkdown:'# 原书\n\n## 方法\n\n图：步骤图。\n\n原书方法。\n\n说明：原书条件。\n\n<!-- 待核：原句「原书方法」；问题：说明不清楚 -->',invoke:invoke as any,
 evidence:{prefix:'pending',read:async k=>storage.get(k)||null,save:async(k,v)=>{storage.set(k,v);}},measure:async()=>1});
 expect(result.verificationProcessed).toBe(true);expect(result.editionIssues).toEqual([]);
 expect(result.editionPendingVerification).toHaveLength(1);
 expect(result.fullEditionMarkdown).toContain('待验证：');expect(result.markdown).toContain('待验证：');expect(invoke).toHaveBeenCalledTimes(1);
});

it('旧成功缓存仍有未闭合原章疑点时降级，不重买、不改原缓存；可见待验证仍允许',async()=>{
 const {createHash}=await import('node:crypto');
 const sourceMarkdown='# 原稿';
 const markdown='<!-- knowledge-edition:v2:full -->\n# 原稿\n\n## 图解｜原章\n\n原表换算已列疑点。';
 const prior={inputDigest:createHash('sha256').update(sourceMarkdown).digest('hex'),compositionVersion:'original-sections-json-selection-v4',result:{fullEditionMarkdown:markdown,markdown:markdown.replace('v2:full','v2:concise'),verificationProcessed:true,editionIssues:[]}};
 const invoke=vi.fn(),save=vi.fn();
 const run=()=>prepareKnowledgeCardEditions({sourceMarkdown,invoke,evidence:{prefix:'cached',read:async()=>prior,save}});
 const result=await run();
 expect(result.verificationProcessed).toBe(false);expect(result.editionIssues).toHaveLength(1);
 expect(result.fullEditionMarkdown).toBe(markdown);expect(prior.result.verificationProcessed).toBe(true);
 expect(invoke).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
 prior.result.fullEditionMarkdown+='\n\n待验证：原表单位尚未核实。';
 expect((await run()).verificationProcessed).toBe(true);
});

it('仅移动疑点注释时按原知识身份复用选节，真正改正文则拒绝缓存',async()=>{
 const {knowledgeEditionSelectionDigest}=await import('./knowledgeCardEditionPreparation');
 const chapters=Array.from({length:15},(_,i)=>`## 章节${i}\n\n原知识${i}。\n\n说明：必要条件${i}。`);
 const note='<!-- 待核：原句「原知识0」；问题：单位无法确认 -->';
 const old='# 手册\n\n'+chapters.join('\n\n')+'\n\n'+note;
 const source='# 手册\n\n'+chapters.map((s,i)=>s+(i===0?'\n\n'+note:'')).join('\n\n');
 const manifest={knowledgeDigest:knowledgeEditionSelectionDigest(old,3),selectedIndices:[0,1,2],targetSections:3,passes:1,pendingResearch:[]};
 expect(knowledgeEditionSelectionDigest(source,3)).toBe(manifest.knowledgeDigest);
 const storage=new Map<string,any>([['moved/selected-sections.json',manifest]]);
 const invoke=vi.fn(async(request:any)=>{
  expect(request.researchOnly).toBe(true);
  return {status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({evidenceState:'missing',sources:[]})}]}}]})};
 });
 const evidence={prefix:'moved',read:async(k:string)=>storage.get(k)||null,save:async(k:string,v:any)=>{storage.set(k,v);}};
 const result=await prepareKnowledgeCardEditions({sourceMarkdown:source,targetSections:3,evidence,invoke:invoke as any,measure:async()=>1});
 expect(invoke).toHaveBeenCalledTimes(1);expect(result.verificationProcessed).toBe(true);
 expect(knowledgeEditionParts(result.markdown)!.modules.filter(m=>m.medium==='image').map(m=>m.headline)).toEqual(['章节0','章节1','章节2']);
 const changed={prefix:'changed',read:async(k:string)=>k.endsWith('/selected-sections.json')?manifest:null,save:async()=>{}};
 await expect(prepareKnowledgeCardEditions({sourceMarkdown:source.replace('原知识0','知识实际变化'),targetSections:3,evidence:changed,invoke:invoke as any,measure:async()=>1})).rejects.toThrow('原稿版本变化');
 expect(invoke).toHaveBeenCalledTimes(1);
});


it('恢复缓存用当前分页器刷新图片计数但保留文字实测与原回执',async()=>{
 const {createHash}=await import('node:crypto');
 const sourceMarkdown='# 原稿';
 const markdown='<!-- knowledge-edition:v2:full -->\n# 原稿\n\n## 图解｜原章\n\n具体内容。';
 const prior={inputDigest:createHash('sha256').update(sourceMarkdown).digest('hex'),compositionVersion:'original-sections-json-selection-v4',result:{fullEditionMarkdown:markdown,markdown:markdown.replace('v2:full','v2:concise'),verificationProcessed:true,editionIssues:[],editionPageCounts:{full:{imagePages:99,readingPages:10},concise:{imagePages:88,readingPages:47}}}};
 const invoke=vi.fn(),save=vi.fn();
 const result=await prepareKnowledgeCardEditions({sourceMarkdown,invoke,evidence:{prefix:'counts',read:async()=>prior,save}});
 expect(result.editionPageCounts).toMatchObject({full:{imagePages:1,readingPages:10},concise:{imagePages:1,readingPages:47}});
 // 生图前预检（只展示，站长 2026-11-20 口径）：两档总页数 ≤80；完整版文字续页 ≤30 页，精华版 ≤50 页（均不超过 80−图数）。
 expect(result.editionPageCounts!.full.pageBudget!.budget.textPages).toEqual({min:0,target:30,max:30});
 expect(result.editionPageCounts!.full.pageBudget!.budget.totalPages).toEqual({min:1,target:31,max:31});
 expect(result.editionPageCounts!.concise.pageBudget!.budget.textPages).toEqual({min:0,target:50,max:50});
 expect(prior.result.editionPageCounts.full.imagePages).toBe(99);expect(invoke).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
});

// D1：逐页回执有界并发写入——键、内容与结果不变；中途一条失败整步失败，重跑幂等。
const d1Source=()=>'# 原书\n\n'+Array.from({length:18},(_,i)=>`## 原始主题${i}\n\n步骤${i}：保留数值${100+i}克、每周3次。\n\n| 项目 | 条件 |\n|---|---|\n| 项${i} | 每天${i+1}次 |`).join('\n\n')+'\n\n## 注意事项\n\n此处保留原书适用条件，不能遗漏。';
const d1Invoke=()=>vi.fn(async()=>({status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({pages:[{reading:{blocks:[0,1,2].map(i=>({title:`原始主题${i}`,type:'prose',text:'选择理由',note:''}))}}]})}]}}]})}));
const KNOWLEDGE_EDITION_RECEIPT_WRITE_CONCURRENCY_FOR_TEST=16;
const pageKey=(k:string)=>/\/pages\/(full|concise)\/(chapters|images)\/\d+\.json$/.test(k);

it('D1 逐页回执并发写入：同键同内容，在途>1且不超上限，结果与计数不变',async()=>{
 const {KNOWLEDGE_EDITION_RECEIPT_WRITE_CONCURRENCY}=await import('./knowledgeCardEditionPreparation');
 const serial=new Map<string,any>(),parallel=new Map<string,any>();
 const sourceMarkdown=d1Source();
 // 参照：每次写入立即完成（等价串行）。
 const ref=await prepareKnowledgeCardEditions({sourceMarkdown,targetSections:3,invoke:d1Invoke() as any,measure:async()=>2,
  evidence:{prefix:'d1',read:async k=>serial.get(k)??null,save:async(k,v)=>{serial.set(k,structuredClone(v));}}});
 let inflight=0,peak=0;
 const result=await prepareKnowledgeCardEditions({sourceMarkdown,targetSections:3,invoke:d1Invoke() as any,measure:async()=>2,
  evidence:{prefix:'d1',read:async k=>parallel.get(k)??null,save:async(k,v)=>{
   if(pageKey(k)){inflight++;peak=Math.max(peak,inflight);await new Promise(r=>setTimeout(r,2));inflight--;}
   parallel.set(k,structuredClone(v));}}});
 // 两档并行、每档各自 ≤ 上限：两档合计在途 ≤ 2×上限。
 expect(peak).toBeGreaterThan(1);expect(peak).toBeLessThanOrEqual(2*KNOWLEDGE_EDITION_RECEIPT_WRITE_CONCURRENCY);
 expect(Array.from(parallel.keys()).filter(pageKey).length).toBeGreaterThan(20);
 expect(new Set(parallel.keys())).toEqual(new Set(serial.keys()));
 for(const [k,v] of Array.from(serial))expect(parallel.get(k)).toEqual(v);
 expect(result).toEqual(ref);
 expect(Object.keys(result.editionPageCounts)).toEqual(['full','concise']);
});

it('D1 并发池中途一条回执写入失败：两档同时停止领取、整步失败不写editions.json；重跑零模型调用且与干净运行逐键一致',async()=>{
 const sourceMarkdown=d1Source(),invoke=d1Invoke();
 const clean=new Map<string,any>();
 await prepareKnowledgeCardEditions({sourceMarkdown,targetSections:3,invoke:d1Invoke() as any,measure:async()=>2,
  evidence:{prefix:'d1f',read:async k=>clean.get(k)??null,save:async(k,v)=>{clean.set(k,structuredClone(v));}}});
 const storage=new Map<string,any>();let chapterWrites=0,failOnce=true;const after:string[]=[];let failed=false;
 const evidence={prefix:'d1f',read:async(k:string)=>storage.get(k)??null,save:async(k:string,v:any)=>{
  if(/\/pages\/full\/chapters\/\d+\.json$/.test(k)&&++chapterWrites===5&&failOnce){failOnce=false;failed=true;await new Promise(r=>setTimeout(r,1));throw Error('ENOSPC: no space left on device');}
  if(failed)after.push(k);
  await new Promise(r=>setTimeout(r,1));storage.set(k,structuredClone(v));}};
 const params={sourceMarkdown,targetSections:3,invoke:invoke as any,evidence,measure:async()=>2};
 await expect(prepareKnowledgeCardEditions(params)).rejects.toThrow('章节检查点保存或读取失败，保留任务等待恢复');
 expect(storage.has('d1f/editions.json')).toBe(false);
 // 失败后不再领取新条目：失败抛出前（替身 1ms）在途与刚放行的写入至多两倍上限；分页回执与完成标记都未写。
 expect(after.length).toBeLessThan(2*KNOWLEDGE_EDITION_RECEIPT_WRITE_CONCURRENCY_FOR_TEST);
 expect(after.some(k=>k.includes('/images/')||k.endsWith('.done.json')||k.endsWith('reading-layout.json'))).toBe(false);
 const calls=invoke.mock.calls.length;
 const result=await prepareKnowledgeCardEditions(params);
 expect(invoke).toHaveBeenCalledTimes(calls);expect(result.verificationProcessed).toBe(true);
 expect(new Set(storage.keys())).toEqual(new Set(clean.keys()));
 for(const [k,v] of Array.from(clean))expect(storage.get(k)).toEqual(v);
 // 再跑一次：命中 editions.json 零写入零调用。
 const before=JSON.stringify(Array.from(storage.entries()));
 await prepareKnowledgeCardEditions(params);
 expect(JSON.stringify(Array.from(storage.entries()))).toBe(before);expect(invoke).toHaveBeenCalledTimes(calls);
});
