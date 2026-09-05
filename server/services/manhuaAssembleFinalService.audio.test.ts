import { describe, expect, it, vi } from "vitest";
const render = vi.hoisted(() =>
  vi.fn(async (_input: unknown) => "https://test.invalid/final.mp4")
);
vi.mock("../vercel-api-core/render.js", () => ({
  renderWorkflowFinalVideo: render,
}));
import { runManhuaAssembleFinal } from "./manhuaAssembleFinalService";

describe("漫剧成片原声入口", () => {
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
});
