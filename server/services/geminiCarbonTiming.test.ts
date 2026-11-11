import { afterEach, describe, expect, it, vi } from "vitest";
import { runGeminiCarbon, type GeminiCarbonDeps } from "./geminiCarbonCall";
import {
  GeminiCarbonTimingStore,
  estimateGeminiCarbonTokens,
  geminiCarbonSizeBaselineMs,
  geminiCarbonSizeBucket,
  planGeminiCarbonCreate,
} from "./geminiCarbonTiming";

afterEach(() => { vi.restoreAllMocks(); });

describe("动态创建期：纯函数", () => {
  it("无历史 → 规模基线（短提示约 45 秒、3 万 token 约 150 秒，随规模线性增长）", () => {
    const short = planGeminiCarbonCreate({ inputTokens: 500, successFirstDataMs: [], recentCreateFailed: [] });
    expect(short).toMatchObject({ basis: "size_baseline", samples: 0, createRetries: 2, retriesBasis: "failure_rate" });
    expect(short.createTimeoutMs).toBeGreaterThanOrEqual(45_000);
    expect(short.createTimeoutMs).toBeLessThan(48_000);
    expect(geminiCarbonSizeBaselineMs(30_000)).toBe(150_000);
    expect(geminiCarbonSizeBaselineMs(8_000)).toBe(73_000);
    expect(geminiCarbonSizeBaselineMs(10_000)).toBeGreaterThan(geminiCarbonSizeBaselineMs(5_000));
  });

  it("有历史 → 2 × P90（高于基线时）；样本太少仍用基线", () => {
    const samples = [20_000, 22_000, 25_000, 30_000, 40_000, 21_000, 23_000, 24_000, 26_000, 60_000];
    const plan = planGeminiCarbonCreate({ inputTokens: 500, successFirstDataMs: samples, recentCreateFailed: [] });
    expect(plan).toMatchObject({ basis: "history_p90", samples: 10, p90Ms: 40_000, createTimeoutMs: 80_000 });
    const few = planGeminiCarbonCreate({ inputTokens: 500, successFirstDataMs: [60_000, 60_000], recentCreateFailed: [] });
    expect(few.basis).toBe("size_baseline");
    // 2×P90 低于基线 → 取基线（max）
    const fast = planGeminiCarbonCreate({ inputTokens: 500, successFirstDataMs: [2_000, 3_000, 4_000], recentCreateFailed: [] });
    expect(fast).toMatchObject({ basis: "size_baseline", createTimeoutMs: fast.baselineMs });
  });

  it("上下限夹取：30 秒 ~ 300 秒", () => {
    const huge = planGeminiCarbonCreate({ inputTokens: 500, successFirstDataMs: [200_000, 250_000, 260_000], recentCreateFailed: [] });
    expect(huge.createTimeoutMs).toBe(300_000);
    expect(geminiCarbonSizeBaselineMs(500_000)).toBe(300_000);
    expect(geminiCarbonSizeBaselineMs(0)).toBeGreaterThanOrEqual(30_000);
  });

  it("env 强制覆盖创建期与重建次数", () => {
    const plan = planGeminiCarbonCreate({
      inputTokens: 50_000, successFirstDataMs: [200_000, 200_000, 200_000], recentCreateFailed: Array(10).fill(true),
      env: { GEMINI_CARBON_CREATE_TIMEOUT_MS: "150000", GEMINI_CARBON_CREATE_RETRIES: "2" },
    });
    expect(plan).toMatchObject({ createTimeoutMs: 150_000, basis: "env", createRetries: 2, retriesBasis: "env" });
  });

  it("该通道近期创建失败率高 → 少重建（≥4/10 → 1 次，≥7/10 → 0 次）", () => {
    const fail = (n: number) => [...Array(10 - n).fill(false), ...Array(n).fill(true)];
    expect(planGeminiCarbonCreate({ inputTokens: 1, successFirstDataMs: [], recentCreateFailed: fail(3) }).createRetries).toBe(2);
    expect(planGeminiCarbonCreate({ inputTokens: 1, successFirstDataMs: [], recentCreateFailed: fail(4) }).createRetries).toBe(1);
    expect(planGeminiCarbonCreate({ inputTokens: 1, successFirstDataMs: [], recentCreateFailed: fail(7) }).createRetries).toBe(0);
    // 只看最近 10 次
    expect(planGeminiCarbonCreate({ inputTokens: 1, successFirstDataMs: [], recentCreateFailed: [...Array(8).fill(true), ...Array(10).fill(false)] }).createRetries).toBe(2);
  });

  it("规模估算与分桶", () => {
    expect(estimateGeminiCarbonTokens("中文四字")).toBe(4);
    expect(estimateGeminiCarbonTokens("abcdefgh")).toBe(2);
    expect(geminiCarbonSizeBucket(1_999)).toBe("lt2k");
    expect(geminiCarbonSizeBucket(2_000)).toBe("2k-8k");
    expect(geminiCarbonSizeBucket(8_000)).toBe("8k-30k");
    expect(geminiCarbonSizeBucket(30_000)).toBe("gt30k");
  });
});

