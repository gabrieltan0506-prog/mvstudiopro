/**
 * 趋势报表经济档切换（2026-08-18 用户拍板）：报表主力 DeepSeek,兜底 GLM-5.2 三网关(K3 出局)。
 * 验证共用通道 invokeDeepSeekJsonChatRaw 的守门行为——缺钥匙快败、截断必拒、
 * 业务 JSON 非法必拒（不许空壳流下游），合法响应原样返回供遥测复用。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDeepSeekJsonChatRaw } from "./platformTopicShortlist";

const VALID_CONTENT = JSON.stringify({ reportTitle: "测试报表", insightSummary: [] });

function mockFetchOnce(payload: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status,
      text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
    })),
  );
}

describe("invokeDeepSeekJsonChatRaw（报表/扩写共用经济档通道）", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("缺 OPENROUTER_API_KEY 立即快败", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    await expect(invokeDeepSeekJsonChatRaw({ system: "s", user: "u" })).rejects.toThrow("经济档通道未配置");
  });

  it("finish_reason=length（预算耗尽截断）必须拒绝", async () => {
    mockFetchOnce({ choices: [{ message: { content: VALID_CONTENT }, finish_reason: "length" }] });
    await expect(invokeDeepSeekJsonChatRaw({ system: "s", user: "u" })).rejects.toThrow("截断");
  });

  it("content 不是合法业务 JSON 必须拒绝（防空壳流下游）", async () => {
    mockFetchOnce({ choices: [{ message: { content: "抱歉，我无法完成这个请求，这不是一个JSON。" }, finish_reason: "stop" }] });
    await expect(invokeDeepSeekJsonChatRaw({ system: "s", user: "u" })).rejects.toThrow("JSON 解析失败");
  });

  it("合法响应原样返回 choices/usage 供报表遥测复用", async () => {
    mockFetchOnce({
      choices: [{ message: { content: VALID_CONTENT }, finish_reason: "stop" }],
      usage: { prompt_tokens: 123, completion_tokens: 456 },
      model: "deepseek/deepseek-v4-pro-0813",
    });
    const res = await invokeDeepSeekJsonChatRaw({ system: "s", user: "u" });
    expect(res.usage?.prompt_tokens).toBe(123);
    expect(res.usage?.completion_tokens).toBe(456);
    expect(String(res.choices?.[0]?.message?.content)).toContain("reportTitle");
  });

  it("fetch 契约:maxTokens 进请求体、外部 abort 信号并入 fetch signal(复审建议3)", async () => {
    mockFetchOnce({ choices: [{ message: { content: VALID_CONTENT }, finish_reason: "stop" }] });
    const ac = new AbortController();
    ac.abort();
    await invokeDeepSeekJsonChatRaw({ system: "s", user: "u", maxTokens: 12_345, abortSignal: ac.signal }).catch(() => null);
    const fetchMock = vi.mocked(fetch as any);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body)).max_tokens).toBe(12_345);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect((init?.signal as AbortSignal).aborted).toBe(true);
  });
});
