import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatVideoBreakdownRecreatePrompt } from "@shared/videoBreakdown";
import { videoBreakdownFixture as fixture } from "@shared/videoBreakdown.fixture";
import { buildVideoBreakdownBgmPrompt } from "@shared/videoBreakdownBgm";
import { formatVideoBreakdownRemakePrompt } from "@shared/videoBreakdownRemake";
import { buildVideoBreakdownCanvasBlocks } from "./videoBreakdownCanvasBlocks";
import {
  buildVideoBreakdownCanvasHandoff,
  clearVideoBreakdownCanvasHandoff,
  readVideoBreakdownCanvasHandoff,
  saveVideoBreakdownCanvasHandoff,
  videoBreakdownCanvasHandoffKey,
  videoBreakdownCanvasHref,
} from "./videoBreakdownCanvasHandoff";
import { videoBreakdownUploadHeaders } from "./videoBreakdownApi";
import { VIDEO_BREAKDOWN_CANVAS_NEXT_STEP, videoBreakdownCanvasImportSummary } from "@/components/canvas/VideoBreakdownCanvasImport";

const signed = (name: string) => `https://storage.googleapis.com/mv-bucket/video-breakdown/7/job1/${name}?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=abc`;
const clipUrls = [signed("c0.mp4"), signed("c1.mp4"), "", signed("c3.mp4")];
const all = [0, 1, 2, 3];

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), map };
}

describe("交接稿", () => {
  it("复刻：按段序，片段带签名地址与 gs:// 对象地址；空片段只带提示词；整片带配乐", () => {
    const h = buildVideoBreakdownCanvasHandoff({ jobId: "job1", result: fixture, clipUrls, segmentIndexes: [3, 0, 2, 1], includeBgm: true, now: new Date("2026-11-11T00:00:00Z") });
    expect(h.mode).toBe("recreate");
    expect(h.items.map(i => i.segmentIndex)).toEqual(all);
    expect(h.items[0]).toMatchObject({ heading: "片段 1 · 雨林潜行", rangeLabel: "00:00.0–00:04.2", prompt: formatVideoBreakdownRecreatePrompt(fixture.segments[0]) });
    expect(h.items[0].clip).toEqual({ url: clipUrls[0], gcsUri: "gs://mv-bucket/video-breakdown/7/job1/c0.mp4", fileName: "拉片片段1-雨林潜行.mp4" });
    expect(h.items[2].clip).toBeUndefined();
    expect(h.bgmPrompt).toBe(buildVideoBreakdownBgmPrompt(fixture));
    expect(JSON.stringify(h)).not.toContain("base64");
  });

  it("单段不带配乐；创作新片换主体并记录输入", () => {
    const one = buildVideoBreakdownCanvasHandoff({ jobId: "job1", result: fixture, clipUrls, segmentIndexes: [1], includeBgm: false });
    expect(one.items).toHaveLength(1);
    expect(one.bgmPrompt).toBeUndefined();
    const remake = { subject: "穿红雨衣的小女孩" };
    const h = buildVideoBreakdownCanvasHandoff({ jobId: "job1", result: fixture, clipUrls, segmentIndexes: all, includeBgm: true, remake });
    expect(h.mode).toBe("remake");
    expect(h.remake).toEqual(remake);
    h.items.forEach((item, i) => expect(item.prompt).toBe(formatVideoBreakdownRemakePrompt(fixture.segments[i], remake)));
    expect(() => buildVideoBreakdownCanvasHandoff({ jobId: "job1", result: fixture, segmentIndexes: [], includeBgm: true })).toThrow("没有可送入画布的分段");
  });

  it("按用户分键存取，校验后读回；清除后为空", () => {
    const storage = memoryStorage();
    const h = buildVideoBreakdownCanvasHandoff({ jobId: "job1", result: fixture, clipUrls, segmentIndexes: all, includeBgm: true });
    saveVideoBreakdownCanvasHandoff(storage, 7, h);
    expect(Array.from(storage.map.keys())).toEqual([videoBreakdownCanvasHandoffKey(7)]);
    expect(readVideoBreakdownCanvasHandoff(storage, 7)).toEqual(h);
    expect(readVideoBreakdownCanvasHandoff(storage, 8)).toBeNull();
    storage.setItem(videoBreakdownCanvasHandoffKey(9), JSON.stringify({ ...h, items: [] }));
    expect(() => readVideoBreakdownCanvasHandoff(storage, 9)).toThrow();
    clearVideoBreakdownCanvasHandoff(storage, 7);
    expect(readVideoBreakdownCanvasHandoff(storage, 7)).toBeNull();
    expect(videoBreakdownCanvasHref()).toBe("/canvas?from=lapian");
  });

  it("存不下时给业务提示", () => {
    const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => undefined };
    const h = buildVideoBreakdownCanvasHandoff({ jobId: "job1", result: fixture, segmentIndexes: [0], includeBgm: false });
    expect(() => saveVideoBreakdownCanvasHandoff(full, 7, h)).toThrow("浏览器暂存空间不足");
  });
});

