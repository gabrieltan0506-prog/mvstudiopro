import { afterEach, describe, expect, it, vi } from "vitest";
import { compileI2VMotionPrompt } from "@shared/jsonDirectorMiddleware";
import { MANHUA_CLIP_CONTINUITY_HINT_ZH } from "@shared/manhuaClipContinuity";
import { renderManhuaClipPromptForSeedance } from "@shared/manhuaClipPromptSanitize";
import { defaultCanvasBlock, type CanvasVideoModel } from "./canvasTypes";
import { runCanvasBlock } from "./canvasRunBlock";
import { extractVideoTailFramesFromUrl } from "./extractVideoFrames";

vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) =>
    run(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));
vi.mock("./extractVideoFrames", () => ({
  // 抽帧边界只返回虚构的图片地址，不下载视频、不运行外部服务。
  extractVideoTailFramesFromUrl: vi.fn(async (url: string) => ({
    frames: [
      {
        dataUrl: url.endsWith("previous.mp4")
          ? "https://test.invalid/continuity-tail.png"
          : "https://test.invalid/result-tail.png",
      },
    ],
  })),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const engines: Array<[CanvasVideoModel, string]> = [
  ["seedance-2.0-mini", "seedanceI2V"],
  ["minimax-hailuo-3", "hailuo3Video"],
  ["happyhorse-1.1", "happyHorseVideo"],
  ["wan-3.0", "wan30Video"],
];
const images = [
  "https://test.invalid/identity.png",
  "https://test.invalid/partner.png",
];
const action =
  "0–10s：白色金角彩鬃四尾黑翼的马跃过深沟，四腿健康有力，阿菁翻身上马。";

function offlineRequests(op: string) {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== `/api/jobs?op=${op}` || init?.method !== "POST")
        throw Error("禁止真实网络");
      requests.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          ok: true,
          videoUrl: "https://test.invalid/result.mp4",
        })
      );
    })
  );
  return requests;
}

