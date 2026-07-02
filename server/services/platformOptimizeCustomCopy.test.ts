import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_core/llm.js", () => ({
  invokeLLM: vi.fn(),
  extractFirstChoicePlainText: vi.fn(),
  extractJsonString: (text: string) => {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) return fenceMatch[1].trim();
    const objStart = text.indexOf("{");
    const objEnd = text.lastIndexOf("}");
    if (objStart !== -1 && objEnd > objStart) return text.slice(objStart, objEnd + 1);
    return text.trim();
  },
}));

vi.mock("../config/platformSwitches.js", () => ({
  getPlatformStage2OpenAiModel: () => "gpt-5.5",
  resolvePlatformStage2OpenAiReasoningEffort: () => "medium",
}));

vi.mock("./gemini35FlashRuntime.js", () => ({
  callGemini35FlashCopywriting: vi.fn(),
}));

import { extractFirstChoicePlainText, invokeLLM } from "../_core/llm.js";
import { callGemini35FlashCopywriting } from "./gemini35FlashRuntime.js";
import {
  optimizeCustomCopy,
  parseOptimizeCustomCopyJsonForTest,
} from "./platformOptimizeCustomCopy.js";

describe("platformOptimizeCustomCopy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EVOLINK_API_KEY = "test-evolink-key";
    process.env.GEMINI_API_KEY = "AIzaSyTestKeyForVitestOnly1234567890";
  });
  it("parses fenced JSON from model output", () => {
    const result = parseOptimizeCustomCopyJsonForTest(
      '```json\n{"summary":"ok","optimizedMarkdown":"# 标题\\n正文","titles":["A"],"hooks":[],"platformNotes":[]}\n```',
    );
    expect(result.summary).toBe("ok");
    expect(result.optimizedMarkdown).toContain("# 标题");
  });

  it("rejects plain-text error bodies from model", () => {
    expect(() => parseOptimizeCustomCopyJsonForTest("An error occurred while processing")).toThrow(
      /模型服务暂时异常/,
    );
  });

  it("uses GPT-5.5 first and returns structured result", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce({ choices: [{ message: { content: "" } }] } as never);
    vi.mocked(extractFirstChoicePlainText).mockReturnValueOnce(
      JSON.stringify({
        summary: "重点",
        optimizedMarkdown: "## 优化稿\n内容",
        titles: ["标题1"],
        hooks: ["钩子"],
        platformNotes: [],
      }),
    );

    const result = await optimizeCustomCopy({
      sourceText: "这是一段足够长的测试文案，用于验证深度优化链路。",
    });

    expect(result.optimizedMarkdown).toContain("优化稿");
    expect(vi.mocked(invokeLLM).mock.calls[0]?.[0]).toMatchObject({ provider: "openai" });
    expect(vi.mocked(callGemini35FlashCopywriting)).not.toHaveBeenCalled();
  });

  it("falls back to Gemini when GPT-5.5 fails", async () => {
    vi.mocked(invokeLLM)
      .mockRejectedValueOnce(new Error("Evolink returned non-JSON body"))
      .mockRejectedValueOnce(new Error("Evolink returned non-JSON body"));
    vi.mocked(callGemini35FlashCopywriting).mockResolvedValueOnce(
      JSON.stringify({
        summary: "兜底",
        optimizedMarkdown: "## Gemini\n兜底成功",
        titles: [],
        hooks: [],
        platformNotes: [],
      }),
    );

    const result = await optimizeCustomCopy({
      sourceText: "这是一段足够长的测试文案，用于验证 Gemini 兜底。",
    });

    expect(result.summary).toBe("兜底");
    expect(vi.mocked(callGemini35FlashCopywriting)).toHaveBeenCalledTimes(1);
  });
});
