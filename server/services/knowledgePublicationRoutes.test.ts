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
describe('图文手册限定模型与同款通道恢复',()=>{
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
 it('两个允许模型的通道均失败即报错，不调用未授权第三模型',async()=>{
  const f=make();f.deps.fetch.mockImplementation(async()=>new Response('{}',{status:503}));
  await expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('所有已配置通道均失败');
  expect(f.deps.fetch).toHaveBeenCalledTimes(8);expect(f.deps.vertex).not.toHaveBeenCalled();
  expect(f.storage.has('test/0/route-vertex.json')).toBe(false);
 });
 it('断线结果未知时不切换、不重投，后续原请求只读断点',async()=>{
  const f=make();f.deps.fetch.mockRejectedValueOnce(new Error('timeout'));
  await expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('未重复提交');
  await expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('回执尚未闭合');
  expect(f.deps.fetch).toHaveBeenCalledTimes(1);expect(f.deps.vertex).not.toHaveBeenCalled();
 });
 it('不是1017或缺少自动阅读结构不能冒充成功',async()=>{
  const f=make();const bad=structuredClone(f.report);delete (bad.pages[0] as any).reading;
  f.deps.fetch.mockImplementation(async(_url?:unknown,init?:RequestInit)=>f.response(JSON.parse(String(init?.body)).model,bad));
  f.deps.fetch.mockResolvedValueOnce(f.response('deepseek/deepseek-v4.1-flash')).mockResolvedValueOnce(f.response(EVO_MODEL,bad));
  await expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('所有已配置通道均失败');expect(f.deps.vertex).not.toHaveBeenCalled();expect(f.storage.get('test/0/route-openrouter.json').reason).toContain('版本');expect(f.storage.get('test/0/route-evolink.json').reason).toContain('结构');
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

it('仅兼容根对象json_object格式回显，并可零请求恢复原完整失败回执',async()=>{
 const f=make();const value={...f.report,type:'json_object'};
 f.deps.fetch.mockResolvedValueOnce(f.response(OR_MODEL,value));
 const first=await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);
 expect(JSON.parse(first.text).gateway).toBe('openrouter');
 const key='test/0/route-openrouter.json',receipt=f.storage.get(key);
 f.storage.set(key,{...receipt,state:'failed',reason:'旧解析器拒绝根type'});f.storage.delete('test/0/accepted.json');f.deps.fetch.mockClear();
 const restored=await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);
 expect(JSON.parse(restored.text).gateway).toBe('openrouter');expect(f.deps.fetch).not.toHaveBeenCalled();expect(f.deps.vertex).not.toHaveBeenCalled();
 expect(f.storage.get(key).priorFailureReason).toBe('旧解析器拒绝根type');expect(f.storage.get(key).response).toEqual(receipt.response);
 const invalid=make();invalid.deps.fetch.mockResolvedValueOnce(invalid.response(OR_MODEL,{...invalid.report,type:'another_business_kind'})).mockResolvedValueOnce(invalid.response(EVO_MODEL));
 const fallback=JSON.parse((await invokeKnowledgePublicationRoutes(invalid.request,invalid.evidence,invalid.deps)).text);
 expect(fallback.gateway).not.toBe('openrouter');expect(invalid.storage.get('test/0/route-openrouter.json').reason).toContain('type');
});

it('新顾问输入必须返回可用装饰配置，缺失不能冒充已经排好图文',async()=>{
 const {KNOWLEDGE_DECORATION_MARKER,resolveKnowledgeDecoration}=await import('../../shared/knowledgeDecorations');
 const f=make();f.request.systemInstruction.parts[0].text+=KNOWLEDGE_DECORATION_MARKER;
 const good=structuredClone(f.report);(good.pages[0].reading as any).decoration=resolveKnowledgeDecoration(undefined,'水循环');
 f.deps.fetch.mockResolvedValueOnce(f.response(OR_MODEL)).mockResolvedValueOnce(f.response(EVO_MODEL,good));
 const out=JSON.parse((await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).text);
 expect(f.storage.get('test/0/route-openrouter.json').reason).toContain('装饰组件配置');expect(out.gateway).toBe('evolink');expect(JSON.parse(out.candidates[0].content.parts[0].text).pages[0].reading.decoration).toEqual((good.pages[0].reading as any).decoration);
});

describe('联网补充与真实来源贯穿正文',()=>{
 const url='https://science.example.org/water';
 const prepare=async()=>{
  const f=make();const {KNOWLEDGE_RESEARCH_MARKER}=await import('../../shared/knowledgeResearch');f.request.systemInstruction.parts[0].text+=KNOWLEDGE_RESEARCH_MARKER;
  const report:any=structuredClone(f.report);report.pages[0].sources=[{url,title:'水循环资料'}];report.pages[0].reading.blocks.push({type:'prose',title:'为什么会循环',note:'',text:`太阳加热水面，水蒸气随后凝结。[资料](${url})`});
  const annotations=[{type:'url_citation',url_citation:{url,title:'水循环原始资料',content:'太阳能驱动蒸发，水汽凝结成云。'}}];
  const response=(value=report,finish='stop')=>new Response(JSON.stringify({model:OR_MODEL,choices:[{finish_reason:finish,message:{content:JSON.stringify(value),annotations}}]}),{headers:{'Content-Type':'application/json'}});
  return {...f,report,annotations,webResponse:response};
 };
 it('同一次生成启用检索，真实引用进入确认正文/云稿和HTML，恢复不重复调用',async()=>{
  const f=await prepare();f.deps.fetch.mockResolvedValueOnce(f.webResponse());
  const raw=await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);const report=JSON.parse(JSON.parse(raw.text).candidates[0].content.parts[0].text);
  const sent=JSON.parse((f.deps.fetch.mock.calls[0] as any)[1].body);expect(sent.plugins).toEqual([{id:'web',engine:'exa',max_results:3}]);expect(report.pages[0].sources[0].title).toBe('水循环原始资料');expect(report.pages[0].body).toContain(url);
  const {knowledgeReviewSchema}=await import('../../shared/knowledgePublication');expect(knowledgeReviewSchema.parse(JSON.parse(JSON.stringify(report))).pages[0].sources?.[0].url).toBe(url);
  const {buildKnowledgeBookletHtml}=await import('../../shared/knowledgeBooklet');expect(buildKnowledgeBookletHtml({title:report.title,pages:[{...report.pages[0],imageUrl:''}]})).toContain(`href="${url}"`);
  await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);expect(f.deps.fetch).toHaveBeenCalledTimes(1);
 });
 it('首跳完整失败后后续通道只使用同一检索片段，不重开搜索',async()=>{
  const f=await prepare();f.deps.fetch.mockResolvedValueOnce(f.webResponse(f.report,'length')).mockResolvedValueOnce(f.response(EVO_MODEL,f.report));
  const result=JSON.parse((await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).text);expect(result.gateway).toBe('evolink');
  const sent=JSON.parse((f.deps.fetch.mock.calls[1] as any)[1].body);expect(sent.plugins).toBeUndefined();expect(JSON.stringify(sent.messages)).toContain('太阳能驱动蒸发');expect(f.storage.has('test/0/web-sources.json')).toBe(true);
 });
 it('无检索回执只在有检索能力的授权模型内重试，耗尽后恢复不再次购买',async()=>{
  const f=await prepare();f.deps.fetch.mockImplementation(async(_url?:unknown,init?:RequestInit)=>f.response(JSON.parse(String(init?.body)).model,f.report));
  await expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('未取得真实联网来源');
  await expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('未取得真实联网来源');expect(f.deps.fetch).toHaveBeenCalledTimes(4);expect(f.deps.vertex).not.toHaveBeenCalled();
 });
 it('伪造引用被拒绝，完整来源片段允许下一路修正正文',async()=>{
  const f=await prepare();const bad=structuredClone(f.report);bad.pages[0].sources[0].url='https://fake.example.org/';f.deps.fetch.mockResolvedValueOnce(f.webResponse(bad)).mockResolvedValueOnce(f.response(EVO_MODEL,f.report));
  await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);expect(f.storage.get('test/0/route-openrouter.json').reason).toContain('不属于');
 });
 it('流式注释随完成回执保存，缺字流不会当成检索成功',async()=>{
  const f=await prepare();const chunks=[{model:OR_MODEL,choices:[{delta:{content:JSON.stringify(f.report)}}]},{choices:[{delta:{annotations:f.annotations},finish_reason:'stop'}]}];
  f.deps.fetch.mockResolvedValueOnce(new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}));
  await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);const saved=JSON.parse(f.storage.get('test/0/openrouter-response.json').text);expect(saved.choices[0].message.annotations).toEqual(f.annotations);
 });
});

