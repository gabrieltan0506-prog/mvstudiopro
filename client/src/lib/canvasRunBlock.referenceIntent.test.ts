import { afterEach, describe, expect, it, vi } from "vitest";
import { compileI2VMotionPrompt } from "@shared/jsonDirectorMiddleware";
import { MANHUA_CLIP_CONTINUITY_HINT_ZH } from "@shared/manhuaClipContinuity";
import { renderManhuaClipPromptForSeedance } from "@shared/manhuaClipPromptSanitize";
import { defaultCanvasBlock, type CanvasVideoModel } from "./canvasTypes";
import { runCanvasBlock } from "./canvasRunBlock";
import { extractVideoTailFramesFromUrl } from "./extractVideoFrames";
import { canvasAudioCueInputKey, createCanvasAudioCue, emptyCanvasAudioStudio } from "@shared/canvasAudioStudio";

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
  it("逐句声音从真实节点进入视频请求，不要求普通画布具备关键帧", async () => {
    const requests = offlineRequests("seedanceI2V");
    const cue = { ...createCanvasAudioCue("dialogue", "line-1"), speakerZh: "墨屠", voiceStateZh: "变身后", voice: "Dylan", textZh: "跟紧我。", shotZh: "抬头", approved: true, selectedTakeId: "take-1" };
    cue.takes.push({ id: "take-1", gcsUri: "gs://test-bucket/post-prod/1/line.wav", previewUrl: "", durationSec: 2, createdAt: "2026-09-08", inputKey: canvasAudioCueInputKey(cue) });
    const block = { ...defaultCanvasBlock("video", 0, 0), id: "video-audio-reference", videoModel: "seedance-2.5" as const, prompt: "【第1段·10s】墨屠抬头说话。", audioStudio: { ...emptyCanvasAudioStudio(), cues: [cue] } };
    await runCanvasBlock({ userRole: "admin", optimizeCopy: async () => "" }, block);
    expect(requests).toHaveLength(1);
    expect(requests[0].audioUrls).toEqual([cue.takes[0]!.gcsUri]);
    expect(requests[0].workMode).toBe("reference_to_video");
    expect(requests[0].prompt).toContain("@audio1仅对应墨屠（变身后）的对白{跟紧我。}");
    expect(requests[0].imageUrls).toBeUndefined();
  });
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

describe("Seedance 2.5 多模态参考：勾选视频是站位参考，不是上一段成片", () => {
  it("不抽尾帧、不追加镜头连续性提示，视频原样进 videoUrls", async () => {
    const requests = offlineRequests("seedanceI2V");
    const previs = "https://test.invalid/previs-blocking.mp4";
    const result = await runCanvasBlock(
      { userRole: "admin", optimizeCopy: async () => "" },
      {
        ...defaultCanvasBlock("video", 0, 0),
        id: "video-seedance25-reference",
        videoModel: "seedance-2.5",
        seedance25WorkMode: "reference_to_video",
        prompt: `【第1段·10s】${action}`,
        refImageUrl: images[0],
        refVideoUrl: previs,
      }
    );
    expect(result.outputUrl).toBe("https://test.invalid/result.mp4");
    expect(requests).toHaveLength(1);
    expect(requests[0].version).toBe("2.5");
    expect(requests[0].videoUrls).toEqual([previs]);
    expect(requests[0].imageUrls).toEqual([images[0]]);
    expect(requests[0].prompt).not.toContain("镜头连续性");
    expect(requests[0].prompt).not.toContain("上一段成片");
    expect(extractVideoTailFramesFromUrl).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("2.5 上游连线的上一段成片仍按接力：抽尾帧、加连续性提示、视频进 videoUrls", async () => {
    const requests = offlineRequests("seedanceI2V");
    const previous = "https://test.invalid/previous.mp4";
    await runCanvasBlock(
      { userRole: "admin", optimizeCopy: async () => "" },
      {
        ...defaultCanvasBlock("video", 0, 0),
        id: "video-seedance25-linked-continuity",
        videoModel: "seedance-2.5",
        seedance25WorkMode: "reference_to_video",
        prompt: `【第1段·10s】${action}`,
        // 自由画布连线：上游成片节点的 mp4 作为最近参考落在 refImageUrl（非用户勾选）
        refImageUrl: previous,
      }
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].version).toBe("2.5");
    expect(requests[0].videoUrls).toEqual([previous]);
    expect(requests[0].imageUrls).toEqual(["https://test.invalid/continuity-tail.png"]);
    expect(requests[0].prompt).toContain("镜头连续性");
    expect(extractVideoTailFramesFromUrl).toHaveBeenCalledTimes(1);
    expect(extractVideoTailFramesFromUrl).toHaveBeenCalledWith(previous, { frameCount: 4, tailWindowSec: 4 });
  });

  it("2.0 档勾选视频仍按上一段成片接力（行为不变）", async () => {
    const requests = offlineRequests("seedanceI2V");
    const previous = "https://test.invalid/previous.mp4";
    await runCanvasBlock(
      { userRole: "admin", optimizeCopy: async () => "" },
      {
        ...defaultCanvasBlock("video", 0, 0),
        id: "video-seedance20-continuity",
        videoModel: "seedance-2.0-mini",
        prompt: `【第1段·10s】${action}`,
        refImageUrl: images[0],
        refVideoUrl: previous,
      }
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].prompt).toContain("镜头连续性");
    expect(extractVideoTailFramesFromUrl).toHaveBeenCalledTimes(1);
  });
});

