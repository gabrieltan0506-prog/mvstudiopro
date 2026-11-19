/**
 * D2：核实修订与主题命题走 GLM@EvoLink → GLM@OpenRouter → DeepSeek v4.1 Flash 1017 链（经真实路由 invokeKnowledgePublicationRoutes，
 * 只 mock 上游 fetch，不发任何真实模型请求）；写坏与仅保活卡住都换路；命题批次分到两通道并行。
 */
import { describe, expect, it, vi } from "vitest";
import { invokeKnowledgePublicationRoutes } from "./knowledgePublicationRoutes";
import { KNOWLEDGE_TOPIC_TITLE_BATCH, nameKnowledgeEditionTopics } from "./knowledgeTopicTitles";
import { verifyKnowledgeEditionManuscripts } from "./knowledgeEditionFinalVerification";
import { compileKnowledgeEditions } from "../../shared/knowledgeCardEdition";
import { knowledgeEditionImagePlan } from "../../shared/knowledgeCardPagination";

const book = compileKnowledgeEditions("测试书", Array.from({ length: 24 }, (_, i) => ({
  headline: `原小节${i}`,
  body: Array.from({ length: 30 }, (_, j) => `第${i}节第${j}句记述一件具体史实，以及它前后的经过与影响。`).join(""),
  priority: "primary" as const,
})));
const batchCount = Math.ceil(knowledgeEditionImagePlan(book.full)!.images.length / KNOWLEDGE_TOPIC_TITLE_BATCH);

