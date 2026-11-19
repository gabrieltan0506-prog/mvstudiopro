import {it,expect,vi,describe} from 'vitest';
import {createHash} from 'node:crypto';
import {bindKnowledgeDistillCautions,knowledgeCautionProgramBinding,knowledgeCautionSimilarityScores} from './knowledgeDistillCautionBinding';
import {bestKnowledgeTextMatch} from '../../shared/knowledgeTextAttachment';
const page:any={id:'11111111-1111-4111-8111-111111111111',headline:'原分段',body:'正文',imageDescription:'',imageStatus:'absent',facts:[{term:'原知识',statement:'原知识'}],cautions:[{kind:'uncertain',evidence:'原句「测试数值甲应为十单位」；与另一处表述不同',message:'已标注疑点，等待全册整理后统一联网核实。'}],reading:{version:1,subtitle:'',accent:'jade',blocks:[{type:'prose',title:'甲章',text:'测试数值甲应为十单位。',note:''},{type:'prose',title:'末章',text:'无关的食物纤维说明。',note:''}]}};
function setup(){const data=new Map<string,any>();return {data,evidence:{prefix:'binding',read:async(k:string)=>data.get(k),save:async(k:string,v:any)=>{data.set(k,structuredClone(v));}}};}
it('唯一逐字原句疑点绑定对应章，不误挂末章且无需模型',async()=>{
 const f=setup(),invoke=vi.fn();const result=await bindKnowledgeDistillCautions(page,{evidence:f.evidence,invoke,family:'glm',channel:'openrouter'});
 expect(invoke).not.toHaveBeenCalled();expect(result.indexOf('<!-- 待核：')).toBeLessThan(result.indexOf('## 末章'));
 expect(result.split('## 末章')[1]).not.toContain('待核');
});
it('跨章两处原句分别绑定两个目标，不漏第二处',async()=>{
 const p=structuredClone(page);p.reading.blocks[1].text='测试数值乙应为二十单位。';p.cautions[0].evidence='原句「测试数值甲应为十单位」与「测试数值乙应为二十单位」不同';
 const f=setup(),invoke=vi.fn();const result=await bindKnowledgeDistillCautions(p,{evidence:f.evidence,invoke,family:'glm',channel:'openrouter'});
 expect(result.match(/<!-- 待核：/g)).toHaveLength(2);expect(invoke).not.toHaveBeenCalled();
});
it('摘要不能逐字匹配时只让原JSON合同选关联，恢复零调用且正文不改写',async()=>{
 const p=structuredClone(page);// 无标题、无原句、无相似依据：程序归属判 no_basis，交模型（原用例证据可按相似度程序归属，见下方表格用例）。
 p.cautions[0].evidence='原作者的换算存疑';
 const f=setup();const invoke=vi.fn(async(request:any)=>{
  expect(request.generationConfig.responseMimeType).toBe('application/json');const input=JSON.parse(request.contents[0].parts[0].text),identity=JSON.parse(input.source.pages[0].body);
  const report={kind:'knowledge_publication_v1',sourceDigest:input.sourceDigest,title:'关联表',pages:[{...p,id:input.source.pages[0].id,cautions:[],reading:{version:1,subtitle:'',accent:'jade',blocks:[{type:'prose',title:identity.chapters[0].label,text:'疑点0',note:''}]}}]};
  return {status:200,text:JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(report)}]}}]})};
 });
 const run=()=>bindKnowledgeDistillCautions(p,{evidence:f.evidence,invoke:invoke as any,family:'glm',channel:'openrouter'});
 const result=await run();expect(result).toContain('测试数值甲应为十单位。');expect(result).toContain(p.cautions[0].evidence);expect(result.indexOf('待核')).toBeLessThan(result.indexOf('## 末章'));
 expect(await run()).toBe(result);expect(invoke).toHaveBeenCalledTimes(1);
 const reportKey=Array.from(f.data.keys()).find(k=>k.endsWith('/report.json'))!;
 f.data.get(reportKey).report.pages[0].reading.blocks[0].title='未存在的章节';
 // 对应表中无法识别的条目只跳过，漏掉的疑点按内容相似度归位；不重购、不报整本失败。
 const tolerant=await run();expect(tolerant).toContain(p.cautions[0].evidence);expect(tolerant.split('## 末章')[1]).not.toContain('待核');expect(invoke).toHaveBeenCalledTimes(1);
});

