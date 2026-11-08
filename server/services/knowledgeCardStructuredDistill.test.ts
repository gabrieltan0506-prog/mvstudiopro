import {it,expect,vi} from 'vitest';
import {knowledgeStructuredDistillContext,invokeKnowledgeStructuredDistill} from './knowledgeCardStructuredDistill';
import {invokeKnowledgePublicationRoutes} from './knowledgePublicationRoutes';
const reading=(text:string)=>({version:1,subtitle:'',accent:'jade',blocks:[{type:'prose',title:'饮食与活动配合',note:'',text}]});
function fixture(){
 const data=new Map<string,any>();
 const evidence={prefix:'test/new-epub-json',read:async(key:string)=>data.get(key),save:async(key:string,value:any)=>{data.set(key,structuredClone(value));}};
 const response=(request:any)=>{
  const input=JSON.parse(request.contents[0].parts[0].text);
  const report={kind:'knowledge_publication_v1',sourceDigest:input.sourceDigest,title:'三方面改善生活习惯',pages:input.source.pages.map((page:any)=>({...page,role:undefined,imageUrl:undefined,body:'明确的知识说明与条件。',reading:reading('明确的知识说明与条件。'),imageDescription:'',imageStatus:'absent',facts:[{term:'生活习惯',statement:'饮食与活动配合。'}],cautions:[]}))};
  return {status:200,text:JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(report)}]}}]})};
 };
 return {data,evidence,response};
}
it('原文全部进入既有JSON批次，失败等在途收口，恢复只执行未完成批次',async()=>{
 const f=fixture();let fail=true,active=0,peak=0;const inputs:string[]=[];
 const invoke=vi.fn(async(request:any,scope:any)=>{
  expect(request.generationConfig.responseMimeType).toBe('application/json');
  expect(request.executionFamily).toBe('glm');
  inputs.push(JSON.parse(request.contents[0].parts[0].text).source.pages.map((p:any)=>p.body).join(''));
  active++;peak=Math.max(peak,active);
  try{if(scope.prefix.endsWith('batch-1')&&fail){fail=false;throw Error('测试用派发前故障');}await new Promise(resolve=>setTimeout(resolve,15));return f.response(request);}finally{active--;}
 });
 const params={sourceText:'原文条件与知识。'.repeat(6000),imageUrls:[],modelName:'glm-5.3-flashx',minSections:2};
 const run=()=>knowledgeStructuredDistillContext.run({evidence:f.evidence,invoke:invoke as any},()=>invokeKnowledgeStructuredDistill(params));
 await expect(run()).rejects.toThrow('派发前故障');expect(active).toBe(0);expect(peak).toBe(2);
 expect(inputs.join('')).toBe(params.sourceText);
 expect(Array.from(f.data.keys()).filter(key=>key.endsWith('/report.json'))).toHaveLength(1);
 const result=await run();expect(invoke).toHaveBeenCalledTimes(3);expect(result).toContain('## 饮食与活动配合');
 await run();expect(invoke).toHaveBeenCalledTimes(3);
});
it('同一任务的旧原稿结果不能被新输入命中，完整结束门禁拒绝半截JSON',async()=>{
 const f=fixture(),invoke=vi.fn(async(request:any)=>f.response(request));
 const run=(sourceText:string)=>knowledgeStructuredDistillContext.run({evidence:f.evidence,invoke:invoke as any},()=>invokeKnowledgeStructuredDistill({sourceText,imageUrls:[],modelName:'glm-5.3-flashx',minSections:1}));
 await run('原文一');await run('原文二');expect(invoke).toHaveBeenCalledTimes(2);
 const partial=vi.fn(async(request:any)=>{const raw=f.response(request);return {...raw,text:raw.text.replace('STOP','MAX_TOKENS')};});
 const work=()=>knowledgeStructuredDistillContext.run({evidence:f.evidence,invoke:partial as any},()=>invokeKnowledgeStructuredDistill({sourceText:'未完成的原文',imageUrls:[],modelName:'glm-5.3-flashx',minSections:1}));
 await expect(work()).rejects.toThrow('尚未完整');await expect(work()).rejects.toThrow('尚未完整');expect(partial).toHaveBeenCalledTimes(1);
});
it('GLM首选沿正式JSON路由出站，真实字段经解析再消费，回放零网络',async()=>{
 const f=fixture();let model='';
 const fetcher=vi.fn(async(_url:any,init:any)=>{
  const body=JSON.parse(init.body);model=body.model;expect(body.response_format).toEqual({type:'json_object'});
  const message=body.messages.find((m:any)=>m.role==='user');
  const text=typeof message.content==='string'?message.content:message.content.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join('\n');
  const input=JSON.parse(text);
  const report={kind:'knowledge_publication_v1',sourceDigest:input.sourceDigest,title:'原文提炼',pages:input.source.pages.map((page:any)=>({id:page.id,headline:'真实主题',body:'知识说明。',reading:{...reading('知识说明。'),templateId:'fusion_ink_mountains',templateReason:'主题适合'},imageDescription:'',imageStatus:'absent',facts:[{term:'主题',statement:'知识说明。'}],cautions:[]}))};
  // 这个用例只校验真实路由与JSON；装饰项由原路由的规范化处理。
  return new Response(JSON.stringify({model:body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(report)}}]}),{status:200});
 });
 const invoke=(request:any,scope:any)=>{request.systemInstruction.parts=[{text:'测试用结构化正文，只验证既有JSON合同。'}];return invokeKnowledgePublicationRoutes(request,scope,{key:()=> 'test-key',fetch:fetcher as any});};
 const params={sourceText:'原始知识说明。',imageUrls:[],modelName:'glm-5.3-flashx',minSections:1};
 const run=()=>knowledgeStructuredDistillContext.run({evidence:f.evidence,invoke:invoke as any},()=>invokeKnowledgeStructuredDistill(params));
 expect(await run()).toContain('知识说明。');expect(model).toBe('z-ai/glm-5.3-flashx');await run();expect(fetcher).toHaveBeenCalledTimes(1);
});
it('原提炼入口使用JSON检查点并确定性合并，不再追加整本重写调用',async()=>{
 const {invokeDistillLlmPossiblyChunked,__setKnowledgeCardDistillGatewayInvokerForTest}=await import('./knowledgeCardDistill');
 const f=fixture(),legacy=vi.fn(async()=>{throw Error('不应进入旧裸Markdown网关');});
 const invoke=vi.fn(async(request:any)=>f.response(request));
 __setKnowledgeCardDistillGatewayInvokerForTest(legacy);
 try{
  const chunks:number[]=[];
  const params={sourceText:'原始知识及必要条件。'.repeat(7000),extraText:'',imageUrls:[],documents:[],modelName:'glm-5.3-flashx',detailLevel:'full' as const,minSectionsTotal:4,onReadingChunk:async(chunk:any)=>{chunks.push(chunk.index);}};
  const run=()=>knowledgeStructuredDistillContext.run({evidence:f.evidence,invoke:invoke as any},()=>invokeDistillLlmPossiblyChunked(params));
  const result=await run();expect(result).toContain('## 饮食与活动配合');expect(legacy).not.toHaveBeenCalled();
  const count=invoke.mock.calls.length;expect(count).toBeGreaterThan(1);expect(new Set(chunks).size).toBe(chunks.length);
  await run();expect(invoke).toHaveBeenCalledTimes(count);
 }finally{__setKnowledgeCardDistillGatewayInvokerForTest(null);}
},15000);