it('流式来源超出合计容量必须拒绝，默认调用不附带来源字段',async()=>{
 const {readGlmSseStream}=await import('./sseChatStream');
 const stream=(text:string)=>new Response('data: '+JSON.stringify({model:'test',choices:[{delta:{content:text,annotations:[{type:'url_citation',url_citation:{url:'https://example.org',title:'来源',content:'a'.repeat(800)}}]},finish_reason:'stop'}]})+'\n\n').body!;
 await expect(readGlmSseStream(stream('b'.repeat(700)),1024,{strictCompletion:true,preserveAnnotations:true})).rejects.toThrow('上限');
 const result=JSON.parse(await readGlmSseStream(stream('正文'),1024,{strictCompletion:true}));expect(result.choices[0].message.annotations).toBeUndefined();
});


it('每模型首次加三次重试，DeepSeek耗尽才进入GLM且按通道限制输出',async()=>{
 const f=make();f.request.generationConfig.maxOutputTokens=500000;
 for(let i=0;i<7;i++)f.deps.fetch.mockResolvedValueOnce(new Response('{}',{status:503}));
 f.deps.fetch.mockResolvedValueOnce(f.response('glm-5.3-flashx'));
 const result=JSON.parse((await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).text);
 const bodies=f.deps.fetch.mock.calls.map(c=>JSON.parse((c as any)[1].body));
 expect(bodies.map(b=>[b.model,b.max_tokens])).toEqual([
  [OR_MODEL,393216],[EVO_MODEL,384000],[OR_MODEL,393216],[EVO_MODEL,384000],
  ['z-ai/glm-5.3-flashx',131072],['glm-5.3-flashx',131072],['z-ai/glm-5.3-flashx',131072],['glm-5.3-flashx',131072],
 ]);
 expect(bodies[0].provider).toMatchObject({order:['DeepSeek'],allow_fallbacks:false});
 expect(bodies[4].provider).toMatchObject({order:['Z.AI'],allow_fallbacks:false});
 expect(result.modelVersion).toBe('glm-5.3-flashx');expect(result.gateway).toBe('glm-evolink-retry-3');
 expect(result.gatewayTrace.map((t:any)=>t.route)).toEqual(['openrouter','evolink','openrouter-retry-2','evolink-retry-3','glm-openrouter','glm-evolink','glm-openrouter-retry-2','glm-evolink-retry-3']);
 expect(f.deps.vertex).not.toHaveBeenCalled();
 await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);expect(f.deps.fetch).toHaveBeenCalledTimes(8);
});
it('GLM首跳成功立即停止，回执独立保留，不调用第二条GLM通道',async()=>{
 const f=make();for(let i=0;i<4;i++)f.deps.fetch.mockResolvedValueOnce(new Response('{}',{status:503}));f.deps.fetch.mockResolvedValueOnce(f.response('z-ai/glm-5.3-flashx'));
 const result=JSON.parse((await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).text);
 expect(result.modelVersion).toBe('z-ai/glm-5.3-flashx');expect(f.deps.fetch).toHaveBeenCalledTimes(5);
 expect(f.storage.get('test/0/route-glm-openrouter.json').state).toBe('received');
 expect(f.storage.has('test/0/route-glm-evolink.json')).toBe(false);
});
it('已停用模型的历史未知回执仍阻止新购，不会抹去或调用旧模型',async()=>{
 const f=make();f.storage.set('test/0/route-vertex.json',{state:'unknown',model:'gemini-3.8-flash'});
 await expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('历史整理请求回执尚未闭合');
 expect(f.deps.fetch).not.toHaveBeenCalled();expect(f.deps.vertex).not.toHaveBeenCalled();expect(f.storage.get('test/0/route-vertex.json').state).toBe('unknown');
});

