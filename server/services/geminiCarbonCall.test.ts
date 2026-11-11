import { describe, expect, it, vi } from "vitest";
import {
  GEMINI_CARBON_RATE_LIMIT_BACKOFF_MS,
  GeminiCarbonExhaustedError,
  mergeGeminiCarbonStream,
  readGeminiCarbonText,
  resolveGeminiCarbonChannelOrder,
  runGeminiCarbon,
  type GeminiCarbonDeps,
} from "./geminiCarbonCall";
import { estimateGeminiCarbonCostUsd, parseGeminiCarbonChannelOrder } from "../../shared/geminiCarbon";

const ENV = { GEMINI_CARBON_CHANNEL_ORDER: "evolink,gemini_api,vertex", GEMINI_CARBON_CREATE_RETRIES: "0", /* 机制用例固定旧顺序、不重新创建；缺省顺序与重新创建另测 */
  EVOLINK_API_KEY: "k-evo",
  GEMINI_API_KEY: "k-gem",
  GOOGLE_APPLICATION_CREDENTIALS_JSON: "{}",
  VERTEX_PROJECT_ID: "proj",
};

type Reply = { status?: number; body?: unknown; throw?: Error };
const ok = (text: string, usage = { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30, totalTokenCount: 150 }, finishReason = "STOP") => ({
  status: 200,
  body: { candidates: [{ content: { parts: [{ text }] }, finishReason }], usageMetadata: usage },
});

function harness(script: Record<string, Reply[]>, env: Record<string, string | undefined> = ENV) {
  const calls: Array<{ channel: string; url: string; body: any; headers: Record<string, string> }> = [];
  const saved: Record<string, unknown> = {};
  const sleeps: number[] = [];
  const channelOf = (url: string) => (url.includes("evolink") ? "evolink" : url.includes("generativelanguage") ? "gemini_api" : "vertex");
  const fetchImpl = vi.fn(async (url: string, init: any) => {
    const channel = channelOf(url);
    calls.push({ channel, url, body: JSON.parse(init.body), headers: init.headers });
    const next = script[channel]?.shift();
    if (!next) throw new Error(`no scripted reply for ${channel}`);
    if (next.throw) throw next.throw;
    return new Response(typeof next.body === "string" ? next.body : JSON.stringify(next.body ?? {}), { status: next.status ?? 200 });
  });
  const deps: GeminiCarbonDeps = {
    fetch: fetchImpl as unknown as typeof fetch,
    sleep: async (ms) => { sleeps.push(ms); },
    env,
    vertexAuthHeaders: async () => ({ Authorization: "Bearer vertex" }),
    vertexProjectId: () => "proj",
    signGsUri: (gs) => `https://signed.example/${gs.slice(5)}?sig=1`,
    now: () => 0,
  };
  const save = vi.fn(async (name: string, value: unknown) => { if (name in saved) throw new Error(`dup ${name}`); saved[name] = value; });
  return { deps, calls, saved, sleeps, save };
}

const validateObj = (decoded: unknown) => {
  if (!decoded || typeof decoded !== "object" || !("ok" in decoded)) throw new Error("缺少 ok 字段");
  return decoded as { ok: boolean };
};

describe("Carbon 缺省顺序下的首发通道", () => {
  it("未设 env：三通道齐备时第一发走 Vertex，成功即停", async () => {
    const { GEMINI_CARBON_CHANNEL_ORDER: _pinned, ...env } = ENV;
    const h = harness({ vertex: [ok('{"ok":true}')] }, env);
    await runGeminiCarbon({ prompt: "p", label: "t", save: h.save, deps: h.deps, validate: validateObj, json: true } as any);
    expect(h.calls.map((c) => c.channel)).toEqual(["vertex"]);
  });
});