describe("Seedance 2.5：无扩展名的上传视频按上传记录 kind 进 videoUrls", () => {
  it("refVideoUrl 无 .mp4 后缀但 uploadedAssets 标记为 video 时不丢", async () => {
    const requests = offlineRequests("seedanceI2V");
    const noExt = "https://test.invalid/canvas/video/previs-no-extension";
    await runCanvasBlock(
      { userRole: "admin", optimizeCopy: async () => "" },
      {
        ...defaultCanvasBlock("video", 0, 0),
        id: "video-seedance25-noext",
        videoModel: "seedance-2.5",
        seedance25WorkMode: "reference_to_video",
        prompt: `【第1段·10s】${action}`,
        refImageUrl: images[0],
        refVideoUrl: noExt,
        uploadedAssets: [
          { id: "a1", url: noExt, previewUrl: noExt, fileName: "previs-no-extension", kind: "video", mimeType: "video/mp4" },
        ],
      }
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].videoUrls).toEqual([noExt]);
    expect(extractVideoTailFramesFromUrl).not.toHaveBeenCalled();
  });
});

describe("Seedance 2.5：用户参考视频与上游接力成片并存时，用户视频是 @视频1", () => {
  it("videoUrls 顺序为 [用户勾选视频, 上游接力视频]", async () => {
    const requests = offlineRequests("seedanceI2V");
    const previous = "https://test.invalid/previous.mp4";
    const previs = "https://test.invalid/previs-blocking.mp4";
    await runCanvasBlock(
      { userRole: "admin", optimizeCopy: async () => "" },
      {
        ...defaultCanvasBlock("video", 0, 0),
        id: "video-seedance25-both",
        videoModel: "seedance-2.5",
        seedance25WorkMode: "reference_to_video",
        prompt: `【第1段·10s】${action}`,
        refImageUrl: previous,
        refVideoUrl: previs,
      }
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].videoUrls).toEqual([previs, previous]);
    expect(extractVideoTailFramesFromUrl).toHaveBeenCalledWith(previous, { frameCount: 4, tailWindowSec: 4 });
  });
});

describe("Seedance 2.5：refVideoUrl 为空但上传记录里有视频时，视频仍进 videoUrls", () => {
  it("uploadedAssets 兜底不静默丢视频", async () => {
    const requests = offlineRequests("seedanceI2V");
    const uploaded = "https://test.invalid/canvas/video/previs.mp4";
    await runCanvasBlock(
      { userRole: "admin", optimizeCopy: async () => "" },
      {
        ...defaultCanvasBlock("video", 0, 0),
        id: "video-seedance25-uploaded-only",
        videoModel: "seedance-2.5",
        seedance25WorkMode: "reference_to_video",
        prompt: `【第1段·10s】${action}`,
        refImageUrl: images[0],
        uploadedAssets: [
          { id: "a1", url: uploaded, previewUrl: uploaded, fileName: "previs.mp4", kind: "video", mimeType: "video/mp4" },
        ],
      }
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].videoUrls).toEqual([uploaded]);
    expect(requests[0].prompt).not.toContain("镜头连续性");
    expect(extractVideoTailFramesFromUrl).not.toHaveBeenCalled();
  });
});
