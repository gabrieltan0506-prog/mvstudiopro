import { describe, expect, it, vi } from "vitest";
import * as canvasRunBlock from "./canvasRunBlock";
import { isManhuaKeyartLookCurrent } from "@shared/manhuaKeyartLookState";
import {
  spawnManhuaDramaStudio,
  expandManhuaShotKeyartsAfterReverse,
  ensureManhuaFragmentClips,
  queuedManhuaClipBlocks,
  queuedManhuaKeyartBlocks,
  resolveManhuaFragmentRunTargets,
  runManhuaDramaFactoryPipeline,
} from "./canvasDramaStudio";
import {
  buildLocalCloudDraftSnapshot,
  serializeCloudDraftForUpload,
  cloudDraftBlocksToCanvas,
  tryLoadLocalCanvas,
  trySaveLocalCanvas,
} from "./manhuaCloudDraftSync";
import { parseManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import { normalizeCanvasBlock, type CanvasBlock } from "./canvasTypes";

const model = "seedance-2.0-mini";
function setup(
  ep = 1,
  durations = [...Array.from({ length: 28 }, () => 4), 18]
) {
  let cursor = 0;
  const text = [
    "| # | 秒位 | 景别·运镜 | 画面 | 台词/字幕 | 音效·配乐 |",
    "|---|---|---|---|---|---|",
    ...durations.map((duration, index) => {
      const start = cursor;
      cursor += duration;
      return `| ${index + 1} | ${start}-${cursor} | 缓推 | 原稿动作${index + 1} | 对白${index + 1} | 风声 |`;
    }),
  ].join("\n");
  const spawned = spawnManhuaDramaStudio({
    topic: "自动分段测试",
    episodeIndex: ep,
    videoModel: model,
  });
  const reverse = spawned.blocks.find(block =>
    block.id.startsWith("reverse-")
  )!;
  const blocks = spawned.blocks.map(block =>
    block.id === reverse.id
      ? { ...block, outputText: text, status: "done" as const }
      : block
  );
  return { ...spawned, blocks, reverseId: reverse.id };
}
function compile(input: ReturnType<typeof setup>, ep = 1) {
  const expanded = expandManhuaShotKeyartsAfterReverse(
    input.blocks,
    input.edges,
    input.reverseId,
    { videoModel: model }
  );
  return ensureManhuaFragmentClips(expanded.blocks, expanded.edges, ep, {
    videoModel: model,
  });
}
function assertPlan(blocks: CanvasBlock[], ep = 1) {
  const clips = queuedManhuaClipBlocks(blocks, ep, model);
  expect(clips.length).toBeGreaterThan(6);
  expect(
    clips.every(
      block => block.id.includes("-auto-") && block.episodeIndex === ep
    )
  ).toBe(true);
  const bindings = clips.map(block => block.manhuaAutoSegment!);
  expect(bindings[0].sourceStartSec).toBe(0);
  expect(bindings.at(-1)!.sourceEndSec).toBe(130);
  for (let i = 1; i < bindings.length; i++)
    expect(bindings[i].sourceStartSec).toBe(bindings[i - 1].sourceEndSec);
  expect(new Set(bindings.flatMap(binding => binding.shotIndexes)).size).toBe(
    29
  );
  expect(
    clips.reduce(
      (sum, block) =>
        sum + block.manhuaEditTrim!.outSec - block.manhuaEditTrim!.inSec,
      0
    )
  ).toBe(130);
  expect(queuedManhuaKeyartBlocks(blocks, ep, model)).toHaveLength(29);
  return clips;
}

describe("原稿自动分段工厂、版本和草稿恢复", () => {
  it("旧原图保留但身份待复核，真实关键帧成功回填后解除，改稿再次失效并云恢复", async () => {
    const compiled = compile(setup(1, [5, 5, 5]));
    const key = queuedManhuaKeyartBlocks(compiled.blocks, 1)[0]!;
    const current = (b: CanvasBlock) =>
      isManhuaKeyartLookCurrent({
        ...b,
        manhuaKeyartLookState: b.manhuaKeyartSourceState,
      });
    const legacy = compiled.blocks.map(b =>
      b.id === key.id
        ? {
            ...b,
            outputUrl: "https://test.example/old.png",
            refImageUrl: "https://test.example/asset-reference.png",
          }
        : b
    );
    expect(current(legacy.find(b => b.id === key.id)!)).toBe(false);
    const spy = vi
      .spyOn(canvasRunBlock, "runCanvasBlock")
      .mockResolvedValue({ outputUrl: "https://test.example/new.png" });
    try {
      const result = await runManhuaDramaFactoryPipeline({
        deps: { optimizeCopy: async () => "" },
        blocks: legacy,
        edges: compiled.edges,
        episodeIndex: 1,
        untilStage: "keyart",
        forceFromStage: "keyart",
        targetBlockIds: [key.id],
        maxRetries: 0,
      });
      const generated = result.blocks.find(b => b.id === key.id)!;
      expect(result.errors).toEqual([]);
      expect(spy).toHaveBeenCalled();
      expect(current(generated)).toBe(true);
      const changed = result.blocks.map(b =>
        b.id.startsWith("reverse-")
          ? {
              ...b,
              outputText: b.outputText!.replace("原稿动作1", "改变动作1"),
            }
          : b
      );
      const next = ensureManhuaFragmentClips(changed, compiled.edges, 1, {
        videoModel: model,
      });
      const invalid = next.blocks.find(b => b.id === key.id)!;
      expect(invalid.outputUrl).toBe(generated.outputUrl);
      expect(current(invalid)).toBe(false);
      const snapshot = buildLocalCloudDraftSnapshot({
        writerSession: {},
        blocks: next.blocks,
        edges: next.edges,
      });
      const restored = cloudDraftBlocksToCanvas(
        parseManhuaCloudDraftPayload(serializeCloudDraftForUpload(snapshot)!)!
          .canvas.blocks
      );
      expect(
        restored.find(b => b.id === key.id)!.manhuaKeyartSourceState
      ).toEqual(invalid.manhuaKeyartSourceState);
    } finally {
      spy.mockRestore();
    }
  });
  it("不足半秒源窗明确阻断，不能因后期下限而扩大或丢尾", () => {
    expect(() => compile(setup(1, [15, 0.2]))).toThrow(/不足0.5秒/);
  });
  it("29原镜130秒铺完整计划，长镜两段共用原静帧且多集不串队列", () => {
    const first = compile(setup());
    const second = compile(setup(2), 2);
    const blocks = [...first.blocks, ...second.blocks];
    const clips = assertPlan(blocks);
    assertPlan(blocks, 2);
    const long = clips.filter(block =>
      block.manhuaAutoSegment!.shotIndexes.includes(29)
    );
    expect(long.length).toBeGreaterThan(1);
    expect(new Set(long.map(block => block.parentId)).size).toBe(1);
    for (const block of long) {
      const targets = resolveManhuaFragmentRunTargets(
        blocks,
        1,
        block.manhuaAutoSegment!.segmentIndex
      );
      expect(targets.keyartId).toBe(block.parentId);
    }
  });
  it("本机和云端往返保留自动段源窗及修订身份", () => {
    const compiled = compile(setup());
    let text = "";
    expect(
      trySaveLocalCanvas(compiled.blocks, compiled.edges, {
        setItem: (_key, value) => {
          text = value;
        },
      })
    ).toBe(true);
    const local = tryLoadLocalCanvas({ getItem: () => text })!;
    assertPlan(local.blocks);
    const snapshot = buildLocalCloudDraftSnapshot({
      writerSession: {},
      blocks: local.blocks,
      edges: local.edges,
    });
    const json = serializeCloudDraftForUpload(snapshot)!;
    const restored = cloudDraftBlocksToCanvas(
      parseManhuaCloudDraftPayload(json)!.canvas.blocks
    );
    expect(assertPlan(restored).map(block => block.manhuaAutoSegment)).toEqual(
      assertPlan(compiled.blocks).map(block => block.manhuaAutoSegment)
    );
  });
  it("旧稿未返回视频但已有任务号时也保留归档，不拷贝任务到新计划", () => {
    const input = setup();
    const prior = input.blocks.find(block => block.id.startsWith("clip-"))!;
    input.blocks = input.blocks.map(block =>
      block.id === prior.id
        ? ({
            ...block,
            status: "running",
            videoTaskId: "test-old-running",
            videoTaskStatus: "running",
          } as CanvasBlock)
        : block
    );
    const next = compile(input);
    expect(next.blocks.find(block => block.id === prior.id)).toMatchObject({
      archivedFromPreviousScript: true,
      videoTaskId: "test-old-running",
      status: "running",
    });
    expect(assertPlan(next.blocks).every(block => !block.videoTaskId)).toBe(
      true
    );
  });
  it("换原稿后不拿旧媒体/待核对任务冒充新段，不删除旧关键帧", () => {
    const compiled = compile(setup());
    const prior = assertPlan(compiled.blocks)[0];
    const oldImage = queuedManhuaKeyartBlocks(compiled.blocks, 1, model).at(
      -1
    )!;
    const changed = compiled.blocks.map(block =>
      block.id === prior.id
        ? {
            ...block,
            outputUrl: "https://test.example/paid.mp4",
            outputUrls: ["https://test.example/paid.mp4"],
            videoTaskId: "test-pending",
            videoTaskStatus: "reconcile_manual" as const,
          }
        : block.id === oldImage.id
          ? {
              ...block,
              outputUrl: "https://test.example/paid.png",
              outputUrls: ["https://test.example/paid.png"],
            }
          : block.id.startsWith("reverse-")
            ? {
                ...block,
                outputText: block.outputText!.replace("原稿动作1", "全新动作1"),
              }
            : block
    );
    const next = ensureManhuaFragmentClips(changed, compiled.edges, 1, {
      videoModel: model,
    });
    expect(next.blocks.find(block => block.id === prior.id)).toMatchObject({
      archivedFromPreviousScript: true,
      outputUrl: "https://test.example/paid.mp4",
      videoTaskId: "test-pending",
    });
    const current = queuedManhuaClipBlocks(next.blocks, 1, model)[0];
    expect(current.id).not.toBe(prior.id);
    expect(current.outputUrl).toBeUndefined();
    expect(current.videoTaskId).toBeUndefined();
    expect(next.blocks.find(block => block.id === oldImage.id)?.outputUrl).toBe(
      "https://test.example/paid.png"
    );
    const stable = ensureManhuaFragmentClips(next.blocks, next.edges, 1, {
      videoModel: model,
    });
    expect(
      queuedManhuaClipBlocks(stable.blocks, 1, model).map(block => block.id)
    ).toEqual(
      queuedManhuaClipBlocks(next.blocks, 1, model).map(block => block.id)
    );
  });
});
