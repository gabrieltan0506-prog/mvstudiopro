import { afterEach, expect, it, vi } from "vitest";
import { invokeLLM } from "./llm";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("one-shot vision records raw before parsing and never falls back after archive or network uncertainty", async () => {
  vi.stubEnv("OPENAI_API_KEY", "sk-offline-test");
  vi.stubEnv("EVOLINK_API_KEY", "sk-offline-backup-test");
  const fetchMock = vi.fn(
    async () =>
      new Response(
        '{"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}]}',
        { status: 200, headers: { "content-type": "application/json" } }
      )
  );
  vi.stubGlobal("fetch", fetchMock);
  const events: string[] = [];
  const params = {
    provider: "openai" as const,
    modelName: "gpt-5.6-terra",
    openAiGateway: "official_only" as const,
    singleAttempt: true,
    messages: [{ role: "user" as const, content: "test" }],
    onPreparedRequest: async () => {
      events.push("request");
    },
    onRawCompletion: async (raw: { text: string }) => {
      events.push("raw");
      expect(raw.text).toContain("choices");
      throw new Error("archive unavailable");
    },
  };
  await expect(invokeLLM(params)).rejects.toThrow("archive unavailable");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(events).toEqual(["request", "raw"]);
  fetchMock.mockRejectedValueOnce(new Error("network unknown"));
  await expect(
    invokeLLM({ ...params, onRawCompletion: async () => {} })
  ).rejects.toThrow("network unknown");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
