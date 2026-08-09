import { afterEach, describe, expect, it, vi } from "vitest";
import { runGeminiScript } from "./omniCanvasApi";

// 顶层 import omniCanvasApi 是重模块，全量并发下 transform 成本计入 5s 默认预算（负载抽签）
vi.setConfig({ testTimeout: 60_000 });

describe("runGeminiScript model fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to flash when pro returns 503", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
        const model = String(body.model || "");
        calls.push(model);
        if (/pro/i.test(model)) {
          return new Response(JSON.stringify({ ok: false, status: 503, error: "算力紧张，请稍后重试" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            ok: true,
            text: "角色卡回退成功",
            raw: { candidates: [{ content: { parts: [{ text: "角色卡回退成功" }] } }] },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const text = await runGeminiScript("写一张女主角色卡", "gemini-3.1-pro-preview");
    expect(text).toBe("角色卡回退成功");
    expect(calls.some((m) => /pro/i.test(m))).toBe(true);
    expect(calls.some((m) => /flash/i.test(m))).toBe(true);
  });
});