function memoryEvidence(prefix = "doc/editions") {
  const store = new Map<string, any>();
  return { store, evidence: { prefix, read: async (k: string) => store.get(k) ?? null, save: async (k: string, v: unknown) => { store.set(k, JSON.parse(JSON.stringify(v))); } } };
}
type Call = { channel: "openrouter" | "evolink"; model: string; input: any; body: any };
const channelOf = (url: unknown) => (String(url).includes("openrouter.ai") ? "openrouter" : "evolink") as Call["channel"];
const inputOf = (body: any) => {
  for (const m of body.messages) if (m.role === "user" && Array.isArray(m.content)) for (const p of m.content) {
    if (p.type !== "text") continue;
    try { const v = JSON.parse(p.text); if (v?.source) return v; } catch { /* 非 JSON 段 */ }
  }
  throw Error("测试夹具：请求中找不到 source");
};
const jsonResponse = (body: any, content: string) => new Response(JSON.stringify({ model: body.model, choices: [{ finish_reason: "stop", message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200, headers: { "Content-Type": "application/json" } });
const titleReport = (input: any) => JSON.stringify({ kind: "knowledge_publication_v1", sourceDigest: input.sourceDigest, title: "主题命题", pages: input.source.pages.map((p: any) => {
  const index = Number(String(p.headline).replace(/^主题/, "")) - 1;
  const headlines = String(p.body.split("\n")[0]).replace(/^原小节：/, "").split("｜");
  return { id: p.id, headline: p.headline, body: "本主题说明", imageDescription: "", imageStatus: "absent", facts: [{ term: "主题", statement: "本主题说明" }], cautions: [],
    reading: { version: 1, subtitle: "", accent: "jade", blocks: [
      { type: "prose", title: `图题${index + 1}`, note: "", text: "image" },
      { type: "prose", title: `内文题${index + 1}`, note: "", text: "reading" },
      ...headlines.map((h: string) => ({ type: "prose", title: `新${h}`, note: "", text: h })),
    ] } };
}) });
const batchOf = (input: any) => Math.floor((Number(String(input.source.pages[0].headline).replace(/^主题/, "")) - 1) / KNOWLEDGE_TOPIC_TITLE_BATCH);
const baseDeps = (fetch: any, extra: Record<string, unknown> = {}) => ({ key: () => "test-key", sign: () => "https://example.invalid/x.png", thumbnail: async () => null,
  sleep: async () => {}, lateReceiptWaitMs: 0, log: () => {}, fetch, ...extra }) as any;

describe("D2 主题命题：两通道并行，各批 GLM 首发链", () => {
  it("批次交替首发 GLM@EvoLink 与 GLM@OpenRouter，两通道同时在途，不先发 DeepSeek", async () => {
    expect(batchCount).toBeGreaterThanOrEqual(2);
    const { evidence } = memoryEvidence();
    const calls: Call[] = [];
    const inflight = new Set<string>();
    let bothInflight = false, release!: () => void;
    const bothSeen = new Promise<void>(r => { release = r; });
    const fetch = vi.fn(async (url: any, init: any) => {
      const body = JSON.parse(init.body), channel = channelOf(url);
      calls.push({ channel, model: body.model, input: inputOf(body), body });
      inflight.add(channel);
      if (inflight.size === 2) { bothInflight = true; release(); }
      // 首波等两通道都已发出（顺序执行则 2 秒后放行，断言失败）。
      await Promise.race([bothSeen, new Promise(r => setTimeout(r, 2000))]);
      return jsonResponse(body, titleReport(inputOf(body)));
    });
    // 模型档传 DeepSeek 也必须 GLM 首发（链规则不随提炼档位变化）。
    const result = await nameKnowledgeEditionTopics({ markdown: book.full, model: "deepseek-v4.1-flash-1017", evidence,
      invoke: (request, scope, overrides) => invokeKnowledgePublicationRoutes(request, scope, { ...baseDeps(fetch), ...overrides }) });
    expect(result.status).toBe("named");
    expect(bothInflight).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(batchCount);
    for (const call of calls) {
      const b = batchOf(call.input);
      expect(call.channel).toBe(b % 2 === 0 ? "evolink" : "openrouter");
      expect(call.model).toBe(call.channel === "evolink" ? "glm-5.3-flashx" : "z-ai/glm-5.3-flashx");
    }
  });

  it("首跳写坏（同跳修复一次仍坏）→ 换到另一通道 GLM，原坏回包永久保存", async () => {
    const { evidence, store } = memoryEvidence();
    const calls: Call[] = [];
    const fetch = vi.fn(async (url: any, init: any) => {
      const body = JSON.parse(init.body), channel = channelOf(url), input = inputOf(body);
      calls.push({ channel, model: body.model, input, body });
      if (batchOf(input) === 0 && channel === "evolink") return jsonResponse(body, '{"pages":[{"body":"缺失结尾');
      return jsonResponse(body, titleReport(input));
    });
    const result = await nameKnowledgeEditionTopics({ markdown: book.full, evidence,
      invoke: (request, scope, overrides) => invokeKnowledgePublicationRoutes(request, scope, { ...baseDeps(fetch), ...overrides }) });
    expect(result.status).toBe("named");
    const batch0 = calls.filter(c => batchOf(c.input) === 0).map(c => `${c.model}@${c.channel}`);
    expect(batch0).toEqual(["glm-5.3-flashx@evolink", "glm-5.3-flashx@evolink", "z-ai/glm-5.3-flashx@openrouter"]);
    const receipt = Array.from(store.entries()).find(([k]) => /batch-0\/route-glm-evolink\.json$/.test(k))?.[1];
    expect(receipt?.response?.text).toContain("缺失结尾");
  });

  it("首跳只收到保活（无实质增量）超时 → 记中断并换到另一通道 GLM", async () => {
    const { evidence, store } = memoryEvidence();
    const calls: Call[] = [];
    const enc = (t: string) => new TextEncoder().encode(t);
    const fetch = vi.fn(async (url: any, init: any) => {
      const body = JSON.parse(init.body), channel = channelOf(url), input = inputOf(body);
      calls.push({ channel, model: body.model, input, body });
      if (batchOf(input) === 0 && channel === "evolink") {
        let timer: ReturnType<typeof setInterval> | undefined;
        const stream = new ReadableStream<Uint8Array>({ start(c) {
          timer = setInterval(() => { try { c.enqueue(enc(": OPENROUTER PROCESSING\n\n")); } catch { clearInterval(timer); } }, 20);
          (init.signal as AbortSignal | undefined)?.addEventListener("abort", () => { clearInterval(timer); try { c.error(new Error("aborted")); } catch { /* 已关闭 */ } });
        } });
        return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
      }
      return jsonResponse(body, titleReport(input));
    });
    const result = await nameKnowledgeEditionTopics({ markdown: book.full, evidence,
      invoke: (request, scope, overrides) => invokeKnowledgePublicationRoutes(request, scope, { ...baseDeps(fetch, { keepaliveOnlyTimeoutMs: 150, idleTimeoutMs: 5000 }), ...overrides }) });
    expect(result.status).toBe("named");
    const batch0 = calls.filter(c => batchOf(c.input) === 0).map(c => `${c.model}@${c.channel}`);
    expect(batch0).toEqual(["glm-5.3-flashx@evolink", "z-ai/glm-5.3-flashx@openrouter"]);
    const receipt = Array.from(store.entries()).find(([k]) => /batch-0\/route-glm-evolink\.json$/.test(k))?.[1];
    expect(receipt).toMatchObject({ state: "interrupted", transportCause: "keepalive_only" });
  });

  it("旧任务已存 request.json 时按原请求回放（续做身份不变），不改成新链", async () => {
    const { evidence } = memoryEvidence();
    const seen: any[] = [];
    const invoke = vi.fn(async (request: any) => { seen.push(request); const input = JSON.parse(request.contents[0].parts[0].text); return { status: 200, text: JSON.stringify({ candidates: [{ content: { parts: [{ text: titleReport(input) }] } }] }) }; });
    // 先跑一遍拿到真实前缀与摘要，再把 batch-0 的 request.json 改成旧形状（openrouter + deepseek）模拟升级前的在途任务。
    const first = memoryEvidence();
    await nameKnowledgeEditionTopics({ markdown: book.full, evidence: first.evidence, invoke: invoke as any });
    const key = Array.from(first.store.keys()).find(k => k.endsWith("/batch-0/request.json"))!;
    const saved = first.store.get(key);
    const old = { ...saved, request: { ...saved.request, executionChannel: "openrouter", executionFamily: "deepseek" } };
    seen.length = 0;
    (evidence as any).save(key, old);
    await nameKnowledgeEditionTopics({ markdown: book.full, evidence, invoke: invoke as any });
    const replay = seen.find(r => JSON.parse(r.contents[0].parts[0].text).source.pages[0].headline === "主题1");
    expect(replay).toMatchObject({ executionChannel: "openrouter", executionFamily: "deepseek" });
  });
});

describe("D2 末段核实修订：GLM 首发链", () => {
  const revisionReport = (input: any) => JSON.stringify({ kind: "knowledge_publication_v1", sourceDigest: input.sourceDigest, title: input.source.title, pages: input.source.pages.map((p: any) => ({
    id: p.id, headline: p.headline, body: "## 方法\n\n修订后的完整步骤与适用条件。", imageDescription: "", imageStatus: "absent", facts: [{ term: "方法", statement: "修订后的完整步骤" }], cautions: [],
  })) }); // 无图末稿修订：路由按完整 body 恢复 reading 结构（同 knowledgePublicationRoutes.test「无图末稿原回包恢复」）。
  const research = async () => ({ status: 200, text: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ verificationMarkdown: "有资料", sources: [{ title: "测试资料", url: "https://example.invalid/source", content: "步骤条件" }] }) }] } }] }) });

  it("修订请求带 GLM 模型族、首页从 EvoLink 起；首跳写坏 → GLM@OpenRouter 成功采用", async () => {
    const { evidence, store } = memoryEvidence("final");
    const calls: Call[] = [];
    const requests: any[] = [];
    const fetch = vi.fn(async (url: any, init: any) => {
      const body = JSON.parse(init.body), channel = channelOf(url);
      calls.push({ channel, model: body.model, input: inputOf(body), body });
      if (channel === "evolink") return jsonResponse(body, '{"pages":[{"body":"缺失结尾');
      return jsonResponse(body, revisionReport(inputOf(body)));
    });
    const invoke = (async (request: any, scope: any) => {
      requests.push(request);
      if (request.researchOnly) return research();
      return invokeKnowledgePublicationRoutes(request, scope, baseDeps(fetch));
    }) as any;
    const source = "# 手册\n\n## 主要重点｜方法\n\n原有步骤。\n\n<!-- 待核：原句「原有步骤」；问题：条件不清楚 -->";
    const [body] = await verifyKnowledgeEditionManuscripts([source], evidence, invoke);
    const revision = requests.find(r => !r.researchOnly);
    expect(revision).toMatchObject({ executionFamily: "glm", executionChannel: "evolink" });
    expect(requests.find(r => r.researchOnly)?.executionChannel).toBe("evolink");
    expect(calls.map(c => `${c.model}@${c.channel}`)).toEqual(["glm-5.3-flashx@evolink", "glm-5.3-flashx@evolink", "z-ai/glm-5.3-flashx@openrouter"]);
    expect(body).toContain("修订后的完整步骤");
    expect(store.get("final/verified.json").issues).toEqual([]);
  });

  it("修订首跳仅保活卡住 → 换另一通道 GLM，不先发 DeepSeek", async () => {
    const { evidence, store } = memoryEvidence("final");
    const calls: Call[] = [];
    const fetch = vi.fn(async (url: any, init: any) => {
      const body = JSON.parse(init.body), channel = channelOf(url);
      calls.push({ channel, model: body.model, input: inputOf(body), body });
      if (channel === "evolink") {
        let timer: ReturnType<typeof setInterval> | undefined;
        const stream = new ReadableStream<Uint8Array>({ start(c) {
          timer = setInterval(() => { try { c.enqueue(new TextEncoder().encode(": keep-alive\n\n")); } catch { clearInterval(timer); } }, 20);
          (init.signal as AbortSignal | undefined)?.addEventListener("abort", () => { clearInterval(timer); try { c.error(new Error("aborted")); } catch { /* 已关闭 */ } });
        } });
        return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
      }
      return jsonResponse(body, revisionReport(inputOf(body)));
    });
    const invoke = (async (request: any, scope: any) => request.researchOnly ? research()
      : invokeKnowledgePublicationRoutes(request, scope, baseDeps(fetch, { keepaliveOnlyTimeoutMs: 150, idleTimeoutMs: 5000 }))) as any;
    const source = "# 手册\n\n## 主要重点｜方法\n\n原有步骤。\n\n<!-- 待核：原句「原有步骤」；问题：条件不清楚 -->";
    const [body] = await verifyKnowledgeEditionManuscripts([source], evidence, invoke);
    expect(calls.map(c => `${c.model}@${c.channel}`)).toEqual(["glm-5.3-flashx@evolink", "z-ai/glm-5.3-flashx@openrouter"]);
    expect(store.get("final/revision-0/route-glm-evolink.json")).toMatchObject({ state: "interrupted", transportCause: "keepalive_only" });
    expect(body).toContain("修订后的完整步骤");
  });
});

