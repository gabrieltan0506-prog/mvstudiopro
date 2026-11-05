import { describe,it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { invokeKnowledgePublicationRoutes, KNOWLEDGE_PUBLICATION_MODEL as OR_MODEL, KNOWLEDGE_PUBLICATION_EVOLINK_MODEL as EVO_MODEL, type KnowledgeModelRequest } from './knowledgePublicationRoutes';
const make=()=>{
 const id=randomUUID(),sourceDigest='a'.repeat(64),storage=new Map<string,any>();
 const source={title:'水循环',pages:[{id,headline:'水循环',body:'蒸发、凝结、降水',imageUrl:'gs://test/own.png'}]};
 const report={kind:'knowledge_publication_v1',sourceDigest,title:source.title,pages:[{id,headline:'水循环',body:'原始说明',imageDescription:'蓝色箭头由水面向上，云层中有雨滴',imageStatus:'consistent',facts:[{term:'蒸发',statement:'水变为水蒸气'}],cautions:[],reading:{version:1,subtitle:'水的循环过程',accent:'jade',blocks:[{type:'table',title:'状态变化',note:'',columns:['过程','变化'],rows:[['蒸发','液态变气态'],['凝结','气态变液态']]}]}}]};
 const request:KnowledgeModelRequest={systemInstruction:{parts:[{text:'测试指令'}]},contents:[{role:'user',parts:[{text:JSON.stringify({source,sourceDigest})},{fileData:{fileUri:'gs://test/own.png',mimeType:'image/png'}}]}],generationConfig:{temperature:0.3,maxOutputTokens:32768,responseMimeType:'application/json'}};
 const evidence={prefix:'test/0',read:vi.fn(async(k:string)=>storage.get(k)||null),save:vi.fn(async(k:string,v:unknown)=>{storage.set(k,structuredClone(v));})};
 const response=(model:string,value:any=report)=>new Response(JSON.stringify({model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:100}}),{status:200,headers:{'Content-Type':'application/json'}});
 const deps={key:()=> 'test-key',sign:()=> 'https://example.invalid/image.png',fetch:vi.fn(async()=>response(OR_MODEL)),vertex:vi.fn(async()=>({status:200,text:JSON.stringify({modelVersion:'gemini-3.8-flash',usageMetadata:{promptTokensDetails:[{modality:'IMAGE',tokenCount:100}]},candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(report)}]}}]})}))};
 return{request,evidence,deps,report,response,storage};
};
describe('知识卡固定1017与最后兜底',()=>{
 it('第一路成功不调用其他路，实际图片与表格结构进入同一回执，重放不再付费',async()=>{
  const f=make();const r=await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);const env=JSON.parse(r.text);
  expect(env.modelVersion).toBe(OR_MODEL);expect(env.inputEvidence.imageSources).toEqual(['gs://test/own.png']);
  const request=JSON.parse((f.deps.fetch.mock.calls[0] as any)[1].body);expect(request.messages[1].content[1]).toEqual({type:'image_url',image_url:{url:'https://example.invalid/image.png',detail:'high'}});
  expect(JSON.parse(env.candidates[0].content.parts[0].text).pages[0].body).toContain('| 蒸发 | 液态变气态 |');
  expect(f.deps.vertex).not.toHaveBeenCalled();await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);expect(f.deps.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(Array.from(f.storage.values()))).not.toContain('test-key');
 });
 it('OpenRouter明确503后只进入EvoLink精确1017图像入口',async()=>{
  const f=make();f.deps.fetch.mockResolvedValueOnce(new Response('{}',{status:503})).mockResolvedValueOnce(f.response(EVO_MODEL));
  const result=JSON.parse((await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).text);
  expect(result.gatewayTrace.map((v:any)=>v.route+':'+v.state)).toEqual(['openrouter:failed','evolink:succeeded']);expect(f.deps.vertex).not.toHaveBeenCalled();
  const call=f.deps.fetch.mock.calls[1] as any;expect(call[0]).toBe('https://api.evolink.ai/v1/chat/completions');expect(JSON.parse(call[1].body).model).toBe(EVO_MODEL);
 });
 it('前两路均明确失败才执行Vertex，保留真实Gemini身份',async()=>{
  const f=make();f.deps.fetch.mockImplementation(async()=>new Response('{}',{status:503}));
  const result=JSON.parse((await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).text);
  expect(f.deps.fetch).toHaveBeenCalledTimes(2);expect(f.deps.vertex).toHaveBeenCalledTimes(1);expect(result.gateway).toBe('vertex');expect(result.modelVersion).toBe('gemini-3.8-flash');expect(result.gatewayTrace).toHaveLength(3);
 });
 it('断线结果未知时不切换、不重投，后续原请求只读断点',async()=>{
  const f=make();f.deps.fetch.mockRejectedValueOnce(new Error('timeout'));
  await expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('未重复提交');
  await expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('回执尚未闭合');
  expect(f.deps.fetch).toHaveBeenCalledTimes(1);expect(f.deps.vertex).not.toHaveBeenCalled();
 });
 it('不是1017或缺少自动阅读结构不能冒充成功',async()=>{
  const f=make();const bad=structuredClone(f.report);delete (bad.pages[0] as any).reading;
  f.deps.fetch.mockResolvedValueOnce(f.response('deepseek/deepseek-v4.1-flash')).mockResolvedValueOnce(f.response(EVO_MODEL,bad));
  const out=JSON.parse((await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).text);expect(out.gateway).toBe('vertex');expect(f.storage.get('test/0/route-openrouter.json').reason).toContain('版本');expect(f.storage.get('test/0/route-evolink.json').reason).toContain('结构');
 });
 it('接受结果保存失败不购买下一跳，恢复用已收原始回执',async()=>{
  const f=make();const saved=f.evidence.save;let fail=true;
  f.evidence.save=vi.fn(async(k,v)=>{if(k.endsWith('/accepted.json')&&fail){fail=false;throw Error('storage failure');}await saved(k,v);});
  await expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('storage failure');
  expect(f.deps.fetch).toHaveBeenCalledTimes(1);expect(f.deps.vertex).not.toHaveBeenCalled();await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);expect(f.deps.fetch).toHaveBeenCalledTimes(1);
 });
 it('收到明确length结束帧会保留原回执再切下一路，不把已知失败当未知断流',async()=>{
  const f=make();const chunk={id:'test',model:OR_MODEL,choices:[{index:0,delta:{content:'不完整'},finish_reason:'length'}]};
  f.deps.fetch.mockResolvedValueOnce(new Response('data: '+JSON.stringify(chunk)+'\n\ndata: [DONE]\n\n',{status:200,headers:{'Content-Type':'text/event-stream'}})).mockResolvedValueOnce(f.response(EVO_MODEL));
  const result=JSON.parse((await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).text);expect(result.gateway).toBe('evolink');expect(f.storage.has('test/0/openrouter-response.json')).toBe(true);expect(f.deps.vertex).not.toHaveBeenCalled();
 });
 it('模型输入变化不能回放另一版原始回执',async()=>{
  const f=make();await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);f.request.systemInstruction.parts[0].text='new';await expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('版本变化');expect(f.deps.fetch).toHaveBeenCalledTimes(1);
 });
});

