import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnManhuaDramaStudio, prepareManhuaKeyartShotTarget, runManhuaDramaFactoryPipeline, ensureManhuaFragmentClips, prepareManhuaFactoryClipInput } from "./canvasDramaStudio";
import * as runner from "./canvasRunBlock";

const refs = [{ id: "hero", role: "character" as const, url: "https://test.invalid/hero.png", source: "upload" as const, labelZh: "玄璃" }];
function fixture() {
  const g = spawnManhuaDramaStudio({ topic: "玄璃推门", episodeIndex: 1, customRefs: refs });
  return { ...g, blocks: g.blocks.filter(b => !b.id.startsWith("keyart-")).map(b => b.id.startsWith("reverse-") ? { ...b, outputText: "1. 玄璃推门\n2. 玄璃抬眼\n3. 玄璃转身", status: "done" as const } : b) };
}
afterEach(() => vi.restoreAllMocks());
describe("当前镜首次生成与重出", () => {
  it("无任何静帧节点时真实编译并仅消费所选一镜", async () => {
    const g = fixture();
    const spy = vi.spyOn(runner, "runCanvasBlock").mockResolvedValue({ outputUrl: "https://test.invalid/new.png" });
    const r = await runManhuaDramaFactoryPipeline({ ...g, deps: { optimizeCopy: async () => "" }, episodeIndex: 1, untilStage: "keyart", keyartShotIndex: 2, maxRetries: 0, ensureOptions: { customRefs: refs } });
    expect(r.errors).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![1].id).toContain("s02");
    expect(r.blocks.filter(b => b.id.startsWith("keyart-"))).toHaveLength(1);
    for (const b of g.blocks) expect(r.blocks.find(x => x.id === b.id)).toEqual(b);
  });
  it("重出单镜仅请求一次，新旧图保留且同集其他镜/跨集不变", async () => {
    const g = fixture();
    const a = prepareManhuaKeyartShotTarget(g.blocks, g.edges, 1, 1, { customRefs: refs });
    const b = prepareManhuaKeyartShotTarget(a.blocks, a.edges, 1, 2, { customRefs: refs });
    const otherEpisode = spawnManhuaDramaStudio({ topic: "另集", episodeIndex: 2, customRefs: refs }).blocks;
    const blocks = [...b.blocks, ...otherEpisode].map(x => x.id === b.targetBlockId ? { ...x, imageBatchCount: 4 as const, outputUrl: "https://test.invalid/old.png", status: "done" as const } : x);
    const spy = vi.spyOn(runner, "runCanvasBlock").mockResolvedValue({ outputUrl: "https://test.invalid/new.png" });
    const r = await runManhuaDramaFactoryPipeline({ blocks, edges: b.edges, deps: { optimizeCopy: async () => "" }, episodeIndex: 1, untilStage: "keyart", keyartShotIndex: 2, targetBlockIds: [b.targetBlockId], maxRetries: 0, ensureOptions: { customRefs: refs } });
    expect(r.errors).toEqual([]); expect(spy).toHaveBeenCalledTimes(1); expect(spy.mock.calls[0]![1].imageBatchCount).toBe(1);
    expect(r.blocks.find(x => x.id === b.targetBlockId)?.outputUrls).toEqual(expect.arrayContaining(["https://test.invalid/old.png", "https://test.invalid/new.png"]));
    for (const x of blocks.filter(x => x.id !== b.targetBlockId)) expect(r.blocks.find(y => y.id === x.id)).toEqual(x);
  });
  it.each([0, 99, NaN, 1.5])("无效镜号 %s 零请求且原图不变", async shot => {
    const g = fixture(); const spy = vi.spyOn(runner, "runCanvasBlock");
    const r = await runManhuaDramaFactoryPipeline({ ...g, deps: { optimizeCopy: async () => "" }, episodeIndex: 1, untilStage: "keyart", keyartShotIndex: shot, maxRetries: 0 });
    expect(r.errors[0]?.message).toMatch(/目标无效|找不到该镜/); expect(spy).not.toHaveBeenCalled(); expect(r.blocks).toEqual(g.blocks);
  });
  it("旧块ID与当前集镜不匹配拒绝，不退化成整集", async () => {
    const g = fixture(); const a = prepareManhuaKeyartShotTarget(g.blocks, g.edges, 1, 1, { customRefs: refs });
    const spy = vi.spyOn(runner, "runCanvasBlock");
    const r = await runManhuaDramaFactoryPipeline({ blocks: a.blocks, edges: a.edges, deps: { optimizeCopy: async () => "" }, episodeIndex: 1, untilStage: "keyart", keyartShotIndex: 2, targetBlockIds: [a.targetBlockId], maxRetries: 0 });
    expect(r.errors[0]?.message).toContain("身份不匹配"); expect(spy).not.toHaveBeenCalled(); expect(r.blocks).toEqual(a.blocks);
  });
  it("空回包保持旧图并明确失败", async () => {
    const g=fixture(); const a=prepareManhuaKeyartShotTarget(g.blocks,g.edges,1,1,{customRefs:refs});
    const blocks=a.blocks.map(b=>b.id===a.targetBlockId?{...b,outputUrl:"https://test.invalid/old.png"}:b);
    const spy=vi.spyOn(runner,"runCanvasBlock").mockResolvedValue({});
    const r=await runManhuaDramaFactoryPipeline({blocks,edges:a.edges,deps:{optimizeCopy:async()=>""},episodeIndex:1,untilStage:"keyart",keyartShotIndex:1,maxRetries:0,ensureOptions:{customRefs:refs}});
    expect(r.errors[0]?.message).toContain("未返回有效图片"); expect(spy).toHaveBeenCalledTimes(1);
    expect(r.blocks.find(b=>b.id===a.targetBlockId)?.outputUrl).toBe("https://test.invalid/old.png");
  });
  it("失败不自动重试，不清空旧图", async () => {
    const g = fixture(); const a = prepareManhuaKeyartShotTarget(g.blocks, g.edges, 1, 1, { customRefs: refs });
    const blocks = a.blocks.map(b => b.id === a.targetBlockId ? { ...b, outputUrl: "https://test.invalid/old.png" } : b);
    const spy = vi.spyOn(runner, "runCanvasBlock").mockRejectedValue(new Error("503 transient"));
    const r = await runManhuaDramaFactoryPipeline({ blocks, edges: a.edges, deps: { optimizeCopy: async () => "" }, episodeIndex: 1, untilStage: "keyart", keyartShotIndex: 1, maxRetries: 0, ensureOptions: { customRefs: refs } });
    expect(spy).toHaveBeenCalledTimes(1); expect(r.errors).toHaveLength(1); expect(r.blocks.find(b => b.id === a.targetBlockId)?.outputUrl).toBe("https://test.invalid/old.png");
  });
});

