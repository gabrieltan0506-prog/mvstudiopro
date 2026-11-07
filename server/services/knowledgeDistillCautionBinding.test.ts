import {it,expect,vi} from 'vitest';
import {bindKnowledgeDistillCautions} from './knowledgeDistillCautionBinding';
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
 const p=structuredClone(page);p.cautions[0].evidence='原作者对第一章测试数值的换算存疑';
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
 await expect(run()).rejects.toThrow('未知章节');expect(invoke).toHaveBeenCalledTimes(1);
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
