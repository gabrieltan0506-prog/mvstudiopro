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
  it("DeepSeek V4 Pro 0813 明确开启 High thinking，并透传JSON、100K与价格帽", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...completion("deepseek/deepseek-v4-pro-0813"),
      provider: "DeepSeek",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.01, completion_tokens_details: { reasoning_tokens: 5 } },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    global.fetch = fetchMock as typeof fetch;
    const result = await invokeLLM({
      model: "pro", provider: "openai", modelName: "deepseek/deepseek-v4-pro-0813",
      reasoningEffort: "high", requestId: "ds-stable-id", max_tokens: 100_000, temperature: 1,
      response_format: { type: "json_object" },
      openRouterProviderPreferences: { require_parameters: true, data_collection: "allow", max_price: { prompt: 0.5, completion: 1 } },
      messages: [{ role: "user", content: "test" }],
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(fetchMock.mock.calls[0][0]).toContain("openrouter.ai");
    expect(body).toMatchObject({
      model: "deepseek/deepseek-v4-pro-0813",
      reasoning: { effort: "high", exclude: true },
      max_tokens: 100_000,
      temperature: 1,
      response_format: { type: "json_object" },
      provider: { require_parameters: true, data_collection: "allow", max_price: { prompt: 0.5, completion: 1 } },
    });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.max_completion_tokens).toBeUndefined();
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