it.each([false, true])("归档同镜旧图不混入段参考（残留连线=%s）", async (linked) => {
  const g = fixture();
  vi.spyOn(runner, "runCanvasBlock").mockResolvedValue({ outputUrl: "https://test.invalid/current.png" });
  const r = await runManhuaDramaFactoryPipeline({ ...g, deps: { optimizeCopy: async () => "" }, episodeIndex: 1, untilStage: "keyart", keyartShotIndex: 2, maxRetries: 0, ensureOptions: { customRefs: refs } });
  expect(r.errors).toEqual([]);
  const plan = ensureManhuaFragmentClips(r.blocks, g.edges, 1, { customRefs: refs });
  const clip = plan.blocks.find(b => b.id.startsWith("clip-") && !b.archivedFromPreviousScript)!;
  const keyart = plan.blocks.find(b => b.id.startsWith("keyart-"))!;
  const baseline = await prepareManhuaFactoryClipInput({ blocks: plan.blocks, edges: plan.edges, blockId: clip.id, fallbackBlock: clip, stage: "clip", preparedVideoEdit: false });
  const archived = { ...keyart, id: "keyart-e01-s02-archived-test", archivedFromPreviousScript: true, outputUrl: "https://test.invalid/archived.png", outputUrls: ["https://test.invalid/archived.png"], manhuaKeyartSourceState: undefined };
  const blocks = [...plan.blocks, archived];
  const result = await prepareManhuaFactoryClipInput({ blocks, edges: linked ? [...plan.edges, { fromId: archived.id, toId: clip.id }] : plan.edges, blockId: clip.id, fallbackBlock: clip, stage: "clip", preparedVideoEdit: false });
  expect(result).toEqual(baseline);
  expect(blocks.at(-1)).toEqual(archived);
});

it('单镜重编译绑定三名实际出演者（含单字署名），不混入下一镜角色或其他场景', () => {
  const names = ['阿青', '墨马', '娘', '曹三'];
  const characters = names.map((nameZh, i) => ({ id: `cast-${i}`, role: 'character' as const, nameZh, lookZh: nameZh, promptZh: nameZh }));
  const locations = ['坊市', '后院'].map((nameZh,i)=>({id:`scene-${i}`,role:'scene' as const,nameZh,lookZh:nameZh,promptZh:nameZh}));
  const canon = {characters,locations,props:[],episodeMainSceneId:{1:'scene-0'}};
  const selected = [...characters, ...locations].map(a=>({id:a.id,role:a.role,labelZh:a.nameZh,url:`https://test.invalid/${a.id}.png`,source:'generated' as const,claimedAnchorIds:[a.id],claimSource:'manual' as const,...(a.role==='character'?{refDuty:'identity' as const,primaryBindings:[{anchorId:a.id,duty:'identity' as const}]}:{})}));
  const g = spawnManhuaDramaStudio({topic:'背母求医',episodeIndex:1,customRefs:selected,assetCanon:canon});
  const blocks=g.blocks.map(b=>b.id.startsWith('reverse-')?{...b,outputText:'| # | 秒位 | 景别·运镜 | 画面 | 台词/字幕 | 音效·配乐 |\n|---|---|---|---|---|---|\n| 1 | 0-5 | 中景 | 阿青背娘挪步，墨马跟随 | 娘：「慢点。」 | 脚步 |\n| 2 | 5-8 | 近景 | 曹三举掌 | —— | 嗡鸣 |\n| 3 | 8-13 | 中景 | 曹三收掌 | —— | 脚步 |',status:'done' as const}:b);
  const before = blocks.find(b=>b.id.startsWith('keyart-'))!;
  const prepared = prepareManhuaKeyartShotTarget(blocks,g.edges,1,1,{customRefs:selected,assetCanon:canon});
  const target=prepared.blocks.find(b=>b.id===prepared.targetBlockId)!;
  expect([target.refImageUrl,...target.editFusionUrls||[]]).toEqual(expect.arrayContaining(['https://test.invalid/cast-0.png','https://test.invalid/cast-1.png','https://test.invalid/cast-2.png','https://test.invalid/scene-0.png']));
  expect([target.refImageUrl,...target.editFusionUrls||[]]).toHaveLength(4);
  expect(target.prompt).not.toContain('参考图5');
  expect(target.prompt).not.toContain('融图参考');
  expect(target.prompt).not.toContain('后院');
  expect(before).toEqual(blocks.find(b=>b.id===before.id));
  for(const b of blocks.filter(b=>b.id!==target.id)) expect(prepared.blocks.find(n=>n.id===b.id)).toEqual(b);
});
