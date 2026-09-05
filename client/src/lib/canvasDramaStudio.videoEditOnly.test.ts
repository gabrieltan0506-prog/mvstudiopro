import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCanvasBlock, type CanvasBlock } from "./canvasTypes";
import * as canvasRunBlock from "./canvasRunBlock";
import { runManhuaDramaFactoryPipeline } from "./canvasDramaStudio";
import { applyManhuaVideoEditInstruction } from "./manhuaMediaVersions";
import { hasFailedManhuaVideoEdit } from "./manhuaFactoryRunIntent";
import { buildLocalCloudDraftSnapshot, cloudDraftBlocksToCanvas } from "./manhuaCloudDraftSync";
import {
  emptyManhuaClipQualityChecks,
  manhuaClipQualityAllowsAssemble,
  type ManhuaClipQualityReport,
} from "@shared/manhuaClipQuality";

afterEach(() => vi.restoreAllMocks());

const oldQuality: ManhuaClipQualityReport = {
  status: "passed",
  checks: Object.fromEntries(
    Object.keys(emptyManhuaClipQualityChecks()).map((key) => [key, true]),
  ) as ManhuaClipQualityReport["checks"],
  failedKeys: [],
  summary: "原片已审阅",
  raw: "原片检查结果",
  reviewedAt: "2026-09-05T00:00:00Z",
  attempts: 1,
  userAcceptedDespiteQc: true,
};

function preparedEdit(): CanvasBlock {
  return {
    ...defaultCanvasBlock("video", 0, 0),
    id: "clip-e01-g02",
    episodeIndex: 1,
    videoModel: "seedance-2.5",
    seedance25WorkMode: "video_edit",
    refVideoUrl: "https://test.invalid/source.mp4",
    seedance25RefVideoUrls: ["https://test.invalid/source.mp4"],
    outputUrl: "https://test.invalid/source.mp4",
    outputUrls: ["https://test.invalid/source.mp4"],
    lastFrameUrl: "https://test.invalid/source-tail.jpg",
    manhuaClipQuality: oldQuality,
    prompt: applyManhuaVideoEditInstruction("【第2段·10s】旧生成稿", "把右侧灯笼改成蓝色"),
  };
}

