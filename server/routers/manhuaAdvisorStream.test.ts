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
