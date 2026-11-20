import { afterEach, beforeEach, expect, it, vi } from "vitest";
const providers = vi.hoisted(() => ({ openai: vi.fn(), evo: vi.fn(), wave: vi.fn(), router: vi.fn() }));
vi.mock("./openaiGptImage2.js", () => ({ isOpenAiGptImage2Configured: () => true, postOpenAiGptImage2AndUpload: providers.openai }));
vi.mock("./evolinkGptImage2.js", () => ({ isEvolinkGptImage2Configured: () => true, isEvolinkModerationFailure: () => false, postEvolinkGptImage2AndUpload: providers.evo }));
vi.mock("./wavespeedGptImage2.js", () => ({ isWavespeedGptImage2Configured: () => true, postWavespeedGptImage2AndUpload: providers.wave }));
vi.mock("./openrouterGptImage2.js", () => ({ isOpenRouterGptImage2Configured: () => true, postOpenRouterGptImage2AndUpload: providers.router }));
import { generatePlatformCompositeSheetImage, generateGptImage2FromRawEnglishPrompt } from "./proxyImageService";
const base = { approvedImageModel: "gpt-image-2.6-sunburst" as const, kind: "single_page_knowledge_card" as const, userId: 7, title: "光合作用", scriptContext: "# 光合作用\n植物通过叶片利用光能。", notePageIndex: 1, notePageTotal: 1, knowledgeCardReferencePageUrls: ["https://test.invalid/reference.png"] };
beforeEach(() => { vi.resetAllMocks(); Object.values(providers).forEach(p => p.mockResolvedValue(null)); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("禁止测试联网"); })); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
// 1119 C1：手册只准 2.6 Sunburst；缺档/空偏好由服务端绑定，绝不落到 Flare。
it.each([undefined, null, "sunburst"] as const)("手册档位%s正文与原页参考进入2.6 Sunburst，仍为4K/high", async variant => {
  providers.openai.mockResolvedValue("https://test.invalid/result.png");
  const result = await generatePlatformCompositeSheetImage({ ...base, openaiImageVariant: variant });
  expect(result).toBe("https://test.invalid/result.png");
  const [prompt, subdir, options] = providers.openai.mock.calls[0];
  expect(prompt).toContain("植物通过叶片利用光能");
  expect(subdir).toBe("platform_knowledge_card/u7");
  expect(options).toMatchObject({ exactModel: "gpt-image-2.6-sunburst", variant: "sunburst", quality: "high", size: "3840x2160", imageUrls: base.knowledgeCardReferencePageUrls, strictRequest: true });
  expect(providers.evo).not.toHaveBeenCalled();
});
it.each([undefined, "sunburst"] as const)("手册档位%s官方拒绝后EvoLink仍为同型号4K/high", async variant => {
  providers.evo.mockResolvedValue("https://test.invalid/fallback.png");
  await generatePlatformCompositeSheetImage({ ...base, openaiImageVariant: variant });
  expect(providers.openai).toHaveBeenCalledTimes(1);
  expect(providers.evo.mock.calls[0][2]).toMatchObject({ model: "gpt-image-2.6-sunburst", variant: "sunburst", quality: "high", resolution: "4K", imageUrls: base.knowledgeCardReferencePageUrls, strictRequest: true });
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

it.each([undefined, "sunburst"] as const)("仅凭偏好 %s 不能代替本次授权", async openaiImageVariant => {
  await expect(generatePlatformCompositeSheetImage({ ...base, approvedImageModel: undefined, openaiImageVariant })).rejects.toThrow("未获授权");
  for (const provider of Object.values(providers)) expect(provider).not.toHaveBeenCalled();
});
it("手册收到 Flare 档位：任何供应商请求之前拒绝", async () => {
  await expect(generatePlatformCompositeSheetImage({ ...base, openaiImageVariant: "flare" })).rejects.toThrow("未获授权");
  for (const provider of Object.values(providers)) expect(provider).not.toHaveBeenCalled();
});
it("整链重试与同档回落：所有出站请求体只带授权型号", async () => {
  vi.stubEnv("PLATFORM_COMPOSITE_SHEET_MAX_ATTEMPTS", "2");
  // 第 1 轮官方、EvoLink 都失败，整链第 2 轮官方成功：共 3 次出站（含 4s 真实退避）
  providers.openai.mockResolvedValueOnce(null).mockResolvedValueOnce("https://test.invalid/second.png");
  await expect(generatePlatformCompositeSheetImage({ ...base })).resolves.toBe("https://test.invalid/second.png");
  expect(providers.openai).toHaveBeenCalledTimes(2); expect(providers.evo).toHaveBeenCalledTimes(1);
  const bodies = [...providers.openai.mock.calls.map(c => c[2].exactModel), ...providers.evo.mock.calls.map(c => c[2].model)];
  expect(bodies.length).toBeGreaterThanOrEqual(3);
  expect(new Set(bodies)).toEqual(new Set(["gpt-image-2.6-sunburst"]));
  for (const c of [...providers.openai.mock.calls, ...providers.evo.mock.calls]) expect(c[2].variant).toBe("sunburst");
  expect(providers.wave).not.toHaveBeenCalled(); expect(providers.router).not.toHaveBeenCalled();
}, 30_000);
it.each([undefined, "flare"] as const)("2.6 底层调用缺档/Flare（%s）不静默落到 Flare，零出站", async variant => {
  await expect(generateGptImage2FromRawEnglishPrompt({ englishPrompt: "x", aspectRatio: "16:9", gcsSubdir: "t", imageModelVersion: "2.6", openaiImageVariant: variant, providerOverride: "openai" } as never)).rejects.toThrow("授权档");
  for (const provider of Object.values(providers)) expect(provider).not.toHaveBeenCalled();
});