describe("D2 旧任务回放：main 上已存的修订请求（openrouter、未设模型族=DeepSeek 首发）原样回放，续做零重买", () => {
  const revisionReport = (input: any) => JSON.stringify({ kind: "knowledge_publication_v1", sourceDigest: input.sourceDigest, title: input.source.title, pages: input.source.pages.map((p: any) => ({
    id: p.id, headline: p.headline, body: "## 方法\n\n修订后的完整步骤与适用条件。", imageDescription: "", imageStatus: "absent", facts: [{ term: "方法", statement: "修订后的完整步骤" }], cautions: [],
  })) });
  const research = async () => ({ status: 200, text: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ verificationMarkdown: "有资料", sources: [{ title: "测试资料", url: "https://example.invalid/source", content: "步骤条件" }] }) }] } }] }) });
  const source = "# 手册\n\n## 主要重点｜方法\n\n原有步骤。\n\n<!-- 待核：原句「原有步骤」；问题：条件不清楚 -->";

  it("旧形状 request.json 按 DeepSeek@OpenRouter 首发回放；回执在、结果丢失时重跑不发任何请求", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (url: any, init: any) => {
      const body = JSON.parse(init.body);
      calls.push(`${body.model}@${channelOf(url)}`);
      return jsonResponse(body, revisionReport(inputOf(body)));
    });
    const invoke = (async (request: any, scope: any) => request.researchOnly ? research() : invokeKnowledgePublicationRoutes(request, scope, baseDeps(fetch))) as any;
    // 新代码先跑一遍拿到真实的检索回执与修订请求，再把修订请求改回 main 的形状并清掉其回执，模拟升级前已落盘、尚未得到回包的任务。
    const fresh = memoryEvidence("final");
    await verifyKnowledgeEditionManuscripts([source], fresh.evidence, invoke);
    const saved = fresh.store.get("final/revision-0/request.json");
    expect(saved.request).toMatchObject({ executionChannel: "evolink", executionFamily: "glm" });
    const { executionFamily: _drop, ...oldRequest } = saved.request;
    const old = memoryEvidence("final");
    for (const [k, v] of Array.from(fresh.store)) if (k.startsWith("final/search-0/") || k === "final/input.json" || k.startsWith("final/candidates-")) old.store.set(k, v);
    old.store.set("final/revision-0/request.json", { ...saved, request: { ...oldRequest, executionChannel: "openrouter" } });
    calls.length = 0;
    const [body] = await verifyKnowledgeEditionManuscripts([source], old.evidence, invoke);
    expect(body).toContain("修订后的完整步骤");
    expect(calls).toEqual(["deepseek/deepseek-v4.1-flash-1017@openrouter"]);
    expect(old.store.get("final/revision-0/request.json").request.executionFamily).toBeUndefined();
    // 进程在保存修订结果前被杀：路由回执已在，修订结果/页检查点/汇总丢失。重跑只读回执，不再购买。
    for (const k of ["final/revision-0/report.json", "final/pages/0.json", "final/verified.json"]) old.store.delete(k);
    calls.length = 0;
    const [again] = await verifyKnowledgeEditionManuscripts([source], old.evidence, invoke);
    expect(calls).toEqual([]);
    expect(again).toBe(body);
  });
});