it('DeepSeek第三次调用成功不再重试或切换GLM，失败原因进入修正输入',async()=>{
 const f=make();const bad=structuredClone(f.report);delete (bad.pages[0] as any).reading;
 f.deps.fetch.mockResolvedValueOnce(f.response(OR_MODEL,bad)).mockResolvedValueOnce(f.response(EVO_MODEL,bad)).mockResolvedValueOnce(f.response(OR_MODEL));
 const result=JSON.parse((await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).text);
 expect(result.gateway).toBe('openrouter-retry-2');expect(f.deps.fetch).toHaveBeenCalledTimes(3);
 expect(JSON.parse((f.deps.fetch.mock.calls[2] as any)[1].body).messages.at(-1).content).toContain('自动表格图文结构');
 expect(f.storage.get('test/0/route-openrouter-retry-2.json').request.model).toBe(OR_MODEL);
});
it('重试期间传输未知时立即停住，恢复同一回执不继续花钱',async()=>{
 const f=make();f.deps.fetch.mockResolvedValueOnce(new Response('{}',{status:503})).mockRejectedValueOnce(Error('lost'));
 await expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('未重复提交');
 await expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('回执尚未闭合');
 expect(f.deps.fetch).toHaveBeenCalledTimes(2);expect(f.storage.has('test/0/route-openrouter-retry-2.json')).toBe(false);
});


