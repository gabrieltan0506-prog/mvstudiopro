import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokePageTriageJson, looksLikeTriageJson, pageTriageTestHooks } from "./knowledgeCardPageTriage";

describe("挑参考页模型链（0911：OpenRouter DS → EvoLink DS → 降档兜底）", () => {
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

  it("OpenRouter 坏 → EvoLink 同款 DeepSeek 接住 → 两家都坏才降档兜底；全坏抛最后一个错", async () => {
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
    expect(tried).toEqual(["openrouter:deepseek/deepseek-v4.1-flash"]);

    // OpenRouter 坏 → EvoLink 同款 DeepSeek 接住，降档兜底不动
    tried.length = 0;
    let fallbackCalls = 0;
    const viaEvolink = await run(
      async (gw) => { tried.push(gw.name); if (gw.name === "openrouter") throw new Error("down"); return '{"pages":[{"page":3}]}'; },
      async () => { fallbackCalls += 1; return '{"pages":[]}'; },
    );
    expect(viaEvolink).toContain('"page":3');
    expect(tried).toEqual(["openrouter", "evolink"]);
    expect(fallbackCalls).toBe(0);

    // 两家 DeepSeek 都坏 → 才轮到降档兜底
    tried.length = 0;
    const viaQwen = await run(
      async (gw) => { tried.push(gw.name); throw new Error("down"); },
      async () => { fallbackCalls += 1; return '{"pages":[]}'; },
    );
    expect(viaQwen).toBe('{"pages":[]}');
    expect(fallbackCalls).toBe(1);
    expect(tried).toEqual(["openrouter", "evolink"]);

    // 全坏 → 抛最后一跳（降档兜底）的错
    await expect(run(async (gw) => { throw new Error(`down:${gw.name}`); }, async () => "乱码")).rejects.toThrow(/triage_bad_output:qwen/);
    await expect(run(async (gw) => { throw new Error(`down:${gw.name}`); })).rejects.toThrow("down:evolink");
  });
});