describe("已有原片编辑不重新制作资产", () => {
  it("工作台提交即保存任务号，后续失败publish和云恢复不丢原任务、不重下单", async () => {
    const target = preparedEdit();
    const published: CanvasBlock[][] = [];
    const callback = vi.fn();
    const run = vi.spyOn(canvasRunBlock, "runCanvasBlock").mockImplementation(async (deps, block) => {
      deps.onVideoTaskCreated?.(block.id, {taskId: "test-pending-edit", engine: "seedance-2.5"});
      expect(published.at(-1)?.find(b => b.id === target.id)?.videoTaskId).toBe("test-pending-edit");
      throw new Error("任务仍待核对");
    });
    const result = await runManhuaDramaFactoryPipeline({
      deps: {optimizeCopy: async () => "", onVideoTaskCreated: callback},
      blocks: [target], edges: [], episodeIndex: 1, untilStage: "clip", forceFromStage: "clip",
      targetBlockIds: [target.id], preservePreparedTargetBlocks: true,
      onBlocksChange: blocks => published.push(blocks),
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(target.id, {taskId: "test-pending-edit", engine: "seedance-2.5"});
    const cloud = buildLocalCloudDraftSnapshot({writerSession: {}, blocks: result.blocks, edges: []});
    const [restored] = cloudDraftBlocksToCanvas(cloud.canvas.blocks);
    expect(restored).toMatchObject({
      videoTaskId: "test-pending-edit", videoTaskEngine: "seedance-2.5", videoTaskStatus: "running",
      status: "error", outputUrl: target.outputUrl, seedance25WorkMode: "video_edit",
    });
    expect(restored.outputUrls).toEqual(target.outputUrls);
    expect(hasFailedManhuaVideoEdit([restored], [1])).toBe(true);
  });
  it.each(["没有分镜", "已有反推文本", "有静帧节点但未出图"])(
    "%s：只编辑指定原片，不补图也不改动其他段",
    async (caseName) => {
      const target = preparedEdit();
      const other: CanvasBlock = {
        ...defaultCanvasBlock("video", 100, 0),
        id: "clip-e01-g01",
        episodeIndex: 1,
        videoModel: "wan-3.0",
        prompt: "前一段成片已经锁定",
        status: "done",
        outputUrl: "https://test.invalid/other.mp4",
        outputUrls: ["https://test.invalid/other.mp4"],
      };
      const extras: CanvasBlock[] = caseName === "已有反推文本"
        ? [{
            ...defaultCanvasBlock("text", 0, 100),
            id: "reverse-e01-test",
            episodeIndex: 1,
            status: "done",
            outputText: "1. 人物走入走廊\n2. 人物回头\n3. 门扇关闭\n4. 灯笼亮起\n5. 人物驻足\n6. 人物离开",
          }]
        : caseName === "有静帧节点但未出图"
          ? [{
              ...defaultCanvasBlock("image", 0, 100),
              id: "keyart-e01-s04-test",
              episodeIndex: 1,
              prompt: "只是一条未生成静帧节点",
            }]
          : [];
      const input = [other, target, ...extras];
      const snapshots: CanvasBlock[][] = [];
      const run = vi.spyOn(canvasRunBlock, "runCanvasBlock")
        .mockResolvedValue({ outputUrl: "https://test.invalid/edited.mp4" });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("禁止未声明网络"));
      const result = await runManhuaDramaFactoryPipeline({
        deps: { optimizeCopy: async () => "" },
        blocks: input,
        edges: [],
        episodeIndex: 1,
        untilStage: "clip",
        forceFromStage: "clip",
        fragmentShotIndex: 2,
        targetBlockIds: [target.id],
        preservePreparedTargetBlocks: true,
        onBlocksChange: (blocks) => snapshots.push(blocks),
        ensureOptions: { videoModel: "wan-3.0" },
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0]?.[1]).toMatchObject({
        id: target.id,
        prompt: target.prompt,
        videoModel: "seedance-2.5",
        seedance25WorkMode: "video_edit",
        refVideoUrl: target.refVideoUrl,
      });
      expect(result.completedIds).toEqual([target.id]);
      expect(result.errors).toEqual([]);
      expect(result.blocks.map((block) => block.id)).toEqual(input.map((block) => block.id));
      for (const snapshot of [...snapshots, result.blocks]) {
        expect(snapshot.filter((block) => block.id !== target.id))
          .toEqual(input.filter((block) => block.id !== target.id));
      }
      const edited = result.blocks.find((block) => block.id === target.id)!;
      expect(edited.outputUrls).toEqual(["https://test.invalid/edited.mp4", target.refVideoUrl]);
      expect(edited.manhuaClipQuality?.status).toBe("unverified");
      expect(edited.manhuaClipQuality?.userAcceptedDespiteQc).toBe(false);
      expect(edited.lastFrameUrl).toBeUndefined();
      for (const snapshot of snapshots) {
        const current = snapshot.find((block) => block.id === target.id)!;
        if (current.outputUrl === target.outputUrl) {
          expect(current.manhuaClipQuality).toEqual(oldQuality);
          expect(current.lastFrameUrl).toBe(target.lastFrameUrl);
        } else {
          expect(current.manhuaClipQuality?.status).toBe("unverified");
        }
      }
      expect(manhuaClipQualityAllowsAssemble({
        outputUrl: edited.outputUrl,
        quality: edited.manhuaClipQuality,
      })).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("同段有两个节点、部分静帧完成时，仍只调用点选的那个视频", async () => {
    const target = { ...preparedEdit(), status: "done" as const };
    const other = {
      ...target,
      id: "clip-e01-g02-older",
      videoModel: "wan-3.0" as const,
      seedance25WorkMode: undefined,
      prompt: "【第2段·10s】同段的另一个成品不要改",
      outputUrl: "https://test.invalid/other.mp4",
    };
    const keys: CanvasBlock[] = [4, 5, 6].map((shot) => ({
      ...defaultCanvasBlock("image", 0, 100),
      id: `keyart-e01-s0${shot}-test`,
      episodeIndex: 1,
      prompt: `第${shot}镜静帧`,
      outputUrl: shot === 4 ? "https://test.invalid/still.jpg" : undefined,
      status: shot === 4 ? "done" : "idle",
    }));
    // 即使旧图存在错误提要连接，编辑操作也不能顺便改写其他图节点。
    const story = {
      ...defaultCanvasBlock("text", 0, 200),
      id: "story-e01-test",
      parentId: "recap_card-e01-test",
      prompt: "既有故事原文",
    };
    const input = [other, target, ...keys, story];
    const run = vi.spyOn(canvasRunBlock, "runCanvasBlock")
      .mockResolvedValue({ outputUrl: "https://test.invalid/edited.mp4" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ ok: true, report: oldQuality }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const snapshots: CanvasBlock[][] = [];
    const result = await runManhuaDramaFactoryPipeline({
      deps: { optimizeCopy: async () => "" }, blocks: input, edges: [],
      episodeIndex: 1, untilStage: "clip", fragmentShotIndex: 2,
      targetBlockIds: [target.id], preservePreparedTargetBlocks: true,
      // 保留原片的 done 状态也必须执行明确的新编辑，不能按有成片跳过。
      skipDone: true,
      onBlocksChange: (blocks) => snapshots.push(blocks),
      ensureOptions: { videoModel: "wan-3.0" },
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[1].id).toBe(target.id);
    expect(run.mock.calls[0]?.[2]).toEqual({ visionImages: [], texts: [] });
    expect(result.completedIds).toEqual([target.id]);
    expect(result.errors).toEqual([]);
    for (const snapshot of [...snapshots, result.blocks]) {
      expect(snapshot.filter((block) => block.id !== target.id))
        .toEqual(input.filter((block) => block.id !== target.id));
    }
    // 此轮保留现有质检 API；有旧静帧时仍走原接口，不能伪称已对比原片。
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body.videoUrl).toBe("https://test.invalid/edited.mp4");
    expect(body.referenceImageUrl).toBe(keys[0]!.outputUrl);
  });

  it.each(["网络失败", "无结果", "已取消"])("%s：原片、旧质检、尾帧和全部历史仍保留", async (failure) => {
    const target = { ...preparedEdit(), status: "done" as const };
    target.outputUrls.push(...Array.from({ length: 12 }, (_, i) => `https://test.invalid/v${i}.mp4`));
    const snapshots: CanvasBlock[][] = [];
    const run = vi.spyOn(canvasRunBlock, "runCanvasBlock");
    if (failure === "无结果") run.mockResolvedValue({});
    else run.mockRejectedValue(new Error(failure === "网络失败" ? "Failed to fetch" : "已取消"));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("禁止网络"));
    const result = await runManhuaDramaFactoryPipeline({
      deps: { optimizeCopy: async () => "" }, blocks: [target], edges: [],
      episodeIndex: 1, untilStage: "clip", fragmentShotIndex: 2,
      targetBlockIds: [target.id], preservePreparedTargetBlocks: true, maxRetries: 4,
      onBlocksChange: (blocks) => snapshots.push(blocks),
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.completedIds).toEqual([]);
    expect(result.errors).toHaveLength(1);
    for (const snapshot of [...snapshots, result.blocks]) {
      expect(snapshot[0]).toMatchObject({
        outputUrl: target.outputUrl,
        outputUrls: target.outputUrls,
        lastFrameUrl: target.lastFrameUrl,
        manhuaClipQuality: oldQuality,
      });
    }
    expect(result.blocks[0]?.status).toBe("error");
  });

  it.each(["集号错", "段号错", "多目标", "重复身份", "原片无效", "模型错误"])(
    "%s：编辑请求拒绝且不触发补图或另一段生成",
    async (invalid) => {
      const target = preparedEdit();
      if (invalid === "原片无效") target.seedance25RefVideoUrls = ["https://"];
      if (invalid === "模型错误") target.videoModel = "wan-3.0";
      const input = invalid === "重复身份" ? [target, { ...target }] : [target];
      const run = vi.spyOn(canvasRunBlock, "runCanvasBlock");
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("禁止网络"));
      const publish = vi.fn();
      const result = await runManhuaDramaFactoryPipeline({
        deps: { optimizeCopy: async () => "" }, blocks: input, edges: [],
        episodeIndex: invalid === "集号错" ? 2 : 1,
        untilStage: "clip", fragmentShotIndex: invalid === "段号错" ? 1 : 2,
        targetBlockIds: invalid === "多目标" ? [target.id, "clip-e01-g01"] : [target.id],
        preservePreparedTargetBlocks: true, onBlocksChange: publish,
      });
      expect(result.blocks).toEqual(input);
      expect(result.completedIds).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(run).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it("失败后通用续跑被拦，用户回原编辑入口确认后只重试所选原片一次", async () => {
    const target = { ...preparedEdit(), status: "error" as const, error: "Failed to fetch" };
    const other = {
      ...defaultCanvasBlock("video", 0, 100),
      id: "clip-e01-g01", episodeIndex: 1, status: "done" as const,
      videoModel: "wan-3.0" as const, prompt: "已完成的第一段",
      outputUrl: "https://test.invalid/other.mp4",
    };
    expect(hasFailedManhuaVideoEdit([other, target], [1])).toBe(true);
    const run = vi.spyOn(canvasRunBlock, "runCanvasBlock")
      .mockResolvedValue({ outputUrl: "https://test.invalid/manual-retry.mp4" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("禁止网络"));
    const result = await runManhuaDramaFactoryPipeline({
      deps: { optimizeCopy: async () => "" }, blocks: [other, target], edges: [],
      episodeIndex: 1, untilStage: "clip", fragmentShotIndex: 2,
      targetBlockIds: [target.id], preservePreparedTargetBlocks: true,
      ensureOptions: { videoModel: "wan-3.0" },
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[1]).toMatchObject({
      id: target.id, seedance25WorkMode: "video_edit", videoModel: "seedance-2.5",
      refVideoUrl: target.refVideoUrl,
    });
    expect(result.blocks[0]).toEqual(other);
    expect(result.blocks[1]?.outputUrls).toEqual(["https://test.invalid/manual-retry.mp4", target.outputUrl]);
    expect(result.errors).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
