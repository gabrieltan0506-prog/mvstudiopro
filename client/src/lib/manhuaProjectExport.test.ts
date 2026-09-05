import { describe, expect, it } from "vitest";
import { MANHUA_CLIP_QUALITY_KEYS } from "@shared/manhuaClipQuality";
import { defaultCanvasBlock } from "./canvasTypes";
import {
  collectManhuaAssembleClipsFromDock,
  collectManhuaClipDockItems,
  episodeIndexesFromDockSelection,
  exportManhuaProjectZip,
  listManhuaExportLibraryRefPaths,
  selectExportableDockIds,
  summarizeManhuaDockExport,
} from "./manhuaProjectExport";

const passedQuality = {
  status: "passed" as const,
  checks: Object.fromEntries(MANHUA_CLIP_QUALITY_KEYS.map((key) => [key, true])) as Record<
    (typeof MANHUA_CLIP_QUALITY_KEYS)[number],
    boolean
  >,
  failedKeys: [],
  summary: "全部通过",
  raw: "",
  attempts: 1,
  reviewedAt: "2026-07-20T00:00:00.000Z",
};

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
    clip.manhuaClipQuality = passedQuality;

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

  it("keeps failed quality clips visible but blocks export until user accepts", () => {
    const clip = defaultCanvasBlock("video", 0, 0);
    clip.id = "clip-e01-failed";
    clip.episodeIndex = 1;
    clip.outputUrl = "https://cdn.example/failed.mp4";
    clip.status = "done";
    clip.manhuaClipQuality = {
      ...passedQuality,
      status: "failed",
      checks: { ...passedQuality.checks, CHARACTER_MATCH: false },
      failedKeys: ["CHARACTER_MATCH"],
      summary: "人物与首镜无关",
      userAcceptedDespiteQc: false,
    };
    const items = collectManhuaClipDockItems([clip]);
    expect(items).toHaveLength(1);
    expect(selectExportableDockIds(items)).toEqual([]);
    expect(collectManhuaAssembleClipsFromDock(items)[0]?.clipUrl).toBeUndefined();

    clip.manhuaClipQuality = { ...clip.manhuaClipQuality!, userAcceptedDespiteQc: true };
    const accepted = collectManhuaClipDockItems([clip]);
    expect(selectExportableDockIds(accepted)).toEqual(["clip-e01-failed"]);
    expect(collectManhuaAssembleClipsFromDock(accepted)[0]?.clipUrl).toBe(
      "https://cdn.example/failed.mp4",
    );
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
          manhuaClipQuality: passedQuality,
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
      expect(manifest.note).toMatch(/合成长片|工程包/);
      expect(blob.size).toBeGreaterThan(40);

      const withFinal = await exportManhuaProjectZip({
        items,
        selectedIds: items.map((i) => i.blockId),
        topic: "测试题材",
        seriesTitle: "测试系列",
        finalVideoUrl: "https://cdn.example/final.mp4",
      });
      expect(withFinal.manifest.finalVideoUrl).toBe("https://cdn.example/final.mp4");
      expect(withFinal.manifest.note).toContain("合成长片");
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("final-only 工程包保存当前版、历史版文件与长期任务身份", async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([7, 8, 9]), { status: 200 })) as typeof fetch;
    const current = "https://cdn.example/final-burned.mp4";
    const original = "https://cdn.example/final-original.mp4";
    const final = {
      ...defaultCanvasBlock("video", 0, 0),
      id: "final-e02",
      episodeIndex: 2,
      episodeTitle: "第二集",
      outputUrl: current,
      outputUrls: [current, original],
      manhuaFinalVersions: [
        {
          origin: "burn_subtitle" as const,
          url: current,
          jobId: "burn-2",
          gcsUri: "gs://bucket/final-burned.mp4",
          createdAt: 20,
        },
        {
          origin: "assemble" as const,
          url: original,
          jobId: "assemble-2",
          gcsUri: "gs://bucket/final-original.mp4",
          createdAt: 10,
        },
      ],
      manhuaFinalPostProd: {
        action: "burn_subtitle" as const,
        jobId: "burn-2",
        sourceUrl: original,
        sourceGcsUri: "gs://bucket/final-original.mp4",
        sourceSelected: false,
        status: "succeeded" as const,
        resultUrl: current,
        resultGcsUri: "gs://bucket/final-burned.mp4",
        resultSelected: true,
        updatedAt: 20,
      },
    };

    try {
      const result = await exportManhuaProjectZip({
        items: [],
        selectedIds: [],
        seriesTitle: "只含整集成片",
        finalVideoBlocks: [final],
        includeLibraryRefs: false,
      });
      expect(result.filename).toBe("mv-manhua-ep02-只含整集成片.zip");
      expect(result.okCount).toBe(2);
      expect(result.failCount).toBe(0);
      expect(result.manifest.finalVideos?.[0]?.versions).toEqual([
        expect.objectContaining({
          url: current,
          active: true,
          path: "ep02/final-v01.mp4",
          jobId: "burn-2",
          gcsUri: "gs://bucket/final-burned.mp4",
        }),
        expect.objectContaining({
          url: original,
          active: false,
          path: "ep02/final-v02.mp4",
          jobId: "assemble-2",
          gcsUri: "gs://bucket/final-original.mp4",
        }),
      ]);
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
      expect(zip.file("ep02/final-v01.mp4")).toBeTruthy();
      expect(zip.file("ep02/final-v02.mp4")).toBeTruthy();
      expect(await zip.file("manifest.json")!.async("string")).toContain(
        "gs://bucket/final-original.mp4",
      );
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("整集历史版本下载失败会进入 failed，不能被当成完整备份", async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) =>
      new Response(new Uint8Array([1]), {
        status: String(input).includes("old") ? 503 : 200,
      })) as typeof fetch;
    const final = {
      ...defaultCanvasBlock("video", 0, 0),
      id: "final-e01",
      episodeIndex: 1,
      outputUrl: "https://cdn.example/current.mp4",
      outputUrls: [
        "https://cdn.example/current.mp4",
        "https://cdn.example/old.mp4",
      ],
    };
    try {
      const result = await exportManhuaProjectZip({
        items: [],
        selectedIds: [],
        finalVideoBlocks: [final],
        includeLibraryRefs: false,
      });
      expect(result.okCount).toBe(1);
      expect(result.failCount).toBe(1);
      expect(result.manifest.failed[0]).toEqual(
        expect.objectContaining({ blockId: "final-e01#v2", url: "https://cdn.example/old.mp4" }),
      );
      expect(result.manifest.finalVideos?.[0]?.versions[1]?.path).toBeUndefined();
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
