import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("./gpt56CopywritingGateway.js", () => ({
  getOfficialOpenAiApiKey: () => "sk-test-official-key-for-unit",
}));

vi.mock("./evolinkChatModel.js", () => ({
  EVOLINK_CHAT_MODEL_GPT56_SOL: "gpt-5.6-sol",
  getEvolinkGpt56SolModel: () => "gpt-5.6-sol",
  normalizeEvolinkChatModel: (m: string) => m || "gpt-5.6-sol",
}));

vi.mock("../_core/llm.js", () => ({
  extractFirstChoicePlainText: () => "fallback-chat-text",
  invokeLLM: vi.fn(async () => ({})),
}));

describe("invokeGpt56Responses", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("parses output_text from official Responses and sends pro reasoning", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "resp_test_1",
        output_text: "hello from responses",
      }),
    });
    const { invokeGpt56Responses } = await import("./gpt56ResponsesClient.js");
    const r = await invokeGpt56Responses({
      input: "ping",
      reasoningMode: "pro",
      reasoningEffort: "medium",
      store: false,
      fallbackChatCompletions: false,
    });
    expect(r.text).toBe("hello from responses");
    expect(r.via).toBe("responses");
    expect(r.reasoningMode).toBe("pro");
    expect(r.responseId).toBe("resp_test_1");
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.reasoning).toEqual({ mode: "pro", effort: "medium" });
    expect(body.store).toBe(false);
  });

  it("falls back to chat completions when Responses fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "boom" } }),
    });
    const { invokeGpt56Responses } = await import("./gpt56ResponsesClient.js");
    const r = await invokeGpt56Responses({
      input: "ping",
      reasoningMode: "pro",
    });
    expect(r.via).toBe("chat_completions");
    expect(r.text).toBe("fallback-chat-text");
    expect(r.reasoningMode).toBe("standard");
  });
});
