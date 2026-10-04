import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const providers = vi.hoisted(() => ({ openai: vi.fn(), evo: vi.fn(), wave: vi.fn(), router: vi.fn() }));
vi.mock("./openaiGptImage2.js", () => ({ isOpenAiGptImage2Configured: () => true, postOpenAiGptImage2AndUpload: providers.openai }));
vi.mock("./evolinkGptImage2.js", () => ({ isEvolinkGptImage2Configured: () => true, isEvolinkModerationFailure: () => false, postEvolinkGptImage2AndUpload: providers.evo }));
vi.mock("./wavespeedGptImage2.js", () => ({ isWavespeedGptImage2Configured: () => true, postWavespeedGptImage2AndUpload: providers.wave }));
vi.mock("./openrouterGptImage2.js", () => ({ isOpenRouterGptImage2Configured: () => true, postOpenRouterGptImage2AndUpload: providers.router }));
import { generateGptImage2FromRawEnglishPrompt, generatePlatformCompositeSheetImage } from "./proxyImageService";
const cancelled = Object.assign(new Error("页面已刷新"), { kind: "cancelled" });
const base = { englishPrompt: "A knowledge card", aspectRatio: "16:9" as const, gcsSubdir: "test", imageLane: "asset" as const, providerOverride: "openai" as const };
beforeEach(() => { vi.resetAllMocks(); Object.values(providers).forEach(p => p.mockResolvedValue(null)); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network"); })); });
afterEach(() => { vi.unstubAllGlobals(); });
describe("刷新只阻止之后的付费提交", () => {
  it("首笔提交前取消不调用供应商", async () => {
    await expect(generateGptImage2FromRawEnglishPrompt({ ...base, beforeImageSubmit: async () => { throw cancelled; } })).rejects.toBe(cancelled);
    Object.values(providers).forEach(p => expect(p).not.toHaveBeenCalled());
  });
  it("当前供应商失败时刷新，不继续换供应商", async () => {
    let stopped = false;
    providers.openai.mockImplementation(async () => { stopped = true; return null; });
    await expect(generateGptImage2FromRawEnglishPrompt({ ...base, beforeImageSubmit: async () => { if (stopped) throw cancelled; } })).rejects.toBe(cancelled);
    expect(providers.openai).toHaveBeenCalledTimes(1); expect(providers.evo).not.toHaveBeenCalled(); expect(providers.wave).not.toHaveBeenCalled();
  });
  it("刷新发生在已提交图片生成时，保留成功结果", async () => {
    let stopped = false;
    providers.openai.mockImplementation(async () => { stopped = true; return "https://test.invalid/result.png"; });
    expect(await generateGptImage2FromRawEnglishPrompt({ ...base, beforeImageSubmit: async () => { if (stopped) throw cancelled; } })).toBe("https://test.invalid/result.png");
    expect(providers.evo).not.toHaveBeenCalled();
  });
  it("结果未知优先原样交给对账，不被刷新覆盖", async () => {
    let stopped = false;
    const unknown = Object.assign(new Error("上游结果未知"), { kind: "unknown" });
    providers.openai.mockImplementation(async () => { stopped = true; throw unknown; });
    await expect(generateGptImage2FromRawEnglishPrompt({ ...base, beforeImageSubmit: async () => { if (stopped) throw cancelled; } })).rejects.toBe(unknown);
    expect(providers.evo).not.toHaveBeenCalled();
  });
  it("知识卡整链不会吞取消错误再重试", async () => {
    let stopped = false;
    providers.openai.mockImplementation(async () => { stopped = true; return null; });
    await expect(generatePlatformCompositeSheetImage({ kind: "single_page_knowledge_card", userId: 1, title: "测试", scriptContext: "测试正文", beforeImageSubmit: async () => { if (stopped) throw cancelled; } })).rejects.toBe(cancelled);
    expect(providers.openai).toHaveBeenCalledTimes(1); expect(providers.evo).not.toHaveBeenCalled();
  });
  it("非页面绑定的调用保留原有回落", async () => {
    providers.evo.mockResolvedValue("https://test.invalid/fallback.png");
    expect(await generateGptImage2FromRawEnglishPrompt(base)).toBe("https://test.invalid/fallback.png");
    expect(providers.openai).toHaveBeenCalledTimes(1); expect(providers.evo).toHaveBeenCalledTimes(1);
  });
});

it("1005显式Flare/Sunburst编辑只沿支持该模型的两家，不能静默改成image-2",async()=>{
 expect(await generateGptImage2FromRawEnglishPrompt({...base,openaiImageVariant:"sunburst",requireImageVariant:true})).toBeNull();
 expect(providers.openai).toHaveBeenCalledTimes(1);expect(providers.evo).toHaveBeenCalledTimes(1);expect(providers.wave).not.toHaveBeenCalled();expect(providers.router).not.toHaveBeenCalled();
 expect(providers.openai.mock.calls[0][2].variant).toBe("sunburst");expect(providers.evo.mock.calls[0][2].variant).toBe("sunburst");
});
