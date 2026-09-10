import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokePageTriageJson, looksLikeTriageJson, pageTriageTestHooks } from "./knowledgeCardPageTriage";

describe("挑参考页模型链（DeepSeek 视觉 → OpenRouter → Qwen3.8-Max 兜底，无 Sol）", () => {
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

  it("第一家回坏输出 → 换第二家；两家都坏 → 用 Qwen 兜底；兜底也坏 → 抛错", async () => {
    const tried: string[] = [];
    const run = (chat: (gw: { name: string; model: string }) => Promise<string>, fallback?: () => Promise<string>) =>
      pageTriageTestHooks.run({ chat: chat as never }, () =>
        invokePageTriageJson({ system: "s", userText: "u", imageUrls: ["https://x/1.jpg"], fallback }),
      );
    const out = await run(async (gw) => {
      tried.push(gw.name + ":" + gw.model);
      if (gw.name === "evolink") throw new Error("triage_bad_output:evolink");
      return '{"pages":[{"page":7,"reason":"表格"}]}';
    });
    expect(out).toContain('"page":7');
    expect(tried).toEqual(["evolink:deepseek-v4-flash-vision-exp", "openrouter:deepseek/deepseek-v4-flash-vision-exp"]);

    let fallbackCalls = 0;
    const viaQwen = await run(async () => { throw new Error("down"); }, async () => { fallbackCalls += 1; return '{"pages":[]}'; });
    expect(viaQwen).toBe('{"pages":[]}');
    expect(fallbackCalls).toBe(1);

    await expect(run(async () => { throw new Error("down"); }, async () => "乱码")).rejects.toThrow(/triage_bad_output:qwen/);
    await expect(run(async () => { throw new Error("down"); })).rejects.toThrow("down");
  });
});