it('自动选版的新输入必须返回有效模板与理由，旧输入仍可回放',async()=>{
 const {KNOWLEDGE_TEMPLATE_SELECTION_MARKER}=await import('../../shared/knowledgePublicationTemplates');
 const f=make();f.request.systemInstruction.parts[0].text+=KNOWLEDGE_TEMPLATE_SELECTION_MARKER;
 const selected=structuredClone(f.report);Object.assign(selected.pages[0].reading,{templateId:'fusion_ink_mountains',templateReason:'配图与知识主题适合清雅水墨'});
 f.deps.fetch.mockResolvedValueOnce(f.response(OR_MODEL)).mockResolvedValueOnce(f.response(EVO_MODEL,selected));
 const out=JSON.parse((await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).text);
 expect(out.gateway).toBe('evolink');expect(f.storage.get('test/0/route-openrouter.json').reason).toContain('选版');
 expect(JSON.parse(out.candidates[0].content.parts[0].text).pages[0].reading.templateId).toBe('fusion_ink_mountains');
});

it('非流式正文失联会取消连接并保留unknown，重放不再付费',async()=>{
 vi.useFakeTimers();
 try{
  const f=make(),cancel=vi.fn();let signal:AbortSignal|undefined;
  f.deps.fetch.mockImplementation(async(_url?:unknown,init?:RequestInit)=>{signal=init?.signal as AbortSignal;return new Response(new ReadableStream({cancel}),{status:503,headers:{'Content-Type':'application/json'}});});
  const pending=expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('未重复提交');
  await vi.advanceTimersByTimeAsync(11*60_000);await pending;
  expect(signal?.aborted).toBe(true);expect(cancel).toHaveBeenCalled();expect(f.storage.get('test/0/route-openrouter.json').state).toBe('unknown');
  await expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('回执尚未闭合');expect(f.deps.fetch).toHaveBeenCalledTimes(1);expect(f.deps.vertex).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});
it('非流式有效字节持续到达时按失联窗口续期，不按总时长终止',async()=>{
 vi.useFakeTimers();
 try{
  const f=make();const raw=await f.response(OR_MODEL).text();let stream!:ReadableStreamDefaultController<Uint8Array>;
  f.deps.fetch.mockResolvedValueOnce(new Response(new ReadableStream({start(c){stream=c;}}),{headers:{'Content-Type':'application/json'}}));
  const pending=invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);await vi.advanceTimersByTimeAsync(0);
  for(const part of [raw.slice(0,20),raw.slice(20,40),raw.slice(40)]){await vi.advanceTimersByTimeAsync(9*60_000);stream.enqueue(new TextEncoder().encode(part));await vi.advanceTimersByTimeAsync(0);}
  stream.close();expect((await pending).status).toBe(200);expect(f.deps.fetch).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});
it('空字节不延长非流式失联窗口，超大正文也不切换付费通道',async()=>{
 vi.useFakeTimers();
 try{
  const f=make();let stream!:ReadableStreamDefaultController<Uint8Array>;
  f.deps.fetch.mockResolvedValueOnce(new Response(new ReadableStream({start(c){stream=c;}}),{headers:{'Content-Type':'application/json'}}));
  const pending=expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('未重复提交');await vi.advanceTimersByTimeAsync(9*60_000);stream.enqueue(new Uint8Array());await vi.advanceTimersByTimeAsync(2*60_000);await pending;
  const oversized=make();oversized.deps.fetch.mockResolvedValueOnce(new Response(new Uint8Array(8*1024*1024+1),{headers:{'Content-Type':'application/json'}}));
  await expect(invokeKnowledgePublicationRoutes(oversized.request,oversized.evidence,oversized.deps)).rejects.toThrow('未重复提交');expect(oversized.deps.fetch).toHaveBeenCalledTimes(1);expect(oversized.storage.get('test/0/route-openrouter.json').state).toBe('unknown');
 }finally{vi.useRealTimers();}
});
