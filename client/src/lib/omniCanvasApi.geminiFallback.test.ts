import { afterEach, describe, expect, it, vi } from "vitest";
import { runGeminiScript } from "./omniCanvasApi";

// 顶层 import omniCanvasApi 是重模块，全量并发下 transform 成本计入 5s 默认预算（负载抽签）
vi.setConfig({ testTimeout: 60_000 });

const ok = (text: string) =>
  new Response(JSON.stringify({ ok: true, raw: { candidates: [{ content: { parts: [{ text }] } }] } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const fail = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify({ ok: false, ...body }), { status, headers: { "Content-Type": "application/json" } });

describe("runGeminiScript（模型由服务端决定）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("请求体不带模型；上游 503 退避重试后成功（服务端自己换档）", async () => {
    vi.useFakeTimers();
    const bodies: Array<Record<string, unknown>> = [];
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body || "{}")));
        n += 1;
        return n === 1 ? fail(503, { status: 503, error: "算力紧张，请稍后重试" }) : ok("角色卡成功");
      }),
    );
    const pending = runGeminiScript("写一张女主角色卡", "gemini-3.1-pro-preview");
    await vi.runAllTimersAsync();
    expect(await pending).toBe("角色卡成功");
    expect(bodies).toHaveLength(2);
    for (const body of bodies) expect(body).toEqual({ prompt: "写一张女主角色卡" });
  });

  it("用量超限 / 未登录：直接报服务端文案，不重试", async () => {
    for (const [status, body] of [
      [429, { error: "rate_limited", message: "操作太频繁，请稍后再试" }],
      [401, { error: "authentication_required", message: "请先登录后再使用" }],
    ] as const) {
      const fetchMock = vi.fn(async () => fail(status, body));
      vi.stubGlobal("fetch", fetchMock);
      await expect(runGeminiScript("x")).rejects.toThrow(body.message);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });
});
