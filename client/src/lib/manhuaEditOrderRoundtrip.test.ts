import { describe, expect, it } from "vitest";
import { buildManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import { buildManhuaAssemblePlan } from "@shared/manhuaFinalAssemble";
import { buildManhuaAssembleJobInput } from "@shared/manhuaAssembleJobInput";
import { buildManhuaManualClipEditTrim } from "@shared/manhuaEditAutoCut";
import {
  stampManhuaTimelineOrder,
  restoreManhuaRoughShotOrder,
} from "@shared/manhuaEditOrder";
import { defaultCanvasBlock, normalizeCanvasBlock } from "./canvasTypes";
import {
  cloudDraftBlocksToCanvas,
  slimBlocksForLocalPersist,
} from "./manhuaCloudDraftSync";
import {
  collectManhuaAssembleClipsFromDock,
  type ManhuaClipDockItem,
} from "./manhuaProjectExport";

describe("粗剪从生产者到合成的往返", () => {
  it("跨段六镜经过本机、云清洗、恢复及坞任务包装后，仍取正确源片区间", () => {
    const order = [4, 1, 5, 2, 3, 6];
    const blocks = [1, 2].map(segment =>
      normalizeCanvasBlock({
        ...defaultCanvasBlock("video", 0, 0),
        id: `clip-e01-g0${segment}-test`,
        episodeIndex: 1,
        manhuaEditTrim: (() => {
          const trim = buildManhuaManualClipEditTrim({
            videoDurationSec: 12,
            fineCutByShot: {},
            shots: [1, 2, 3].map(index => ({
              shotIndex: (segment - 1) * 3 + index,
              durationSec: 4,
            })),
          });
          return {
            ...trim,
            shotPieces: stampManhuaTimelineOrder(trim.shotPieces, order),
          };
        })(),
      })
    );
    const original = JSON.stringify(blocks);
    const local = slimBlocksForLocalPersist(blocks);
    const cloud = buildManhuaCloudDraftPayload({
      clientUpdatedAt: "2026-09-05T00:00:00Z",
      writerSession: {},
      blocks: local,
      edges: [],
    });
    const restored = cloudDraftBlocksToCanvas(
      JSON.parse(JSON.stringify(cloud.canvas.blocks))
    );
    const pieces = restored.flatMap(
      block => block.manhuaEditTrim?.shotPieces || []
    );
    expect(restoreManhuaRoughShotOrder(pieces, [1, 2, 3, 4, 5, 6])).toEqual(
      order
    );
    // 成片 URL 另由现有媒体恢复路径提供；本测试不冒充跨设备视频已恢复。
    const items: ManhuaClipDockItem[] = restored.map((block, index) => ({
      blockId: block.id,
      stage: "clip",
      episodeIndex: 1,
      label: `段${index + 1}`,
      kind: "video",
      outputUrl: `https://test.invalid/segment${index + 1}.mp4`,
      clipQuality: {
        status: "passed",
        checks: {} as never,
        failedKeys: [],
        summary: "测试",
        raw: "",
        attempts: 1,
        reviewedAt: "2026-09-05T00:00:00Z",
      },
    }));
    const clips = collectManhuaAssembleClipsFromDock(items, {
      blocks: restored,
    });
    const input = JSON.parse(
      JSON.stringify(buildManhuaAssembleJobInput({ clips }))
    );
    const plan = buildManhuaAssemblePlan(input.params.clips);
    expect(
      plan.sceneVideos.map(scene => [
        scene.url,
        scene.trimInSec,
        scene.trimOutSec,
      ])
    ).toEqual([
      [items[1]!.outputUrl, 0, 4],
      [items[0]!.outputUrl, 0, 4],
      [items[1]!.outputUrl, 4, 8],
      [items[0]!.outputUrl, 4, 8],
      [items[0]!.outputUrl, 8, 12],
      [items[1]!.outputUrl, 8, 12],
    ]);
    expect(JSON.stringify(blocks)).toBe(original);
  });

  it("清洗后的非法播放序号仍被合成拒绝，不会降级成旧稿", () => {
    const block = normalizeCanvasBlock({
      ...defaultCanvasBlock("video", 0, 0),
      id: "clip-e01-g01-bad",
      manhuaEditTrim: {
        inSec: 0,
        outSec: 4,
        shotPieces: [
          {
            shotIndex: 1,
            timelineOrder: Number.NaN,
            trimInSec: 0,
            trimOutSec: 4,
            durationSec: 4,
          },
        ],
      },
    });
    expect(block.manhuaEditTrim?.shotPieces?.[0]?.timelineOrder).toBe(0);
    const cloud = buildManhuaCloudDraftPayload({
      clientUpdatedAt: "2026-09-05T00:00:00Z",
      writerSession: {},
      blocks: [block],
      edges: [],
    });
    const restored = cloudDraftBlocksToCanvas(cloud.canvas.blocks);
    expect(() =>
      buildManhuaAssemblePlan([
        {
          episodeIndex: 1,
          clipUrl: "https://test.invalid/clip.mp4",
          shotPieces: restored[0]!.manhuaEditTrim!.shotPieces,
        },
      ])
    ).toThrow();
  });
});
