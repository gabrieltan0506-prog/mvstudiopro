import { afterEach, beforeEach, expect, it, vi } from "vitest";
const providers = vi.hoisted(() => ({ openai: vi.fn(), evo: vi.fn(), wave: vi.fn(), router: vi.fn() }));
vi.mock("./openaiGptImage2.js", () => ({ isOpenAiGptImage2Configured: () => true, postOpenAiGptImage2AndUpload: providers.openai }));
vi.mock("./evolinkGptImage2.js", () => ({ isEvolinkGptImage2Configured: () => true, isEvolinkModerationFailure: () => false, postEvolinkGptImage2AndUpload: providers.evo }));
vi.mock("./wavespeedGptImage2.js", () => ({ isWavespeedGptImage2Configured: () => true, postWavespeedGptImage2AndUpload: providers.wave }));
vi.mock("./openrouterGptImage2.js", () => ({ isOpenRouterGptImage2Configured: () => true, postOpenRouterGptImage2AndUpload: providers.router }));
import { generatePlatformCompositeSheetImage, generatePlatformTopicCoverNanoBanana2FromEnglishPrompt } from "./proxyImageService";
const base = { kind: "single_page_knowledge_card" as const, userId: 1, title: "会议表达", viralCreation: true, singleGraphicPage: true, notePageIndex: 2, notePageTotal: 5, scriptContext: "# 先说结论\n\n先说已完成，再说待处理。", referencePhotoUrl: "https://test.invalid/portrait.png" };
beforeEach(() => { vi.resetAllMocks(); Object.values(providers).forEach(p => p.mockResolvedValue(null)); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("测试禁止联网"); })); });
afterEach(() => vi.unstubAllGlobals());
it("四页分别提交本页正文与同一人像，不按总页码二次切片", async () => {
  providers.openai.mockResolvedValue("https://test.invalid/result.png");
  for (let page = 2; page <= 5; page++) await generatePlatformCompositeSheetImage({ ...base, notePageIndex: page, scriptContext: `# 第${page}页\n\n本页唯一内容${page}。` });
  expect(providers.openai).toHaveBeenCalledTimes(4);
  for (let i = 0; i < 4; i++) {
    const args = providers.openai.mock.calls[i];
    expect(args[0]).toContain(`本页唯一内容${i + 2}。`);
    expect(args[0]).toContain("不要擅自将本页正文切到别页");
    expect(args[2]).toMatchObject({ variant: "sunburst", imageUrls: [base.referencePhotoUrl], quality: "medium", size: "1152x2048" });
    expect(JSON.stringify(args)).toContain("1152x2048");
  }
  expect(providers.evo).not.toHaveBeenCalled();
});
it("官方失败只同模型回落，不整链二次购买或换模型", async () => {
  await expect(generatePlatformCompositeSheetImage(base)).rejects.toThrow();
  expect(providers.openai).toHaveBeenCalledTimes(1); expect(providers.evo).toHaveBeenCalledTimes(1);
  expect(providers.evo.mock.calls[0][2]).toMatchObject({ variant: "sunburst", quality: "medium", resolution: "2K", imageUrls: [base.referencePhotoUrl] });
  expect(providers.wave).not.toHaveBeenCalled(); expect(providers.router).not.toHaveBeenCalled();
});
it("旧知识卡仍使用原页切片和原稿参考，不误用人物参考", async () => {
  providers.openai.mockResolvedValue("https://test.invalid/legacy.png");
  await generatePlatformCompositeSheetImage({ ...base, viralCreation: false, singleGraphicPage: undefined, notePageIndex: 1, notePageTotal: 1 });
  const args = providers.openai.mock.calls[0];
  expect(args[0]).not.toContain("独立可发布的小红书图文笔记正文图片");
  expect(args[2].imageUrls || []).not.toContain(base.referencePhotoUrl);
});

it("爆款封面与独立正文采用相同2K中画质及人像参考", async () => {
  providers.openai.mockResolvedValue("https://test.invalid/cover.png");
  await generatePlatformTopicCoverNanoBanana2FromEnglishPrompt({viralCreation:true,englishPrompt:"职业装封面",referenceImageUrls:[base.referencePhotoUrl]});
  expect(providers.openai.mock.calls[0][2]).toMatchObject({quality:"medium",size:"1152x2048",imageUrls:[base.referencePhotoUrl]});
});

it("旧八格入口拒绝发起爆款图文像素调用", async () => {
  await expect(generatePlatformCompositeSheetImage({...base,kind:"xiaohongshu_dual_note",singleGraphicPage:undefined})).rejects.toThrow("每页独立出图");
  for(const provider of Object.values(providers)) expect(provider).not.toHaveBeenCalled();
});

it("4列3行导演分镜各段与备用通道锁定Sunburst 2K中画质", async () => {
  providers.evo.mockResolvedValue("https://test.invalid/director.png");
  for (let index = 0; index < 3; index++) {
    await generatePlatformCompositeSheetImage({ ...base, kind: "storyboard_sheet_landscape", singleGraphicPage: undefined, gridSection: { index, total: 3 }, scriptContext: "镜头1：人物自然站立，双手下垂，中景，柔光，缓慢推进。" });
  }
  expect(providers.openai).toHaveBeenCalledTimes(3);
  expect(providers.evo).toHaveBeenCalledTimes(3);
  for (const args of providers.openai.mock.calls) expect(args[2]).toMatchObject({ exactModel: "gpt-image-2.5-sunburst", variant: "sunburst", quality: "medium", size: "2048x1152", imageUrls: [base.referencePhotoUrl] });
  for (const args of providers.evo.mock.calls) expect(args[2]).toMatchObject({ model: "gpt-image-2.5-sunburst", variant: "sunburst", quality: "medium", resolution: "2K", imageUrls: [base.referencePhotoUrl] });
  expect(providers.wave).not.toHaveBeenCalled(); expect(providers.router).not.toHaveBeenCalled();
});
