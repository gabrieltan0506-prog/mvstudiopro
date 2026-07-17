import { describe, expect, it } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import {
  collectManhuaClipDockItems,
  episodeIndexesFromDockSelection,
  exportManhuaProjectZip,
} from "./manhuaProjectExport";

describe("manhuaProjectExport", () => {
  it("collects keyart/clip/omni/story with outputs, grouped by episode", () => {
    const key = defaultCanvasBlock("image", 0, 0);
    key.id = "keyart-e01-a";
    key.episodeIndex = 1;
    key.episodeTitle = "开局";
    key.outputUrl = "https://cdn.example/k1.jpg";
    key.status = "done";

    const clip = defaultCanvasBlock("video", 0, 0);
    clip.id = "clip-e02-b";
    clip.episodeIndex = 2;
    clip.outputUrl = "https://cdn.example/c2.mp4";
    clip.status = "done";

    const idle = defaultCanvasBlock("video", 0, 0);
    idle.id = "clip-e01-c";
    idle.episodeIndex = 1;

    const story = defaultCanvasBlock("text", 0, 0);
    story.id = "story-e01-d";
    story.episodeIndex = 1;
    story.outputText = "# ep1\n钩子";
    story.status = "done";

    const items = collectManhuaClipDockItems([key, clip, idle, story]);
    expect(items.map((i) => i.blockId)).toEqual(["keyart-e01-a", "story-e01-d", "clip-e02-b"]);
    expect(episodeIndexesFromDockSelection(items, ["clip-e02-b", "keyart-e01-a"])).toEqual([1, 2]);
  });

  it("builds zip with manifest and ep folders", async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })) as typeof fetch;

    try {
      const items = collectManhuaClipDockItems([
        {
          ...defaultCanvasBlock("image", 0, 0),
          id: "keyart-e01-x",
          episodeIndex: 1,
          episodeTitle: "一",
          outputUrl: "https://cdn.example/a.jpg",
          status: "done",
        },
        {
          ...defaultCanvasBlock("video", 0, 0),
          id: "clip-e01-y",
          episodeIndex: 1,
          outputUrl: "https://cdn.example/b.mp4",
          status: "done",
        },
      ]);
      const { blob, filename, manifest, okCount } = await exportManhuaProjectZip({
        items,
        selectedIds: items.map((i) => i.blockId),
        topic: "测试题材",
        seriesTitle: "测试系列",
      });
      expect(filename).toBe("mv-manhua-ep01.zip");
      expect(okCount).toBe(2);
      expect(manifest.failed).toHaveLength(0);
      expect(manifest.note).toContain("不含自动拼接");
      expect(blob.size).toBeGreaterThan(40);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});
