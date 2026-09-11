import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDistillLlmPossiblyChunked, makeKnowledgeCardPageSelector } from "./knowledgeCardDistill";

const markdown = "## 测试小节\n图：流程图\n- 第一条足够长的知识要点\n- 第二条足够长的知识要点";
const request = (sourceText = "测试原文。".repeat(40)) => invokeDistillLlmPossiblyChunked({
  sourceText, extraText: "", imageUrls: [], documents: [], modelName: "glm-5.3-flash",
  minSectionsTotal: 2, detailLevel: "full",
});
const response = (finish_reason = "stop") => new Response(JSON.stringify({
  choices: [{ message: { content: markdown }, finish_reason }],
}), { status: 200 });

beforeEach(() => {
  for (const key of ["EVOLINK_API_KEY", "OPENROUTER_API_KEY", "DASHSCOPE_SG_PLAN_KEY"]) vi.stubEnv(key, "test-key");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("主提炼真实模型路由与安全终止", () => {
  it("GLM 档首跳失败后调用合法同名的 EvoLink GLM，不错误降档", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return calls.length === 1 ? new Response("busy", { status: 503 }) : response();
    }));
    expect(await request()).toBe(markdown);
    expect(calls.map((c) => [new URL(c.url).hostname, c.body.model])).toEqual([
      ["openrouter.ai", "z-ai/glm-5.3-flash"],
      ["direct.evolink.ai", "glm-5.3-flash"],
    ]);
    expect(calls[1]!.body).toMatchObject({ temperature: 0.7, reasoning_effort: "high", stream: true });
  });

  it.each(["content_filter", "sensitive"])("普通 JSON 的 %s 立即终止，不换供应商", async (finish) => {
    const fetch = vi.fn(async () => response(finish));
    vi.stubGlobal("fetch", fetch);
    await expect(request()).rejects.toMatchObject({ code: "sse_content_safety" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["content_filter", "sensitive"])("SSE 的 %s 立即终止，不按断流重试", async (finish) => {
    const fetch = vi.fn(async () => new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: markdown }, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "content-type": "text/event-stream" } },
    ));
    vi.stubGlobal("fetch", fetch);
    await expect(request()).rejects.toMatchObject({ code: "sse_content_safety" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("挑页安全拒绝不被整组无参考页降级吞掉", async () => {
    const fetch = vi.fn(async () => response("content_filter"));
    vi.stubGlobal("fetch", fetch);
    await expect(makeKnowledgeCardPageSelector("glm-5.3-flash")([
      { index: 1, pageNumbers: [1], imageUrl: "https://example.invalid/sheet.jpg", gcsUri: "gs://test/sheet.jpg" },
    ], 1)).rejects.toMatchObject({ code: "sse_content_safety" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("分段成功后统稿安全拒绝：终止而非保留原稿当成功", async () => {
    let calls = 0;
    const fetch = vi.fn(async () => response(++calls <= 2 ? "stop" : "sensitive"));
    vi.stubGlobal("fetch", fetch);
    await expect(request("测试原文。".repeat(5_000))).rejects.toMatchObject({ code: "sse_content_safety" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
