import { afterEach, describe, expect, it, vi } from "vitest";

// 用例体内 await import 重模块，全量并发下 transform 成本计入 5s 默认预算（负载抽签）
vi.setConfig({ testTimeout: 60_000 });

const llmMock = vi.hoisted(() => vi.fn());
vi.mock("../_core/llm.js", async () => ({ ...await vi.importActual("../_core/llm.js"), invokeLLM: llmMock }));
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
    llmMock.mockReset();
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

  it("优秀档 Qwen 剧本候选保持 medium 推理档", async () => {
    fetchMock.mockResolvedValueOnce(chatResponse("完整测试剧本"));
    const { runManhuaWriterExpand } = await import("./manhuaWriterExpandRun.js");
    await runManhuaWriterExpand({ prompt: "候选剧本", tier: "excellent", episodeCount: 1 });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.model).toBe("qwen3.8-max");
    expect(body.reasoning_effort).toBe("medium");
    expect(body).not.toHaveProperty("thinking_budget");
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

  it("卓越档先GLM再DeepSeek，四跳有界且不返回截断稿", async () => {
    llmMock.mockRejectedValueOnce(new Error("暂时不可用"))
      .mockResolvedValueOnce({ choices: [{ message: { content: "截断稿" }, finish_reason: "length" }] })
      .mockRejectedValueOnce(new Error("暂时不可用"))
      .mockResolvedValueOnce({ choices: [{ message: { content: "完整剧本" }, finish_reason: "stop" }] });
    const { runManhuaWriterExpand } = await import("./manhuaWriterExpandRun.js");
    expect(await runManhuaWriterExpand({ prompt: "write it", tier: "superb", episodeCount: 1 })).toBe("完整剧本");
    expect(llmMock.mock.calls.map(([p]) => [p.modelName, p.openAiGateway, p.reasoningEffort])).toEqual([
      ["z-ai/glm-5.3-flashx", "auto", "low"], ["glm-5.3-flashx", "evolink_flash_only", "low"],
      ["deepseek/deepseek-v4.1-flash", "auto", "none"], ["deepseek-v4.1-flash", "evolink_flash_only", "none"],
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
