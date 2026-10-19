import { buildMarketingPrompt } from "../../shared/marketingSkills.js";
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
  getPlatformStage2OpenAiModel: () => "z-ai/glm-5.3-flashx",
  resolvePlatformStage2OpenAiReasoningEffort: () => "max",
}));

vi.mock("./platformTextModel.js", () => ({
  PLATFORM_TEXT_REASONING_EFFORT: "low",
  resolvePlatformTextMaxCompletionTokens: () => 32768,
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

  it("uses OpenRouter GLM FlashX and returns structured result", async () => {
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
      modelName: "z-ai/glm-5.3-flashx",
      reasoningEffort: "low",
      max_tokens: 32768,
    });
  });

  it("throws capacity message when GLM fails", async () => {
    vi.mocked(invokeLLM).mockRejectedValueOnce(new Error("OpenRouter returned non-JSON body"));

    await expect(
      optimizeCustomCopy({
        sourceText: "这是一段足够长的测试文案，用于验证失败提示。",
      }),
    ).rejects.toThrow(OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE);
  });
});

describe("营销优化生产请求", () => {
 beforeEach(() => vi.clearAllMocks());
 it("将用户优化要求送入同源方法，并保留原正文与运营建议分离", async () => {
  const sourceText = "一起读亲子绘本，让家长与孩子分享今天的心情。";
  const optimizationBrief = "为亲子绘本营销获客，商品和价格尚未确定。";
  const platformNotes = [{ platform: "小红书", angle: "引流候选共读体验；利润候选绘本；高价候选动画。成本与售价待补。", copySnippet: sourceText }];
  vi.mocked(invokeLLM).mockResolvedValueOnce({ choices: [] } as never);
  vi.mocked(extractFirstChoicePlainText).mockReturnValueOnce(JSON.stringify({ optimizedMarkdown: sourceText, platformNotes }));
  const result = await optimizeCustomCopy({ sourceText, optimizationBrief });
  const request = vi.mocked(invokeLLM).mock.calls[0][0];
  expect(request.messages[1].content).toContain(buildMarketingPrompt({ stage: "optimize", context: [sourceText, optimizationBrief].join("\n") }));
  expect(request.messages[1].content).toContain("platformNotes.angle");
  expect(result.optimizedMarkdown).toBe(sourceText);
  expect(result.platformNotes).toEqual(platformNotes);
 });
 it("纯科普不会因挂载技能或趋势文字而被补三档销售指令", async () => {
  vi.mocked(invokeLLM).mockResolvedValueOnce({ choices: [] } as never);
  vi.mocked(extractFirstChoicePlainText).mockReturnValueOnce(JSON.stringify({ optimizedMarkdown: "月亮绕着地球公转。" }));
  await optimizeCustomCopy({ sourceText: "向孩子解释月亮为什么会有阴晴圆缺，只做天文科普。", platformSkillsPrompt: "营销转化" });
  expect(vi.mocked(invokeLLM).mock.calls[0][0].messages[1].content).not.toContain("【营销建议与正文分离】");
 });
});
