import { describe, expect, it, vi } from "vitest";
import {
  GEMINI_CARBON_RATE_LIMIT_BACKOFF_MS,
  GeminiCarbonExhaustedError,
  resolveGeminiCarbonChannelOrder,
  runGeminiCarbon,
  type GeminiCarbonDeps,
} from "./geminiCarbonCall";
import { estimateGeminiCarbonCostUsd, parseGeminiCarbonChannelOrder } from "../../shared/geminiCarbon";

const ENV = {
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

describe("Carbon 通道顺序", () => {
  it("缺省 EvoLink → Gemini API → Vertex；env 可改，去重、忽略无效项", () => {
    expect(resolveGeminiCarbonChannelOrder({})).toEqual(["evolink", "gemini_api", "vertex"]);
    expect(resolveGeminiCarbonChannelOrder({ GEMINI_CARBON_CHANNEL_ORDER: "vertex, evolink ,vertex" })).toEqual(["vertex", "evolink"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(resolveGeminiCarbonChannelOrder({ GEMINI_CARBON_CHANNEL_ORDER: "openrouter" })).toEqual(["evolink", "gemini_api", "vertex"]);
    // 只允许 EvoLink / Vertex 的调用方（模板学习精读）：gemini_api 被忽略
    expect(parseGeminiCarbonChannelOrder("gemini_api,vertex", ["evolink", "vertex"], ["evolink", "vertex"])).toEqual(["vertex"]);
    warn.mockRestore();
  });
});

describe("runGeminiCarbon 三通道 fallback", () => {
  it("缺省先走 EvoLink；成功即停，证据含 request/raw/decoded/parsed/hop-used，用量与估价记录", async () => {
    const h = harness({ evolink: [ok('{"ok":true}')] });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await runGeminiCarbon({ prompt: "p", validate: validateObj, save: h.save, label: "t", deps: h.deps });
    info.mockRestore();
    expect(result.channel).toBe("evolink");
    expect(result.model).toBe("gemini-4-carbon");
    expect(h.calls.map((c) => c.channel)).toEqual(["evolink"]);
    expect(h.calls[0]!.url).toBe("https://direct.evolink.ai/v1beta/models/gemini-4-carbon:generateContent");
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
    expect(result.failuresZh.join("|")).toMatch(/请求超时.*MAX_TOKENS/);
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
    const h = harness({ evolink: [{ status: 503 }] }, { EVOLINK_API_KEY: "k" });
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
    expect(h.calls[0]!.url).toContain("/models/gemini-4-carbon-x:generateContent");
    expect(h.calls[0]!.body.generationConfig.responseMimeType).toBeUndefined();
  });
});
