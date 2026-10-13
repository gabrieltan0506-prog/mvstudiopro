import {beforeEach, describe, expect, it, vi} from "vitest";
const mock = vi.hoisted(() => ({ official: vi.fn(), evo: vi.fn(), wave: vi.fn(), router: vi.fn() }));
vi.mock("./openaiGptImage2.js", () => ({isOpenAiGptImage2Configured: () => true, postOpenAiGptImage2AndUpload: mock.official}));
vi.mock("./evolinkGptImage2.js", () => ({isEvolinkGptImage2Configured: () => true, isEvolinkModerationFailure: () => false, postEvolinkGptImage2AndUpload: mock.evo}));
vi.mock("./wavespeedGptImage2.js", () => ({isWavespeedGptImage2Configured: () => true, postWavespeedGptImage2AndUpload: mock.wave}));
vi.mock("./openrouterGptImage2.js", () => ({isOpenRouterGptImage2Configured: () => true, postOpenRouterGptImage2AndUpload: mock.router}));
import {generatePlatformTopicCoverNanoBanana2FromEnglishPrompt} from "./proxyImageService";
describe("爆款封面固定Sunburst模型的真实路由（上游隔离）", () => {
 beforeEach(() => { vi.clearAllMocks(); mock.official.mockResolvedValue(null); mock.evo.mockResolvedValue(null); });
 it("官方失败只切同款EvoLink，不能换WaveSpeed或OpenRouter", async () => {
  const output = await generatePlatformTopicCoverNanoBanana2FromEnglishPrompt({viralCreation:true,englishPrompt:"同一人物在会议场景演示沟通，简体中文封面"});
  expect(output).toBeNull(); expect(mock.official).toHaveBeenCalledTimes(1); expect(mock.evo).toHaveBeenCalledTimes(1);
  expect(mock.official.mock.calls[0][2]).toMatchObject({exactModel:"gpt-image-2.5-sunburst",variant:"sunburst",strictRequest:true});
  expect(mock.evo.mock.calls[0][2]).toMatchObject({model:"gpt-image-2.5-sunburst",variant:"sunburst"});
  expect(mock.wave).not.toHaveBeenCalled(); expect(mock.router).not.toHaveBeenCalled();
 });
 it("官方成功只提交一次，并保留参考图", async () => {
  mock.official.mockResolvedValue("https://example.invalid/fixture.png");
  const output = await generatePlatformTopicCoverNanoBanana2FromEnglishPrompt({viralCreation:true,englishPrompt:"虚构测试画面",referenceImageUrls:["https://example.invalid/reference.png"]});
  expect(output).toBe("https://example.invalid/fixture.png"); expect(mock.evo).not.toHaveBeenCalled(); expect(mock.official.mock.calls[0][2].imageUrls).toEqual(["https://example.invalid/reference.png"]);
 });
});
