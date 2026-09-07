import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import { runCanvasBlock } from "./canvasRunBlock";
import {
  prepareProjectVideoReferences,
  projectVideoReferenceFailurePatch,
  toggleProjectVideoReference,
} from "./canvasProjectVideoReferences";

vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) =>
    run(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));
afterEach(() => vi.unstubAllGlobals());

const asset = {
  id: "test-reference",
  role: "character" as const,
  labelZh: "离线参考图",
  url: "https://test.invalid/reference.png",
};
const node = () =>
  toggleProjectVideoReference(
    {
      ...defaultCanvasBlock("video", 0, 0),
      id: "video-failure-test",
      videoModel: "seedance-2.0-mini" as const,
      prompt: "【第1段·10s】0–10s：人物缓慢转身。",
      outputUrl: "https://test.invalid/previous.mp4",
      outputUrls: ["https://test.invalid/previous.mp4"],
    },
    asset
  );

describe("项目图片预检与运行失败分期恢复", () => {
  it.each(["资产列表变化", "连线变化"])(
    "%s后提交失败仍记录同账号节点错误，保留旧成片",
    async () => {
      const original = node();
      const prepared = await prepareProjectVideoReferences(
        original,
        [asset],
        async source => source.url
      );
      let finish!: (response: Response) => void;
      let requested!: () => void;
      const requestStarted = new Promise<void>(resolve => {
        requested = resolve;
      });
      const fetcher = vi.fn((url: string, init?: RequestInit) => {
        if (url !== "/api/jobs?op=seedanceI2V" || init?.method !== "POST")
          throw Error("禁止真实网络");
        requested();
        return new Promise<Response>(resolve => {
          finish = resolve;
        });
      });
      vi.stubGlobal("fetch", fetcher);
      let contextCurrent = true;
      const result = runCanvasBlock(
        { userRole: "admin", optimizeCopy: async () => "" },
        prepared
      ).catch(error =>
        projectVideoReferenceFailurePatch({
          guarded: true,
          generationStarted: true,
          contextCurrent,
          targetCurrent: true,
          error,
        })
      );
      await requestStarted;
      contextCurrent = false;
      finish(
        new Response(JSON.stringify({ ok: false, error: "测试提交被拒绝" }), {
          status: 403,
        })
      );
      const patch = await result;
      expect(patch).toMatchObject({ status: "error", error: "测试提交被拒绝" });
      const restored = { ...original, status: "running", ...patch };
      expect(restored.status).toBe("error");
      expect(restored.outputUrl).toBe(original.outputUrl);
      expect(restored.outputUrls).toEqual(original.outputUrls);
      expect(restored.videoTaskId).toBeUndefined();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it("预检中素材变化仍取消，零生成请求、不把旧状态写成错误", async () => {
    const fetcher = vi.fn(() => {
      throw Error("不应生成");
    });
    vi.stubGlobal("fetch", fetcher);
    let current = true;
    const original = node();
    const result = await prepareProjectVideoReferences(
      original,
      [asset],
      async source => {
        current = false;
        return source.url;
      },
      () => current
    ).catch(error =>
      projectVideoReferenceFailurePatch({
        guarded: true,
        generationStarted: false,
        contextCurrent: current,
        targetCurrent: true,
        error,
      })
    );
    expect(result).toBeNull();
    expect(original.status).toBe("idle");
    expect(original.outputUrl).toBe("https://test.invalid/previous.mp4");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["切换账号", "卸载画布", "目标节点移除"])(
    "%s后运行失败不写入新上下文",
    () => {
      expect(
        projectVideoReferenceFailurePatch({
          guarded: true,
          generationStarted: true,
          contextCurrent: false,
          targetCurrent: false,
          error: new Error("旧请求错误"),
        })
      ).toBeNull();
    }
  );

  it("同上下文续签失败可显示错误，未使用项目图的既有错误路径不变", () => {
    expect(
      projectVideoReferenceFailurePatch({
        guarded: true,
        generationStarted: false,
        contextCurrent: true,
        targetCurrent: true,
        error: new Error("测试签名失败"),
      })
    ).toEqual({ status: "error", error: "测试签名失败" });
    expect(
      projectVideoReferenceFailurePatch({
        guarded: false,
        generationStarted: true,
        contextCurrent: false,
        targetCurrent: false,
        error: new Error("原路径错误"),
      })
    ).toEqual({ status: "error", error: "原路径错误" });
  });
});
