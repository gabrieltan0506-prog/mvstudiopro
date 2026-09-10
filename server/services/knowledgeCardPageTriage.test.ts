import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokePageTriageJson, looksLikeTriageJson, pageTriageTestHooks } from "./knowledgeCardPageTriage";

describe("挑参考页模型链（0911：EvoLink DS → OpenRouter DS → Qwen 兜底）", () => {
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

  it("EvoLink 坏 → 先 OpenRouter 同款 DeepSeek → 最后才 Qwen 兜底；全坏抛最后一个错", async () => {
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

    // EvoLink 坏 → OpenRouter 同款 DeepSeek 接住，Qwen 兜底不动
    tried.length = 0;
    let fallbackCalls = 0;
    const viaOr = await run(
      async (gw) => { tried.push(gw.name); if (gw.name === "evolink") throw new Error("down"); return '{"pages":[{"page":3}]}'; },
      async () => { fallbackCalls += 1; return '{"pages":[]}'; },
    );
    expect(viaOr).toContain('"page":3');
    expect(tried).toEqual(["evolink", "openrouter"]);
    expect(fallbackCalls).toBe(0);

    // 两家 DeepSeek 都坏 → 才轮到 Qwen 兜底
    tried.length = 0;
    const viaQwen = await run(
      async (gw) => { tried.push(gw.name); throw new Error("down"); },
      async () => { fallbackCalls += 1; return '{"pages":[]}'; },
    );
    expect(viaQwen).toBe('{"pages":[]}');
    expect(fallbackCalls).toBe(1);
    expect(tried).toEqual(["evolink", "openrouter"]);

    // 全坏 → 抛最后一跳（Qwen 兜底）的错
    await expect(run(async (gw) => { throw new Error(`down:${gw.name}`); }, async () => "乱码")).rejects.toThrow(/triage_bad_output:qwen/);
    await expect(run(async (gw) => { throw new Error(`down:${gw.name}`); })).rejects.toThrow("down:openrouter");
  });
});
