import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), claim: vi.fn(), key: vi.fn(), official: vi.fn() }));
vi.mock("./knowledgeCardReadingStore.js", () => ({ readKnowledgeReadingJson: mocks.read, saveKnowledgeReadingObject: mocks.save, claimKnowledgeReadingCall: mocks.claim }));
vi.mock("./gpt56CopywritingGateway.js", () => ({ getEvolinkApiKey: mocks.key, resolveGpt56OfficialFallbackTarget: mocks.official }));
vi.mock("../_core/llm.js", async original => ({ ...await original<typeof import("../_core/llm")>(), extractFirstChoicePlainText: (value: any) => value.choices?.[0]?.message?.content || "" }));
import { invokeKnowledgeReadingJson, knowledgeReadingModelMatches, resetKnowledgeReadingChannelMemory } from "./knowledgeCardReadingGateway";
const input = { objectPrefix: "test/reading", model: "gpt-5.6-sol" as const, system: "测试阅读", text: "测试原页" };
const envelope = (finish = "stop", content = '{"ok":true}') => JSON.stringify({ model: input.model, choices: [{ finish_reason: finish, message: { content } }] });
describe("阅读网关不可重复购买与完整性", () => {
  beforeEach(() => { vi.resetAllMocks(); resetKnowledgeReadingChannelMemory(); mocks.official.mockReturnValue({ gateway: "openai_official", apiUrl: "https://api.openai.com/v1/chat/completions", apiKey: "test-official-key", modelName: input.model }); mocks.read.mockResolvedValue(null); mocks.save.mockResolvedValue({}); mocks.claim.mockResolvedValue(true); mocks.key.mockReturnValue("test-key"); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(envelope()))); });
  afterEach(() => vi.unstubAllGlobals());
  it("保存原始响应后才解析，并保留超过40张的全部输入图片", async () => {
    const images = Array.from({ length: 45 }, (_, i) => ({ pageId: `p${i + 1}`, url: `https://example.invalid/${i + 1}.png` }));
    expect(await invokeKnowledgeReadingJson({ ...input, images })).toEqual({ ok: true });
    const request = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(request.messages[1].content.filter((item: any) => item.type === "image_url")).toHaveLength(45);
    expect(request.messages[1].content.at(-1).image_url.url).toContain("45.png");
    expect(JSON.parse(mocks.save.mock.calls[0]![1].toString()).body).toBe(envelope());
  });
  it.each(["length", "content_filter", "tool_calls", null])("拒绝不完整停止原因 %s，重试只读已存响应", async finish => {
    const reply = { status: 200, body: envelope(finish as any), receivedAt: "测试时间" };
    mocks.read.mockResolvedValue(reply);
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("未完整返回");
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("解析错误仍永久保存原始响应", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("invalid-json"));
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow();
    expect(JSON.parse(mocks.save.mock.calls[0]![1].toString()).body).toBe("invalid-json");
  });
  it("原始响应存储失败立即停止", async () => {
    mocks.save.mockRejectedValue(new Error("测试存储失败"));
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("测试存储失败");
  });
  it("存在占用而无响应时禁止重新请求", async () => {
    mocks.claim.mockResolvedValue(false);
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("未重复提交");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("完整缓存直接恢复，不依赖当前凭证", async () => {
    mocks.key.mockReturnValue(undefined); mocks.read.mockResolvedValue({ status: 200, body: envelope() });
    expect(await invokeKnowledgeReadingJson(input)).toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.key).not.toHaveBeenCalled();
  });
  it("HTTP失败缓存禁止自动重新购买", async () => {
    mocks.read.mockResolvedValue({ status: 403, body: "测试鉴权失败" });
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("未自动重复购买"); expect(fetch).not.toHaveBeenCalled();
  });
  it("轻量请求携带正确模型与思考参数", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(envelope().replace("gpt-5.6-sol", "qwen3.8-max")));
    await invokeKnowledgeReadingJson({ ...input, model: "qwen3.8-max" });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({ model: "qwen3.8-max", enable_thinking: true, max_completion_tokens: 32768 });
    expect(body).not.toHaveProperty("max_tokens");
  });
  it("上游返回另一档位或缺失模型身份时拒绝", async () => {
    for (const model of ["qwen3.8-max", undefined]) {
      mocks.read.mockResolvedValue({ status: 200, body: JSON.stringify({ ...JSON.parse(envelope()), model }) });
      await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("档位不一致");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  function persistent() {
    const objects = new Map<string, any>();
    const claims = new Set<string>();
    mocks.read.mockImplementation(async name => objects.get(name) ?? null);
    mocks.save.mockImplementation(async (name, buffer) => {
      const value = JSON.parse(buffer.toString());
      if (objects.has(name) && JSON.stringify(objects.get(name)) !== JSON.stringify(value)) throw new Error("禁止覆盖原回执");
      objects.set(name, value); return {};
    });
    mocks.claim.mockImplementation(async name => { if (claims.has(name)) return false; claims.add(name); return true; });
    return { objects, claims };
  }
  it("524先保存原始回执，再用既有官方同模型回退，图文与xhigh不丢", async () => {
    const store = persistent();
    const images = Array.from({ length: 45 }, (_, index) => ({ pageId: `p${index + 1}`, url: `https://example.invalid/${index + 1}.png` }));
    vi.mocked(fetch).mockResolvedValueOnce(new Response("测试524超时", { status: 524 })).mockImplementationOnce(async () => {
      expect(store.objects.get(`${input.objectPrefix}/raw.json`).status).toBe(524);
      return new Response(envelope());
    });
    expect(await invokeKnowledgeReadingJson({ ...input, images })).toEqual({ ok: true });
    expect(mocks.official).toHaveBeenCalledWith(input.model);
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(["https://api.evolink.ai/v1/chat/completions", "https://api.openai.com/v1/chat/completions"]);
    const bodies = vi.mocked(fetch).mock.calls.map(call => JSON.parse(call[1]!.body as string));
    expect(bodies[1].messages).toEqual(bodies[0].messages);
    expect(bodies[1]).toMatchObject({ model: input.model, reasoning_effort: "xhigh", response_format: { type: "json_object" }, max_completion_tokens: 32768 });
    expect(bodies[1]).not.toHaveProperty("max_tokens");
    expect(bodies[1].messages[1].content.filter((item: any) => item.type === "image_url")).toHaveLength(45);
    expect(store.objects.get(`${input.objectPrefix}/raw.json`).body).toBe("测试524超时");
    expect(store.objects.get(`${input.objectPrefix}/official-fallback/raw.json`).body).toBe(envelope());
    expect(Array.from(store.claims)).toEqual([`${input.objectPrefix}/claim.json`, `${input.objectPrefix}/official-fallback/claim.json`]);
  });
  it("已存524可直接官方回退，成功缓存后两条通道都不重买且不再需要key", async () => {
    const store = persistent();
    const original = { status: 524, body: "已存测试524", receivedAt: "原时间" };
    store.objects.set(`${input.objectPrefix}/raw.json`, original);
    expect(await invokeKnowledgeReadingJson(input)).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.key).not.toHaveBeenCalled();
    mocks.official.mockImplementation(() => { throw new Error("测试无key"); });
    expect(await invokeKnowledgeReadingJson(input)).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.official).toHaveBeenCalledTimes(1);
    expect(store.objects.get(`${input.objectPrefix}/raw.json`)).toEqual(original);
  });
  it("官方未配置时保留524并明确断点，不重新EvoLink也不占用官方请求", async () => {
    const store = persistent(); store.objects.set(`${input.objectPrefix}/raw.json`, { status: 524, body: "测试524" });
    mocks.official.mockImplementation(() => { throw new Error("OPENAI_API_KEY（或 OPENAI_CHAT_API_KEY）未配置：无法使用官方备用通道"); });
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("未配置");
    expect(fetch).not.toHaveBeenCalled(); expect(store.claims.size).toBe(0);
  });
  it("EvoLink网络超时保留未知回执后仅官方一次，官方也超时则恢复不重复任何通道", async () => {
    const store = persistent();
    vi.mocked(fetch).mockRejectedValue(new DOMException("test timeout", "TimeoutError"));
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("结果待对账");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store.objects.get(`${input.objectPrefix}/transport-error.json`)).toMatchObject({ outcome: "unknown", retryable: true });
    expect(store.objects.get(`${input.objectPrefix}/official-fallback/transport-error.json`)).toMatchObject({ outcome: "unknown", retryable: true });
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("结果待对账");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("官方已有claim却无回执时只查询原任务，不重发官方请求", async () => {
    const store = persistent(); store.objects.set(`${input.objectPrefix}/raw.json`, { status: 524, body: "测试524" });
    store.claims.add(`${input.objectPrefix}/official-fallback/claim.json`);
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("未重复提交"); expect(fetch).not.toHaveBeenCalled();
  });
  it("官方返回失败或不同模型仍留独立raw，不能降档或重复购买", async () => {
    const store = persistent(); store.objects.set(`${input.objectPrefix}/raw.json`, { status: 524, body: "测试524" });
    vi.mocked(fetch).mockResolvedValue(new Response(envelope().replace(input.model, "qwen3.8-max")));
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("档位不一致");
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("档位不一致");
    expect(fetch).toHaveBeenCalledTimes(1); expect(store.objects.has(`${input.objectPrefix}/official-fallback/raw.json`)).toBe(true);
  });
  it("Qwen的524不偷偷换成官方Sol", async () => {
    const store = persistent(); store.objects.set(`${input.objectPrefix}/raw.json`, { status: 524, body: "测试524" });
    await expect(invokeKnowledgeReadingJson({ ...input, model: "qwen3.8-max" })).rejects.toThrow("未自动重复购买");
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.official).not.toHaveBeenCalled();
  });
  it("调用方主动中止不触发官方回退", async () => {
    const store = persistent(); const controller = new AbortController();
    vi.mocked(fetch).mockImplementationOnce(async () => { controller.abort(); throw new DOMException("test cancelled", "AbortError"); });
    await expect(invokeKnowledgeReadingJson({ ...input, signal: controller.signal })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.official).not.toHaveBeenCalled();
    expect(store.objects.get(`${input.objectPrefix}/transport-error.json`).retryable).toBe(false);
  });
  it("存524或未知传输回执失败时不越过证据门禁购买官方", async () => {
    persistent(); mocks.save.mockRejectedValue(new Error("测试持久化失败"));
    vi.mocked(fetch).mockResolvedValue(new Response("测试524", { status: 524 }));
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("测试持久化失败");
    expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.official).not.toHaveBeenCalled();
  });

  it("官方快照日期后缀同模型可接受，其他形状仍拒绝", async () => {
    expect(knowledgeReadingModelMatches("gpt-5.6-sol-2026-08-30", "gpt-5.6-sol")).toBe(true);
    for (const bad of ["gpt-5.6-sol-mini", "gpt-5.6-sol-2026-8-3", "gpt-5.6-solx-2026-08-30", "gpt-5.6", "", undefined, 3]) expect(knowledgeReadingModelMatches(bad, "gpt-5.6-sol")).toBe(false);
    const store = persistent(); store.objects.set(`${input.objectPrefix}/raw.json`, { status: 524, body: "测试524" });
    vi.mocked(fetch).mockResolvedValue(new Response(envelope().replace(input.model, "gpt-5.6-sol-2026-08-30")));
    expect(await invokeKnowledgeReadingJson(input)).toEqual({ ok: true });
  });
  it("同任务内主通道超时后，后续批直接走官方，不再每批先等主通道；已有主通道回执仍优先复用", async () => {
    const store = persistent();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("测试524", { status: 524 })).mockImplementation(async () => new Response(envelope()));
    const scope = "test/analysis";
    expect(await invokeKnowledgeReadingJson({ ...input, channelScope: scope })).toEqual({ ok: true });
    expect(await invokeKnowledgeReadingJson({ ...input, objectPrefix: "test/reading-2", channelScope: scope })).toEqual({ ok: true });
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(["https://api.evolink.ai/v1/chat/completions".replace("api.", "direct."), "https://api.openai.com/v1/chat/completions", "https://api.openai.com/v1/chat/completions"]);
    expect(store.objects.has("test/reading-2/raw.json")).toBe(false); expect(store.objects.has("test/reading-2/transport-error.json")).toBe(false);
    expect(store.claims.has("test/reading-2/claim.json")).toBe(false); expect(store.claims.has("test/reading-2/official-fallback/claim.json")).toBe(true);
    store.objects.set("test/reading-3/raw.json", { status: 200, body: envelope() });
    expect(await invokeKnowledgeReadingJson({ ...input, objectPrefix: "test/reading-3", channelScope: scope })).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.mocked(fetch).mockClear();
    await invokeKnowledgeReadingJson({ ...input, objectPrefix: "test/reading-4", channelScope: "another/analysis" });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("https://direct.evolink.ai/v1/chat/completions");
    await expect(invokeKnowledgeReadingJson({ ...input, objectPrefix: "test/reading-5", channelScope: scope, model: "qwen3.8-max" })).rejects.toThrow();
    expect(vi.mocked(fetch).mock.calls.at(-1)![0]).toBe("https://direct.evolink.ai/v1/chat/completions");
  });
});
