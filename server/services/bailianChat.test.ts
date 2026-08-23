/**
 * GLM GLM-5.3 链回归(复审三轮 P1-5):成功短路/HTTP 失败降级/业务验真失败降级/
 * abort 停链/全灭带完整轨迹/参数透传。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlmGatewayError, invokeGlmJsonChatWithGatewayFallback } from "./bailianChat";

const GOOD = JSON.stringify({ reportTitle: "报表", insightSummary: [{ role: "判断", title: "t", description: "d" }], trackGrowth: [{ name: "n", growth: "+1%" }] });
const okBody = (content: string, model = "glm-5.3") =>
  JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2 }, model });

function stubFetchSeq(handlers: Array<(url: string, init: any) => { ok: boolean; status: number; body: string }>) {
  let i = 0;
  const calls: Array<{ url: string; init: any }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      const h = handlers[Math.min(i, handlers.length - 1)];
      i += 1;
      const r = h(String(url), init);
      return { ok: r.ok, status: r.status, text: async () => r.body };
    }),
  );
  return calls;
}

describe("invokeGlmJsonChatWithGatewayFallback(GLM-5.3 链)", () => {
  beforeEach(() => {
    vi.stubEnv("WAN_OFFICIAL_BASE", "https://ws.example.cn");
    vi.stubEnv("WAN_OFFICIAL_API_KEY", "bl-key");
    vi.stubEnv("DASHSCOPE_SG_BASE", "https://sg.example.com");
    vi.stubEnv("DASHSCOPE_SG_API_KEY", "sg-key");
    vi.stubEnv("EVOLINK_API_KEY", "evo-key");
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("百炼成功即短路:只发一次外呼,gateway=bailian,轨迹一条 ok", async () => {
    const calls = stubFetchSeq([() => ({ ok: true, status: 200, body: okBody(GOOD) })]);
    const r = await invokeGlmJsonChatWithGatewayFallback({ system: "s", user: "u" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("ws.example.cn/compatible-mode");
    expect(r.gateway).toBe("bailian");
    expect(r.gatewayTrace).toEqual([{ gateway: "bailian", model: "ZHIPU/GLM-5.3", outcome: "ok" }]);
  });

  it("北京百炼 HTTP 500 后降级新加坡百炼成功（顺位：北京→新加坡→OpenRouter）", async () => {
    const calls = stubFetchSeq([
      () => ({ ok: false, status: 500, body: "boom" }),
      () => ({ ok: true, status: 200, body: okBody(GOOD) }),
    ]);
    const r = await invokeGlmJsonChatWithGatewayFallback({ system: "s", user: "u" });
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("sg.example.com/compatible-mode");
    expect(r.gateway).toBe("bailian_sg");
    expect(r.gatewayTrace[0]).toMatchObject({ gateway: "bailian", outcome: "http_error" });
  });

  it("HTTP 200 但业务验真失败时继续降级(复审 P1-1 核心)", async () => {
    const calls = stubFetchSeq([
      () => ({ ok: true, status: 200, body: okBody("抱歉这不是报表 JSON") }),
      () => ({ ok: true, status: 200, body: okBody(GOOD) }),
    ]);
    const r = await invokeGlmJsonChatWithGatewayFallback({
      system: "s",
      user: "u",
      validateContent: (text) => {
        if (!text.startsWith("{")) throw new Error("业务 JSON 非法");
      },
    });
    expect(calls).toHaveLength(2);
    expect(r.gateway).toBe("bailian_sg");
    expect(r.gatewayTrace[0]).toMatchObject({ gateway: "bailian", outcome: "content_invalid" });
  });

  it("空 content 视为失败继续降级,不得当成功", async () => {
    const calls = stubFetchSeq([
      () => ({ ok: true, status: 200, body: okBody("") }),
      () => ({ ok: true, status: 200, body: okBody(GOOD) }),
    ]);
    const r = await invokeGlmJsonChatWithGatewayFallback({ system: "s", user: "u" });
    expect(calls).toHaveLength(2);
    expect(r.gatewayTrace[0]).toMatchObject({ gateway: "bailian", outcome: "empty_content" });
  });

  it("首网关失败后若已 abort,不再调用下一网关", async () => {
    const ac = new AbortController();
    stubFetchSeq([
      () => {
        ac.abort();
        return { ok: false, status: 500, body: "boom" };
      },
    ]);
    const err = await invokeGlmJsonChatWithGatewayFallback({ system: "s", user: "u", abortSignal: ac.signal }).catch((e) => e);
    expect(err).toBeInstanceOf(GlmGatewayError);
    expect(err.message).toContain("硬截止");
    expect(vi.mocked(fetch as any).mock.calls).toHaveLength(1);
  });

  it("全链失败:GlmGatewayError 带完整轨迹(含 Wan official / EvoLink 两档 Qwen);max_tokens/model/signal 透传正确", async () => {
    const calls = stubFetchSeq([() => ({ ok: false, status: 502, body: "bad" })]);
    const err = await invokeGlmJsonChatWithGatewayFallback({ system: "s", user: "u", maxTokens: 12_345 }).catch((e) => e);
    expect(err).toBeInstanceOf(GlmGatewayError);
    expect(err.gatewayTrace.map((t: any) => t.gateway)).toEqual([
      "bailian",
      "bailian_sg",
      "openrouter",
      "bailian_qwen",
      "evolink_qwen",
    ]);
    expect(err.gatewayTrace.every((t: any) => t.outcome === "http_error")).toBe(true);
    const body0 = JSON.parse(String(calls[0].init?.body));
    expect(body0.max_tokens).toBe(12_345);
    expect(body0.model).toBe("ZHIPU/GLM-5.3");
    // calls[1]=新加坡百炼（同为 ZHIPU/GLM-5.3），calls[2]=OpenRouter（独立命名）
    const body1 = JSON.parse(String(calls[1].init?.body));
    expect(body1.model).toBe("ZHIPU/GLM-5.3");
    const body2 = JSON.parse(String(calls[2].init?.body));
    expect(body2.model).toBe("z-ai/glm-5.3");
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });
});
