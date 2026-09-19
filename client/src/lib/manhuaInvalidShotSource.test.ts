import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureManhuaFragmentClips,
  prepareManhuaFactoryClipInput,
  prepareManhuaKeyartShotTarget,
  resolveShotsForEpisodeKeyarts,
  runManhuaDramaFactoryPipeline,
  spawnManhuaDramaStudio,
} from "./canvasDramaStudio";
import * as runner from "./canvasRunBlock";

const refs = [{ id: "person", role: "character" as const, url: "https://test.invalid/person.png", source: "upload" as const, labelZh: "甲" }];
const options = { deps: { optimizeCopy: async () => "" }, episodeIndex: 1, maxRetries: 0, ensureOptions: { customRefs: refs } };
function manuscript(time = "5-10") {
  return `| 镜号 | 秒位 | 景别运镜 | 画面 | 对白 |\n| --- | --- | --- | --- | --- |\n| 1 | 0-5 | 中景固定 | 甲抬手 | 无 |\n| 2 | ${time} | 近景固定 | 甲回头 | 无 |`;
}
function fixture(time = "5-10") {
  const graph = spawnManhuaDramaStudio({ topic: "甲抬手再回头", episodeIndex: 1, customRefs: refs });
  const blocks = graph.blocks.map(block => block.id.startsWith("reverse-")
    ? { ...block, outputText: manuscript(time), status: "done" as const }
    : block.id.startsWith("keyart-") || block.id.startsWith("clip-")
      ? { ...block, outputUrl: `https://test.invalid/old-${block.id}`, outputUrls: [`https://test.invalid/history-${block.id}`] }
      : block);
  return { ...graph, blocks };
}
function interceptGeneration() {
  // 只替换最后派发边界；解析、编译、来源回执和目标选择均执行生产函数。
  return vi.spyOn(runner, "runCanvasBlock").mockImplementation(async (_deps, block) => ({
    outputUrl: `https://test.invalid/${block.kind === "video" ? "clip.mp4" : `${block.id}.png`}`,
  }));
}
afterEach(() => vi.restoreAllMocks());

describe("坏秒位原稿在生产派发前拒绝", () => {
  it.each(["8-5", "坏秒位", "4-10"])("%s：单镜和单段零派发，错误可读且旧块不变", async time => {
    const graph = fixture(time);
    const original = structuredClone(graph.blocks);
    const dispatch = interceptGeneration();
    // 页面仍可读取原稿，不应因渲染阶段抛错而无法修正。
    expect(() => resolveShotsForEpisodeKeyarts(graph.blocks, 1)).not.toThrow();
    for (const target of [{ untilStage: "keyart" as const, keyartShotIndex: 2 }, { untilStage: "clip" as const, fragmentShotIndex: 1 }]) {
      const result = await runManhuaDramaFactoryPipeline({ ...graph, ...options, ...target });
      expect(result.errors.map(error => error.message).join(" ")).toMatch(/原稿|秒位/);
      expect(result.blocks).toEqual(original);
      expect(dispatch).not.toHaveBeenCalled();
    }
    expect(graph.blocks).toEqual(original);
  });

  it.each(["8-5", "坏秒位", "4-10"])("%s：直接ensure、单镜prepare和单段prepare同样拒绝", async time => {
    const graph = fixture(time);
    const original = structuredClone(graph.blocks);
    const dispatch = interceptGeneration();
    expect(() => ensureManhuaFragmentClips(graph.blocks, graph.edges, 1, { customRefs: refs })).toThrow(/原稿|秒位/);
    expect(() => prepareManhuaKeyartShotTarget(graph.blocks, graph.edges, 1, 2, { customRefs: refs })).toThrow(/原稿|秒位/);
    const clip = graph.blocks.find(block => block.id.startsWith("clip-"))!;
    expect(clip).toBeDefined();
    await expect(prepareManhuaFactoryClipInput({ ...graph, blockId: clip.id, fallbackBlock: clip, stage: "clip", episodeIndex: 1, preparedVideoEdit: false })).rejects.toThrow(/原稿|秒位/);
    expect(graph.blocks).toEqual(original);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("合法原稿可生成单镜，真实回执继续供单段视频消费", async () => {
    const original = fixture();
    const graph = { ...original, blocks: original.blocks.filter(block => !block.id.startsWith("keyart-")) };
    const dispatch = interceptGeneration();
    const first = await runManhuaDramaFactoryPipeline({ ...graph, ...options, untilStage: "keyart", keyartShotIndex: 2 });
    expect(first.errors).toEqual([]);
    expect(dispatch.mock.calls.some(call => call[1].kind === "image")).toBe(true);
    dispatch.mockClear();
    const second = await runManhuaDramaFactoryPipeline({ ...graph, ...options, blocks: first.blocks, untilStage: "clip", fragmentShotIndex: 1 });
    expect(second.errors).toEqual([]);
    expect(dispatch.mock.calls.some(call => call[1].kind === "video")).toBe(true);
  });

  it("修好坏原稿后同一画布可恢复执行", async () => {
    const graph = fixture("8-5");
    const dispatch = interceptGeneration();
    const failed = await runManhuaDramaFactoryPipeline({ ...graph, ...options, untilStage: "keyart", keyartShotIndex: 2 });
    expect(failed.errors.length).toBeGreaterThan(0);
    expect(dispatch).not.toHaveBeenCalled();
    const blocks = failed.blocks.map(block => block.id.startsWith("reverse-") ? { ...block, outputText: manuscript() } : block);
    const recovered = await runManhuaDramaFactoryPipeline({ ...graph, ...options, blocks, untilStage: "keyart", keyartShotIndex: 2 });
    expect(recovered.errors).toEqual([]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("本轮reverse返回坏稿时保留正文，不重试也不继续图片视频", async () => {
    const graph = fixture();
    const reverse = graph.blocks.find(block => block.id.startsWith("reverse-"))!;
    const blocks = graph.blocks.map(block => block.id === reverse.id
      ? { ...block, outputText: undefined, status: "idle" as const }
      : block.kind === "text" || block.kind === "copy_organize"
        ? { ...block, outputText: "甲抬手再回头", status: "done" as const } : block);
    const badText = manuscript("8-5");
    const dispatch = vi.spyOn(runner, "runCanvasBlock").mockResolvedValue({ outputText: badText });
    const result = await runManhuaDramaFactoryPipeline({ ...graph, ...options, blocks, untilStage: "clip", forceFromStage: "reverse", maxRetries: 2 });
    expect(dispatch.mock.calls.map(call => call[1].id)).toEqual([reverse.id]);
    expect(result.blocks.find(block => block.id === reverse.id)?.outputText).toBe(badText);
    expect(result.errors.map(error => error.message).join(" ")).toMatch(/原稿|秒位/);
    for (const old of blocks.filter(block => block.kind === "image" || block.kind === "video")) {
      const retained = result.blocks.find(block => block.id === old.id);
      expect(retained?.outputUrl).toBe(old.outputUrl);
      expect(retained?.outputUrls).toEqual(old.outputUrls);
    }
  });
});
