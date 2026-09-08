import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ evolink: vi.fn(), openai: vi.fn(), openrouter: vi.fn() }));
vi.mock("./evolinkGptImage2.js", async importOriginal => ({
  ...await importOriginal<typeof import("./evolinkGptImage2.js")>(), isEvolinkGptImage2Configured: () => true, postEvolinkGptImage2AndUpload: calls.evolink,
}));
vi.mock("./openaiGptImage2.js", () => ({ isOpenAiGptImage2Configured: () => true, postOpenAiGptImage2AndUpload: calls.openai }));
vi.mock("./openrouterGptImage2.js", () => ({ isOpenRouterGptImage2Configured: () => true, postOpenRouterGptImage2AndUpload: calls.openrouter }));
vi.mock("./platformImagePipelineStats.js", () => ({ emitPlatformImagePipelineStat: vi.fn() }));
import { generatePlatformCompositeSheetImage } from "./proxyImageService";

const output = "https://example.invalid/finished-card.png";
const sourceRefs = Array.from({ length: 12 }, (_, i) => `https://example.invalid/source-${i + 1}.png`);
const options = {
  kind: "single_page_knowledge_card" as const, title: "方法笔记", scriptContext: "旧正文不该重分页", notePageIndex: 3, notePageTotal: 5,
  forceSkipCompositeDeepResearchPro: true,
  knowledgeCardFrozenPage: { pageId: "internal-card-3", contentMarkdown: "# 第三页条件\n阈值30%与时间窗口必须同时满足。", visualDirections: "对齐机制箭头与数据表。", sourcePageIds: ["internal-source-1"], referenceImageUrls: sourceRefs },
};
describe("冻结原页参考进入真实生图包装链", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("GPT_IMAGE2_PROVIDER", "auto"); vi.stubEnv("GPT_IMAGE2_ALLOW_OPENROUTER_FALLBACK", "");
    vi.stubEnv("PLATFORM_COMPOSITE_SHEET_MAX_ATTEMPTS", "1");
    calls.evolink.mockResolvedValue(output); calls.openai.mockResolvedValue(output); calls.openrouter.mockResolvedValue(output);
  });
  afterEach(() => vi.unstubAllEnvs());
  it("12张原页全部送往EvoLink，冻结第三页正文不被本地分页重切，无附加脸锁", async () => {
    expect(await generatePlatformCompositeSheetImage(options)).toBe(output);
    const [prompt, , request] = calls.evolink.mock.calls[0];
    expect(request).toMatchObject({ imageUrls: sourceRefs, aspectRatio: "16:9", resolution: "4K", quality: "high" });
    expect(prompt).toContain(options.knowledgeCardFrozenPage.contentMarkdown); expect(prompt).toContain("第 3/5 页");
    expect(prompt).not.toContain(options.scriptContext); expect(prompt).not.toContain("internal-card-3");
    expect(prompt).not.toMatch(/FACE LOCK|same person|face identity|face-lock|replace.*person/i);
    expect(prompt).toContain("知识原页参考·仅理解与重绘");
  });
  it("原页与独立主人公参考可共存，合计16张完整传递", async () => {
    const portrait = "https://example.invalid/portrait.png";
    const previous = Array.from({ length: 3 }, (_, i) => `https://example.invalid/previous-${i}.png`);
    await generatePlatformCompositeSheetImage({ ...options, referencePhotoUrl: portrait, continuityReferenceImageUrls: previous });
    expect(calls.evolink.mock.calls[0][2].imageUrls).toEqual([portrait, ...previous, ...sourceRefs]);
  });
  it("17张原页或合并超过16张明确失败，网关零调用", async () => {
    await expect(generatePlatformCompositeSheetImage({ ...options, knowledgeCardFrozenPage: { ...options.knowledgeCardFrozenPage, referenceImageUrls: Array.from({ length: 17 }, (_, i) => `https://example.invalid/${i}.png`) } })).rejects.toThrow("超过16张");
    await expect(generatePlatformCompositeSheetImage({ ...options, referencePhotoUrl: "https://example.invalid/portrait.png", continuityReferenceImageUrls: Array.from({ length: 4 }, (_, i) => `https://example.invalid/previous-${i}.png`) })).rejects.toThrow("合计超过16张");
    expect(calls.evolink).not.toHaveBeenCalled(); expect(calls.openai).not.toHaveBeenCalled(); expect(calls.openrouter).not.toHaveBeenCalled();
  });
  it("OpenAI及OpenRouter回退都保留全部原页和4K，不降到无参考生图", async () => {
    calls.evolink.mockResolvedValue(null); calls.openai.mockResolvedValue(null); vi.stubEnv("GPT_IMAGE2_ALLOW_OPENROUTER_FALLBACK", "1");
    expect(await generatePlatformCompositeSheetImage(options)).toBe(output);
    expect(calls.openai.mock.calls[0][2]).toMatchObject({ imageUrls: sourceRefs, size: "3840x2160", quality: "high", lane: "asset" });
    expect(calls.openrouter.mock.calls[0][2]).toMatchObject({ imageUrls: sourceRefs, resolution: "4K", quality: "high", aspectRatio: "16:9" });
  });
  it.each(["left", "center"] as const)("原页参考保留%s主体位置以及4K横版", async subjectPosition => {
    await generatePlatformCompositeSheetImage({ ...options, subjectPosition, compositeImageEngine: "nano_banana_2" });
    expect(calls.evolink.mock.calls[0][0]).toContain(subjectPosition === "left" ? "LEFT third" : "CENTER the main visual subject");
    expect(calls.evolink.mock.calls[0][2]).toMatchObject({ resolution: "4K", aspectRatio: "16:9" });
  });
  it("仅原页参考被审核拒绝时不走主人公澄清重试", async () => {
    calls.evolink.mockImplementation(async (_p, _d, request) => { request.captureError.message = "moderation blocked"; return null; });
    calls.openai.mockImplementation(async (_p, _d, request) => { request.captureError.message = "moderation blocked"; return null; });
    await expect(generatePlatformCompositeSheetImage(options)).rejects.toThrow("内容审核拦截");
    expect(calls.evolink).toHaveBeenCalledTimes(1); expect(calls.openai).toHaveBeenCalledTimes(1);
  });
  it("8001字正文在任何供应商调用前失败", async () => {
    await expect(generatePlatformCompositeSheetImage({ ...options, knowledgeCardFrozenPage: { ...options.knowledgeCardFrozenPage, contentMarkdown: "甲".repeat(8001) } })).rejects.toThrow("超过单页8000字");
    expect(calls.evolink).not.toHaveBeenCalled(); expect(calls.openai).not.toHaveBeenCalled();
  });
});
