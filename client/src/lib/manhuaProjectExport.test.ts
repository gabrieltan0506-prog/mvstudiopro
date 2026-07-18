import { describe, expect, it } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import {
  collectManhuaClipDockItems,
  episodeIndexesFromDockSelection,
  exportManhuaProjectZip,
  listManhuaExportLibraryRefPaths,
  selectExportableDockIds,
  summarizeManhuaDockExport,
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

  it("includes pending story so dock can select episodes before outputs exist", () => {
    const story1 = defaultCanvasBlock("text", 0, 0);
    story1.id = "story-e01-p";
    story1.episodeIndex = 1;
    story1.episodeTitle = "开局";
    const story2 = defaultCanvasBlock("text", 0, 400);
    story2.id = "story-e02-q";
    story2.episodeIndex = 2;
    story2.episodeTitle = "转折";

    const items = collectManhuaClipDockItems([story1, story2]);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.label.includes("待跑"))).toBe(true);
    expect(episodeIndexesFromDockSelection(items, [story1.id, story2.id])).toEqual([1, 2]);

    const exportOnly = collectManhuaClipDockItems([story1, story2], { includePendingStory: false });
    expect(exportOnly).toHaveLength(0);
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
      expect(filename).toBe("mv-manhua-ep01-测试系列.zip");
      expect(okCount).toBe(2);
      expect(manifest.failed).toHaveLength(0);
      expect(manifest.note).toContain("不含自动拼接");
      expect(blob.size).toBeGreaterThan(40);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("exports bible/beats text and selectExportable helpers", async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([9, 9]), { status: 200 })) as typeof fetch;
    try {
      const bible = defaultCanvasBlock("text", 0, 0);
      bible.id = "bible-e01-a";
      bible.episodeIndex = 1;
      bible.outputText = "## 角色\n沈清";
      bible.status = "done";
      const beats = defaultCanvasBlock("text", 0, 0);
      beats.id = "beats-e02-b";
      beats.episodeIndex = 2;
      beats.episodeTitle = "反转";
      beats.outputText = "镜1…";
      beats.status = "done";
      const pending = defaultCanvasBlock("text", 0, 0);
      pending.id = "story-e03-c";
      pending.episodeIndex = 3;

      const items = collectManhuaClipDockItems([bible, beats, pending]);
      expect(items.map((i) => i.stage).sort()).toEqual(["beats", "bible", "story"]);
      expect(selectExportableDockIds(items)).toEqual(["bible-e01-a", "beats-e02-b"]);
      const sum = summarizeManhuaDockExport(items);
      expect(sum.episodeCount).toBe(3);
      expect(sum.exportableCount).toBe(2);

      const { filename, okCount, manifest } = await exportManhuaProjectZip({
        items,
        selectedIds: selectExportableDockIds(items),
        seriesTitle: "深宫棋子",
      });
      expect(okCount).toBe(2);
      expect(filename).toContain("series");
      expect(filename).toContain("深宫棋子");
      expect(manifest.selected.some((s) => s.path === "ep01/bible.md")).toBe(true);
      expect(manifest.selected.some((s) => s.path === "ep02/beats.md")).toBe(true);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("lists reusable library ref paths for characters and scene demos", () => {
    const refs = listManhuaExportLibraryRefPaths({
      characterIds: ["char_f_01", "char_m_01"],
      artStyleId: "photoreal",
      sceneId: "scene_06",
      demoAssetIds: ["demo_prop_ancient_jade"],
    });
    expect(refs.some((r) => r.kind === "character" && r.id === "char_f_01")).toBe(true);
    expect(refs.some((r) => r.publicPath.includes("char_m_01_sheet"))).toBe(true);
    expect(refs.some((r) => r.id === "demo_prop_ancient_jade")).toBe(true);
  });

  it("embeds writer-pack.md when provided", async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([1]), { status: 200 })) as typeof fetch;
    try {
      const key = defaultCanvasBlock("image", 0, 0);
      key.id = "keyart-e01-w";
      key.episodeIndex = 1;
      key.outputUrl = "https://cdn.example/k.jpg";
      key.status = "done";
      const items = collectManhuaClipDockItems([key]);
      const { blob } = await exportManhuaProjectZip({
        items,
        selectedIds: [key.id],
        writerPackMarkdown: "## 系列标题\n测试\n",
        includeLibraryRefs: false,
      });
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      expect(zip.file("writer-pack.md")).toBeTruthy();
      const md = await zip.file("writer-pack.md")!.async("string");
      expect(md).toContain("系列标题");
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});
