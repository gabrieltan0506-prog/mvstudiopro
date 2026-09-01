import { describe, expect, it, vi } from "vitest";
import {
  buildPlatformQwen38RequestBody,
  PlatformTextAnalysisAttemptsError,
  runPlatformTextAnalysisAttempts,
} from "./platformTextAnalysisLlm";

const good = (label: string) => ({
  choices: [{ message: { content: JSON.stringify({ label }) }, finish_reason: "stop" }],
  model: label,
  gateway: label,
});

describe("buildPlatformQwen38RequestBody", () => {
  it("固定模型、high 思考、JSON 输出和流式用量", () => {
    expect(buildPlatformQwen38RequestBody({
      systemPrompt: "system",
      userPrompt: "user",
      maxTokens: 200_000,
      temperature: 0.6,
    })).toEqual({
      model: "qwen3.8-max",
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "user" },
      ],
      enable_thinking: true,
      reasoning_effort: "high",
      max_completion_tokens: 65_536,
      response_format: { type: "json_object" },
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.6,
    });
  });

  it("输出上限收敛到 8192–65536", () => {
    expect(buildPlatformQwen38RequestBody({ systemPrompt: "s", userPrompt: "u", maxTokens: 1 }).max_completion_tokens).toBe(8_192);
    expect(buildPlatformQwen38RequestBody({ systemPrompt: "s", userPrompt: "u", maxTokens: 9_000 }).max_completion_tokens).toBe(9_000);
  });
});

describe("runPlatformTextAnalysisAttempts", () => {
  it("严格按北京、新加坡、GLM 顺序，成功即停", async () => {
    const order: string[] = [];
    const result = await runPlatformTextAnalysisAttempts({
      systemPrompt: "s",
      userPrompt: "u",
      maxTokens: 10_000,
      validateContent: (content) => JSON.parse(content),
    }, {
      qwenBeijing: vi.fn(async () => { order.push("beijing"); throw new Error("fail"); }),
      qwenSingapore: vi.fn(async () => { order.push("singapore"); return good("qwen_3_8_singapore"); }),
      glm: vi.fn(async () => { order.push("glm"); return good("glm_5_3"); }),
      sleepMs: async () => {},
    });

    expect(order).toEqual(["beijing", "singapore"]);
    expect(result.engine).toBe("qwen_3_8_singapore");
    expect(result.attempt).toBe(2);
  });

  it("内容验真失败会进入下一档", async () => {
    const result = await runPlatformTextAnalysisAttempts({
      systemPrompt: "s",
      userPrompt: "u",
      maxTokens: 10_000,
      validateContent: (content) => {
        const parsed = JSON.parse(content) as { valid?: boolean };
        if (!parsed.valid) throw new Error("内容不合格");
      },
    }, {
      qwenBeijing: async () => good("invalid"),
      qwenSingapore: async () => ({
        ...good("qwen_3_8_singapore"),
        choices: [{ message: { content: JSON.stringify({ valid: true }) }, finish_reason: "stop" }],
      }),
      sleepMs: async () => {},
    });
    expect(result.engine).toBe("qwen_3_8_singapore");
  });

  it("三档全灭抛出含完整轨迹的结构化错误", async () => {
    const fail = vi.fn(async () => { throw new Error("fail"); });
    const error = await runPlatformTextAnalysisAttempts({
      systemPrompt: "s",
      userPrompt: "u",
      maxTokens: 10_000,
    }, {
      qwenBeijing: fail,
      qwenSingapore: fail,
      glm: fail,
      sleepMs: async () => {},
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(PlatformTextAnalysisAttemptsError);
    expect(error.attempts.map((item: { engine: string }) => item.engine)).toEqual([
      "qwen_3_8_beijing",
      "qwen_3_8_singapore",
      "glm_5_3",
    ]);
  });
});