describe("Carbon 通道顺序", () => {
  it("缺省 Vertex → Gemini API → EvoLink；env 可改，去重、忽略无效项", () => {
    expect(resolveGeminiCarbonChannelOrder({})).toEqual(["vertex", "gemini_api", "evolink"]);
    expect(resolveGeminiCarbonChannelOrder({ GEMINI_CARBON_CHANNEL_ORDER: "vertex, evolink ,vertex" })).toEqual(["vertex", "evolink"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(resolveGeminiCarbonChannelOrder({ GEMINI_CARBON_CHANNEL_ORDER: "openrouter" })).toEqual(["vertex", "gemini_api", "evolink"]);
    // 只允许 EvoLink / Vertex 的调用方（模板学习精读）：gemini_api 被忽略
    expect(parseGeminiCarbonChannelOrder("gemini_api,vertex", ["evolink", "vertex"], ["evolink", "vertex"])).toEqual(["vertex"]);
    warn.mockRestore();
  });
});

describe("runGeminiCarbon 三通道 fallback", () => {
  it("顺序首位成功即停，证据含 request/raw/decoded/parsed/hop-used，用量与估价记录", async () => {
    const h = harness({ evolink: [ok('{"ok":true}')] });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await runGeminiCarbon({ prompt: "p", validate: validateObj, save: h.save, label: "t", deps: h.deps });
    info.mockRestore();
    expect(result.channel).toBe("evolink");
    expect(result.model).toBe("gemini-4-carbon");
    expect(h.calls.map((c) => c.channel)).toEqual(["evolink"]);
    expect(h.calls[0]!.url).toBe("https://direct.evolink.ai/v1beta/models/gemini-4-carbon:streamGenerateContent?alt=sse");
    expect(h.calls[0]!.body.generationConfig).toMatchObject({ maxOutputTokens: 65536, responseMimeType: "application/json" });
    expect(Object.keys(h.saved)).toEqual(["hop-1-evolink-request", "hop-1-evolink-raw", "hop-1-evolink-decoded", "hop-1-evolink-parsed", "hop-used"]);
    expect((h.saved["hop-1-evolink-raw"] as any).usage).toEqual({ inputTokens: 100, outputTokens: 20, thoughtsTokens: 30, totalTokens: 150 });
    expect((h.saved["hop-used"] as any).estimatedCostUsd).toBe(estimateGeminiCarbonCostUsd({ inputTokens: 100, outputTokens: 20, thoughtsTokens: 30 }));
    expect(result.usage.thoughtsTokens).toBe(30);
  });

  it("超时 / 断线 / HTTP 错 / 空回 / MAX_TOKENS 空正文都算失败并切下一通道", async () => {
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    const h = harness({
      evolink: [{ throw: timeout }],
      gemini_api: [ok("", { promptTokenCount: 10, candidatesTokenCount: 0, thoughtsTokenCount: 4000, totalTokenCount: 4010 }, "MAX_TOKENS")],
      vertex: [ok('{"ok":true}')],
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await runGeminiCarbon({ prompt: "p", validate: validateObj, save: h.save, label: "t", deps: h.deps });
    expect(result.channel).toBe("vertex");
    expect(result.hop).toBe(3);
    expect(result.failuresZh.join("|")).toMatch(/创建失败.*MAX_TOKENS/);
    expect((h.saved["hop-2-gemini_api-failed"] as any).kind).toBe("max_tokens");
    // 失败通道的思考 token 也计入总用量
    expect(result.totalUsage.thoughtsTokens).toBe(4030);

    for (const [reply, kind] of [
      [{ throw: new Error("socket hang up") }, "network"],
      [{ status: 500, body: { error: { message: "x" } } }, "http"],
      [ok(""), "empty"],
      [{ status: 200, body: { error: { message: "bad" } } }, "provider_error"],
      [ok("x", undefined, "SAFETY"), "blocked"],
    ] as const) {
      const g = harness({ evolink: [reply as Reply], gemini_api: [ok('{"ok":true}')] });
      const r = await runGeminiCarbon({ prompt: "p", validate: validateObj, save: g.save, label: "t", deps: g.deps });
      expect(r.channel).toBe("gemini_api");
      expect((g.saved["hop-1-evolink-failed"] as any).kind).toBe(kind);
    }
  });

  it("写坏：同通道带原因修复一次；修复仍不过再切下一通道", async () => {
    const h = harness({ evolink: [ok("not json"), ok('{"nope":1}')], gemini_api: [ok('{"ok":true}')] });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await runGeminiCarbon({ prompt: "原始提示", validate: validateObj, save: h.save, label: "t", deps: h.deps });
    expect(h.calls.map((c) => c.channel)).toEqual(["evolink", "evolink", "gemini_api"]);
    expect(h.calls[1]!.body.contents[0].parts.at(-1).text).toMatch(/^原始提示\n\n上一版输出未通过服务端校验：/);
    expect(h.saved).toHaveProperty("hop-1-evolink-rejected");
    expect(h.saved).toHaveProperty("hop-1-evolink-repair-rejected");
    expect(result.channel).toBe("gemini_api");
    expect(result.repaired).toBe(false);

    const g = harness({ evolink: [ok('{"nope":1}'), ok('{"ok":true}')] });
    const fixed = await runGeminiCarbon({ prompt: "p", validate: validateObj, save: g.save, label: "t", deps: g.deps });
    expect(fixed.channel).toBe("evolink");
    expect(fixed.repaired).toBe(true);
  });

  it("429 同通道退避 2s/5s/10s 重试 3 次；仍限流再切下一通道", async () => {
    expect(GEMINI_CARBON_RATE_LIMIT_BACKOFF_MS).toEqual([2_000, 5_000, 10_000]);
    const limited = { status: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED" } } };
    const h = harness({ evolink: [limited, limited, ok('{"ok":true}')] });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const r = await runGeminiCarbon({ prompt: "p", validate: validateObj, save: h.save, label: "t", deps: h.deps });
    expect(r.channel).toBe("evolink");
    expect(h.sleeps).toEqual([2_000, 5_000]);
    expect(Object.keys(h.saved)).toEqual(expect.arrayContaining(["hop-1-evolink-raw", "hop-1-evolink-retry1-raw", "hop-1-evolink-retry2-raw"]));

    const g = harness({ evolink: [limited, limited, limited, limited], gemini_api: [ok('{"ok":true}')] });
    const r2 = await runGeminiCarbon({ prompt: "p", validate: validateObj, save: g.save, label: "t", deps: g.deps });
    expect(g.sleeps).toEqual([2_000, 5_000, 10_000]);
    expect(r2.channel).toBe("gemini_api");
    expect((g.saved["hop-1-evolink-failed"] as any).kind).toBe("rate_limited");
  });

  it("全部失败抛 GeminiCarbonExhaustedError，并落 hop-exhausted；未配置通道记 skipped", async () => {
    const h = harness({ evolink: [{ status: 503 }] }, { EVOLINK_API_KEY: "k", GEMINI_CARBON_CHANNEL_ORDER: "evolink,gemini_api,vertex", GEMINI_CARBON_CREATE_RETRIES: "0" });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(runGeminiCarbon({ prompt: "p", validate: validateObj, save: h.save, label: "t", deps: h.deps })).rejects.toBeInstanceOf(GeminiCarbonExhaustedError);
    expect(h.saved).toHaveProperty("hop-2-gemini_api-skipped");
    expect(h.saved).toHaveProperty("hop-3-vertex-skipped");
    expect((h.saved["hop-exhausted"] as any).failuresZh).toHaveLength(3);
  });

  it("媒体：EvoLink 用签名 https、Vertex 用 gs://、Gemini API 跳过；证据只记 gs://", async () => {
    const h = harness({ evolink: [{ status: 502 }], vertex: [ok('{"ok":true}')] });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await runGeminiCarbon({ prompt: "p", media: [{ mimeType: "video/mp4", gsUri: "gs://b/v.mp4" }], validate: validateObj, save: h.save, label: "t", deps: h.deps });
    expect(h.calls[0]!.body.contents[0].parts[0].fileData.fileUri).toBe("https://signed.example/b/v.mp4?sig=1");
    expect(h.calls[1]!.channel).toBe("vertex");
    expect(h.calls[1]!.body.contents[0].parts[0].fileData.fileUri).toBe("gs://b/v.mp4");
    expect((h.saved["hop-2-gemini_api-skipped"] as any).kind).toBe("unsupported");
    expect(JSON.stringify(h.saved)).not.toContain("signed.example");
    await expect(runGeminiCarbon({ prompt: "p", media: [{ mimeType: "video/mp4", gsUri: "https://x/y.mp4" }], channels: ["vertex"], validate: validateObj, save: harness({}).save, label: "t", deps: harness({}).deps })).rejects.toThrow();
  });

  it("text 模式：正文原样交 validate；显式 channels 与 model 优先；思考 part 不进正文", async () => {
    const h = harness({ vertex: [{ status: 200, body: { candidates: [{ content: { parts: [{ text: "想", thought: true }, { text: "正文" }] }, finishReason: "STOP" }] } }] });
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const r = await runGeminiCarbon({ prompt: "p", responseFormat: "text", channels: ["vertex"], model: "gemini-4-carbon-x", validate: (d) => String(d), save: h.save, label: "t", deps: h.deps });
    expect(r.value).toBe("正文");
    expect(h.calls[0]!.url).toContain("/models/gemini-4-carbon-x:streamGenerateContent?alt=sse");
    expect(h.calls[0]!.body.generationConfig.responseMimeType).toBeUndefined();
  });
});


describe("Carbon 流式：有心跳就等，创建失败就重新创建（站长 2026-11-11）", () => {
  const sse = (chunks: unknown[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("");
  const part = (text: string, thought = false) => ({ candidates: [{ content: { parts: [{ text, ...(thought ? { thought: true } : {}) }] } }] });
  const ONE = { EVOLINK_API_KEY: "k", GEMINI_CARBON_CHANNEL_ORDER: "evolink" };
  const run = (deps: GeminiCarbonDeps, save: any) => runGeminiCarbon({ prompt: "p", validate: validateObj, save, label: "t", deps });

  it("mergeGeminiCarbonStream：SSE 多段拼成同形回包，思考与正文分开，用量与结束原因取最后一段", () => {
    const merged = mergeGeminiCarbonStream(sse([
      part("先想一想", true), part('{"ok":'), part("再想", true),
      { candidates: [{ content: { parts: [{ text: "true}" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, thoughtsTokenCount: 9 } },
    ])) as any;
    expect(merged.candidates[0].content.parts).toEqual([{ text: "先想一想再想", thought: true }, { text: '{"ok":true}' }]);
    expect(merged.candidates[0].finishReason).toBe("STOP");
    expect(merged.usageMetadata.thoughtsTokenCount).toBe(9);
    expect(merged.streamChunks).toBe(4);
    expect(readGeminiCarbonText(merged)).toBe('{"ok":true}');
    expect(mergeGeminiCarbonStream("不是 JSON")).toBeNull();
    expect(mergeGeminiCarbonStream('{"a":1}')).toEqual({ a: 1 });
  });

  it("缺省带思考设置（thinkingLevel HIGH + includeThoughts）；调用方给了就不覆盖；流式原文与还原回包各存一份", async () => {
    const h = harness({ evolink: [{ body: sse([part("想", true), { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, thoughtsTokenCount: 4 } }]) }] }, ONE);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await run(h.deps, h.save);
    expect(h.calls[0]!.body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "HIGH", includeThoughts: true });
    expect(result.usage.thoughtsTokens).toBe(4);
    const raw = h.saved["hop-1-evolink-raw"] as any;
    expect(raw.rawStream).toContain("data: ");
    expect(raw.payload.candidates[0].content.parts.at(-1)).toEqual({ text: '{"ok":true}' });
    const g = harness({ evolink: [ok('{"ok":true}')] }, ONE);
    await runGeminiCarbon({ prompt: "p", validate: validateObj, save: g.save, label: "t", deps: g.deps, extraGenerationConfig: { thinkingConfig: { thinkingLevel: "LOW" } } });
    expect(g.calls[0]!.body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
  });

  it("创建失败（断线 / 503）同通道重新创建，成功即用；证据留下每次失败", async () => {
    const h = harness({ evolink: [{ throw: new Error("socket hang up") }, { status: 503 }, ok('{"ok":true}')] }, ONE);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await run(h.deps, h.save);
    expect(h.calls.map((c) => c.channel)).toEqual(["evolink", "evolink", "evolink"]);
    expect(result.hop).toBe(1);
    expect((h.saved["hop-1-evolink-error"] as any)).toMatchObject({ createFailed: true, willRecreate: true });
    expect(h.saved).toHaveProperty("hop-1-evolink-recreate1-raw");
    expect(h.saved).toHaveProperty("hop-1-evolink-recreate2-raw");
    expect(h.sleeps).toEqual([2000, 2000]);
  });

  it("重新创建用尽仍失败才切下一通道", async () => {
    const h = harness({ evolink: [{ throw: new Error("x") }, { throw: new Error("x") }, { throw: new Error("x") }], vertex: [ok('{"ok":true}')] }, { EVOLINK_API_KEY: "k", GOOGLE_APPLICATION_CREDENTIALS_JSON: "{}", VERTEX_PROJECT_ID: "p", GEMINI_CARBON_CHANNEL_ORDER: "evolink,vertex" });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await run(h.deps, h.save);
    expect(h.calls.map((c) => c.channel)).toEqual(["evolink", "evolink", "evolink", "vertex"]);
    expect(result.channel).toBe("vertex");
    expect(result.failuresZh[0]).toContain("创建失败");
  });

  const streamingFetch = (plan: Array<{ firstAfterMs?: number; chunks?: Array<{ afterMs: number; text: string }>; hang?: boolean }>) => {
    let call = 0;
    return (async (_url: string, init: any) => {
      const step = plan[call++]!;
      const signal: AbortSignal = init.signal;
      const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });
      if (step.hang) return new Promise<Response>((_, reject) => signal.addEventListener("abort", () => reject(abortError())));
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          signal.addEventListener("abort", () => { try { controller.error(abortError()); } catch { /* 已关闭 */ } });
          for (const chunk of step.chunks ?? []) {
            await new Promise((resolve) => setTimeout(resolve, chunk.afterMs));
            if (signal.aborted) return;
            controller.enqueue(encoder.encode(chunk.text));
          }
          if (!signal.aborted && !(step.chunks ?? []).some((c) => c.text === "__STALL__")) controller.close();
        },
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
  };
  const timedDeps = (fetchImpl: typeof fetch, env: Record<string, string>): GeminiCarbonDeps => ({
    fetch: fetchImpl, sleep: async () => undefined, env, vertexAuthHeaders: async () => ({}), vertexProjectId: () => "p", signGsUri: (g) => g, now: () => Date.now(),
  });

  it("创建期内没有任何回应 → 重新创建；慢但持续有数据（总时长远超心跳间隔）照样等到完成", async () => {
    const env = { ...ONE, GEMINI_CARBON_CREATE_TIMEOUT_MS: "60", GEMINI_CARBON_HEARTBEAT_TIMEOUT_MS: "80", GEMINI_CARBON_CREATE_RETRIES: "1" };
    const done = { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
    const fetchImpl = streamingFetch([
      { hang: true },
      { chunks: [...Array.from({ length: 6 }, () => ({ afterMs: 40, text: sse([part("想", true)]) })), { afterMs: 40, text: sse([done]) }] },
    ]);
    const saved: Record<string, any> = {};
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await run(timedDeps(fetchImpl, env), async (n: string, v: unknown) => { saved[n] = v; });
    expect(result.value).toEqual({ ok: true });
    expect(saved["hop-1-evolink-error"].reasonZh).toContain("创建失败");
    expect(saved["hop-1-evolink-recreate1-raw"].segments).toBe(7);
    expect(result.elapsedMs).toBeGreaterThan(200); // 280ms 才写完，远超 80ms 心跳间隔，没有被总时长掐断
  });

  it("已有数据后心跳中断 → 判失败且不重新创建（不是创建失败）", async () => {
    const env = { ...ONE, GEMINI_CARBON_CREATE_TIMEOUT_MS: "200", GEMINI_CARBON_HEARTBEAT_TIMEOUT_MS: "60", GEMINI_CARBON_CREATE_RETRIES: "2" };
    let calls = 0;
    const inner = streamingFetch([{ chunks: [{ afterMs: 10, text: sse([part("想", true)]) }, { afterMs: 400, text: "__STALL__" }] }]);
    const fetchImpl = (async (u: string, i: any) => { calls += 1; return inner(u as any, i); }) as unknown as typeof fetch;
    const saved: Record<string, any> = {};
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(run(timedDeps(fetchImpl, env), async (n: string, v: unknown) => { saved[n] = v; })).rejects.toBeInstanceOf(GeminiCarbonExhaustedError);
    expect(calls).toBe(1);
    expect(saved["hop-1-evolink-error"]).toMatchObject({ createFailed: false, willRecreate: false });
    expect(saved["hop-1-evolink-error"].reasonZh).toContain("心跳中断");
  });
});
