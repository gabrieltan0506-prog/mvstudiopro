/**
 * 0923 热修：选 GLM 时挑页走通用提炼通道，原来请求里没有 JSON 约束，
 * GLM 两家都回了提炼稿（「挑页回包不是合法 JSON：## 文艺复兴英国戏剧全景…」）。
 * 现在 OpenRouter 的 GLM / DeepSeek 跳带 response_format json_object；千问跳不加（用户令）、EvoLink 未核不加；
 * 正文提炼请求一律不带。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeKnowledgeCardPageSelector } from "./knowledgeCardDistill";
import { KNOWLEDGE_CARD_DISTILL_MODEL_GLM } from "../../shared/knowledgeCardDistillModels";

const SHEET = [{ index: 1, pageNumbers: [1, 2, 3], imageUrl: "https://signed/s1.jpg", gcsUri: "gs://b/s1.jpg" }];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubKeys() {
  vi.stubEnv("EVOLINK_API_KEY", "e");
  vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "s");
  vi.stubEnv("OPENROUTER_API_KEY", "o");
  vi.stubEnv("KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS", "0");
}

const okJson = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("挑页 JSON 模式（0923 热修）", () => {
  it("选 GLM：OpenRouter GLM / DeepSeek 跳带 json_object；EvoLink、新加坡、OpenRouter 千问不带", async () => {
    stubKeys();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bodies: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push({ url: String(input), body: JSON.parse(String(init?.body || "{}")) });
      // 前五跳都 503，第六跳（OpenRouter 千问）成功：六跳的请求体都能看到
      if (bodies.length < 6) return new Response("down", { status: 503 });
      return okJson('{"pages":[{"page":2,"reason":"表格"}]}');
    }));
    const picked = await makeKnowledgeCardPageSelector(KNOWLEDGE_CARD_DISTILL_MODEL_GLM)(SHEET as never, 3);
    expect(picked).toEqual([{ pageNumber: 2, reason: "表格" }]);
    expect(bodies).toHaveLength(6);
    const rf = bodies.map((b) => {
      const host = new URL(b.url).hostname;
      const model = String(b.body.model);
      return `${host}|${model}|${JSON.stringify(b.body.response_format ?? null)}`;
    });
    // 顺序：OR·GLM → EvoLink·GLM → OR·DeepSeek → EvoLink·DeepSeek → 新加坡·千问 → OR·千问
    expect(rf[0]).toMatch(/^openrouter\.ai\|z-ai\/glm.*\|\{"type":"json_object"\}$/);
    expect(rf[1]).toMatch(/evolink.*\|null$/);
    expect(rf[2]).toMatch(/^openrouter\.ai\|deepseek\/.*\|\{"type":"json_object"\}$/);
    expect(rf[3]).toMatch(/evolink.*\|null$/);
    expect(rf[4]).toMatch(/\|null$/);
    expect(rf[5]).toMatch(/^openrouter\.ai\|qwen\/.*\|null$/);
    // OpenRouter GLM 仍锁 Z.AI 自营
    expect(bodies[0]!.body.provider).toMatchObject({ order: ["Z.AI"], allow_fallbacks: false });
  });
});
