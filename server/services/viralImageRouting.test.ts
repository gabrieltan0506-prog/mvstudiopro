import { buildPlatformTopicCoverDirectChinesePrompt } from "./geminiPlatformCompositeTranslation";
import { PLATFORM_EDITORIAL_COVER_GUIDANCE } from "../../shared/platformEditorialCover";
import { buildPlatformSceneTextForCover } from "../../shared/platformSceneTextForCover";
import { connectXhsPackageToBlueprint, xhsCreationPackageSchema } from "../../shared/xhsCreationPackage";
import { fictionalViralBlueprint } from "../../shared/viralCreation.fixture";
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
  expect(mock.official.mock.calls[0][0]).toContain(PLATFORM_EDITORIAL_COVER_GUIDANCE);
  expect(mock.evo.mock.calls[0][0]).toContain(PLATFORM_EDITORIAL_COVER_GUIDANCE);
  expect(mock.wave).not.toHaveBeenCalled(); expect(mock.router).not.toHaveBeenCalled();
 });
 it("官方成功只提交一次，并保留参考图", async () => {
  mock.official.mockResolvedValue("https://example.invalid/fixture.png");
  const output = await generatePlatformTopicCoverNanoBanana2FromEnglishPrompt({viralCreation:true,englishPrompt:"虚构测试画面",referenceImageUrls:["https://example.invalid/reference.png"]});
  expect(output).toBe("https://example.invalid/fixture.png"); expect(mock.evo).not.toHaveBeenCalled(); expect(mock.official.mock.calls[0][2].imageUrls).toEqual(["https://example.invalid/reference.png"]);
 });
});

it("成交目标从创作包经保存快照与中文编译进入真实像素请求，保留锁脸与费用参数", async () => {
 mock.official.mockResolvedValue("https://example.invalid/fixture.png");
 const blueprint = fictionalViralBlueprint();
 const pack = xhsCreationPackageSchema.parse(blueprint.xhsPackage);
 pack.conversion = {goal:"convert",offer:"亲子共读绘本",delivery:"纸质绘本一册，不承诺改善亲子关系",action:"查看绘本详情"};
 pack.cover.visual = "家长与孩子在窗边共读，真实绘本页面为清晰主体，桌沿前景与远处书架建立层次。";
 connectXhsPackageToBlueprint(blueprint,pack);
 const persisted=JSON.parse(JSON.stringify(blueprint));
 const context=buildPlatformSceneTextForCover(persisted);
 const prompt=buildPlatformTopicCoverDirectChinesePrompt({topicHook:"今晚一起读",context,variant:"graphic"});
 expect(prompt).toContain("【本张封面·购买与行动动机】");
 expect(prompt).toContain("亲子共读绘本");expect(prompt).toContain("不承诺改善亲子关系");
 expect(prompt).not.toContain("左右大字夹人：");expect(prompt).not.toContain("大数字压屏：");
 await generatePlatformTopicCoverNanoBanana2FromEnglishPrompt({viralCreation:true,englishPrompt:prompt,referenceImageUrls:["https://example.invalid/person.png"]});
 const request=mock.official.mock.calls.at(-1)!;
 expect(request[0]).toContain("【本张封面·购买与行动动机】");expect(request[0]).toContain("前景—主体—背景");
 expect(request[2]).toMatchObject({exactModel:"gpt-image-2.5-sunburst",quality:"medium",size:"1152x2048",imageUrls:["https://example.invalid/person.png"]});
});
