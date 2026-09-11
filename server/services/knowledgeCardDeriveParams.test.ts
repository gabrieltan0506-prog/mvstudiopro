/**
 * 终审 P2 回归（0911 第二轮）：派生链各跳的**请求参数契约**按 (gateway, tier) 定。
 * 走真实 deriveChat/chatOnce（只 stub fetch），不替换内部 chat——防止只在包装层修对、真实适配层照旧发错参数。
 * 关键：EvoLink 的 Qwen 末跳必须发 EvoLink-Qwen 契约
 * （enable_thinking / reasoning_effort:"medium" / max_completion_tokens），
 * 不是 DeepSeek 那套（thinking:{type:"enabled"} / max_tokens 翻倍）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveKnowledgeCardCompact } from "./knowledgeCardLevelDerive";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const stubKeys = () => {
  vi.stubEnv("EVOLINK_API_KEY", "e-key");
  vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "s-key");
  vi.stubEnv("OPENROUTER_API_KEY", "o-key");
};

const section = (n: number) =>
  `## 第${n}节\n图：示意 ${n}\n- 要点 ${n}\n\n| A | B |\n| - | - |\n| ${n} | ${n} |\n\n`;
const FULL = `前言\n\n${[1, 2, 3, 4, 5].map(section).join("")}`;
const PICKED = [1, 2, 3].map(section).join("");

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 });

type Recorded = { url: string; body: Record<string, unknown> };

function recordFetch(responses: Array<() => Response>) {
  const calls: Recorded[] = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    const next = responses[calls.length - 1];
    if (!next) throw new Error(`多余的第 ${calls.length} 次请求`);
    return next();
  });
  vi.stubGlobal("fetch", spy);
  return { calls, spy };
}

/** 造一条与上游同形的 SSE 流：逐 token 发 delta，末帧带 finish_reason 与 usage */
const sse = (content: string) => {
  const frames = [...content.match(/[\s\S]{1,40}/g) || []].map((piece) =>
    `data: ${JSON.stringify({ model: "m", choices: [{ delta: { content: piece } }] })}\n\n`,
  );
  frames.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { completion_tokens: 9 } })}\n\n`);
  frames.push("data: [DONE]\n\n");
  return new Response(frames.join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
};

describe("派生链流式输出（0911 用户令：全链改流式）", () => {
  it("发 stream:true + stream_options，SSE 分帧正文被还原成整份稿子", async () => {
    stubKeys();
    const { calls } = recordFetch([() => sse(PICKED)]);
    const r = await deriveKnowledgeCardCompact({ fullMarkdown: FULL, targetSections: 3 });
    expect(r.sections).toBe(3);
    expect(r.markdown).toContain("## 第1节");
    expect(r.markdown).toContain("## 第3节");
    expect(calls[0]!.body.stream).toBe(true);
    expect(calls[0]!.body.stream_options).toEqual({ include_usage: true });
  });

  it("上游忽略 stream 直接回 JSON 时照常解析，不交白卷", async () => {
    stubKeys();
    const { calls } = recordFetch([() => ok(PICKED)]);
    const r = await deriveKnowledgeCardCompact({ fullMarkdown: FULL, targetSections: 3 });
    expect(r.sections).toBe(3);
    expect(calls[0]!.body.stream).toBe(true);
  });
});

describe("派生链真实适配层参数契约（终审 P2）", () => {
  it("选 GLM：OpenRouter GLM 503 → EvoLink GLM 503 → OpenRouter DeepSeek 成功；各跳参数契约分别正确", async () => {
    stubKeys();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls } = recordFetch([
      () => new Response("upstream busy", { status: 503 }),
      () => new Response("upstream busy", { status: 503 }),
      () => ok(PICKED),
    ]);
    const r = await deriveKnowledgeCardCompact({ fullMarkdown: FULL, targetSections: 3, model: "glm-5.3-flash" });
    expect(r.sections).toBe(3);
    // 0911 用户令：同模型 OpenRouter 先、EvoLink 兜底
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual([
      "openrouter.ai",
      "direct.evolink.ai",
      "openrouter.ai",
    ]);
    // 第一跳（OpenRouter GLM）：锁 Z.AI 自营
    const orGlm = calls[0]!.body;
    expect(orGlm.model).toBe("z-ai/glm-5.3-flash");
    expect(orGlm.provider).toEqual({ order: ["Z.AI"], allow_fallbacks: false, require_parameters: true });
    expect(orGlm.reasoning).toEqual({ effort: "high" });
    // 第二跳（EvoLink GLM）：恒开思考不发 thinking 开关，只发 reasoning_effort
    const evoGlm = calls[1]!.body;
    expect(evoGlm.model).toBe("glm-5.3-flash");
    expect(evoGlm.reasoning_effort).toBe("high");
    expect(evoGlm.max_tokens).toBe(8_000);
    expect("thinking" in evoGlm).toBe(false);
    expect("enable_thinking" in evoGlm).toBe(false);
    // 第三跳（OpenRouter DeepSeek）：锁 DeepSeek 自营，max_tokens 翻倍留给思维链
    const orDs = calls[2]!.body;
    expect(orDs.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(orDs.provider).toEqual({ order: ["DeepSeek"], allow_fallbacks: false });
    expect(orDs.reasoning).toEqual({ effort: "high" });
    expect(orDs.max_tokens).toBe(16_000);
    expect(orDs.temperature).toBe(0.2);
  });

  it("末跳 OpenRouter Qwen（两档四跳都挂之后）：max_tokens 不吃 DeepSeek 翻倍、不带 provider 锁", async () => {
    stubKeys();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls } = recordFetch([
      () => new Response("down", { status: 503 }),
      () => new Response("down", { status: 503 }),
      () => new Response("down", { status: 503 }),
      () => new Response("down", { status: 503 }),
      () => new Response("down", { status: 503 }),
      () => ok(PICKED),
    ]);
    const r = await deriveKnowledgeCardCompact({ fullMarkdown: FULL, targetSections: 3 });
    expect(r.sections).toBe(3);
    // 共享顺序里没有 evolink:qwen 跳；这里验的是真实末跳 OpenRouter Qwen 的契约
    const lastBody = calls[calls.length - 1]!.body;
    expect(lastBody.model).toBe("qwen/qwen3.8-max");
    expect(lastBody.max_tokens).toBe(8_000);
    expect("provider" in lastBody).toBe(false);
  });

  it("EvoLink DeepSeek 跳（OpenRouter 挂了才轮到）：thinking:{type:enabled} + reasoning_effort high + max_tokens 翻倍", async () => {
    stubKeys();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls } = recordFetch([() => new Response("or down", { status: 503 }), () => ok(PICKED)]);
    const r = await deriveKnowledgeCardCompact({ fullMarkdown: FULL, targetSections: 3 });
    expect(r.sections).toBe(3);
    expect(new URL(calls[1]!.url).hostname).toBe("direct.evolink.ai");
    const body = calls[1]!.body;
    expect(body.model).toBe("deepseek-v4.1-flash");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
    // maxTokens=8000（小样本下限）→ DeepSeek 档翻倍 16000 留给思维链
    expect(body.max_tokens).toBe(16_000);
    expect("enable_thinking" in body).toBe(false);
    expect("max_completion_tokens" in body).toBe(false);
    // EvoLink 不是 OpenRouter，不带 provider 字段
    expect("provider" in body).toBe(false);
  });

  it("OpenRouter DeepSeek 首跳：模型是 V4.1 Flash，provider 锁 DeepSeek 自营且不许回落（0911 用户令）", async () => {
    stubKeys();
    const { calls } = recordFetch([() => ok(PICKED)]);
    const r = await deriveKnowledgeCardCompact({ fullMarkdown: FULL, targetSections: 3 });
    expect(r.sections).toBe(3);
    expect(new URL(calls[0]!.url).hostname).toBe("openrouter.ai");
    const body = calls[0]!.body;
    expect(body.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(body.provider).toEqual({ order: ["DeepSeek"], allow_fallbacks: false });
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.max_tokens).toBe(16_000);
  });
});

describe("挑页与经济档也走流式（0911 用户令）", () => {
  it("挑页：SSE 还原出合法 JSON 页表，请求带 stream:true", async () => {
    stubKeys();
    const { invokePageTriageJson } = await import("./knowledgeCardPageTriage");
    const { calls } = recordFetch([() => sse('{"pages":[{"page":5,"reason":"图解"}]}')]);
    const out = await invokePageTriageJson({ system: "s", userText: "u", imageUrls: ["https://x/1.jpg"] });
    expect(out).toContain('"page":5');
    expect(calls[0]!.body.stream).toBe(true);
    expect(calls[0]!.body.stream_options).toEqual({ include_usage: true });
  });

  it("经济档 JSON 通道：SSE 还原出业务 JSON，请求带 stream:true", async () => {
    stubKeys();
    const { invokeDeepSeekJsonChatRaw } = await import("./platformTopicShortlist");
    const payload = JSON.stringify({ items: [{ title: "一个够长的业务标题", reason: "够长的理由文本" }] });
    const { calls } = recordFetch([() => sse(payload)]);
    const json = await invokeDeepSeekJsonChatRaw({ system: "s", user: "u" });
    expect(String(json.choices?.[0]?.message?.content)).toContain("业务标题");
    expect(calls[0]!.body.stream).toBe(true);
    expect(new URL(calls[0]!.url).hostname).toBe("openrouter.ai");
  });

  it("经济档：OpenRouter 挂了落 EvoLink 同款 glm-5.3（0911 用户令：OpenRouter 优先）", async () => {
    stubKeys();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const payload = JSON.stringify({ items: [{ title: "一个够长的业务标题", reason: "够长的理由文本" }] });
    const { calls } = recordFetch([
      () => new Response("or down", { status: 503 }),
      () => sse(payload),
    ]);
    await invokeEconomy();
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual(["openrouter.ai", "direct.evolink.ai"]);
    expect(calls[1]!.body.model).toBe("glm-5.3");
    expect(calls[1]!.body.stream).toBe(true);
  });
});

async function invokeEconomy() {
  const { invokeDeepSeekJsonChatRaw } = await import("./platformTopicShortlist");
  return invokeDeepSeekJsonChatRaw({ system: "s", user: "u" });
}
