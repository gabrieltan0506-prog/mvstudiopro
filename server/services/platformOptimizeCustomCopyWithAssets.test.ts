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
}));

vi.mock("../growth/trendStore.js", () => ({
  readTrendStoreForPlatforms: vi.fn(async () => ({
    collections: {
      douyin: {
        items: [
          {
            title: "中年男人别再把情绪熬成血管病",
            likes: 1200,
            comments: 88,
            shares: 40,
            collectedAt: new Date().toISOString(),
          },
        ],
      },
    },
  })),
}));

import { extractFirstChoicePlainText, invokeLLM } from "../_core/llm.js";
import { optimizeCustomCopyWithAssets } from "./platformOptimizeCustomCopyWithAssets.js";

describe("platformOptimizeCustomCopyWithAssets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EVOLINK_API_KEY = "test-evolink-key";
  });

  it("requires visionAnalysis", async () => {
    await expect(
      optimizeCustomCopyWithAssets({
        sourceText: "这是一段足够长的测试文案，用于验证素材绑定优化链路。",
      }),
    ).rejects.toThrow("请先完成素材视觉分析");
  });

  it("includes vision + trend brief in LLM user block", async () => {
    vi.mocked(invokeLLM).mockResolvedValueOnce({ choices: [{ message: { content: "" } }] } as never);
    vi.mocked(extractFirstChoicePlainText).mockReturnValueOnce(
      JSON.stringify({
        summary: "苏轼×医学",
        optimizedMarkdown: "## 优化稿\n正文",
        titles: ["标题1"],
        hooks: [],
        platformNotes: [],
      }),
    );

    const result = await optimizeCustomCopyWithAssets({
      sourceText: "这是一段足够长的测试文案，用于验证素材绑定优化链路。",
      optimizationBrief: "强化情绪免疫力",
      visionAnalysis: {
        summary: "封面为东坡肉与医学博士",
        visualSummary: "宋韵餐厅暖光",
        titleSuggestions: ["别把情绪熬成血管病"],
      },
      windowDays: 7,
    });

    expect(result.optimizedMarkdown).toContain("优化稿");
    expect(result.visionAttached).toBe(true);
    expect(result.trendWindowDays).toBe(7);
    const userContent = String(vi.mocked(invokeLLM).mock.calls[0]?.[0]?.messages?.[1]?.content || "");
    expect(userContent).toContain("视觉分析 JSON");
    expect(userContent).toContain("东坡肉");
    expect(userContent).toContain("近期热点");
  });
});
