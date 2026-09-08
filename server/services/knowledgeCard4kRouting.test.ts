import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  evolink: vi.fn(), openai: vi.fn(), openrouter: vi.fn(),
}));

vi.mock("./evolinkGptImage2.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./evolinkGptImage2.js")>(),
  isEvolinkGptImage2Configured: () => true,
  postEvolinkGptImage2AndUpload: calls.evolink,
}));
vi.mock("./openaiGptImage2.js", () => ({
  isOpenAiGptImage2Configured: () => true,
  postOpenAiGptImage2AndUpload: calls.openai,
}));
vi.mock("./openrouterGptImage2.js", () => ({
  isOpenRouterGptImage2Configured: () => true,
  postOpenRouterGptImage2AndUpload: calls.openrouter,
}));
vi.mock("./platformImagePipelineStats.js", () => ({ emitPlatformImagePipelineStat: vi.fn() }));

import {
  generateGptImage2FromRawEnglishPrompt,
  generatePlatformCompositeSheetImage,
} from "./proxyImageService.js";
import { buildEvolinkRequestBody } from "./evolinkGptImage2.js";

const output = "https://example.com/test-knowledge-card.png";
const markdown = "# 工作笔记\n\n## 确认目标\n先确认要交付的内容和读者，再组织重点和案例。\n\n## 核对证据\n用原文检验数字与结论，保留引用关系。";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GPT_IMAGE2_PROVIDER", "auto");
  vi.stubEnv("GPT_IMAGE2_ALLOW_OPENROUTER_FALLBACK", "");
  calls.evolink.mockResolvedValue(output);
  calls.openai.mockResolvedValue(output);
  calls.openrouter.mockResolvedValue(output);
});
afterEach(() => vi.unstubAllEnvs());

async function generateCard(total: number, referencePhotoUrl?: string, subjectPosition?: "left" | "center") {
  return generatePlatformCompositeSheetImage({
    kind: "single_page_knowledge_card",
    title: "工作笔记",
    scriptContext: markdown,
    notePageIndex: 1,
    notePageTotal: total,
    subjectPosition,
    referencePhotoUrl,
    forceSkipCompositeDeepResearchPro: true,
  });
}

describe("知识卡实际出图规格", () => {
  it.each([1, 4, 6, 7, 12, 20])("%i页都给EvoLink传独立4K分辨率与high质量", async (total) => {
    expect(await generateCard(total)).toBe(output);
    expect(calls.evolink).toHaveBeenCalledTimes(1);
    const [prompt, , options] = calls.evolink.mock.calls[0];
    expect(prompt).toContain("工作笔记");
    expect(options).toMatchObject({ aspectRatio: "16:9", quality: "high", resolution: "4K" });
    const body = buildEvolinkRequestBody("gpt-image-2", prompt, "16:9", options.quality, [], undefined, options.resolution);
    expect(body).toMatchObject({ size: "16:9", resolution: "4K", quality: "high" });
  });

  it("回退OpenAI仍明确请求3840×2160，保留参考图", async () => {
    calls.evolink.mockResolvedValue(null);
    const ref = "https://example.com/test-reference.png";
    expect(await generateCard(12, ref)).toBe(output);
    expect(calls.openai).toHaveBeenCalledTimes(1);
    expect(calls.openai.mock.calls[0][2]).toMatchObject({
      size: "3840x2160", quality: "high", imageUrls: [ref], lane: "asset",
    });
  });

  it("开启的OpenRouter回退也携带4K，默认关闭行为不变", async () => {
    vi.stubEnv("GPT_IMAGE2_ALLOW_OPENROUTER_FALLBACK", "1");
    calls.evolink.mockResolvedValue(null);
    calls.openai.mockResolvedValue(null);
    expect(await generateCard(8)).toBe(output);
    expect(calls.openrouter.mock.calls[0][2]).toMatchObject({
      aspectRatio: "16:9", resolution: "4K", quality: "high",
    });
  });

  it("审核澄清重试沿用同一4K规格及参考图", async () => {
    calls.evolink.mockImplementationOnce(async (_prompt, _dir, options) => {
      options.captureError.message = "moderation blocked";
      return null;
    }).mockResolvedValue(output);
    calls.openai.mockImplementationOnce(async (_prompt, _dir, options) => {
      options.captureError.message = "moderation blocked";
      return null;
    });
    expect(await generateCard(10, "https://example.com/test-reference.png")).toBe(output);
    expect(calls.evolink).toHaveBeenCalledTimes(2);
    for (const call of calls.evolink.mock.calls) {
      expect(call[2]).toMatchObject({ quality: "high", resolution: "4K" });
    }
  });

  it("其他调用不指定新参数时保留原有供应商尺寸默认值", async () => {
    await generateGptImage2FromRawEnglishPrompt({
      englishPrompt: "测试场景", aspectRatio: "16:9", gcsSubdir: "test",
    });
    expect(calls.evolink.mock.calls[0][2].resolution).toBeUndefined();
    calls.evolink.mockResolvedValue(null);
    await generateGptImage2FromRawEnglishPrompt({
      englishPrompt: "测试场景", aspectRatio: "16:9", gcsSubdir: "test",
    });
    expect(calls.openai.mock.calls[0][2].size).toBeUndefined();
  });
});


it.each(["left", "center"] as const)("主体%s位置进入真实供应商调用prompt且仍4K横版", async position => {
  await generateCard(4, undefined, position);
  const [prompt, , options] = calls.evolink.mock.calls[0];
  expect(prompt).toContain(position === "left" ? "LEFT third" : "CENTER the main visual subject");
  expect(options).toMatchObject({ aspectRatio: "16:9", resolution: "4K", quality: "high" });
});