it('恢复较后路由的成功回执时不先购买缺失的早期重试',async()=>{
 const f=make();await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);
 const receipt=f.storage.get('test/0/route-openrouter.json');
 const response=await f.response('z-ai/glm-5.3-flashx').text();
 f.storage.delete('test/0/route-openrouter.json');f.storage.delete('test/0/accepted.json');
 f.storage.set('test/0/route-glm-openrouter.json',{...receipt,route:'glm-openrouter',model:'z-ai/glm-5.3-flashx',response:{status:200,text:response}});
 f.deps.fetch.mockClear();
 expect(JSON.parse((await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).text).modelVersion).toBe('z-ai/glm-5.3-flashx');
 expect(f.deps.fetch).not.toHaveBeenCalled();
});
it('较后路由有未知回执时不能购买任何缺失的早期重试',async()=>{
 const f=make();await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);
 const receipt=f.storage.get('test/0/route-openrouter.json');
 f.storage.delete('test/0/route-openrouter.json');f.storage.delete('test/0/accepted.json');
 f.storage.set('test/0/route-glm-openrouter.json',{...receipt,state:'unknown',response:undefined});f.deps.fetch.mockClear();
 await expect(invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).rejects.toThrow('回执尚未闭合');
 expect(f.deps.fetch).not.toHaveBeenCalled();
});

it('四页只找到部分来源时，后续搜索补齐缺页证据，不在旧片段中空转',async()=>{
 const {KNOWLEDGE_RESEARCH_MARKER}=await import('../../shared/knowledgeResearch');
 const f=make();f.request.systemInstruction.parts[0].text+=KNOWLEDGE_RESEARCH_MARKER;
 const original=JSON.parse((f.request.contents[0].parts[0] as {text:string}).text);
 const ids=Array.from({length:4},()=>randomUUID());
 original.source.pages=ids.map((id,i)=>({...original.source.pages[0],id,headline:`主题${i+1}`}));
 (f.request.contents[0].parts[0] as {text:string}).text=JSON.stringify(original);
 const a='https://science.example.org/part-one',b='https://science.example.org/part-two';
 const pages=ids.map((id,i)=>({...structuredClone(f.report.pages[0]),id,headline:`主题${i+1}`,sources:i===3?[{url:b,title:'来源二'}]:[{url:a,title:'来源一'}],reading:{...structuredClone(f.report.pages[0].reading),blocks:[{type:'prose',title:'解释',note:'',text:`原始资料说明。[来源](${i===3?b:a})`}]}}));
 const good={...f.report,pages};const missing=structuredClone(good);missing.pages[3].sources=[];
 const web=(report:any,urls:string[])=>new Response(JSON.stringify({model:OR_MODEL,choices:[{finish_reason:'stop',message:{content:JSON.stringify(report),annotations:urls.map(url=>({type:'url_citation',url_citation:{url,title:'真实检索来源',content:'本次查得的原始片段'}}))}}]}),{headers:{'Content-Type':'application/json'}});
 f.deps.fetch.mockResolvedValueOnce(web(missing,[a])).mockResolvedValueOnce(f.response(EVO_MODEL,missing)).mockResolvedValueOnce(web(good,[b]));
 const result=JSON.parse((await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).text);
 expect(result.gateway).toBe('openrouter-retry-2');expect(f.deps.fetch).toHaveBeenCalledTimes(3);
 const retry=JSON.parse((f.deps.fetch.mock.calls[2] as any)[1].body);
 expect(retry.plugins).toEqual([{id:'web',engine:'exa',max_results:3}]);expect(retry.messages.at(-1).content).toContain(ids[3]);
 expect(f.storage.get('test/0/web-sources.json').sources.map((s:any)=>s.url)).toEqual([a,b]);
 await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);expect(f.deps.fetch).toHaveBeenCalledTimes(3);
});


