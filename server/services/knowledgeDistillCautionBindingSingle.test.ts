import {it,expect,vi} from 'vitest';
import {bindKnowledgeDistillCautions} from './knowledgeDistillCautionBinding';
const page:any={id:'11111111-1111-4111-8111-111111111111',headline:'原分段',body:'正文',imageDescription:'',imageStatus:'absent',facts:[{term:'原知识',statement:'原知识'}],
 cautions:[{kind:'uncertain',evidence:'原句「测试数值甲应为十单位」与「测试数值乙应为二十单位」不同',message:'已标注疑点，等待全册整理后统一联网核实。'}],
 reading:{version:1,subtitle:'',accent:'jade',blocks:[{type:'prose',title:'甲章',text:'测试数值甲应为十单位。',note:''},{type:'prose',title:'乙章',text:'测试数值乙应为二十单位。',note:''},{type:'prose',title:'末章',text:'无关的食物纤维说明。',note:''}]}};
function setup(){const data=new Map<string,any>();return {data,evidence:{prefix:'binding',read:async(k:string)=>data.get(k),save:async(k:string,v:any)=>{data.set(k,structuredClone(v));}}};}
const count=(s:string)=>(s.match(/<!-- 待核：/g)||[]).length;

it('归章去重：跨章疑点只挂证据首句所在章；旧口径（不传 singleTarget）仍挂两章',async()=>{
 const invoke=vi.fn();
 const single=await bindKnowledgeDistillCautions(page,{evidence:setup().evidence,invoke,family:'glm',channel:'openrouter',singleTarget:true});
 expect(count(single)).toBe(1);expect(single.indexOf('待核')).toBeLessThan(single.indexOf('## 乙章'));
 const legacy=await bindKnowledgeDistillCautions(page,{evidence:setup().evidence,invoke,family:'glm',channel:'openrouter'});
 expect(count(legacy)).toBe(2);expect(invoke).not.toHaveBeenCalled();
});

it('同文疑点去重、每页最多保留 2 条',async()=>{
 const p=structuredClone(page);const c=(t:string)=>({kind:'uncertain',evidence:`原句「${t}」`,message:'待核实。'});
 p.cautions=[c('测试数值甲应为十单位'),c('测试数值甲应为十单位'),c('测试数值乙应为二十单位'),c('无关的食物纤维说明')];
 const out=await bindKnowledgeDistillCautions(p,{evidence:setup().evidence,invoke:vi.fn(),family:'glm',channel:'openrouter',singleTarget:true,maxCautions:2});
 expect(count(out)).toBe(2);expect(out.split('## 末章')[1]).not.toContain('待核');
});

it('模型归章回多章时只取一章；已存绑定回执回放零调用',async()=>{
 const p=structuredClone(page);p.cautions[0].evidence='作者换算存疑';
 const f=setup();
 const invoke=vi.fn(async(request:any)=>{
  const input=JSON.parse(request.contents[0].parts[0].text),identity=JSON.parse(input.source.pages[0].body);
  const blocks=identity.chapters.slice(0,2).map((ch:any)=>({type:'prose',title:ch.label,text:'疑点0',note:''}));
  const report={kind:'knowledge_publication_v1',sourceDigest:input.sourceDigest,title:'关联表',pages:[{...p,id:input.source.pages[0].id,cautions:[],reading:{version:1,subtitle:'',accent:'jade',blocks}}]};
  return {status:200,text:JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(report)}]}}]})};
 });
 const run=()=>bindKnowledgeDistillCautions(p,{evidence:f.evidence,invoke:invoke as any,family:'glm',channel:'openrouter',singleTarget:true});
 const first=await run();expect(count(first)).toBe(1);expect(invoke).toHaveBeenCalledTimes(1);
 expect(await run()).toBe(first);expect(invoke).toHaveBeenCalledTimes(1);
});
