import {it,expect,vi} from 'vitest';
import {prepareKnowledgeCardEditions} from './knowledgeCardEditionPreparation';
import {knowledgeEditionParts} from '../../shared/knowledgeCardEdition';
import {planKnowledgeCardPages} from '../../shared/knowledgeCardPagination';

it('正式两档只选择原章，完整知识不二次浓缩；逐页保存且恢复零调用',async()=>{
 const storage=new Map<string,any>();
 const chapters=Array.from({length:18},(_,i)=>`## 原始主题${i}\n\n步骤${i}：保留数值${100+i}克、每周3次。\n\n| 项目 | 条件 |\n|---|---|\n| 项${i} | 每天${i+1}次 |`);
 const sourceMarkdown='# 原书\n\n'+chapters.join('\n\n')+'\n\n## 注意事项\n\n此处保留原书适用条件，不能遗漏。';
 const invoke=vi.fn(async(request:any)=>{
  expect(request.researchOnly).not.toBe(true);
  const prompt=request.systemInstruction.parts.map((p:any)=>p.text).join('');
  expect(prompt).not.toContain('四分之一');expect(prompt).not.toContain('归并主题');
  return {status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({pages:[{body:'# 原书\n\n'+chapters.slice(0,3).map(s=>s.replace(/保留数值\d+克/,'模型错误改写')).join('\n\n')}]})}]}}]})};
 });
 const evidence={prefix:'test/edition',read:async(k:string)=>storage.get(k)||null,save:async(k:string,v:any)=>{storage.set(k,v);}};
 const result=await prepareKnowledgeCardEditions({sourceMarkdown,evidence,measure:async()=>2,invoke:invoke as any,targetSections:3});
 const full=knowledgeEditionParts(result.fullEditionMarkdown)!,concise=knowledgeEditionParts(result.markdown)!;
 for(let i=0;i<18;i++)for(const edition of [full,concise]){
  expect(edition.knowledge).toContain(`保留数值${100+i}克`);expect(edition.knowledge).toContain(`| 项${i} | 每天${i+1}次 |`);
 }
 expect(full.knowledge).not.toContain('模型错误改写');
 expect(full.reading).toContain('原书适用条件');expect(concise.reading).toContain('原始主题17');
 expect(concise.images).not.toContain('原始主题17');
 expect(result.editionPageCounts.full.readingPages).toBe(2);
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
 ?{sourceDigest:'test',findings:[],verificationMarkdown:'未补充外部事实',sources:[]}
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
 const invoke=vi.fn(async()=>({status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({pages:[{body:chapters.slice(0,3).join('\n\n')}]})}]}}]})}));
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
 expect(result.editionPageCounts.full.readingPages).toBe(0);
});