it('已收完整对应表仅补固定外层合同，保留未知回执且恢复不重购',async()=>{
 const {createHash}=await import('node:crypto');
 const {KNOWLEDGE_PUBLICATION_ROUTE_VERSION}=await import('./knowledgePublicationRoutes');
 const p=structuredClone(page);p.cautions[0].evidence='摘要中的第一章数值需要确认';
 const f=setup();const invoke=vi.fn(async(request:any,scope:any)=>{
  const input=JSON.parse(request.contents[0].parts[0].text),identity=JSON.parse(input.source.pages[0].body);
  const requestDigest=createHash('sha256').update(JSON.stringify([KNOWLEDGE_PUBLICATION_ROUTE_VERSION,request])).digest('hex');
  await scope.save(`${scope.prefix}/route-glm-openrouter.json`,{requestDigest,state:'failed',model:'z-ai/glm-5.3-flashx',response:{status:200,text:JSON.stringify({model:'z-ai/glm-5.3-flashx',choices:[{finish_reason:'stop',message:{content:JSON.stringify({sourceDigest:input.sourceDigest,pageId:p.id,reading:{version:1,subtitle:'',accent:'jade',blocks:[{type:'prose',title:identity.chapters[0].label,text:'疑点0',note:''}]}})}}]})}});
  await scope.save(`${scope.prefix}/route-glm-evolink.json`,{requestDigest,state:'unknown'});
  throw Error('已有完整回包外层字段不全');
 });
 const run=()=>bindKnowledgeDistillCautions(p,{evidence:f.evidence,invoke:invoke as any,family:'glm',channel:'openrouter'});
 const result=await run();expect(result.indexOf('待核')).toBeLessThan(result.indexOf('## 末章'));
 expect(await run()).toBe(result);expect(invoke).toHaveBeenCalledTimes(1);
 const recovered=Array.from(f.data.values()).find(v=>v.recoveredFrom);expect(recovered.report.kind).toBe('knowledge_publication_v1');
 expect(Array.from(f.data.values()).some(v=>v.state==='unknown')).toBe(true);
});

it('关联回包漏掉部分疑点时按内容相似度归位，不让整本读档失败也不默认挂末章',async()=>{
 const p=structuredClone(page);
 p.reading.blocks=[{type:'prose',title:'甲章',text:'膳食纤维来源与每日摄入量说明。',note:''},{type:'prose',title:'乙章',text:'快走心率与运动强度的自查方法。',note:''},{type:'prose',title:'末章',text:'其他附录内容。',note:''}];
 // 两条都无法程序确定（第一条无依据，第二条两章并列），交模型；模型只关联第一条，漏掉第二条。
 p.cautions=[{kind:'uncertain',evidence:'第一条需核对的说法',message:'已标注疑点'},{kind:'uncertain',evidence:'膳食纤维与快走心率',message:'已标注疑点'}];
 const f=setup();const invoke=vi.fn(async(request:any)=>{
  const input=JSON.parse(request.contents[0].parts[0].text),identity=JSON.parse(input.source.pages[0].body);
  expect(identity.questions.map((q:any)=>q.id)).toEqual(['疑点0','疑点1']);
  // 只关联了第一条疑点，漏掉第二条
  const report={kind:'knowledge_publication_v1',sourceDigest:input.sourceDigest,title:'关联表',pages:[{...p,id:input.source.pages[0].id,cautions:[],reading:{version:1,subtitle:'',accent:'jade',blocks:[{type:'prose',title:identity.chapters[0].label,text:'疑点0',note:''}]}}]};
  return {status:200,text:JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(report)}]}}]})};
 });
 const result=await bindKnowledgeDistillCautions(p,{evidence:f.evidence,invoke:invoke as any,family:'glm',channel:'openrouter'});
 const [a,b,c]=result.split(/(?=^## )/m);
 expect(a).toContain('第一条需核对');expect(`${a}${b}`).toContain('膳食纤维与快走心率');expect(c).not.toContain('待核');
 expect(invoke).toHaveBeenCalledTimes(1);
 const bindings=Array.from(f.data.entries()).find(([k])=>k.endsWith('/bindings.json'))![1];
 expect(bindings.similarityFallback).toEqual([1]);
});

