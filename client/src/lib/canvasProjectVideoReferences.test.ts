import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";
import { buildManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import { defaultCanvasBlock, normalizeCanvasBlock } from "./canvasTypes";
import {
  blocksForCloudDraftSync,
  cloudDraftBlocksToCanvas,
} from "./manhuaCloudDraftSync";
import { rememberLocalMediaDisplay } from "./manhuaLocalMediaStore";
import { runCanvasBlock } from "./canvasRunBlock";
import { CanvasProjectVideoReferencePicker } from "../components/canvas/CanvasProjectVideoReferencePicker";
import {
  canSelectProjectVideoReferences,
  matchesProjectVideoReference,
  prepareProjectVideoReferences,
  projectVideoReferenceLimit,
  projectVideoReferenceUrls,
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
vi.mock("./extractVideoFrames", () => ({
  extractVideoTailFramesFromUrl: async () => ({
    frames: [{ dataUrl: "https://test.invalid/tail.png" }],
  }),
}));
afterEach(() => vi.unstubAllGlobals());

const ref = (id: number): ManhuaCustomAssetRef => ({
  id: `test-ref-${id}`,
  role: "character",
  labelZh: `测试角色${id}`,
  url: `https://storage.googleapis.com/test-bucket/generated/test/${id}.png?signature=test-old`,
  gcsUri: `gs://test-bucket/generated/test/${id}.png`,
});
const refs = Array.from({ length: 17 }, (_, index) => ref(index + 1));
const node = () => ({
  ...defaultCanvasBlock("video", 0, 0),
  id: "video-test",
  videoModel: "seedance-2.0-mini" as const,
  prompt:
    "【第1段·10s】0–10s：参考图1的马站在参考图2的人物身旁，镜头缓慢推近。",
  outputUrl: "https://test.invalid/old.mp4",
  outputUrls: ["https://test.invalid/old.mp4"],
});

describe("普通视频节点复用本集图片", () => {
  it("续签期间切换项目后不再签下一张，也不返回可提交载荷", async () => {
    const selected = refs.slice(0, 2).reduce(toggleProjectVideoReference, node());
    let current = true;
    const refresh = vi.fn(async (source: { url: string }) => {
      current = false;
      return source.url;
    });
    await expect(prepareProjectVideoReferences(selected, refs, refresh, () => current)).rejects.toThrow(/项目或账号/);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("显式选择按次序进入首图与附图，取消首图顺移，不触碰旧产物", () => {
    const original = node();
    const one = toggleProjectVideoReference(original, refs[0]);
    const two = toggleProjectVideoReference(one, refs[1]);
    expect(projectVideoReferenceUrls(two)).toEqual([refs[0].url, refs[1].url]);
    expect(two.outputUrls).toBe(original.outputUrls);
    expect(two.outputUrl).toBe(original.outputUrl);
    const removed = toggleProjectVideoReference(two, refs[0]);
    expect(removed.refImageUrl).toBe(refs[1].url);
    expect(removed.editFusionUrls).toEqual([]);
    expect(projectVideoReferenceUrls(original)).toEqual([]);
  });
  it("九图模式拒第十图，待审图不可加，超限旧稿仍能移除", () => {
    const nine = refs.slice(0, 9).reduce(toggleProjectVideoReference, node());
    expect(() => toggleProjectVideoReference(nine, refs[9])).toThrow(/上限/);
    expect(() =>
      toggleProjectVideoReference(node(), {
        ...refs[0],
        reviewStatus: "needs_review",
      })
    ).toThrow(/确认/);
    const old = {
      ...nine,
      editFusionUrls: refs.slice(1, 10).map(item => item.url),
    };
    expect(
      projectVideoReferenceUrls(toggleProjectVideoReference(old, refs[0]))
    ).toHaveLength(9);
  });
  it("十六图经本机规范化、云保存与恢复不丢图，不依赖上传列表", () => {
    const selected = refs
      .slice(0, 16)
      .reduce(toggleProjectVideoReference, {
        ...node(),
        videoModel: "seedance-2.5" as const,
        seedance25WorkMode: "reference_to_video" as const,
      });
    expect(() => toggleProjectVideoReference(selected, refs[16])).toThrow(
      /上限/
    );
    const normalized = normalizeCanvasBlock(selected);
    expect(projectVideoReferenceUrls(normalized)).toHaveLength(16);
    const draft = buildManhuaCloudDraftPayload({
      clientUpdatedAt: "2026-09-08T00:00:00Z",
      writerSession: {},
      blocks: blocksForCloudDraftSync([normalized]),
      edges: [],
    });
    const restored = cloudDraftBlocksToCanvas(draft.canvas.blocks)[0];
    expect(restored.uploadedAssets).toEqual([]);
    const restoredUrls = projectVideoReferenceUrls(restored);
    expect(restoredUrls).toHaveLength(16);
    for (let index = 0; index < 16; index++)
      expect(
        matchesProjectVideoReference(restoredUrls[index], refs[index])
      ).toBe(true);
  });
  it("签名变化、本机blob和站内稳定链仍识别同一图，不串同名异图", () => {
    expect(
      matchesProjectVideoReference(
        refs[0].url.replace("test-old", "test-new"),
        refs[0]
      )
    ).toBe(true);
    expect(
      matchesProjectVideoReference(
        "/api/canvas-media/generated/test/1.png",
        refs[0]
      )
    ).toBe(true);
    expect(
      matchesProjectVideoReference(refs[1].url, {
        ...refs[0],
        labelZh: refs[1].labelZh,
      })
    ).toBe(false);
    rememberLocalMediaDisplay({
      displayUrl: "blob:test-project-ref",
      pointer: "local-media:v1/test-project-ref",
      sourceUrl: refs[0].url,
    });
    expect(matchesProjectVideoReference("blob:test-project-ref", refs[0])).toBe(
      true
    );
  });
  it("两张现签图片进入真实运行请求，十秒、旧输出和原引用不被改写", async () => {
    const submitted: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url !== "/api/jobs?op=seedanceI2V" || init?.method !== "POST")
          throw new Error("禁止真实网络");
        submitted.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({ ok: true, videoUrl: "https://test.invalid/new.mp4" })
        );
      })
    );
    const selected = refs
      .slice(0, 2)
      .reduce(toggleProjectVideoReference, node());
    const refresh = vi.fn(async (source: { url: string }) =>
      source.url.replace("test-old", "test-fresh")
    );
    const prepared = await prepareProjectVideoReferences(
      selected,
      refs,
      refresh
    );
    const result = await runCanvasBlock(
      { userRole: "admin", optimizeCopy: async () => "" },
      prepared
    );
    expect(result.outputUrl).toBe("https://test.invalid/new.mp4");
    expect(submitted).toHaveLength(1);
    expect(submitted[0].imageUrls).toEqual(
      refs.slice(0, 2).map(item => item.url.replace("test-old", "test-fresh"))
    );
    expect(submitted[0].duration).toBe(10);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(selected.refImageUrl).toBe(refs[0].url);
    expect(selected.outputUrl).toBe("https://test.invalid/old.mp4");
  });
  it("接力尾帧会挤掉第九图时不发付费请求", async () => {
    const fetcher = vi.fn(() => {
      throw new Error("不应发网络");
    });
    vi.stubGlobal("fetch", fetcher);
    const selected = refs
      .slice(0, 9)
      .reduce(toggleProjectVideoReference, node());
    const prepared = await prepareProjectVideoReferences(
      selected,
      refs,
      async source => source.url
    );
    await expect(
      runCanvasBlock(
        { userRole: "admin", optimizeCopy: async () => "" },
        { ...prepared, refVideoUrl: "https://test.invalid/continuity.mp4" }
      )
    ).rejects.toThrow(/接力尾帧/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("续签失败、待审或切至文生模式均在生成前拒绝", async () => {
    const selected = toggleProjectVideoReference(node(), refs[0]);
    await expect(
      prepareProjectVideoReferences(selected, refs, async () => {
        throw new Error("测试签名失败");
      })
    ).rejects.toThrow("测试签名失败");
    await expect(
      prepareProjectVideoReferences(selected, [
        { ...refs[0], reviewStatus: "needs_review" },
      ])
    ).rejects.toThrow(/待确认/);
    const textOnly = {
      ...selected,
      videoModel: "seedance-2.5" as const,
      seedance25WorkMode: "text_to_video" as const,
    };
    expect(projectVideoReferenceLimit(textOnly)).toBe(0);
    await expect(prepareProjectVideoReferences(textOnly, refs)).rejects.toThrow(
      /上限/
    );
    expect(
      projectVideoReferenceLimit({
        ...textOnly,
        seedance25WorkMode: "image_to_video",
      })
    ).toBe(2);
  });
  it("空资产和工厂节点保持原路径，不请求续签", async () => {
    const refresh = vi.fn();
    const selected = toggleProjectVideoReference(node(), refs[0]);
    expect(await prepareProjectVideoReferences(selected, [], refresh)).toBe(
      selected
    );
    for (const id of [
      "clip-e01-g01",
      "omni_edit-e01",
      "keyart-e01-s01",
      "final-e01",
    ]) {
      const factory = { ...selected, id };
      expect(canSelectProjectVideoReferences(factory)).toBe(false);
      expect(await prepareProjectVideoReferences(factory, refs, refresh)).toBe(
        factory
      );
    }
    expect(refresh).not.toHaveBeenCalled();
  });
  it("界面展示实际顺序、已选数及可逆按钮，空列表不加空壳", () => {
    const selected = refs
      .slice(0, 2)
      .reduce(toggleProjectVideoReference, node());
    const props = { block: selected, refs, disabled: false, onToggle: vi.fn() };
    const html = renderToStaticMarkup(
      React.createElement(CanvasProjectVideoReferencePicker, props)
    );
    expect(html).toContain("已有资产");
    expect(html).toContain("移除资产 测试角色1");
    expect(html).toContain("参考图 2");
    expect(
      renderToStaticMarkup(
        React.createElement(CanvasProjectVideoReferencePicker, {
          ...props,
          refs: [],
        })
      )
    ).toBe("");
  });
});