describe("画布方块", () => {
  const h = buildVideoBreakdownCanvasHandoff({ jobId: "job1", result: fixture, clipUrls, segmentIndexes: all, includeBgm: true });

  it("每段一个参考生视频方块，按段序从左到右；片段挂为上传素材并预选为参考视频；末尾一个纯器乐配乐方块", () => {
    const blocks = buildVideoBreakdownCanvasBlocks(h, []);
    const videos = blocks.filter(b => b.kind === "video");
    expect(videos).toHaveLength(4);
    expect(videos.map(b => b.prompt)).toEqual(h.items.map(i => i.prompt));
    expect(videos.every(b => b.seedance25WorkMode === "reference_to_video")).toBe(true);
    expect(videos.map(b => b.x)).toEqual([...videos.map(b => b.x)].sort((a, b) => a - b));
    expect(new Set(videos.map(b => b.y)).size).toBe(1);
    expect(videos[0].uploadedAssets).toEqual([expect.objectContaining({ url: clipUrls[0], previewUrl: clipUrls[0], gcsUri: "gs://mv-bucket/video-breakdown/7/job1/c0.mp4", kind: "video", mimeType: "video/mp4" })]);
    expect(videos[0].seedance25RefVideoUrls).toEqual([clipUrls[0]]);
    expect(videos[2].uploadedAssets).toEqual([]);
    expect(videos[2].seedance25RefVideoUrls).toBeUndefined();
    const music = blocks.filter(b => b.kind === "music");
    expect(music).toHaveLength(1);
    expect(music[0].prompt).toBe(h.bgmPrompt);
    expect(music[0].musicMv).toMatchObject({ status: "idle", instrumental: true });
    expect(new Set(blocks.map(b => b.id)).size).toBe(blocks.length);
  });

  it("追加在已有方块下方，不与现有内容重叠", () => {
    const blocks = buildVideoBreakdownCanvasBlocks(h, [{ y: 100, height: 360 }, { y: 900, height: 400 }]);
    expect(Math.min(...blocks.map(b => b.y))).toBeGreaterThan(1300);
  });

  it("采用横幅说明：复刻 / 新片两种口径与段序说明", () => {
    expect(videoBreakdownCanvasImportSummary(h)).toBe("4 个视频方块（参考生视频，按段序从左到右，提示词为各段复刻提示词）；3 段附原片片段作参考视频；1 段片段未裁好，只带提示词，可自行上传参考；1 个配乐方块（纯器乐）");
    const r = buildVideoBreakdownCanvasHandoff({ jobId: "job1", result: fixture, clipUrls, segmentIndexes: all, includeBgm: true, remake: { subject: "小女孩" } });
    expect(videoBreakdownCanvasImportSummary(r)).toContain("只取动作与运镜，请在方块里补上你自己的主体外观参考图");
    expect(VIDEO_BREAKDOWN_CANVAS_NEXT_STEP).toContain("拼接成一支完整短视频");
  });

  it("横幅没有交接稿时不渲染", async () => {
    const { default: VideoBreakdownCanvasImport } = await import("@/components/canvas/VideoBreakdownCanvasImport");
    expect(renderToStaticMarkup(createElement(VideoBreakdownCanvasImport, { userId: 7, disabled: false, onApply: () => undefined }))).toBe("");
  });
});

describe("上传请求头", () => {
  it("带签名时的 Content-Type 与全部 requiredHeaders", () => {
    expect(videoBreakdownUploadHeaders("video/mp4", { "x-goog-content-length-range": "0,1024" })).toEqual([["Content-Type", "video/mp4"], ["x-goog-content-length-range", "0,1024"]]);
    expect(videoBreakdownUploadHeaders("video/mp4", { "content-type": "video/quicktime" })).toEqual([["Content-Type", "video/quicktime"]]);
    expect(videoBreakdownUploadHeaders("video/webm")).toEqual([["Content-Type", "video/webm"]]);
  });
});