it('对应表标签有空白/全角/只写章节号等差异时仍能对上，未知条目跳过',async()=>{
 const p=structuredClone(page);
 p.reading.blocks=[{type:'prose',title:'甲章',text:'膳食纤维来源与每日摄入量说明。',note:''},{type:'prose',title:'乙章',text:'快走心率与运动强度的自查方法。',note:''},{type:'prose',title:'末章',text:'其他附录内容。',note:''}];
 p.cautions=[{kind:'uncertain',evidence:'第一条需核对的说法',message:'已标注疑点'},{kind:'uncertain',evidence:'第二条需核对的说法',message:'已标注疑点'}];
 const f=setup();const invoke=vi.fn(async(request:any)=>{
  const input=JSON.parse(request.contents[0].parts[0].text),identity=JSON.parse(input.source.pages[0].body);
  const [a,b]=identity.chapters.map((c:any)=>c.label);
  const report={kind:'knowledge_publication_v1',sourceDigest:input.sourceDigest,title:'关联表',pages:[{...p,id:input.source.pages[0].id,cautions:[],reading:{version:1,subtitle:'',accent:'jade',blocks:[
   {type:'prose',title:' '+a.replace('｜',' | ')+' ',text:'疑点 0',note:''},
   {type:'prose',title:b.split('｜')[0],text:'疑点１',note:''},
   {type:'prose',title:'不存在的章节',text:'疑点9',note:''}]}}]};
  return {status:200,text:JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(report)}]}}]})};
 });
 const result=await bindKnowledgeDistillCautions(p,{evidence:f.evidence,invoke:invoke as any,family:'glm',channel:'openrouter'});
 const [x,y,z]=result.split(/(?=^## )/m);
 expect(x).toContain('第一条需核对');expect(y).toContain('第二条需核对');expect(z).not.toContain('待核');
 const bindings=Array.from(f.data.entries()).find(([k])=>k.endsWith('/bindings.json'))![1];
 expect(bindings.similarityFallback).toEqual([]);expect(bindings.skippedBlocks).toBe(1);
});

