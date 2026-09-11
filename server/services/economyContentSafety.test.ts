import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expandPlatformTopicPicks, invokeDeepSeekJsonChatRaw } from "./platformTopicShortlist";
import { runVisualReportLlmAttempts, VisualReportAttemptsError } from "./visualReportLlm";

vi.mock("./platformSkillsService.js", () => ({
  listAllPlatformSkillsForUser: vi.fn(async () => []),
  composePlatformSkillsPromptBlock: vi.fn(() => ""),
}));

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key-openrouter");
  vi.stubEnv("EVOLINK_API_KEY", "test-key-evolink");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function rejectResponse(stream: boolean, reason: string) {
  const text = JSON.stringify({ reportTitle: "不应接受的部分正文", insightSummary: ["部分内容"] });
  return stream
    ? new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
    : new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: reason }] }), { headers: { "content-type": "application/json" } });
}

describe("经济档安全拒绝在全部重试层保持终止", () => {
  it.each([[true, "content_filter"], [true, "sensitive"], [false, "content_filter"], [false, "sensitive"]] as const)(
    "stream=%s finish=%s：只外呼一次并保留失败轨迹", async (stream, reason) => {
      const fetchMock = vi.fn(async () => rejectResponse(stream, reason));
      vi.stubGlobal("fetch", fetchMock);
      const error = await invokeDeepSeekJsonChatRaw({ system: "s", user: "u" }).catch((e) => e);
      expect(error.code).toBe("sse_content_safety");
      expect(error.gatewayTrace).toHaveLength(1);
      expect(error.gatewayTrace[0]).toMatchObject({ gateway: "openrouter", outcome: "failed" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("扩写外层不重发同一条，被拒正文不进入成品或 onItem", async () => {
    const fetchMock = vi.fn(async () => rejectResponse(true, "content_filter"));
    vi.stubGlobal("fetch", fetchMock);
    const onItem = vi.fn();
    await expect(expandPlatformTopicPicks({
      userId: "test-user", engine: "deepseek-v4", onItem,
      picks: [{ id: "test-pick", title: "测试选题", dedupeKey: "test-pick", hookSketch: "测试", primaryLane: "fmcg", formatHint: "图文笔记", skillsUsed: [], conveyGoal: "说明" }] as any,
    })).rejects.toThrow("扩写失败（1 条全部未出）：内容被安全策略拦截");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onItem).not.toHaveBeenCalled();
  });

  it("报表外层保留错误回执与真实次数，不重试已被拒绝的经济档", async () => {
    const fetchMock = vi.fn(async () => rejectResponse(true, "content_filter"));
    vi.stubGlobal("fetch", fetchMock);
    const error = await runVisualReportLlmAttempts({
      systemPrompt: "s", userPrompt: "u", maxTokens: 8192,
      primaryModelName: "test-model", primaryInvoke: () => invokeDeepSeekJsonChatRaw({ system: "s", user: "u" }),
      sleepMs: async () => {},
    }).catch((e) => e);
    expect(error).toBeInstanceOf(VisualReportAttemptsError);
    expect(error.attempts).toHaveLength(1);
    expect(error.attempts[0].gatewayTrace).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
