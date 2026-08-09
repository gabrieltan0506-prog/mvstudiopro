import { afterEach, describe, expect, it, vi } from "vitest";

// 用例体内 await import 重模块，全量并发下 transform 成本计入 5s 默认预算（负载抽签）
vi.setConfig({ testTimeout: 60_000 });

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("./gpt56CopywritingGateway.js", () => ({
  getEvolinkApiKey: () => "evolink-test-key",
  getOpenRouterChatHeaders: () => ({ "X-Test": "1" }),
  OPENROUTER_CHAT_COMPLETIONS_URL: "https://openrouter.example/v1/chat/completions",
}));

vi.mock("./openrouterGptImage2.js", () => ({
  getOpenRouterApiKey: () => "openrouter-test-key",
}));

function chatResponse(text: string, opts?: { finishReason?: string; completionTokens?: number }) {
  return {
    ok: true,
    text: async () =>
      JSON.stringify({
        id: "chatcmpl-test",
        created: 0,
        model: "test-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: text },
            finish_reason: opts?.finishReason ?? "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: opts?.completionTokens ?? 20, total_tokens: 30 },
      }),
  };
}

describe("manhuaWriterExpandRun", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("treats finish_reason=length as a failure and does not return the truncated text", async () => {
    fetchMock
      .mockResolvedValueOnce(chatResponse("half a script...", { finishReason: "length" }))
      .mockResolvedValueOnce(chatResponse("full backup-channel script", { finishReason: "stop" }));
    const { runManhuaWriterExpand } = await import("./manhuaWriterExpandRun.js");
    const text = await runManhuaWriterExpand({
      prompt: "write it",
      tier: "excellent",
      episodeCount: 1,
    });
    expect(text).toBe("full backup-channel script");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails outright when every channel is truncated", async () => {
    fetchMock.mockResolvedValue(chatResponse("half a script...", { finishReason: "length" }));
    const { runManhuaWriterExpand, MANHUA_WRITER_EXPAND_CAPACITY_MESSAGE } = await import(
      "./manhuaWriterExpandRun.js"
    );
    await expect(
      runManhuaWriterExpand({ prompt: "write it", tier: "excellent", episodeCount: 1 }),
    ).rejects.toThrow(MANHUA_WRITER_EXPAND_CAPACITY_MESSAGE);
  });

  it("routes the top tier through Evolink first (OpenRouter is TOS-blocked for OpenAI models)", async () => {
    fetchMock.mockResolvedValueOnce(chatResponse("top tier script"));
    const { runManhuaWriterExpand } = await import("./manhuaWriterExpandRun.js");
    await runManhuaWriterExpand({ prompt: "write it", tier: "top", episodeCount: 1 });
    const firstUrl = String(fetchMock.mock.calls[0]![0]);
    expect(firstUrl).toContain("evolink");
  });

  it("routes the superb tier through OpenRouter first", async () => {
    fetchMock.mockResolvedValueOnce(chatResponse("superb tier script"));
    const { runManhuaWriterExpand } = await import("./manhuaWriterExpandRun.js");
    await runManhuaWriterExpand({ prompt: "write it", tier: "superb", episodeCount: 1 });
    const firstUrl = String(fetchMock.mock.calls[0]![0]);
    expect(firstUrl).toContain("openrouter");
  });
});
