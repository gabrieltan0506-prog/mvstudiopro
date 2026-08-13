import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeLLM } from "./llm";

const originalFetch = global.fetch;

function completion(model = "gpt-5.6-luna") {
  return { id: "cmpl-1", created: 1, model, choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }] };
}

beforeEach(() => {
  process.env.EVOLINK_API_KEY = "evo-test";
  process.env.OPENAI_API_KEY = "sk-official-test";
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.EVOLINK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  vi.restoreAllMocks();
});

describe("invokeLLM evolink_primary", () => {
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
