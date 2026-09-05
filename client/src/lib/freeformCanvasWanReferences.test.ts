import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CanvasWanVideoReferencePicker,
  resolveCanvasVideoReferencePickerLimit,
  toggleCanvasVideoReferenceSelection,
} from "@/components/canvas/FreeformCanvas";
import type { CanvasUploadedAsset } from "./canvasTypes";

const videoAsset = (index: number): CanvasUploadedAsset => ({
  id: `video-${index}`,
  url: `https://cdn.example/video-${index}.mp4`,
  previewUrl: `https://cdn.example/video-${index}.jpg`,
  fileName: `参考视频-${index}.mp4`,
  kind: "video",
});

describe("FreeformCanvas · 引擎视频参考选择器", () => {
  it("Seedance 2.5 保持 10 条，Wan 3.0 独立使用 5 条真实上限", () => {
    expect(resolveCanvasVideoReferencePickerLimit("seedance-2.5")).toBe(10);
    expect(resolveCanvasVideoReferencePickerLimit("wan-3.0")).toBe(5);
    expect(resolveCanvasVideoReferencePickerLimit("minimax-hailuo-3")).toBeNull();
  });

  it("Wan 达到 5 条后不再追加、不截旧值；仍可取消任一已选视频", () => {
    const selected = Array.from({ length: 5 }, (_, index) => `https://cdn.example/${index}.mp4`);
    expect(
      toggleCanvasVideoReferenceSelection(selected, "https://cdn.example/overflow.mp4", 5),
    ).toEqual(selected);
    expect(toggleCanvasVideoReferenceSelection(selected, selected[2], 5)).toEqual([
      selected[0],
      selected[1],
      selected[3],
      selected[4],
    ]);
  });

  it("当前引擎面板直接展示已上传视频、绑定顺序与 5 条计数", () => {
    const assets = [
      ...Array.from({ length: 6 }, (_, index) => videoAsset(index + 1)),
      {
        ...videoAsset(99),
        id: "invalid-video",
        url: "javascript:alert(1)",
        fileName: "不可发送.mp4",
      },
    ];
    const html = renderToStaticMarkup(
      React.createElement(CanvasWanVideoReferencePicker, {
        uploadedAssets: assets,
        selectedUrls: assets.slice(0, 5).map((asset) => asset.url),
        onChange: vi.fn(),
      }),
    );
    expect(html).toContain('data-engine="wan-3.0"');
    expect(html).toContain('data-max-video-refs="5"');
    expect(html).toContain("动作与镜头参考视频");
    expect(html).toContain("已选 5/5");
    expect(html).toContain("参考视频 1–5");
    expect(html).toContain("参考视频-6.mp4");
    expect(html).toContain("disabled");
    expect(html).not.toContain("不可发送.mp4");
    expect(html).not.toContain("Wan 3.0");
    expect(html).not.toContain("Seedance");
  });

  it("从 Seedance 遗留 6 条时不静默裁成 5 条，而是全部保留并提示取消", () => {
    const assets = Array.from({ length: 6 }, (_, index) => videoAsset(index + 1));
    const html = renderToStaticMarkup(
      React.createElement(CanvasWanVideoReferencePicker, {
        uploadedAssets: assets,
        selectedUrls: assets.map((asset) => asset.url),
        onChange: vi.fn(),
      }),
    );
    expect(html).toContain("已选 6/5");
    expect(html).toContain("超过当前引擎上限");
    for (const asset of assets) expect(html).toContain(asset.fileName);
  });
});