it('关联请求失败或回包截断时不让整本读档失败，不重购，全部按内容相似度归位',async()=>{
 const p=structuredClone(page);
 p.reading.blocks=[{type:'prose',title:'甲章',text:'膳食纤维来源与每日摄入量说明。',note:''},{type:'prose',title:'乙章',text:'快走心率与运动强度的自查方法。',note:''},{type:'prose',title:'末章',text:'其他附录内容。',note:''}];
 // 两章并列（程序判 near-tie），交模型；模型回包截断后按原规则相似度兜底，仍不挂末章。
 p.cautions=[{kind:'uncertain',evidence:'快走心率与膳食纤维',message:'已标注疑点'}];
 const f=setup();const invoke=vi.fn(async()=>({status:200,text:JSON.stringify({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{'}]}}]})}));
 const result=await bindKnowledgeDistillCautions(p,{evidence:f.evidence,invoke:invoke as any,family:'glm',channel:'openrouter'});
 const [x,y,z]=result.split(/(?=^## )/m);
 expect(`${x}${y}`).toContain('快走心率与膳食纤维');expect(z).not.toContain('待核');expect(invoke).toHaveBeenCalledTimes(1);
 const bindings=Array.from(f.data.entries()).find(([k])=>k.endsWith('/bindings.json'))![1];
 expect(bindings.modelError).toContain('未完整结束');expect(bindings.similarityFallback).toEqual([0]);
});

describe('B2 程序归属：标题 → 唯一原句 → 相似度（领先门槛）→ 不确定才问模型',()=>{
 const chapters=[
  {index:0,title:'膳食纤维摄入',text:'## 膳食纤维摄入\n\n膳食纤维来源与每日摄入量说明，成人每日二十五克。'},
  {index:1,title:'快走与心率',text:'## 快走与心率\n\n快走心率与运动强度的自查方法，心率区间按年龄估算。'},
  {index:2,title:'附录',text:'## 附录\n\n其他附录内容。'},
 ];
 const table:[string,string,{targets:number[];method:string;reason?:string}][]=[
  ['唯一标题且余下文字印证同章','「快走与心率」一节心率区间按年龄估算的方法未给出来源',{targets:[1],method:'heading'}],
  ['唯一标题但余下文字无依据（不能凭提到标题就定）','「快走与心率」一节的估算公式未给出来源',{targets:[],method:'ambiguous',reason:'heading_unconfirmed'}],
  ['唯一标题但余下文字指向另一章','快走与心率一节的说法与膳食纤维来源与每日摄入量说明矛盾',{targets:[],method:'ambiguous',reason:'heading_unconfirmed'}],
  ['唯一原句','原句“成人每日二十五克”与其他资料不一致',{targets:[0],method:'quotation'}],
  ['标题与原句同章','「快走与心率」写“心率区间按年龄估算”，未说明公式',{targets:[1],method:'heading'}],
  ['标题与原句矛盾','「快走与心率」一节写道：“成人每日二十五克”',{targets:[],method:'ambiguous',reason:'heading_quote_conflict'}],
  ['两个标题','膳食纤维摄入与快走与心率两节说法矛盾',{targets:[],method:'ambiguous',reason:'multiple_headings'}],
  ['原句分属两章','“成人每日二十五克”与“心率区间按年龄估算”互相矛盾',{targets:[],method:'ambiguous',reason:'quotation_ambiguous'}],
  ['相似度明显领先','每日摄入量的说法需核对',{targets:[0],method:'similarity'}],
  ['相似度并列','膳食纤维与快走心率',{targets:[],method:'ambiguous',reason:'similarity_near_tie'}],
  ['无依据','第一条需核对的说法',{targets:[],method:'ambiguous',reason:'no_basis'}],
  ['无依据（外文）','unit conversion is doubtful',{targets:[],method:'ambiguous',reason:'no_basis'}],
 ];
 it.each(table)('%s',(_name,evidence,expected)=>{
  expect(knowledgeCautionProgramBinding(chapters,evidence)).toEqual(expected);
 });
 it('对抗：证据只是提到另一章标题（「与××矛盾」「可参见注意事项」）时不得程序定到被提到的章',()=>{
  const ch=(rows:[string,string][])=>rows.map(([t,x],index)=>({index,title:t,text:`## ${t}\n\n${x}`}));
  // 疑点原句（改写过、不逐字）在第 0 章，证据顺带提到第 1 章标题：模型应关联第 0 章（或两章），程序不能单凭标题定到第 1 章。
  expect(knowledgeCautionProgramBinding(ch([['布洛芬用法用量','布洛芬成人每次200至400毫克，每日最大剂量为1200毫克，儿童按体重计算。'],['用药注意事项','胃溃疡患者慎用，避免与酒精同服，孕晚期禁用。']]),
   '原文称布洛芬一天最多可吃1200毫克，这与用药注意事项里提醒的胃肠风险相比剂量偏高，需核对').targets).toEqual([]);
  expect(knowledgeCautionProgramBinding(ch([['降压药的选择','钙通道阻滞剂适合老年人，血压控制目标为一百四十。'],['注意事项','服药期间定期监测肾功能。']]),
   '原书说老年人血压目标一百四十，未区分是否合并糖尿病，可参见注意事项').targets).toEqual([]);
  // 短标题被长标题包含、但在证据里也独立出现：两章都被提到，不能只定长标题那章。
  expect(knowledgeCautionProgramBinding(ch([['用药剂量','成人每日两次。'],['儿童用药剂量','儿童每日三次。']]),'儿童用药剂量写每日三次而用药剂量写每日两次，二者矛盾'))
   .toEqual({targets:[],method:'ambiguous',reason:'multiple_headings'});
  // 只出现长标题时短标题不单独算（原规则保留）。
  expect(knowledgeCautionProgramBinding(ch([['用药剂量','成人每日两次。'],['儿童用药剂量','儿童每日三次，按体重计算。']]),'儿童用药剂量一节每日三次按体重计算未说明体重区间').targets).toEqual([1]);
 });
 it('相似度分数与原 bestKnowledgeTextMatch 选出的第一名一致（同构实现）',()=>{
  for(const [, evidence] of table){
   const scores=knowledgeCautionSimilarityScores(chapters.map(c=>c.text),evidence);
   if(Math.max(...scores)>0)expect(scores.indexOf(Math.max(...scores))).toBe(bestKnowledgeTextMatch(chapters.map(c=>c.text),evidence));
  }
 });
 it('文字无依据时构造上不可能给出确定归属：与各章不共用任何字的证据一律交模型',()=>{
  const used=new Set(Array.from(chapters.map(c=>c.text+c.title).join('')));
  const pool=Array.from('甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄黄宇宙洪荒日月盈昃辰宿列张').filter(ch=>!used.has(ch));
  let seed=7;const rand=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};
  for(let n=0;n<200;n++){
   const evidence=Array.from({length:4+Math.floor(rand()*30)},()=>pool[Math.floor(rand()*pool.length)]).join(rand()<0.3?'，':'');
   expect(knowledgeCautionProgramBinding(chapters,evidence).targets).toEqual([]);
  }
 });
 it('程序能定的疑点不问模型、留程序归属记录；仍不确定的才交模型，且只问那几条',async()=>{
  const p=structuredClone(page);p.reading.blocks=chapters.map(c=>({type:'prose',title:c.title,text:c.text.split('\n\n')[1],note:''}));
  p.cautions=[{kind:'uncertain',evidence:'每日摄入量的说法需核对',message:'已标注疑点'},{kind:'uncertain',evidence:'第一条需核对的说法',message:'已标注疑点'}];
  const f=setup();const asked:string[][]=[];
  const invoke=vi.fn(async(request:any)=>{
   const input=JSON.parse(request.contents[0].parts[0].text),identity=JSON.parse(input.source.pages[0].body);
   asked.push(identity.questions.map((q:any)=>q.id));
   const report={kind:'knowledge_publication_v1',sourceDigest:input.sourceDigest,title:'关联表',pages:[{...p,id:input.source.pages[0].id,cautions:[],reading:{version:1,subtitle:'',accent:'jade',blocks:[{type:'prose',title:identity.chapters[1].label,text:'疑点1',note:''}]}}]};
   return {status:200,text:JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(report)}]}}]})};
  });
  const result=await bindKnowledgeDistillCautions(p,{evidence:f.evidence,invoke:invoke as any,family:'glm',channel:'openrouter'});
  expect(asked).toEqual([['疑点1']]);
  const [a,b,c]=result.split(/(?=^## )/m);
  expect(a).toContain('每日摄入量的说法');expect(b).toContain('第一条需核对');expect(c).not.toContain('待核');
  const bindings=Array.from(f.data.entries()).find(([k])=>k.endsWith('/bindings.json'))![1];
  expect(bindings.programBindings).toEqual([{index:0,targets:[0],method:'similarity'},{index:1,targets:[],method:'ambiguous',reason:'no_basis'}]);
  // 全部程序可定：零模型调用，归属记录落 caution-program-*.json。
  const q=structuredClone(p);q.cautions=[q.cautions[0]];const g=setup(),none=vi.fn();
  const only=await bindKnowledgeDistillCautions(q,{evidence:g.evidence,invoke:none as any,family:'glm',channel:'openrouter'});
  expect(none).not.toHaveBeenCalled();expect(only.split(/(?=^## )/m)[0]).toContain('每日摄入量');
  expect(Array.from(g.data.keys()).some(k=>/\/caution-program-[0-9a-f]{64}\.json$/.test(k))).toBe(true);
 });
 it('续做兼容：旧身份的归属目录已有请求与回包时沿旧流程零调用复用，不做程序归属、不另买',async()=>{
  const {knowledgeReadingMarkdown}=await import('../../shared/knowledgePublicationLayout');
  const p=structuredClone(page);p.reading.blocks=chapters.map(c=>({type:'prose',title:c.title,text:c.text.split('\n\n')[1],note:''}));
  // 程序归属会定到第 0 章；旧回包把它关联到第 1 章——复用旧结果即应挂在第 1 章。
  p.cautions=[{kind:'uncertain',evidence:'每日摄入量的说法需核对',message:'已标注疑点'}];
  const body=knowledgeReadingMarkdown(p.reading).replace(/^### /gm,'## ').replace(/^> (?!〔参考原页)/gm,'说明：');
  const chunks=body.split(/(?=^##[ \t]+)/m),chs=chunks.map((text,index)=>({text,index,title:text.match(/^##[ \t]+([^\n]+)/)?.[1]})).filter(c=>c.title);
  const identity={version:1,pageId:p.id,chapters:chs.map(c=>({label:`章节${c.index}｜${c.title}`,body:c.text})),questions:[{id:'疑点0',evidence:p.cautions[0].evidence,message:p.cautions[0].message}]};
  const digest=createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  const id=`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
  const f=setup(),dir=`binding/caution-binding-${digest}`;
  f.data.set(`${dir}/request.json`,{digest,request:{}});
  const reading={version:1,subtitle:'',accent:'jade',blocks:[{type:'prose',title:identity.chapters[1].label,text:'疑点0',note:''}]};
  f.data.set(`${dir}/report.json`,{digest,report:{kind:'knowledge_publication_v1',sourceDigest:digest,title:'已有疑点对应原章',pages:[{id,headline:'只关联，不改内容',body:knowledgeReadingMarkdown(reading as any),imageStatus:'absent',imageDescription:'',facts:[{term:'章节关联',statement:'仅定位'}],cautions:[],reading}]}});
  const invoke=vi.fn();
  const result=await bindKnowledgeDistillCautions(p,{evidence:f.evidence,invoke:invoke as any,family:'glm',channel:'openrouter'});
  expect(invoke).not.toHaveBeenCalled();
  const [a,b]=result.split(/(?=^## )/m);expect(b).toContain('每日摄入量');expect(a).not.toContain('待核');
  expect(f.data.get(`${dir}/bindings.json`).programBindings).toBeUndefined();
 });
});
