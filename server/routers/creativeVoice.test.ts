import { describe, it, expect, vi, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
const mock = vi.hoisted(() => ({ auth: vi.fn(), connect: vi.fn() }));
vi.mock("../_core/sdk", () => ({ sdk: { authenticateRequest: mock.auth } }));
vi.mock("../services/creativeVoiceTransport", () => ({ connectVoiceTransport: mock.connect }));
import { registerCreativeVoice, allowedVoiceOrigin } from "./creativeVoice";
const WS = createRequire(import.meta.url)("ws");
let server: Server, client: any;
afterEach(async () => { client?.terminate(); if(server) await new Promise<void>(resolve=>server.close(()=>resolve())); vi.clearAllMocks(); });
async function open(role = "admin") {
  mock.auth.mockResolvedValue({ id: 7, role });
  server = createServer(); registerCreativeVoice(server);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const port = (server.address() as any).port;
  client = new WS(`ws://127.0.0.1:${port}/api/creative-voice/socket`, { headers: { origin: "https://mvstudiopro.com" } });
  client.on("error", () => {});
}
describe("语音代理新增鉴权与工具回传", () => {
  it("拒绝伪造域名与非管理者", async () => {
    expect(allowedVoiceOrigin("https://mvstudiopro.com.attacker.test",true)).toBe(false);
    expect(allowedVoiceOrigin(undefined,true)).toBe(false);
    await open("user");
    const status = await new Promise(resolve=>client.on("unexpected-response", (_r:any,res:any)=>{res.resume(); resolve(res.statusCode);}));
    expect(status).toBe(403); expect(mock.connect).not.toHaveBeenCalled();
  });
  it("工具结果仅接受原ID一次；没有额外三次上限，断线清理上游", async () => {
    const upstream = { send: vi.fn(), close: vi.fn() }; let events!: (event:any)=>void;
    mock.connect.mockImplementation(async(input)=>{ events=input.onEvent; return upstream; });
    await open(); await new Promise(resolve=>client.on("open",resolve));
    const messages:any[]=[]; client.on("message", (b:Buffer)=>messages.push(JSON.parse(b.toString())));
    client.send(JSON.stringify({type:"start",purpose:"discussion",context:"测试作品",projectKey:"test",confirmedCost:true}));
    await vi.waitFor(()=>expect(messages.some(m=>m.ready)).toBe(true));
    for(let i=0;i<4;i++) {
      events({type:"workflow",id:`note-${i}`,action:{action:"inspect"}});
      await vi.waitFor(()=>expect(messages.some(m=>m.id===`note-${i}`)).toBe(true));
      client.send(JSON.stringify({type:"toolResult",id:`note-${i}`,text:"本机保存成功"}));
      await vi.waitFor(()=>expect(upstream.send).toHaveBeenCalledTimes(i+1));
    }
    client.send(JSON.stringify({type:"toolResult",id:"note-3",text:"重复结果"}));
    client.send(JSON.stringify({type:"toolResult",id:"invented",text:"未发起结果"}));
    client.send(JSON.stringify({type:"stop"}));
    await vi.waitFor(()=>expect(upstream.close).toHaveBeenCalled());
    expect(upstream.send).toHaveBeenCalledTimes(4);
    expect(upstream.send.mock.calls[0][0].toolResponse.functionResponses[0].name).toBe("creativeWorkflow");
  });
});

it("1005媒体方案和完整影片审阅工具分别按原ID回送，不生成额外任务",async()=>{
 const upstream={send:vi.fn(),close:vi.fn()};let events!:(event:any)=>void;
 mock.connect.mockImplementation(async input=>{events=input.onEvent;return upstream});await open();await new Promise(resolve=>client.on('open',resolve));
 const received:any[]=[];client.on('message',(b:Buffer)=>received.push(JSON.parse(b.toString())));client.send(JSON.stringify({type:'start',purpose:'video_review',context:'作品',projectKey:'p',confirmedCost:true}));await vi.waitFor(()=>expect(received.some(m=>m.ready)).toBe(true));
 for(const [type,name] of [['mediaEdit','proposeMediaEdit'],['filmReview','reviewFilm']]){
  events(type==='mediaEdit'?{type,id:type,proposal:{kind:'image',blockId:'a',instruction:'改背景'}}:{type,id:type,blockId:'v',question:'检查灯光'});
  await vi.waitFor(()=>expect(received.some(m=>m.id===type)).toBe(true));client.send(JSON.stringify({type:'toolResult',id:type,text:'等待用户确认，未提交'}));
  await vi.waitFor(()=>expect(upstream.send.mock.calls.some(([m])=>m.toolResponse?.functionResponses?.[0]?.name===name)).toBe(true));
 }
 expect(upstream.send.mock.calls.filter(([m])=>m.toolResponse)).toHaveLength(2);client.close();await new Promise(resolve=>client.once('close',resolve));
});

it("小说正文工具按原ID回传；无效参数回送失败，不让模型无限等待",async()=>{
 const upstream={send:vi.fn(),close:vi.fn()};let events!:(event:any)=>void;
 mock.connect.mockImplementation(async input=>{events=input.onEvent;return upstream});await open();await new Promise(resolve=>client.on('open',resolve));
 const received:any[]=[];client.on('message',(b:Buffer)=>received.push(JSON.parse(b.toString())));
 client.send(JSON.stringify({type:'start',purpose:'script_review',context:'作品',projectKey:'p',confirmedCost:true}));await vi.waitFor(()=>expect(received.some(m=>m.ready)).toBe(true));
 events({type:'novelEdit',id:'read-chapter',action:{action:'read',episode:1}});await vi.waitFor(()=>expect(received.some(m=>m.id==='read-chapter')).toBe(true));
 client.send(JSON.stringify({type:'toolResult',id:'read-chapter',text:'完整正文和revision'}));await vi.waitFor(()=>expect(upstream.send).toHaveBeenCalledTimes(1));
 expect(upstream.send.mock.calls[0][0].toolResponse.functionResponses[0]).toMatchObject({id:'read-chapter',name:'novelText'});
 events({type:'toolRejected',id:'bad-args',name:'novelText',text:'参数不完整，未改正文'});events({type:'toolRejected',id:'bad-args',name:'novelText',text:'重复'});
 expect(upstream.send).toHaveBeenCalledTimes(2);expect(upstream.send.mock.calls[1][0].toolResponse.functionResponses[0].response.error).toContain('未改正文');
 client.close();await new Promise(resolve=>client.once('close',resolve));
});

it("production bridge serializes paid-capable commands and acknowledges each result once",async()=>{
 const upstream={send:vi.fn(),close:vi.fn()};let events!:(event:any)=>void;
 mock.connect.mockImplementation(async input=>{events=input.onEvent;return upstream});await open();await new Promise(resolve=>client.on('open',resolve));
 const received:any[]=[];client.on('message',(b:Buffer)=>received.push(JSON.parse(b.toString())));
 client.send(JSON.stringify({type:'start',purpose:'previs',context:'独立测试作品',projectKey:'isolated',confirmedCost:true}));await vi.waitFor(()=>expect(received.some(m=>m.ready)).toBe(true));
 const event={type:'production',id:'model-test',action:{action:'model3d',assetId:'isolated-hero'}};events(event);events(event);
 await vi.waitFor(()=>expect(received.filter(m=>m.id===event.id)).toHaveLength(1));events({type:'production',id:'other',action:{action:'image2d',anchorId:'other'}});
 expect(upstream.send.mock.calls[0][0].toolResponse.functionResponses[0]).toMatchObject({name:'creativeProduction',response:{error:expect.stringContaining('正在处理')}});
 client.send(JSON.stringify({type:'toolResult',id:event.id,text:'用户取消，未调用供应商'}));await vi.waitFor(()=>expect(upstream.send).toHaveBeenCalledTimes(2));
 expect(upstream.send.mock.calls[1][0].toolResponse.functionResponses[0]).toMatchObject({name:'creativeProduction',response:expect.any(Object)});
 client.send(JSON.stringify({type:'toolResult',id:event.id,text:'重复'}));client.send(JSON.stringify({type:'stop'}));await vi.waitFor(()=>expect(upstream.close).toHaveBeenCalled());expect(upstream.send).toHaveBeenCalledTimes(2);
});

it("typed media confirmation is a complete user turn while microphone stays realtime",async()=>{
 const upstream={send:vi.fn(),close:vi.fn()};let events!:(event:any)=>void;mock.connect.mockImplementation(async input=>{events=input.onEvent;return upstream});
 await open();await new Promise(resolve=>client.on('open',resolve));const received:any[]=[];client.on('message',(b:Buffer)=>received.push(JSON.parse(b.toString())));
 client.send(JSON.stringify({type:'start',purpose:'discussion',context:'作品',projectKey:'p',confirmedCost:true}));await vi.waitFor(()=>expect(received.some(m=>m.ready)).toBe(true));
 client.send(JSON.stringify({type:'text',text:'可以，生成Flare预览，不要替换原图。'}));client.send(JSON.stringify({type:'audioEnd'}));
 await vi.waitFor(()=>expect(upstream.send).toHaveBeenCalledTimes(2));expect(upstream.send.mock.calls[0][0]).toEqual({clientContent:{turns:[{role:'user',parts:[{text:'可以，生成Flare预览，不要替换原图。'}]}],turnComplete:true}});expect(upstream.send.mock.calls[1][0]).toEqual({realtimeInput:{audioStreamEnd:true}});
 events({type:'workflow',id:'inspect-request',action:{action:'inspect'}});await vi.waitFor(()=>expect(received.some(m=>m.id==='inspect-request')).toBe(true));client.send(JSON.stringify({type:'toolResult',id:'inspect-request',text:'已有图片方案'}));await vi.waitFor(()=>expect(upstream.send).toHaveBeenCalledTimes(3));expect(upstream.send.mock.calls[2][0].toolResponse.functionResponses[0].response).toEqual({result:'已有图片方案',currentUserRequest:'可以，生成Flare预览，不要替换原图。'});
 client.close();await new Promise(resolve=>client.once('close',resolve));
});

it("重复相同inspect先提醒再断开，避免没有用户新指令时无限消耗",async()=>{
 const upstream={send:vi.fn(),close:vi.fn()};let events!:(event:any)=>void;mock.connect.mockImplementation(async input=>{events=input.onEvent;return upstream});await open();await new Promise(resolve=>client.on('open',resolve));const received:any[]=[];client.on('message',(b:Buffer)=>received.push(JSON.parse(b.toString())));client.send(JSON.stringify({type:'start',purpose:'discussion',context:'作品',projectKey:'p',confirmedCost:true}));await vi.waitFor(()=>expect(received.some(m=>m.ready)).toBe(true));
 for(let n=1;n<=3;n++){events({type:'workflow',id:`read-${n}`,action:{action:'inspect'}});await vi.waitFor(()=>expect(received.some(m=>m.id===`read-${n}`)).toBe(true));client.send(JSON.stringify({type:'toolResult',id:`read-${n}`,text:'同一作品和修改方案'}));if(n<3)await vi.waitFor(()=>expect(upstream.send).toHaveBeenCalledTimes(n));}
 await vi.waitFor(()=>expect(upstream.close).toHaveBeenCalled());expect(upstream.send).toHaveBeenCalledTimes(2);expect(upstream.send.mock.calls[1][0].toolResponse.functionResponses[0].response.result).toContain('不要再次inspect');expect(received.some(m=>m.type==='error'&&m.text.includes('重复读取'))).toBe(true);
});

it("inspect返回结构化上下文，避免把正文JSON重复转义喂给Live",async()=>{
 const upstream={send:vi.fn(),close:vi.fn()};let events!:(event:any)=>void;mock.connect.mockImplementation(async input=>{events=input.onEvent;return upstream});await open();await new Promise(resolve=>client.on('open',resolve));const received:any[]=[];client.on('message',(b:Buffer)=>received.push(JSON.parse(b.toString())));client.send(JSON.stringify({type:'start',purpose:'discussion',context:'作品',projectKey:'p',confirmedCost:true}));await vi.waitFor(()=>expect(received.some(m=>m.ready)).toBe(true));events({type:'workflow',id:'structured',action:{action:'inspect'}});await vi.waitFor(()=>expect(received.some(m=>m.id==='structured')).toBe(true));client.send(JSON.stringify({type:'toolResult',id:'structured',text:JSON.stringify({media:{plan:{kind:'video'}},context:JSON.stringify({episode:1,body:'完整正文'})})}));await vi.waitFor(()=>expect(upstream.send).toHaveBeenCalledTimes(1));expect(upstream.send.mock.calls[0][0].toolResponse.functionResponses[0].response.result).toEqual({media:{plan:{kind:'video'}},context:{episode:1,body:'完整正文'}});client.close();await new Promise(resolve=>client.once('close',resolve));
});

it("新用户要求重置重复读取保护，不限制正常多轮讨论",async()=>{
 const upstream={send:vi.fn(),close:vi.fn()};let events!:(event:any)=>void;mock.connect.mockImplementation(async input=>{events=input.onEvent;return upstream});await open();await new Promise(resolve=>client.on('open',resolve));const received:any[]=[];client.on('message',(b:Buffer)=>received.push(JSON.parse(b.toString())));client.send(JSON.stringify({type:'start',purpose:'discussion',context:'作品',projectKey:'p',confirmedCost:true}));await vi.waitFor(()=>expect(received.some(m=>m.ready)).toBe(true));
 for(let n=0;n<4;n++){client.send(JSON.stringify({type:'text',text:`第${n+1}次请读取当前作品`}));await vi.waitFor(()=>expect(upstream.send).toHaveBeenCalledTimes(n*2+1));events({type:'workflow',id:`fresh-${n}`,action:{action:'inspect'}});await vi.waitFor(()=>expect(received.some(m=>m.id===`fresh-${n}`)).toBe(true));client.send(JSON.stringify({type:'toolResult',id:`fresh-${n}`,text:'相同但本轮需要重新读取的页面'}));await vi.waitFor(()=>expect(upstream.send).toHaveBeenCalledTimes(n*2+2));}
 expect(upstream.close).not.toHaveBeenCalled();client.close();await new Promise(resolve=>client.once('close',resolve));
});

it("白模失败与inspect交替不会绕过无进展保护",async()=>{
 const upstream={send:vi.fn(),close:vi.fn()};let events!:(event:any)=>void;mock.connect.mockImplementation(async input=>{events=input.onEvent;return upstream});await open();await new Promise(resolve=>client.on('open',resolve));const received:any[]=[];client.on('message',(b:Buffer)=>received.push(JSON.parse(b.toString())));client.send(JSON.stringify({type:'start',purpose:'discussion',context:'作品',projectKey:'p',confirmedCost:true}));await vi.waitFor(()=>expect(received.some(m=>m.ready)).toBe(true));
 let sent=0;
 for(let n=1;n<=3;n++){
  events({type:'production',id:`previs-${n}`,action:{action:'previs',clipId:'clip-e01-g01'}});await vi.waitFor(()=>expect(received.some(m=>m.id===`previs-${n}`)).toBe(true));client.send(JSON.stringify({type:'toolResult',id:`previs-${n}`,text:'目标不在当前分段计划，未打开'}));
  if(n===3)break;
  const beforeRead=++sent;await vi.waitFor(()=>expect(upstream.send).toHaveBeenCalledTimes(beforeRead));
  events({type:'workflow',id:`between-${n}`,action:{action:'inspect'}});await vi.waitFor(()=>expect(received.some(m=>m.id===`between-${n}`)).toBe(true));client.send(JSON.stringify({type:'toolResult',id:`between-${n}`,text:`状态${n}`}));
  const expected=++sent;await vi.waitFor(()=>expect(upstream.send).toHaveBeenCalledTimes(expected));
 }
 await vi.waitFor(()=>expect(upstream.close).toHaveBeenCalled());expect(received.some(m=>m.type==='error'&&m.text.includes('重复操作'))).toBe(true);expect(upstream.send).toHaveBeenCalledTimes(4);
});

it("分享音画后文字追问保留在同一realtime流，不混用clientContent",async()=>{
 const upstream={send:vi.fn(),close:vi.fn()};mock.connect.mockImplementation(async()=>upstream);await open();await new Promise(resolve=>client.on('open',resolve));const received:any[]=[];client.on('message',(b:Buffer)=>received.push(JSON.parse(b.toString())));
 client.send(JSON.stringify({type:'start',purpose:'discussion',context:'独立音讯测试',projectKey:'p',confirmedCost:true}));await vi.waitFor(()=>expect(received.some(m=>m.ready)).toBe(true));
 client.send(JSON.stringify({type:'audio',data:'AAAA'}));client.send(JSON.stringify({type:'audioEnd'}));client.send(JSON.stringify({type:'text',text:'刚才听到什么声音？'}));
 await vi.waitFor(()=>expect(upstream.send).toHaveBeenCalledTimes(3));expect(upstream.send.mock.calls[2][0]).toEqual({realtimeInput:{text:'刚才听到什么声音？'}});expect(upstream.send.mock.calls.some(c=>'clientContent' in c[0])).toBe(false);
 client.close();await new Promise(resolve=>client.once('close',resolve));
});
