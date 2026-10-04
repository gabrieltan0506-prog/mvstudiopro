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
