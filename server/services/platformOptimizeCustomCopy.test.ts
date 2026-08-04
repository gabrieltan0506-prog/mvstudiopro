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
  getPlatformStage2OpenAiModel: () => "moonshotai/kimi-k3",
  resolvePlatformStage2OpenAiReasoningEffort: () => "max",
}));

vi.mock("./openrouterKimiK3.js", () => ({
  OPENROUTER_KIMI_K3_REASONING_EFFORT: "max",
  resolveOpenRouterKimiK3MaxCompletionTokens: () => 131072,
}));

vi.mock("./gpt56CopywritingGateway.js", () => ({
  getOfficialOpenAiApiKey: () => "",
  getEvolinkApiKey: () => "",
}));

vi.mock("./openrouterGptImage2.js", () => ({
  getOpenRouterApiKey: () => "test-openrouter-key",
}));

import { extractFirstChoicePlainText, invokeLLM } from "../_core/llm.js";
import {
  OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE,
  optimizeCustomCopy,
  parseOptimizeCustomCopyJsonForTest,
} from "./platformOptimizeCustomCopy.js";

describe("platformOptimizeCustomCopy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("uses OpenRouter Kimi K3 and returns structured result", async () => {
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
    expect(vi.mocked(invokeLLM).mock.calls[0]?.[0]).toMatchObject({
      provider: "openai",
      modelName: "moonshotai/kimi-k3",
      reasoningEffort: "max",
      max_tokens: 131072,
    });
  });

  it("throws capacity message when Kimi fails", async () => {
    vi.mocked(invokeLLM).mockRejectedValueOnce(new Error("OpenRouter returned non-JSON body"));

    await expect(
      optimizeCustomCopy({
        sourceText: "这是一段足够长的测试文案，用于验证失败提示。",
      }),
    ).rejects.toThrow(OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE);
  });
});
