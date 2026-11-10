import { beforeEach, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
const mocks = vi.hoisted(() => ({ context: vi.fn(), caller: vi.fn(), ask: vi.fn() }));
vi.mock("../_core/context", () => ({ createContext: mocks.context }));
vi.mock("../routers", () => ({ appRouter: { createCaller: mocks.caller } }));
import { registerManhuaAdvisorStream } from "./manhuaAdvisorStream";
beforeEach(() => { vi.clearAllMocks(); mocks.context.mockResolvedValue({ user: { id: 7 } }); mocks.caller.mockImplementation(() => ({ mvAnalysis: { askPlatformSkillQa: mocks.ask } })); });
async function endpoint(run: (url: string) => Promise<void>) {
  const app = express(); app.use(express.json()); registerManhuaAdvisorStream(app);
  const server: Server = createServer(app);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  try { await run(`http://127.0.0.1:${(server.address() as any).port}/api/manhua-advisor/stream`); }
  finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}
it("未登录不执行顾问，不返回 SSE 成功", () => endpoint(async url => {
  mocks.context.mockResolvedValue({ user: null });
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"manhuaContext":{}}' });
  expect(res.status).toBe(401); expect(mocks.caller).not.toHaveBeenCalled();
}));
it("只使用已鉴权 caller；增量先到，持久结果返回后才发 result", () => endpoint(async url => {
  let resolve!: (v: unknown) => void;
  mocks.ask.mockImplementation(async () => {
    const ctx = mocks.caller.mock.calls[0][0]; ctx.advisorStream("reset"); ctx.advisorStream("delta", "先推近");
    return new Promise(r => { resolve = r; });
  });
  const input = { manhuaContext: {}, requestId: "original-request", confirmPaid: true, confirmedCredits: 8 };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const reader = res.body!.getReader(); const first = new TextDecoder().decode((await reader.read()).value);
  expect(first).toContain("event: delta"); expect(first).not.toContain("event: result");
  expect(mocks.ask).toHaveBeenCalledWith(input); expect(mocks.caller.mock.calls[0][0].user.id).toBe(7);
  resolve({ answer: "先推近", remainingFreeToday: 4 });
  let tail = ""; for (;;) { const chunk = await reader.read(); if (chunk.done) break; tail += new TextDecoder().decode(chunk.value); }
  expect(tail).toContain("event: result");
}));
it("支付确认错误原样返回客户端，不生成成功回执", () => endpoint(async url => {
  mocks.ask.mockRejectedValue(new Error("PAYMENT_REQUIRED 继续将扣除8积分，请确认"));
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"manhuaContext":{}}' });
  const text = await res.text(); expect(text).toContain("event: error"); expect(text).toContain("PAYMENT_REQUIRED"); expect(text).not.toContain("event: result");
}));
it("知识卡上下文可进入同一鉴权SSE，保留原请求与回放标记", () => endpoint(async url => {
  const input={knowledgePublicationContext:{documentId:"11111111-1111-4111-8111-111111111111",batchIndex:0,attempt:0},requestId:"original-request"};
  mocks.ask.mockResolvedValue({success:true,answer:'{"kind":"knowledge_publication_batch_v1"}',replayed:true});
  const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
  expect(res.status).toBe(200);const text=await res.text();expect(text).toContain('"replayed":true');expect(text).toContain('event: result');expect(mocks.ask).toHaveBeenCalledWith(input);
}));
it("漫剧顾问各跳标签发往浏览器前换成中性说法，不带模型与通道名", () => endpoint(async url => {
  mocks.ask.mockImplementationOnce(async () => {
    const ctx = mocks.caller.mock.calls[0][0];
    ctx.advisorStream("reset", "DeepSeek V4.1 Flash 1017 · OpenRouter"); ctx.advisorStream("reset", "GLM 5.3 FlashX · EvoLink"); ctx.advisorStream("reset", "影片审阅"); ctx.advisorStream("delta", "先推近");
    return { answer: "先推近", remainingFreeToday: 4 };
  });
  const text = await (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"manhuaContext":{}}' })).text();
  expect(text).not.toMatch(/DeepSeek|GLM|OpenRouter|EvoLink|Flash/i);
  expect(text.match(/event: reset/g)).toHaveLength(3); expect(text).toContain('"text":"创作顾问"'); expect(text).toContain('"text":"影片审阅"'); expect(text).toContain("先推近");
}));
it("知识卡不向前台发送模型、技术流或原始错误", () => endpoint(async url => {
  mocks.ask.mockImplementationOnce(async()=>{
    const ctx=mocks.caller.mock.calls[0][0];ctx.advisorStream('reset','DeepSeek 1017 OpenRouter');ctx.advisorStream('delta','request_id=private');
    return {success:true,answer:'{"kind":"knowledge_publication_batch_v1"}',modelName:'private-model',remainingFreeToday:4};
  });
  const req={method:'POST',headers:{'Content-Type':'application/json'},body:'{"knowledgePublicationContext":{}}'};
  const first=await (await fetch(url,req)).text();expect(first).not.toMatch(/private-model|DeepSeek|OpenRouter|request_id|event: reset|event: delta/);expect(first).toContain('event: result');
  mocks.ask.mockRejectedValueOnce(Error('private-endpoint HTTP 503 model=test-key'));
  const second=await (await fetch(url,req)).text();expect(second).not.toMatch(/private-endpoint|503|test-key/);expect(second).toContain('原稿');
}));
