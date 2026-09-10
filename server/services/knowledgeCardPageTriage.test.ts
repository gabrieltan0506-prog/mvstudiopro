import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokePageTriageJson, looksLikeTriageJson, pageTriageTestHooks } from "./knowledgeCardPageTriage";

describe("挑参考页模型链（EvoLink DeepSeek 视觉 → 新加坡 Qwen → OpenRouter DeepSeek 视觉；无 Sol）", () => {
  beforeEach(() => {
    process.env.EVOLINK_API_KEY = "evo";
    process.env.OPENROUTER_API_KEY = "or";
  });
  afterEach(() => {
    delete process.env.EVOLINK_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });

  it("JSON 校验：必须是 {pages:[…]}", () => {
    expect(looksLikeTriageJson('前言 {"pages":[{"page":3}]} 后记')).toBe(true);
    expect(looksLikeTriageJson('{"foo":1}')).toBe(false);
    expect(looksLikeTriageJson("不是 json")).toBe(false);
  });

  it("EvoLink 坏 → 先 Qwen 兜底 → 再 OpenRouter；全坏抛最后一个错", async () => {
    const tried: string[] = [];
    const run = (chat: (gw: { name: string; model: string }) => Promise<string>, fallback?: () => Promise<string>) =>
      pageTriageTestHooks.run({ chat: chat as never }, () =>
        invokePageTriageJson({ system: "s", userText: "u", imageUrls: ["https://x/1.jpg"], fallback }),
      );
    const out = await run(async (gw) => {
      tried.push(gw.name + ":" + gw.model);
      return '{"pages":[{"page":7,"reason":"表格"}]}';
    });
    expect(out).toContain('"page":7');
    expect(tried).toEqual(["evolink:deepseek-v4-flash-vision-exp"]);

    // EvoLink 坏 → Qwen 兜底成功，OpenRouter 不动
    tried.length = 0;
    let fallbackCalls = 0;
    const viaQwen = await run(
      async (gw) => { tried.push(gw.name); throw new Error("down"); },
      async () => { fallbackCalls += 1; return '{"pages":[]}'; },
    );
    expect(viaQwen).toBe('{"pages":[]}');
    expect(fallbackCalls).toBe(1);
    expect(tried).toEqual(["evolink"]);

    // EvoLink 坏、Qwen 回乱码 → OpenRouter 接住
    tried.length = 0;
    const viaOr = await run(
      async (gw) => { tried.push(gw.name); if (gw.name === "evolink") throw new Error("down"); return '{"pages":[{"page":3}]}'; },
      async () => "乱码",
    );
    expect(viaOr).toContain('"page":3');
    expect(tried).toEqual(["evolink", "openrouter"]);

    // 三家全坏 → 抛最后一家（OpenRouter）的错
    await expect(run(async (gw) => { throw new Error(`down:${gw.name}`); }, async () => "乱码")).rejects.toThrow("down:openrouter");
    await expect(run(async (gw) => { throw new Error(`down:${gw.name}`); })).rejects.toThrow("down:openrouter");
  });
});