describe('接受回执前闭合最终消费者合同（KH-ROUTE-01）', () => {
 it.each([
  ['有图却标无图', { imageStatus: 'absent' }, '实际配图审校'],
  ['有图但没有观察', { imageDescription: '' }, '实际配图审校'],
  ['有疑点却没有说明', { imageStatus: 'uncertain' }, '图文疑点没有说明'],
 ] as const)('%s必须在路由内失败并使用下一次获准重试', async (_name, patch, reason) => {
  const f = make(), invalid = structuredClone(f.report);
  Object.assign(invalid.pages[0], patch);
  f.deps.fetch.mockResolvedValueOnce(f.response(OR_MODEL, invalid)).mockResolvedValueOnce(f.response(EVO_MODEL));
  const output = JSON.parse((await invokeKnowledgePublicationRoutes(f.request, f.evidence, f.deps)).text);
  expect(output.gateway).toBe('evolink');
  expect(f.storage.get('test/0/route-openrouter.json').reason).toContain(reason);
  expect(f.storage.get('test/0/accepted.json').normalized.text).toBe(JSON.stringify(output));
  await invokeKnowledgePublicationRoutes(f.request, f.evidence, f.deps);
  expect(f.deps.fetch).toHaveBeenCalledTimes(2);
 });
 it.each(['missing-evidence', 'unknown-page'] as const)('一致性%s不能先被接受再由下游拒收', async problem => {
  const f = make(), pageId = randomUUID(), sourceDigest = 'c'.repeat(64);
  f.request.contents = [{ role:'user', parts:[{ text:JSON.stringify({ sourceDigest, facts:[{ pageId, term:'水循环', statement:'蒸发后凝结' }] }) }] }];
  const invalid = { sourceDigest, findings:[{ pageIds:[problem === 'unknown-page' ? randomUUID() : pageId], message:'核对两页的数字', ...(problem === 'missing-evidence' ? {} : { evidence:'两页原文数字不同' }) }] };
  const corrected = { sourceDigest, findings:[] };
  f.deps.fetch.mockResolvedValueOnce(f.response(OR_MODEL, invalid)).mockResolvedValueOnce(f.response(EVO_MODEL, corrected));
  const output = JSON.parse((await invokeKnowledgePublicationRoutes(f.request, f.evidence, f.deps)).text);
  expect(output.gateway).toBe('evolink');
  expect(f.storage.get('test/0/route-openrouter.json').reason).toContain(problem === 'missing-evidence' ? '输出合同不符' : '未知页号');
  expect(JSON.parse(output.candidates[0].content.parts[0].text)).toEqual(corrected);
  expect(f.deps.fetch).toHaveBeenCalledTimes(2);
 });
});

it('并发分配的EvoLink批次固定该通道，DeepSeek四次耗尽才GLM且恢复零新调用',async()=>{
 const f=make();f.request.executionChannel='evolink';
 for(let i=0;i<4;i++)f.deps.fetch.mockResolvedValueOnce(new Response('{}',{status:503}));
 f.deps.fetch.mockResolvedValueOnce(f.response('glm-5.3-flashx'));
 const answer=JSON.parse((await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).text);
 expect(f.deps.fetch.mock.calls.map(c=>JSON.parse((c as any)[1].body).model)).toEqual([EVO_MODEL,EVO_MODEL,EVO_MODEL,EVO_MODEL,'glm-5.3-flashx']);
 expect(f.deps.fetch.mock.calls.every(c=>(c as any)[0]==='https://api.evolink.ai/v1/chat/completions')).toBe(true);
 expect(answer.gateway).toBe('glm-evolink');
 await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);expect(f.deps.fetch).toHaveBeenCalledTimes(5);
});
it('EvoLink并发批次先保留真实检索资料再整理，恢复不重复检索或整理',async()=>{
 const f=make();f.request.executionChannel='evolink';f.request.systemInstruction.parts.push({text:'【联网资料融入正文】'});
 const url='https://example.org/water';const report=structuredClone(f.report) as any;
 report.pages[0].sources=[{url,title:'真实来源'}];report.pages[0].reading.blocks[0].note='根据[真实来源]('+url+')';
 const annotation={type:'url_citation',url_citation:{url,title:'真实来源',content:'水蒸发后形成水蒸气。'}};
 f.deps.fetch.mockResolvedValueOnce(new Response(JSON.stringify({model:OR_MODEL,choices:[{finish_reason:'stop',message:{content:'{}',annotations:[annotation]}}],usage:{cost:0.01}}),{headers:{'Content-Type':'application/json'}}));
 f.deps.fetch.mockResolvedValueOnce(f.response(EVO_MODEL,report));
 const answer=JSON.parse((await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps)).text);
 expect(answer.gateway).toBe('evolink');expect(f.deps.fetch).toHaveBeenCalledTimes(2);
 expect(f.storage.has('test/0/research/accepted.json')).toBe(true);
 const body=JSON.parse((f.deps.fetch.mock.calls[1] as any)[1].body);
 expect(body.messages.at(-1).content).toEqual(expect.arrayContaining([expect.objectContaining({text:expect.stringContaining('水蒸发后形成水蒸气')})]));
 await invokeKnowledgePublicationRoutes(f.request,f.evidence,f.deps);expect(f.deps.fetch).toHaveBeenCalledTimes(2);
});