describe("统计存储", () => {
  it("按通道 × 规模分桶保留最近 N 条成功样本；失败只计入失败率", () => {
    const store = new GeminiCarbonTimingStore({ maxSamples: 5 });
    for (let i = 0; i < 8; i += 1) store.record({ channel: "vertex", inputTokens: 100, firstDataMs: 10_000 * (i + 1), ok: true, at: i });
    store.record({ channel: "vertex", inputTokens: 20_000, firstDataMs: 999, ok: true, at: 9 });
    const plan = store.plan("vertex", 100);
    expect(plan.samples).toBe(5);
    expect(plan.p90Ms).toBe(80_000);
    expect(store.plan("evolink", 100).samples).toBe(0);
    for (let i = 0; i < 4; i += 1) store.record({ channel: "vertex", inputTokens: 100, firstDataMs: null, ok: false, at: 20 + i });
    expect(store.plan("vertex", 100).createRetries).toBe(1);
    expect(store.plan("vertex", 100).samples).toBe(5);
  });

  it("懒加载持久化统计；写入节流（每 10 条成功写一次）；先加载再写", async () => {
    const saved: unknown[] = [];
    const load = vi.fn(async () => ({ version: 1, samples: { vertex: { lt2k: [{ firstDataMs: 70_000, inputTokens: 1, at: 0 }, { firstDataMs: 70_000, inputTokens: 1, at: 0 }, { firstDataMs: 70_000, inputTokens: 1, at: 0 }] } }, attempts: { vertex: [{ failed: true, at: 0 }] } }));
    const store = new GeminiCarbonTimingStore({ persist: { load, save: async (s) => { saved.push(s); } }, flushEvery: 10 });
    await store.ensureLoaded();
    await store.ensureLoaded();
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.plan("vertex", 1)).toMatchObject({ basis: "history_p90", createTimeoutMs: 140_000, recentCreateFailures: 1 });
    for (let i = 0; i < 9; i += 1) store.record({ channel: "vertex", inputTokens: 1, firstDataMs: 1_000, ok: true, at: i });
    await store.drain();
    expect(saved).toHaveLength(0);
    store.record({ channel: "vertex", inputTokens: 1, firstDataMs: 1_000, ok: true, at: 10 });
    await store.drain();
    expect(saved).toHaveLength(1);
    expect((saved[0] as any).samples.vertex.lt2k).toHaveLength(13);
  });

  it("距上次写入超过 5 分钟也会写", async () => {
    let t = 0;
    const save = vi.fn(async () => undefined);
    const store = new GeminiCarbonTimingStore({ persist: { load: async () => null, save }, now: () => t });
    store.record({ channel: "evolink", inputTokens: 1, firstDataMs: 1, ok: true, at: 0 });
    await store.drain();
    expect(save).not.toHaveBeenCalled();
    t = 5 * 60_000;
    store.record({ channel: "evolink", inputTokens: 1, firstDataMs: 1, ok: true, at: t });
    await store.drain();
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("接入调用层", () => {
  const ENV = { VERTEX_PROJECT_ID: "p", GOOGLE_APPLICATION_CREDENTIALS_JSON: "{}", EVOLINK_API_KEY: "k", GEMINI_CARBON_CHANNEL_ORDER: "vertex,evolink" };
  const okBody = JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } });
  const deps = (fetchImpl: typeof fetch, timing: GeminiCarbonTimingStore | undefined, env: Record<string, string> = ENV): GeminiCarbonDeps => ({
    fetch: fetchImpl, sleep: async () => undefined, env, vertexAuthHeaders: async () => ({}), vertexProjectId: () => "p", signGsUri: (g) => g, now: () => Date.now(), timing,
  });
  const validate = (d: unknown) => d as { ok: boolean };

  it("持久化读写都失败 → 调用照常成功，样本记入内存；request 证据记下创建期依据与样本数", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const store = new GeminiCarbonTimingStore({ persist: { load: async () => { throw new Error("gcs down"); }, save: async () => { throw new Error("gcs down"); } }, flushEvery: 1 });
    const saved: Record<string, any> = {};
    const fetchImpl = (async () => new Response(okBody, { status: 200 })) as unknown as typeof fetch;
    const result = await runGeminiCarbon({ prompt: "短提示", validate, save: async (n, v) => { saved[n] = v; }, label: "t", deps: deps(fetchImpl, store) });
    await store.drain();
    expect(result.value).toEqual({ ok: true });
    expect(saved["hop-1-vertex-request"].createPlan).toMatchObject({ basis: "size_baseline", samples: 0, createRetries: 2 });
    expect(saved["hop-1-vertex-request"].createPlan.createTimeoutMs).toBeGreaterThanOrEqual(45_000);
    expect(saved["hop-1-vertex-raw"].createPlan.basis).toBe("size_baseline");
    expect(saved["hop-used"].firstDataMs).not.toBeNull();
    expect(store.plan("vertex", 10).samples).toBe(1);
  });

  it("创建期超时记 null 并计入失败率；失败率高时本次少重建，更早切下一通道", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const store = new GeminiCarbonTimingStore();
    for (let i = 0; i < 7; i += 1) store.record({ channel: "vertex", inputTokens: 1, firstDataMs: null, ok: false, at: i });
    const urls: string[] = [];
    // vertex 一直不回应（创建期由 env 压到 30ms 便于测试；重建次数不设 env，按失败率决定）
    const fetchImpl = (async (url: string, init: any) => {
      urls.push(url);
      if (!url.includes("evolink")) {
        return await new Promise<Response>((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
      }
      return new Response(okBody, { status: 200 });
    }) as unknown as typeof fetch;
    const saved: Record<string, any> = {};
    const result = await runGeminiCarbon({ prompt: "p", validate, save: async (n, v) => { saved[n] = v; }, label: "t", deps: deps(fetchImpl, store, { ...ENV, GEMINI_CARBON_CREATE_TIMEOUT_MS: "30" }) });
    expect(result.channel).toBe("evolink");
    expect(urls.filter((u) => !u.includes("evolink"))).toHaveLength(1); // 失败 7/10 → 0 次重建
    expect(saved["hop-1-vertex-request"].createPlan).toMatchObject({ createRetries: 0, retriesBasis: "failure_rate", recentCreateFailures: 7, basis: "env", createTimeoutMs: 30 });
    expect(saved["hop-1-vertex-error"].createPlan.createRetries).toBe(0);
    expect(store.plan("vertex", 1).recentCreateFailures).toBe(8);
  });
});
