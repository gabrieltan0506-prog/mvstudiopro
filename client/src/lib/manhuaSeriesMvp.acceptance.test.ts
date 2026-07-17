/**
 * 阿硕对齐 MVP 手测清单的可机器验收（不烧 API）。
 * 对应 ~/Downloads/2026Jul18/jobstodo.md §6
 */
import { describe, expect, it } from "vitest";
import {
  filterBlocksByEpisode,
  resolveManhuaFactoryOrderedIds,
  spawnManhuaDramaStudioSeries,
} from "./canvasDramaStudio";
import {
  collectManhuaClipDockItems,
  episodeIndexesFromDockSelection,
  exportManhuaProjectZip,
} from "./manhuaProjectExport";
import { defaultCanvasBlock } from "./canvasTypes";
import { composeWriterPackFactoryContext, type ManhuaWriterPack } from "@shared/manhuaWriterRoom";

function fakePack(): ManhuaWriterPack {
  return {
    seriesTitle: "石门冷光",
    logline: "外门弟子闯秘境",
    charactersMd: "女主青衫",
    propsMd: "玉佩",
    locationsMd: "石门",
    episodeCount: 3,
    rawMarkdown: "x".repeat(200),
    episodes: [
      { index: 1, title: "石门异响", body: "听见异响", endHook: "门缝透出冷光" },
      { index: 2, title: "冷光之后", body: "推门", endHook: "身后有人叫她本名" },
      { index: 3, title: "本名", body: "回头", endHook: "玉佩碎裂" },
    ],
  };
}

describe("manhua series MVP acceptance (jobstodo §6)", () => {
  it("3 集铺板：三行链 + 上集钩子 + 焦点集 orderedIds 不串集", () => {
    const pack = fakePack();
    const { blocks, episodeCount } = spawnManhuaDramaStudioSeries({
      topic: pack.seriesTitle,
      genreId: "xianxia",
      episodes: pack.episodes,
      writerContextForEpisode: (ep) => composeWriterPackFactoryContext(pack, ep.index),
      rowGap: 400,
    });
    expect(episodeCount).toBe(3);
    const stories = blocks.filter((b) => b.id.startsWith("story-"));
    expect(stories).toHaveLength(3);
    expect(stories[1]!.prompt).toContain("【上集钩子】门缝透出冷光");
    expect(stories[2]!.prompt).toContain("【上集钩子】身后有人叫她本名");
    expect(stories[1]!.prompt).toContain("## 本集优先：第2集《冷光之后》");

    const ep2Ids = resolveManhuaFactoryOrderedIds(blocks, "clip", 2);
    expect(ep2Ids).toHaveLength(6); // until clip，不含 omni_edit
    expect(ep2Ids.every((id) => id.includes("-e02-"))).toBe(true);
    expect(filterBlocksByEpisode(blocks, 1)).toHaveLength(7);
  });

  it("成片坞勾选 → 导出 zip 含 manifest 与 ep 目录", async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(".mp4")) {
        return new Response(new Uint8Array([0, 0, 0, 1]), { status: 200 });
      }
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 });
    }) as typeof fetch;

    try {
      const key1 = {
        ...defaultCanvasBlock("image", 0, 0),
        id: "keyart-e01-a",
        episodeIndex: 1,
        episodeTitle: "石门异响",
        outputUrl: "https://cdn.example/ep1.jpg",
        status: "done" as const,
      };
      const clip2 = {
        ...defaultCanvasBlock("video", 0, 400),
        id: "clip-e02-b",
        episodeIndex: 2,
        episodeTitle: "冷光之后",
        outputUrl: "https://cdn.example/ep2.mp4",
        status: "done" as const,
      };
      const items = collectManhuaClipDockItems([key1, clip2]);
      expect(items).toHaveLength(2);
      const selected = [key1.id, clip2.id];
      expect(episodeIndexesFromDockSelection(items, selected)).toEqual([1, 2]);

      const { blob, filename, manifest, okCount } = await exportManhuaProjectZip({
        items,
        selectedIds: selected,
        topic: "石门冷光",
        seriesTitle: "石门冷光",
      });
      expect(filename).toBe("mv-manhua-series.zip");
      expect(okCount).toBe(2);
      expect(manifest.note).toContain("不含自动拼接");
      expect(manifest.selected.some((s) => s.path?.startsWith("ep01/"))).toBe(true);
      expect(manifest.selected.some((s) => s.path?.startsWith("ep02/"))).toBe(true);
      expect(blob.size).toBeGreaterThan(50);

      const JSZip = (await import("jszip")).default;
      const buf = await blob.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      expect(zip.file("manifest.json")).toBeTruthy();
      expect(Object.keys(zip.files).some((p) => p.startsWith("ep01/"))).toBe(true);
      expect(Object.keys(zip.files).some((p) => p.startsWith("ep02/"))).toBe(true);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});