describe("普通视频参考职责不被自动改写", () => {
  it.each(engines)(
    "%s 的身份参考保持动作正文与图片顺序，不注入场景静帧或微动",
    async (videoModel, op) => {
      const requests = offlineRequests(op);
      // 当前共享 HappyHorse 图配额为一张，本轮只验证提示词，不扩改配额。
      const selectedImages =
        videoModel === "happyhorse-1.1" ? images.slice(0, 1) : images;
      const block = {
        ...defaultCanvasBlock("video", 0, 0),
        id: "video-reference-intent",
        videoModel,
        prompt: `【第1段·10s】图片只提供人物身份。${action}`,
        refImageUrl: selectedImages[0],
        editFusionUrls: selectedImages.slice(1),
        outputUrl: "https://test.invalid/previous.mp4",
      };
      const originalPrompt = block.prompt;
      const result = await runCanvasBlock(
        { userRole: "admin", optimizeCopy: async () => "" },
        block
      );
      expect(result.outputUrl).toBe("https://test.invalid/result.mp4");
      expect(requests).toHaveLength(1);
      expect(requests[0].prompt).toContain(action);
      expect(requests[0].prompt).toContain("图片只提供人物身份");
      expect(requests[0].prompt).not.toMatch(/参考静帧|场景材质|微动演绎/);
      expect(requests[0].imageUrls).toEqual(selectedImages);
      expect(requests[0].duration).toBe(10);
      expect(block.prompt).toBe(originalPrompt);
      expect(block.outputUrl).toBe("https://test.invalid/previous.mp4");
    }
  );

  it.each(engines)(
    "%s 保留用户显式首帧、静帧及动作指令",
    async (videoModel, op) => {
      const requests = offlineRequests(op);
      const explicit = "参考静帧作为首帧，开场保留场景材质；随后立即腾空跃起。";
      await runCanvasBlock(
        { userRole: "admin", optimizeCopy: async () => "" },
        {
          ...defaultCanvasBlock("video", 0, 0),
          id: "video-explicit-first-frame",
          videoModel,
          prompt: `【第1段·10s】${explicit}`,
          refImageUrl: images[0],
        }
      );
      expect(requests).toHaveLength(1);
      expect(requests[0].prompt).toContain(explicit);
      expect(requests[0].prompt).not.toContain("微动演绎");
    }
  );

  it.each(engines)(
    "%s 无图时维持原请求资格，不捏造参考静帧",
    async (videoModel, op) => {
      const requests = offlineRequests(op);
      const running = runCanvasBlock(
        { userRole: "admin", optimizeCopy: async () => "" },
        {
          ...defaultCanvasBlock("video", 0, 0),
          id: "video-no-reference",
          videoModel,
          prompt: `【第1段·10s】${action}`,
        }
      );
      if (videoModel === "wan-3.0" || videoModel === "happyhorse-1.1") {
        await expect(running).rejects.toThrow(/至少一张/);
        expect(requests).toEqual([]);
      } else {
        await running;
        expect(requests).toHaveLength(1);
        expect(requests[0].prompt).toContain(action);
        expect(requests[0].prompt).not.toMatch(/参考静帧|场景材质|微动演绎/);
        expect(requests[0].imageUrl).toBeUndefined();
        expect(requests[0].imageUrls).toBeUndefined();
      }
    }
  );

  it("空正文编译fallback和画布空输入门禁保持不变", async () => {
    expect(compileI2VMotionPrompt("")).toBe(
      "按参考静帧做可读微动；运镜与对白以提示词正文为准。"
    );
    const requests = offlineRequests("seedanceI2V");
    await expect(
      runCanvasBlock(
        { optimizeCopy: async () => "" },
        {
          ...defaultCanvasBlock("video", 0, 0),
          id: "video-empty",
          prompt: "",
        }
      )
    ).rejects.toThrow(/请先填写提示词/);
    expect(requests).toEqual([]);
  });

  it("普通节点接力保留原连续性说明，尾帧先于身份图进入实际请求", async () => {
    const requests = offlineRequests("seedanceI2V");
    const previous = "https://test.invalid/previous.mp4";
    const result = await runCanvasBlock(
      { userRole: "admin", optimizeCopy: async () => "" },
      {
        ...defaultCanvasBlock("video", 0, 0),
        id: "video-continuity-intent",
        videoModel: "seedance-2.0-mini",
        prompt: `【第1段·10s】${action}`,
        refImageUrl: images[0],
        refVideoUrl: previous,
      }
    );
    expect(result.outputUrl).toBe("https://test.invalid/result.mp4");
    expect(requests).toHaveLength(1);
    expect(requests[0].prompt).toContain(
      renderManhuaClipPromptForSeedance(MANHUA_CLIP_CONTINUITY_HINT_ZH)
    );
    expect(requests[0].prompt).toContain(action);
    expect(requests[0].prompt).not.toMatch(/参考静帧|微动演绎/);
    expect(requests[0].imageUrls).toEqual([
      "https://test.invalid/continuity-tail.png",
      images[0],
    ]);
    expect(requests[0].imageUrl).toBe(
      "https://test.invalid/continuity-tail.png"
    );
    expect(requests[0].videoUrls).toEqual([previous]);
    expect(extractVideoTailFramesFromUrl).toHaveBeenCalledTimes(1);
    expect(extractVideoTailFramesFromUrl).toHaveBeenCalledWith(
      previous,
      { frameCount: 4, tailWindowSec: 4 }
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("普通与clip对照：工厂静帧职责仍实际出站，正文及图片不丢失", async () => {
    const requests = offlineRequests("seedanceI2V");
    const base = {
      ...defaultCanvasBlock("video", 0, 0),
      videoModel: "seedance-2.0-mini" as const,
      prompt: `【第1段·10s】${action}`,
      refImageUrl: images[0],
    };
    const deps = { userRole: "admin", optimizeCopy: async () => "" };
    await runCanvasBlock(deps, { ...base, id: "video-ordinary-comparison" });
    const clip = await runCanvasBlock(deps, { ...base, id: "clip-e01-g01" });
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.prompt).toContain(action);
      expect(request.prompt).not.toContain("微动演绎");
      expect(request.imageUrls).toEqual([images[0]]);
      expect(request.duration).toBe(10);
    }
    expect(requests[0].prompt).not.toContain("为本段构图与光色基准");
    expect(requests[1].prompt).toContain("@图片1为本段构图与光色基准");
    expect(requests[1].prompt).toContain("只按秒轴改动作/口型/运镜");
    expect(clip.lastFrameUrl).toBe("https://test.invalid/result-tail.png");
    expect(extractVideoTailFramesFromUrl).toHaveBeenCalledTimes(1);
    expect(extractVideoTailFramesFromUrl).toHaveBeenCalledWith(
      "https://test.invalid/result.mp4",
      { frameCount: 1, tailWindowSec: 4 }
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
