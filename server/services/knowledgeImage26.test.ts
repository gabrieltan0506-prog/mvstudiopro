import { afterEach, beforeEach, expect, it, vi } from "vitest";
const providers = vi.hoisted(() => ({ openai: vi.fn(), evo: vi.fn(), wave: vi.fn(), router: vi.fn() }));
vi.mock("./openaiGptImage2.js", () => ({ isOpenAiGptImage2Configured: () => true, postOpenAiGptImage2AndUpload: providers.openai }));
vi.mock("./evolinkGptImage2.js", () => ({ isEvolinkGptImage2Configured: () => true, isEvolinkModerationFailure: () => false, postEvolinkGptImage2AndUpload: providers.evo }));
vi.mock("./wavespeedGptImage2.js", () => ({ isWavespeedGptImage2Configured: () => true, postWavespeedGptImage2AndUpload: providers.wave }));
vi.mock("./openrouterGptImage2.js", () => ({ isOpenRouterGptImage2Configured: () => true, postOpenRouterGptImage2AndUpload: providers.router }));
import { generatePlatformCompositeSheetImage, generateGptImage2FromRawEnglishPrompt } from "./proxyImageService";
const base = { kind: "single_page_knowledge_card" as const, userId: 7, title: "光合作用", scriptContext: "# 光合作用\n植物通过叶片利用光能。", notePageIndex: 1, notePageTotal: 1, knowledgeCardReferencePageUrls: ["https://test.invalid/reference.png"] };
beforeEach(() => { vi.resetAllMocks(); Object.values(providers).forEach(p => p.mockResolvedValue(null)); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("禁止测试联网"); })); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each(["flare", "sunburst"] as const)("手册%s正文与原页参考进入同档2.6，仍为4K/high", async variant => {
  providers.openai.mockResolvedValue("https://test.invalid/result.png");
  const result = await generatePlatformCompositeSheetImage({ ...base, openaiImageVariant: variant });
  expect(result).toBe("https://test.invalid/result.png");
  const [prompt, subdir, options] = providers.openai.mock.calls[0];
  expect(prompt).toContain("植物通过叶片利用光能");
  expect(subdir).toBe("platform_knowledge_card/u7");
  expect(options).toMatchObject({ exactModel: `gpt-image-2.6-${variant}`, quality: "high", size: "3840x2160", imageUrls: base.knowledgeCardReferencePageUrls, strictRequest: true });
  expect(providers.evo).not.toHaveBeenCalled();
});
it.each(["flare", "sunburst"] as const)("手册%s官方拒绝后EvoLink仍为同型号4K/high", async variant => {
  providers.evo.mockResolvedValue("https://test.invalid/fallback.png");
  await generatePlatformCompositeSheetImage({ ...base, openaiImageVariant: variant });
  expect(providers.openai).toHaveBeenCalledTimes(1);
  expect(providers.evo.mock.calls[0][2]).toMatchObject({ model: `gpt-image-2.6-${variant}`, quality: "high", resolution: "4K", imageUrls: base.knowledgeCardReferencePageUrls, strictRequest: true });
  expect(providers.wave).not.toHaveBeenCalled(); expect(providers.router).not.toHaveBeenCalled();
});
it("EvoLink首选也保持2.6，失败回官方同档", async () => {
  providers.openai.mockResolvedValue("https://test.invalid/result.png");
  await generatePlatformCompositeSheetImage({ ...base, knowledgeCardImageProvider: "evolink", openaiImageVariant: "sunburst" });
  expect(providers.evo.mock.invocationCallOrder[0]).toBeLessThan(providers.openai.mock.invocationCallOrder[0]);
  expect(providers.evo.mock.calls[0][2].model).toBe("gpt-image-2.6-sunburst");
  expect(providers.openai.mock.calls[0][2].exactModel).toBe("gpt-image-2.6-sunburst");
});
it("旧供应商偏好不会把升级手册降为旧模型", async () => {
  vi.stubEnv("PLATFORM_COMPOSITE_SHEET_MAX_ATTEMPTS", "1");
  vi.stubEnv("GPT_IMAGE2_ALLOW_OPENROUTER_FALLBACK", "1");
  await expect(generatePlatformCompositeSheetImage({ ...base, knowledgeCardImageProvider: "wavespeed" })).rejects.toThrow();
  expect(providers.wave).not.toHaveBeenCalled(); expect(providers.router).not.toHaveBeenCalled();
});
it("2.6未知结果不跨供应商也不整链重买", async () => {
  const unknown = Object.assign(new Error("待对账"), { kind: "unknown" });
  providers.openai.mockRejectedValue(unknown);
  await expect(generatePlatformCompositeSheetImage(base)).rejects.toBe(unknown);
  expect(providers.openai).toHaveBeenCalledTimes(1); expect(providers.evo).not.toHaveBeenCalled();
});
it("未指定升级的其他像素业务维持旧默认", async () => {
  providers.openai.mockResolvedValue("https://test.invalid/result.png");
  await generateGptImage2FromRawEnglishPrompt({ englishPrompt: "原画布图", aspectRatio: "16:9", gcsSubdir: "test", requireImageVariant: true, openaiImageVariant: "sunburst" });
  expect(providers.openai.mock.calls[0][2].exactModel).toBe("gpt-image-2.5-sunburst");
});
