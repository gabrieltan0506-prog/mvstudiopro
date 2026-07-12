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
  resolveGemini35FlashCopywritingMaxOutputTokens: () => 65536,
  resolvePlatformStage2GeminiModel: () => "gemini-3-flash-preview",
  callGemini35FlashCopywriting: vi.fn(),
}));

import { extractFirstChoicePlainText, invokeLLM } from "../_core/llm.js";
import { callGemini35FlashCopywriting } from "./gemini35FlashRuntime.js";
import {
  OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE,
  optimizeCustomCopy,
  parseOptimizeCustomCopyJsonForTest,
} from "./platformOptimizeCustomCopy.js";

describe("platformOptimizeCustomCopy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EVOLINK_API_KEY = "test-evolink-key";
  });

  it("parses fenced JSON from model output", () => {
    const result = parseOptimizeCustomCopyJsonForTest(
      '```json\n{"summary":"ok","optimizedMarkdown":"# 标题\\n正文","titles":["A"],"hooks":[],"platformNotes":[]}\n```',
    );
    expect(result.summary).toBe("ok");
    expect(result.optimizedMarkdown).toContain("# 标题");
  });

  it("returns capacity message for plain-text error bodies from model", () => {
    expect(() => parseOptimizeCustomCopyJsonForTest("An error occurred while processing")).toThrow(
      OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE,
    );
  });

  it("uses GPT-5.5 and returns structured result", async () => {
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
    expect(vi.mocked(invokeLLM).mock.calls[0]?.[0]).toMatchObject({
      max_tokens: 65536,
    });
  });

  it("falls back to Gemini Flash when GPT-5.6 fails", async () => {
    vi.mocked(invokeLLM)
      .mockRejectedValueOnce(new Error("Evolink returned non-JSON body"))
      .mockRejectedValueOnce(new Error("Evolink returned non-JSON body"));
    vi.mocked(callGemini35FlashCopywriting).mockResolvedValueOnce(
      JSON.stringify({
        summary: "gemini",
        optimizedMarkdown: "## Gemini 优化稿\n内容",
        titles: ["G"],
        hooks: [],
        platformNotes: [],
      }),
    );

    const result = await optimizeCustomCopy({
      sourceText: "这是一段足够长的测试文案，用于验证 Gemini fallback。",
    });

    expect(result.optimizedMarkdown).toContain("Gemini 优化稿");
    expect(vi.mocked(callGemini35FlashCopywriting)).toHaveBeenCalledTimes(1);
  });

  it("throws capacity message when GPT and Gemini both fail", async () => {
    vi.mocked(invokeLLM)
      .mockRejectedValueOnce(new Error("Evolink returned non-JSON body"))
      .mockRejectedValueOnce(new Error("Evolink returned non-JSON body"));
    vi.mocked(callGemini35FlashCopywriting).mockRejectedValueOnce(new Error("gemini down"));

    await expect(
      optimizeCustomCopy({
        sourceText: "这是一段足够长的测试文案，用于验证失败提示。",
      }),
    ).rejects.toThrow(OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE);
  });
});
