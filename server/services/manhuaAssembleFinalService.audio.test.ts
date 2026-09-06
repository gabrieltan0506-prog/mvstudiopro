import { beforeEach, describe, expect, it, vi } from "vitest";
const render = vi.hoisted(() =>
  vi.fn(async (_input: unknown) => "https://test.invalid/final.mp4")
);
vi.mock("../vercel-api-core/render.js", () => ({
  renderWorkflowFinalVideo: render,
}));
import { runManhuaAssembleFinal } from "./manhuaAssembleFinalService";
import type { ManhuaAssembleShotPieceInput } from "../../shared/manhuaFinalAssemble";
import type { ManhuaRenderedSubtitle } from "../../shared/manhuaRenderedSubtitle";
import { runPaidManhuaAssemble, type ManhuaAssembleBillingDeps } from "./manhuaAssembleBilling.js";

describe("漫剧成片原声入口", () => {
  beforeEach(() => {
    render.mockClear();
  });

  it("三段精确源窗口经过服务清洗后仍为 31 秒，备用 sceneVideos 入口也不舍入", async () => {
    const durations = [10.333333, 10.333334, 10.333333];
    await runManhuaAssembleFinal({ clips: durations.map((duration, i) => ({
      episodeIndex: 1, segmentIndex: i + 1, clipUrl: `https://test.invalid/${i}.mp4`,
      durationSec: 11, trimInSec: 0, trimOutSec: duration,
    })) });
    const input = render.mock.calls[0]?.[0] as { sceneVideos: Array<{ trimOutSec: number; duration: string }> };
    expect(input.sceneVideos.map(scene => scene.trimOutSec)).toEqual(durations);
    expect(input.sceneVideos.reduce((sum, scene) => sum + parseFloat(scene.duration), 0)).toBe(31);
    await runManhuaAssembleFinal({ sceneVideos: [{ sceneIndex: 1, url: "https://test.invalid/0.mp4", duration: "11s", trimInSec: 0.123456, trimOutSec: 10.333333 }] });
    expect(render.mock.calls[1]?.[0]).toMatchObject({ sceneVideos: [{ trimInSec: 0.123456, trimOutSec: 10.333333 }] });
  });

  it.each([
    { trimInSec: 0 }, { trimOutSec: 1 }, { trimInSec: -0.1, trimOutSec: 1 },
    { trimInSec: 0, trimOutSec: 0.49 }, { trimInSec: 1, trimOutSec: 0 },
    { trimInSec: 0, trimOutSec: NaN }, { trimInSec: null, trimOutSec: 1 },
  ])("clips 与 sceneVideos 都在 renderer 前拒绝非法裁切 %j", async trim => {
    await expect(runManhuaAssembleFinal({ clips: [{ episodeIndex: 1, clipUrl: "https://test.invalid/clip.mp4", ...trim } as any] })).rejects.toMatchObject({ code: "manhua_assemble_invalid_trim" });
    await expect(runManhuaAssembleFinal({ sceneVideos: [{ sceneIndex: 1, url: "https://test.invalid/clip.mp4", duration: "15s", ...trim } as any] })).rejects.toMatchObject({ code: "manhua_assemble_invalid_trim" });
    expect(render).not.toHaveBeenCalled();
  });

  it("旧稿镜片裁切无效时整次拒绝，不过滤坏镜片后播完整源片", async () => {
    await expect(runManhuaAssembleFinal({ clips: [{ episodeIndex: 1, clipUrl: "https://test.invalid/clip.mp4",
      shotPieces: [{ shotIndex: 1, trimInSec: 0, trimOutSec: 0.2 }],
    }] })).rejects.toMatchObject({ code: "manhua_assemble_invalid_trim" });
    expect(render).not.toHaveBeenCalled();
  });

  it("真实服务裁切拒绝经 worker 同款账本封装原路退款，renderer 不启动", async () => {
    const deps = {
      deduct: vi.fn(async () => ({ success: true, cost: 5, remainingBalance: 95, source: "personal" })),
      refundDirect: vi.fn(async () => {}), readHold: vi.fn(async () => null),
      register: vi.fn(async () => {}), refund: vi.fn(async () => ({})),
    };
    await expect(runPaidManhuaAssemble({ userId: 7, jobId: "test-invalid-trim", deps: deps as unknown as ManhuaAssembleBillingDeps,
      run: () => runManhuaAssembleFinal({ clips: [{ episodeIndex: 1, clipUrl: "https://test.invalid/clip.mp4", trimInSec: 0, trimOutSec: 0.2 }] }),
    })).rejects.toMatchObject({ code: "manhua_assemble_invalid_trim" });
    expect(deps.deduct).toHaveBeenCalledOnce();
    expect(deps.register).toHaveBeenCalledOnce();
    expect(deps.refund).toHaveBeenCalledOnce();
    expect(deps.refund).toHaveBeenCalledWith("test-invalid-trim", "manhuaFinalAssemble", "task_failed", "合成失败·退回积分");
    expect(render).not.toHaveBeenCalled();
  });

  it("实际渲染回执原样进入成片结果，不回退到请求中的计划秒位", async () => {
    const timeline: ManhuaRenderedSubtitle = {
      version: 1, textSource: "assembly_script_snapshot", timing: "rendered_shot_windows", durationSec: 8,
      cues: [{ shotIndex: 1, order: 1, startSec: 0, endSec: 8, textZh: "原句" }],
    };
    render.mockImplementationOnce(async input => {
      (input as { onSubtitleTimeline?: (value: ManhuaRenderedSubtitle) => void }).onSubtitleTimeline?.(timeline);
      return "https://test.invalid/final.mp4";
    });
    const result = await runManhuaAssembleFinal({ clips: [{ episodeIndex: 1,
      clipUrl: "https://test.invalid/source.mp4",
      subtitleSource: { shots: [{ shotIndex: 1, durationSec: 4, textZh: "原句" }] },
    }] });
    expect(result.subtitleTimeline).toEqual(timeline);
    expect(result.finalVideoUrl).toBe("https://test.invalid/final.mp4");
  });

  it("未选配乐时只合成原声，不隐式请求任何生成供应商", async () => {
    const noNetwork = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("禁止上游请求"));
    try {
      await runManhuaAssembleFinal({ clips: [{ episodeIndex: 1, clipUrl: "https://test.invalid/source.mp4" }], musicPrompt: "旧稿附带的配乐想法" });
      expect(noNetwork).not.toHaveBeenCalled();
      expect(render.mock.calls[0]?.[0]).toMatchObject({ preserveSourceAudio: true, musicUrl: undefined });
    } finally { noNetwork.mockRestore(); }
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
