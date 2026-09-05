import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const media = vi.hoisted(() => ({
  tailFrames: vi.fn(async (_url: string, _options?: unknown) => ({
    frames: [],
  })),
  duration: vi.fn(async (_url: string) => 10),
}));
vi.mock("./extractVideoFrames", () => ({
  extractVideoTailFramesFromUrl: media.tailFrames,
  extractVideoFramesFromUrl: vi.fn(),
}));
vi.mock("./videoUpscaleApi", () => ({ probeVideoDurationSec: media.duration }));
vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) =>
    run(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));

import { defaultCanvasBlock } from "./canvasTypes";
import { runCanvasBlock } from "./canvasRunBlock";
import { applyManhuaVideoEditInstruction } from "./manhuaMediaVersions";
import { applyFactoryPrefsToBlocks } from "./canvasDramaStudio";

const RESULT = "https://test.invalid/edited.mp4";
const instruction = "只在第 2 至 4 秒移除画面右侧路人，补全其后墙面";
const deps = {
  userId: "test-user",
  userRole: "admin",
  optimizeCopy: async () => "",
};
let requests: Array<Record<string, unknown>>;

function editBlock(source: string) {
  return {
    ...defaultCanvasBlock("video", 0, 0),
    id: "clip-e01-g02",
    episodeIndex: 1,
    videoModel: "seedance-2.5" as const,
    seedance25WorkMode: "video_edit" as const,
    refVideoUrl: source,
    seedance25RefVideoUrls: [source],
    refImageUrl: "https://test.invalid/old-generation-keyframe.png",
    prompt: applyManhuaVideoEditInstruction(
      "【第2段·10s】\n0–5s：旧剧情跳窗逃跑\n5–10s：旧对白不要回头\n【连续】承上段旧末帧\n",
      instruction
    ),
  };
}

beforeEach(() => {
  requests = [];
  media.tailFrames.mockClear();
  media.duration.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== "/api/jobs?op=seedanceI2V" || init?.method !== "POST") {
        throw new Error("测试禁止真实网络与未声明请求");
      }
      requests.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({ ok: true, videoUrl: RESULT, workMode: "video_edit" })
      );
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("已有成片编辑的真实出站请求（无网络）", () => {
  it.each(["seedance-2.0", "seedance-2.5", "wan-3.0", "minimax-hailuo-3"])(
    "%s 原片编辑只提交本次修改，不重新演出旧生成剧情",
    async sourceEngine => {
      const source = `https://test.invalid/${sourceEngine}.mp4`;
      const block = editBlock(source);
      const before = JSON.stringify(block);
      const [prepared] = applyFactoryPrefsToBlocks([block], {});
      const result = await runCanvasBlock(deps, prepared!, {
        visionImages: [],
        texts: ["旧上游预告：天崩地裂"],
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        version: "2.5",
        workMode: "video_edit",
        videoUrls: [source],
        duration: 10,
        editSourceDurationSec: 10,
        episodeIndex: 1,
        clipIndex: 2,
      });
      expect(requests[0]?.prompt).toContain(instruction);
      expect(requests[0]?.prompt).toContain("@视频1");
      expect(requests[0]?.prompt).toContain("保留");
      expect(requests[0]?.prompt).not.toMatch(
        /旧剧情|旧对白|旧末帧|天崩地裂|剪辑手法/
      );
      expect(requests[0]?.imageUrls).toBeUndefined();
      expect(requests[0]?.audioUrls).toBeUndefined();
      // 只抽编辑结果的尾帧；原片不是上一段，不应先把原片结尾喂成首帧。
      expect(media.tailFrames.mock.calls.map(call => call[0])).toEqual([
        RESULT,
      ]);
      expect(media.duration).toHaveBeenCalledWith(source);
      expect(result.outputUrl).toBe(RESULT);
      expect(JSON.stringify(block)).toBe(before);
    }
  );

  it("缺少明确原片时不借用上游视频冒充，不提交", async () => {
    const block = { ...editBlock(""), seedance25RefVideoUrls: [] };
    await expect(
      runCanvasBlock(deps, block, {
        texts: [],
        visionImages: [{ url: "https://test.invalid/unrelated.mp4" }],
      })
    ).rejects.toThrow("原片");
    expect(requests).toHaveLength(0);
  });

  it("缺少本次编辑指令时不把旧生成 prompt 当作编辑要求", async () => {
    const block = {
      ...editBlock("https://test.invalid/source.mp4"),
      prompt: "旧剧情跳窗",
    };
    await expect(runCanvasBlock(deps, block)).rejects.toThrow("编辑要求");
    expect(requests).toHaveLength(0);
  });

  it("未获编辑资格的用户仍被原会员权限拦截", async () => {
    await expect(
      runCanvasBlock(
        { ...deps, userRole: "user", userPlan: "free" },
        editBlock("https://test.invalid/source.mp4")
      )
    ).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
});
