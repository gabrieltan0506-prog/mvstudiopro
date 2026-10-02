import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ManhuaClipDock from "../components/canvas/ManhuaClipDock";
import { defaultCanvasBlock } from "./canvasTypes";

describe("失败段白模更换入口", () => {
  it("实际成片坞组件显示第三第四段换文件按钮，空产物仍不能合成", () => {
    const blocks = [3, 4].map((segment) => {
      const block = defaultCanvasBlock("video", 0, 0);
      block.id = `clip-e01-g0${segment}-test`;
      block.episodeIndex = 1; block.status = "error";
      block.prompt = `【第${segment}段】`;
      block.manhuaSegmentRefs = { previs: { url: "https://example.test/original.mp4", fileName: `第${segment}段原白模.mp4`, updatedAt: "2026-10-02T00:00:00Z" } };
      return block;
    });
    const markup = renderToStaticMarkup(React.createElement(ManhuaClipDock, {
      blocks, selectedIds: new Set<string>(), onSelectedIdsChange: () => {},
      onSegmentReferenceUpload: () => {},
    }));
    for (const segment of [3, 4]) {
      expect(markup).toContain(`manhua-segment-refs-clip-e01-g0${segment}-test`);
      expect(markup).toContain(`第${segment}段原白模.mp4（点击换文件）`);
    }
    expect(markup.match(/白模站位/g)?.length).toBeGreaterThanOrEqual(2);
    expect(markup).not.toContain("合成长片（2 段");
  });
});
