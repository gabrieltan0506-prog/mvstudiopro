import {expect,it,vi} from 'vitest';
import {buildDistillSystem,buildRefineSystem,mergeDistilledMarkdownChunks} from './knowledgeCardDistill';
import {preserveKnowledgePendingResearch,knowledgePendingResearchNotes} from './knowledgeVerificationPolicy';
import {prepareKnowledgeCardEditions} from './knowledgeCardEditionPreparation';

const envelope=(value:unknown)=>({status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}]})});
it('实际读档及各统稿阶段都要求标注四类问题，末段再联网',()=>{
 for(const prompt of [buildDistillSystem(8,'glm-5.3-flashx',[],'full'),...(['final','group','tighten'] as const).map(stage=>buildRefineSystem(8,stage,10,'glm-5.3-flashx','full'))]){
  for(const required of ['实际疑点','前后矛盾','内容不全','说明不清楚','待核：','跨段','最后阶段','内部HTML注释'])expect(prompt).toContain(required);
 }
});
it('分段合并、统稿漏标、正式原节选择后，只有问题章节进入末段搜索，恢复零调用',async()=>{
 const note='原句「每次12次」；问题：另一处写每次20次，前后矛盾，缺少适用条件';
 const first=`# 手册\n\n## 方法\n\n图：运动步骤。\n\n每次12次。\n\n说明：按原动作执行。\n\n<!-- 待核：${note} -->`;
 const second='# 手册\n\n## 观察\n\n图：记录状态。\n\n说明：记录当天状态。';
 const merged=mergeDistilledMarkdownChunks([first,second]);
 const refined=preserveKnowledgePendingResearch(merged,merged.replace(/<!--[^]*?-->/g,''));
 expect(knowledgePendingResearchNotes(refined)).toEqual([note]);
 const data=new Map<string,any>();const invoke=vi.fn(async(req:any)=>{
  if(req.researchOnly){expect(JSON.stringify(req)).toContain('每次12次');return envelope({verificationMarkdown:'针对原句明确次数适用条件',sources:[{title:'测试资料',url:'https://example.invalid/source',content:'次数适用条件'}]});}
  return envelope({pages:[{body:'# 手册\n\n## 次要重点｜方法\n\n图：运动步骤。\n\n每次12次。\n\n说明：次数因适用条件而异，保留原文供核对。'}]});
 });
 const args={sourceMarkdown:refined,evidence:{prefix:'flow',read:async(k:string)=>data.get(k)||null,save:async(k:string,v:any)=>{data.set(k,v);}},invoke:invoke as any,measure:async()=>1};
 await prepareKnowledgeCardEditions(args);
 expect(invoke.mock.calls.filter(([r])=>r.researchOnly)).toHaveLength(1);
 expect(data.get('flow/final-verification/verified.json').skipped).toBe(false);
 const count=invoke.mock.calls.length;await prepareKnowledgeCardEditions(args);expect(invoke).toHaveBeenCalledTimes(count);
});
it('选节Markdown解析到cautions的疑点不能被原文回填吞掉',async()=>{
 const source='# 手册\n\n'+Array.from({length:15},(_,i)=>`## 章${i}\n\n图：步骤。\n\n原文${i}。\n\n说明：条件${i}。`).join('\n\n');
 const data=new Map<string,any>();
 const invoke=vi.fn(async(req:any,scope:any)=>{
  // 选节按 original-sections-json-selection-v4 合同只回 reading.blocks 标题（程序取回原章全文），疑点另记 cautions。
  if(scope.prefix.includes('/selection-')){
   const title=/^##\s+(.+)$/m.exec(JSON.parse(req.contents[0].parts[0].text).source.pages[0].body)![1].trim();
   return envelope({pages:[{body:'选择理由',cautions:title==='章0'?[{kind:'uncertain',evidence:'原句「原文0」；问题：说明不清楚，缺少操作条件',message:'已标注疑点，等待全册整理后统一联网核实。'}]:[],
    reading:{version:1,subtitle:'',accent:'jade',blocks:[{type:'prose',title,note:'',text:'该章值得配图'}]}}]});
  }
  if(req.researchOnly)return envelope({verificationMarkdown:'已检查对应原句',sources:[{title:'测试资料',url:'https://example.invalid/source',content:'操作条件'}]});
  return envelope({pages:[{body:'# 手册\n\n## 主要重点｜章0\n\n图：步骤。\n\n原文0。\n\n说明：补充操作条件。'}]});
 });
 await prepareKnowledgeCardEditions({sourceMarkdown:source,targetSections:1,evidence:{prefix:'select',read:async k=>data.get(k)||null,save:async(k,v)=>{data.set(k,v);}},invoke:invoke as any,measure:async()=>1});
 expect(invoke.mock.calls.filter(([r])=>r.researchOnly)).toHaveLength(1);
 expect(data.get('select/final-verification/pages/0.json').original).toContain('说明不清楚');
});

it('旧版无疑点生产证据的中断任务拒绝复用和自动重新购买',async()=>{
 const invoke=vi.fn();
 await expect(prepareKnowledgeCardEditions({sourceMarkdown:'# 手册\n\n## 原章\n内容。',invoke,
 evidence:{prefix:'old',read:async k=>k.endsWith('/source.json')?{markdown:'旧稿'}:null,save:vi.fn()}})).rejects.toThrow('缺少疑点识别版本证据');
 expect(invoke).not.toHaveBeenCalled();
});

it('原句及标题无法定位时保留独立核对说明，继续末段检索且不误改其他章',()=>{
 const result=preserveKnowledgePendingResearch('# 原稿\n\n## 方法\n每次12次。<!-- 待核：原句「每次12次」；问题：缺少条件 -->', '# 新稿\n\n## 观察\n无关内容。');
 expect(result).toContain('## 说明：方法待核补充');expect(result).toContain('原文核对：每次12次');
 expect(result.split('## 说明：')[0]).not.toContain('待核：');expect(knowledgePendingResearchNotes(result)).toHaveLength(1);
});
