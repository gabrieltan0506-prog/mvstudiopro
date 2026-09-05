import { beforeEach, describe, expect, it, vi } from "vitest";
const render = vi.hoisted(() =>
  vi.fn(async (_input: unknown) => "https://test.invalid/final.mp4")
);
vi.mock("../vercel-api-core/render.js", () => ({
  renderWorkflowFinalVideo: render,
}));
import { runManhuaAssembleFinal } from "./manhuaAssembleFinalService";
import type { ManhuaAssembleShotPieceInput } from "../../shared/manhuaFinalAssemble";

describe("漫剧成片原声入口", () => {
  beforeEach(() => {
    render.mockClear();
  });

  it("真实合成生产者显式保留原声和逐镜裁切，不新增生成请求", async () => {
    const result = await runManhuaAssembleFinal({
      clips: [
        {
          episodeIndex: 1,
          segmentIndex: 1,
          clipUrl: "https://test.invalid/clip.mp4",
          shotPieces: [{ shotIndex: 1, trimInSec: 1.2, trimOutSec: 2.4 }],
        },
      ],
      musicUrl: "https://test.invalid/music.mp3",
      transition: "cut",
    });
    expect(result.finalVideoUrl).toBe("https://test.invalid/final.mp4");
    expect(render).toHaveBeenCalledOnce();
    expect(render.mock.calls[0]?.[0]).toMatchObject({
      preserveSourceAudio: true,
      transition: "cut",
      musicUrl: "https://test.invalid/music.mp3",
      sceneVideos: [
        {
          url: "https://test.invalid/clip.mp4",
          trimInSec: 1.2,
          trimOutSec: 2.4,
        },
      ],
    });
  });

  it("保留 sanitizer 后的全局顺序并把跨段源片与裁切按 4,1,5,2,3,6 交给 renderer", async () => {
    await runManhuaAssembleFinal({
      clips: [
        {
          episodeIndex: 1,
          segmentIndex: 1,
          clipUrl: "https://test.invalid/s1.mp4",
          shotPieces: [
            { shotIndex: 1, timelineOrder: 2, trimInSec: 0, trimOutSec: 1 },
            { shotIndex: 2, timelineOrder: 4, trimInSec: 1, trimOutSec: 2 },
            { shotIndex: 3, timelineOrder: 5, trimInSec: 2, trimOutSec: 3 },
          ],
        },
        {
          episodeIndex: 1,
          segmentIndex: 2,
          clipUrl: "https://test.invalid/s2.mp4",
          shotPieces: [
            { shotIndex: 4, timelineOrder: 1, trimInSec: 10, trimOutSec: 11 },
            { shotIndex: 5, timelineOrder: 3, trimInSec: 11, trimOutSec: 12 },
            { shotIndex: 6, timelineOrder: 6, trimInSec: 12, trimOutSec: 13 },
          ],
        },
      ],
      musicUrl: "https://test.invalid/music.mp3",
      transition: "cut",
    });

    const input = render.mock.calls[0]?.[0] as {
      sceneVideos?: Array<{
        url?: string;
        trimInSec?: number;
        trimOutSec?: number;
      }>;
    };
    expect(
      input.sceneVideos?.map(scene => [
        scene.url,
        scene.trimInSec,
        scene.trimOutSec,
      ])
    ).toEqual([
      ["https://test.invalid/s2.mp4", 10, 11],
      ["https://test.invalid/s1.mp4", 0, 1],
      ["https://test.invalid/s2.mp4", 11, 12],
      ["https://test.invalid/s1.mp4", 1, 2],
      ["https://test.invalid/s1.mp4", 2, 3],
      ["https://test.invalid/s2.mp4", 12, 13],
    ]);
  });

  it.each([
    {
      name: "非法零值",
      pieces: [{ shotIndex: 1, timelineOrder: 0, trimInSec: 0, trimOutSec: 1 }],
    },
    {
      name: "部分缺失",
      pieces: [
        { shotIndex: 1, timelineOrder: 1, trimInSec: 0, trimOutSec: 1 },
        { shotIndex: 2, trimInSec: 1, trimOutSec: 2 },
      ],
    },
    {
      name: "唯一顺序重复镜号",
      pieces: [
        { shotIndex: 1, timelineOrder: 1, trimInSec: 0, trimOutSec: 1 },
        { shotIndex: 1, timelineOrder: 2, trimInSec: 1, trimOutSec: 2 },
      ],
    },
    {
      name: "有序镜片非法裁切",
      pieces: [
        { shotIndex: 1, timelineOrder: 1, trimInSec: 2, trimOutSec: 2.2 },
      ],
    },
    {
      name: "有序数组中的空镜片",
      pieces: [
        null,
        { shotIndex: 1, timelineOrder: 1, trimInSec: 0, trimOutSec: 1 },
      ],
    },
  ])("在 renderer 前拒绝 $name 的 timelineOrder", async ({ pieces }) => {
    await expect(
      runManhuaAssembleFinal({
        clips: [
          {
            episodeIndex: 1,
            segmentIndex: 1,
            clipUrl: "https://test.invalid/clip.mp4",
            shotPieces: pieces as unknown as ManhuaAssembleShotPieceInput[],
          },
        ],
        musicUrl: "https://test.invalid/music.mp3",
      })
    ).rejects.toMatchObject({ code: "manhua_assemble_invalid_timeline_order" });
    expect(render).not.toHaveBeenCalled();
  });
});
