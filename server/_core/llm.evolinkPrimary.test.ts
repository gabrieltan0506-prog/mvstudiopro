import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeLLM } from "./llm";

const originalFetch = global.fetch;

function completion(model = "gpt-5.6-luna") {
  return { id: "cmpl-1", created: 1, model, choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }] };
}

beforeEach(() => {
  process.env.EVOLINK_API_KEY = "evo-test";
  process.env.OPENAI_API_KEY = "sk-official-test";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.EVOLINK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  vi.restoreAllMocks();
});

describe("invokeLLM evolink_primary", () => {
  it("GLM 5.3 千条分类：medium 按官方口径降为 high，不自行补 temperature/top_p", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...completion("z-ai/glm-5.3"),
      provider: "DeepSeek",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    global.fetch = fetchMock as typeof fetch;
    await invokeLLM({
      model: "pro", provider: "openai", modelName: "z-ai/glm-5.3",
      reasoningEffort: "medium", max_tokens: 65_536,
      response_format: { type: "json_object" },
      openRouterProviderPreferences: { require_parameters: true },
      messages: [{ role: "user", content: "test" }],
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toMatchObject({
      model: "z-ai/glm-5.3",
      max_tokens: 65_536,
      response_format: { type: "json_object" },
      // 0911：GLM 跳锁 Z.AI 自营，调用方偏好并进去
      provider: { order: ["Z.AI"], allow_fallbacks: false, require_parameters: true },
    });
    // GLM 5.3 只认 low/high/max：medium 按官方口径发 high，不发一个会被静默降级的值
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
  });

  it("GLM 5.3 明确开启 High thinking、锁 Z.AI 自营，并忽略不兼容采样参数", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...completion("z-ai/glm-5.3"),
      provider: "DeepSeek",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.01, completion_tokens_details: { reasoning_tokens: 5 } },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    global.fetch = fetchMock as typeof fetch;
    const result = await invokeLLM({
      model: "pro", provider: "openai", modelName: "z-ai/glm-5.3",
      reasoningEffort: "high", requestId: "ds-stable-id", max_tokens: 100_000, temperature: 1,
      response_format: { type: "json_object" },
      openRouterProviderPreferences: { require_parameters: true, data_collection: "allow", max_price: { prompt: 0.5, completion: 1 } },
      messages: [{ role: "user", content: "test" }],
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(fetchMock.mock.calls[0][0]).toContain("openrouter.ai");
    expect(body).toMatchObject({
      model: "z-ai/glm-5.3",
      max_tokens: 100_000,
      response_format: { type: "json_object" },
      provider: {
        order: ["Z.AI"],
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: "allow",
        max_price: { prompt: 0.5, completion: 1 },
      },
    });
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(result.usage).toMatchObject({ cost: 0.01, completion_tokens_details: { reasoning_tokens: 5 } });
  });

  it("EvoLink 可重试失败时只回落官方一次并复用 requestId", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(completion()), { status: 200, headers: { "content-type": "application/json" } }));
    global.fetch = fetchMock as typeof fetch;
    const result = await invokeLLM({
      model: "pro", provider: "openai", modelName: "gpt-5.6-luna", reasoningEffort: "low",
      openAiGateway: "evolink_primary", requestId: "batch-stable-id", messages: [{ role: "user", content: "test" }],
    });
    expect(result.provider).toBe("openai");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("evolink.ai");
    expect(fetchMock.mock.calls[1][0]).toContain("api.openai.com");
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).headers).toMatchObject({ "x-request-id": "batch-stable-id", "idempotency-key": "batch-stable-id" });
    }
  });

  it("EvoLink 4xx 参数错误不回落官方，也不触碰 OpenRouter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "bad schema" } }), { status: 400, headers: { "content-type": "application/json" } }));
    global.fetch = fetchMock as typeof fetch;
    await expect(invokeLLM({
      model: "pro", provider: "openai", modelName: "gpt-5.6-terra", reasoningEffort: "high",
      openAiGateway: "evolink_primary", requestId: "job-stable-id", messages: [{ role: "user", content: "test" }],
    })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("evolink.ai");
    expect(fetchMock.mock.calls.flat().join(" ")).not.toContain("openrouter.ai");
  });
});
