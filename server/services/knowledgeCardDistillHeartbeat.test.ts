import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invokeDistillLlm } from "./knowledgeCardDistill";

// 挑页单跳按心跳换跳：只保活 15 分钟 / 无字节 3 分钟即本跳失败换下一跳；不设固定总时长；用户取消仍整链立即停。
const KEEPALIVE_MS = 15 * 60_000, IDLE_MS = 180_000;
const enc = new TextEncoder();
const sse = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);
const delta = (content: string) => sse({ choices: [{ delta: { content }, finish_reason: null }] });
const done = () => [sse({ choices: [{ delta: {}, finish_reason: "stop" }] }), enc.encode("data: [DONE]\n\n")];
/** 可由测试推送字节的 SSE 响应 */
function streamResponse(signal?: AbortSignal) {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
  signal?.addEventListener("abort", () => { try { ctrl.error(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })); } catch { /* closed */ } });
  return { response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }), push: (b: Uint8Array) => { try { ctrl.enqueue(b); } catch { /* closed */ } }, close: () => ctrl.close() };
}
const triage = (abortSignal?: AbortSignal) => invokeDistillLlm({
  sourceText: "全书共 10 页", imageUrls: [], modelName: "glm-5.3-flashx", minSections: 1, effort: "high", plainUserContent: true, jsonObject: true,
  minOutputChars: 2, chainRetry: false, abortSignal,
  chainOverride: [{ gateway: "openrouter" }, { gateway: "evolink" }] as any,
  keepaliveOnlyTimeoutMs: KEEPALIVE_MS, idleTimeoutMs: IDLE_MS,
});
const settle = async (p: Promise<unknown>) => { let out: any = { pending: true }; p.then(v => { out = { value: v }; }, e => { out = { error: e }; }); for (let i = 0; i < 20; i++) await Promise.resolve(); return () => out; };

beforeEach(() => {
  for (const key of ["EVOLINK_API_KEY", "OPENROUTER_API_KEY", "DASHSCOPE_SG_PLAN_KEY"]) vi.stubEnv(key, "test-key");
  vi.spyOn(console, "warn").mockImplementation(() => {}); vi.spyOn(console, "info").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("只收到保活：保活窗口到期本跳失败，换下一跳；不是取消", async () => {
  const hosts: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    hosts.push(new URL(url).hostname);
    const s = streamResponse(init.signal);
    if (hosts.length === 1) { const t = setInterval(() => s.push(enc.encode(": keep-alive\n\n")), 30_000); init.signal.addEventListener("abort", () => clearInterval(t)); }
    else { s.push(delta('{"pages":[]}')); for (const b of done()) s.push(b); s.close(); }
    return s.response;
  }));
  const result = await settle(triage());
  await vi.advanceTimersByTimeAsync(KEEPALIVE_MS - 60_000);
  expect(hosts).toHaveLength(1); expect(result().pending).toBe(true);
  await vi.advanceTimersByTimeAsync(2 * 60_000);
  expect(hosts).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(result().value).toBe('{"pages":[]}');
});

it("响应头之后无字节：空闲窗口到期本跳失败，换下一跳", async () => {
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
    const s = streamResponse(init.signal);
    if (++n === 2) { s.push(delta('{"pages":[]}')); for (const b of done()) s.push(b); s.close(); }
    return s.response;
  }));
  const result = await settle(triage());
  await vi.advanceTimersByTimeAsync(IDLE_MS - 1_000);
  expect(n).toBe(1);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(n).toBe(2); expect(result().value).toBe('{"pages":[]}');
});

it("一直有实质增量的长回包（超过所有窗口与旧 60 分钟总时长）不被掐断", async () => {
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
    n++; const s = streamResponse(init.signal); let k = 0;
    const t = setInterval(() => {
      if (++k < 90 * 2) s.push(delta(k === 1 ? '{"pages":[' : " ")); // 每 30 秒一段，持续 90 分钟
      else { clearInterval(t); s.push(delta("]}")); for (const b of done()) s.push(b); s.close(); }
    }, 30_000);
    return s.response;
  }));
  const result = await settle(triage());
  await vi.advanceTimersByTimeAsync(91 * 60_000);
  expect(n).toBe(1); expect(JSON.parse(result().value)).toEqual({ pages: [] });
});

it("用户取消：整链立即停，按取消上报，不换下一跳", async () => {
  let n = 0; const ctrl = new AbortController();
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => { n++; const s = streamResponse(init.signal); s.push(enc.encode(": keep-alive\n\n")); return s.response; }));
  const result = await settle(triage(ctrl.signal));
  await vi.advanceTimersByTimeAsync(60_000);
  ctrl.abort(new Error("用户终止"));
  await vi.advanceTimersByTimeAsync(1);
  expect(n).toBe(1);
  const { isKnowledgeCardCancelledError } = await import("./knowledgeCardDistill");
  expect(result().error).toBeTruthy(); expect(isKnowledgeCardCancelledError(result().error, ctrl.signal)).toBe(true);
});

it("未给心跳参数（主提炼等）：仍按原固定总时长，不受影响", async () => {
  const spy = vi.spyOn(AbortSignal, "timeout");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"pages":[]}' }, finish_reason: "stop" }] }), { status: 200 })));
  await invokeDistillLlm({ sourceText: "x", imageUrls: [], modelName: "glm-5.3-flashx", minSections: 1, effort: "high", plainUserContent: true, minOutputChars: 2, chainRetry: false, chainOverride: [{ gateway: "openrouter" }] as any });
  expect(spy).toHaveBeenCalled();
  spy.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"pages":[]}' }, finish_reason: "stop" }] }), { status: 200 })));
  await triage();
  expect(spy).not.toHaveBeenCalled();
});
