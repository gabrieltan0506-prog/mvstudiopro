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
