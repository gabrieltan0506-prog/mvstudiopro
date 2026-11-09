/**
 * 1110 MV 多人互动镜头 × 顾问白模（OmniCanvas 宿主侧）。全部替身：不渲染、不调模型、不扣费。
 * 从 OmniCanvas.tsx 原文切出真实函数体编译执行（同 advisorVideoAdoption.test.ts 写法）。
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { transform } from "esbuild";
import { setManhuaSegmentReference } from "@shared/manhuaSegmentReference";
import { createManhuaPrevisStudio, formatPrevisMotionGuide } from "@shared/manhuaPrevis";
import { buildMvShotPrevisStudio, mvPrevisAdvisorQuestion, type MvPrevisShot } from "@shared/canvasMusicMvPrevis";
import { requestsAdvisorPrevisRender } from "@/lib/manhuaAdvisorPrevisIntent";

const source = readFileSync("client/src/pages/OmniCanvas.tsx", "utf8");
const panelSource = readFileSync("client/src/components/canvas/ManhuaCreativeAdvisorPanel.tsx", "utf8");
function slice(start: string, end: string): string {
  const a = source.indexOf(start); const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`OmniCanvas 片段未找到：${start}`);
  return source.slice(a, b).trim();
}
async function compile<T>(names: string[], body: string, ret: string): Promise<(ctx: Record<string, unknown>) => T> {
  const { code } = await transform(`const {${names.join(",")}}=ctx;${body}`, { loader: "ts", target: "es2022" });
  return new Function("ctx", `${code};return ${ret};`) as (ctx: Record<string, unknown>) => T;
}

type Fn = (...args: any[]) => any;
let adoptRef: Fn;
let makeCurrentStudio: (ctx: Record<string, unknown>) => Fn;
let makeApply: (ctx: Record<string, unknown>) => Fn;
let makeOpen: (ctx: Record<string, unknown>) => Fn;

beforeAll(async () => {
  adoptRef = (await compile<Fn>(["setManhuaSegmentReference", "formatPrevisMotionGuide"],
    slice("export function adoptMvShotAdvisorPrevisReference", "function loadFactoryCharacterPrefs").replace(/^export /, ""),
    "adoptMvShotAdvisorPrevisReference"))({ setManhuaSegmentReference, formatPrevisMotionGuide });
  makeCurrentStudio = await compile<Fn>(["blocksRef", "getBlockEpisodeIndex", "writerFocusEpisode", "resolveManhuaEpisodeClipVideoModel", "explicitWriterVideoModel", "resolveClipLocalSegmentIndex", "resolveShotsForEpisodeKeyartsResult", "groupShotsIntoSegments", "buildAdvisorPrevisShotSource", "withRiggedModelSourceAssetRefs", "customAssetRefs", "resolveManhuaRigSource"],
    slice("  function advisorPrevisCurrentStudio(", "  const advisorPrevisClip = blocks.find"), "advisorPrevisCurrentStudio");
  makeApply = await compile<Fn>(["canUseManhua3d", "factoryBusy", "blocksRef", "buildManhuaPrevisAudio", "adoptAdvisorPrevisTrial", "advisorPrevisCurrentStudio", "adoptMvShotAdvisorPrevisReference", "saveCanvasState", "edges", "setBlocks", "toast", "maskMediaProviderDetails"],
    slice("  const applyAdvisorPrevis = ", "  const advisorTopIssue = "), "applyAdvisorPrevis");
  makeOpen = await compile<Fn>(["canUseManhua3d", "factoryBusy", "blocksRef", "advisor3dOpenVersion", "setAdvisor3dContext", "setAdvisorPreviewSelection", "setAdvisorPrevisClipId", "setAdvisorFocusSection", "chooseAdvisorVisibility", "setAdvisorNudge", "setAdvisorQuestionSeed", "advisorComponentKey"],
    slice("  function openMvShotAdvisorPrevis(", "  /** 交 FreeformCanvas"), "openMvShotAdvisorPrevis");
});

const shot: MvPrevisShot = {
  shotId: "s3", startSec: 12, endSec: 18, kind: "generated",
  visualPrompt: "两人在雨中相拥", cameraPrompt: "环绕",
  beats: [{ startSec: 12, endSec: 15, actionZh: "女主奔向男主", cameraZh: "跟拍", moodZh: "急切", sfxZh: "雨声" }, { startSec: 15, endSec: 18, actionZh: "两人拥抱", cameraZh: "环绕", moodZh: "释然", sfxZh: "心跳" }] as any,
  castZh: ["林夏：短发风衣", "周屿：黑色西装"],
};
function mvBlock(extra: Record<string, unknown> = {}) {
  return { id: "mv-shot-s3", kind: "video", status: "idle", prompt: "",
    musicMvShot: { planRequestId: "11111111-1111-4111-8111-111111111111", audioId: "a1", shotId: "s3", startSec: 12, endSec: 18 },
    previsStudio: buildMvShotPrevisStudio("mv-shot-s3", shot), ...extra } as any;
}
const neverManhua = () => { throw new Error("不应按漫剧分集重解析"); };
function studioCtx(blocks: any[]) {
  return { blocksRef: { current: blocks }, getBlockEpisodeIndex: () => 1, writerFocusEpisode: 1, resolveManhuaEpisodeClipVideoModel: neverManhua, explicitWriterVideoModel: "",
    resolveClipLocalSegmentIndex: neverManhua, resolveShotsForEpisodeKeyartsResult: neverManhua, groupShotsIntoSegments: neverManhua, buildAdvisorPrevisShotSource: neverManhua,
    withRiggedModelSourceAssetRefs: (spec: unknown) => spec, customAssetRefs: [], resolveManhuaRigSource: () => ({}) };
}

describe("MV 镜头块走块上来源", () => {
  it("advisorShotSource 直接取自块，不调漫剧分集解析", () => {
    const block = mvBlock();
    const studio = makeCurrentStudio(studioCtx([block]))(block);
    expect(studio.advisorShotSource).toEqual(block.previsStudio.advisorShotSource);
    expect(studio.advisorShotSource.shots).toHaveLength(2);
  });
  it("MV 块缺块上来源时报业务错误，不回落漫剧解析", () => {
    const block = mvBlock({ previsStudio: createManhuaPrevisStudio(6) });
    expect(() => makeCurrentStudio(studioCtx([block]))(block)).toThrow("逐窗节拍");
  });
  it("漫剧片段仍按分集重解析（原行为不变）", () => {
    const block = { id: "clip-e01-g01", previsStudio: { ...createManhuaPrevisStudio(6), advisorShotSource: { clipId: "clip-e01-g01" } } } as any;
    expect(() => makeCurrentStudio(studioCtx([block]))(block)).toThrow("不应按漫剧分集重解析");
  });
});

describe("onOpenAdvisorPrevis 入口（autoStart）", () => {
  function openCtx(over: Record<string, unknown> = {}) {
    return { canUseManhua3d: true, factoryBusy: false, blocksRef: { current: [mvBlock()] }, advisor3dOpenVersion: { current: 0 },
      setAdvisor3dContext: vi.fn(), setAdvisorPreviewSelection: vi.fn(), setAdvisorPrevisClipId: vi.fn(), setAdvisorFocusSection: vi.fn(),
      chooseAdvisorVisibility: vi.fn(), setAdvisorNudge: vi.fn(), setAdvisorQuestionSeed: vi.fn(), advisorComponentKey: "u1:p1", ...over };
  }
  it("打开顾问白模页，并只发一次带 submit 的提问种子；提问命中试看渲染意图", () => {
    const ctx = openCtx(); const q = mvPrevisAdvisorQuestion(shot);
    makeOpen(ctx)("mv-shot-s3", q, true);
    expect(ctx.setAdvisorPrevisClipId).toHaveBeenCalledWith("mv-shot-s3");
    expect(ctx.setAdvisorPreviewSelection).toHaveBeenCalledWith({ clipId: "mv-shot-s3" });
    expect(ctx.chooseAdvisorVisibility).toHaveBeenCalledWith(true);
    expect(ctx.setAdvisorQuestionSeed).toHaveBeenCalledTimes(1);
    const seed = (ctx.setAdvisorQuestionSeed as any).mock.calls[0][0];
    expect(seed).toMatchObject({ question: q, projectKey: "u1:p1", submit: true });
    // 面板拿到候选后据此自动开始试看（requestsAdvisorPrevisRender），无需另发渲染请求
    expect(requestsAdvisorPrevisRender(seed.question)).toBe(true);
  });
  it("submit=false 只预填，不自动提问", () => {
    const ctx = openCtx(); makeOpen(ctx)("mv-shot-s3", "调整站位", false);
    expect((ctx.setAdvisorQuestionSeed as any).mock.calls[0][0].submit).toBeUndefined();
  });
  it("无白模权限、制作中、块无基线：不打开、不提问", () => {
    for (const over of [{ canUseManhua3d: false }, { factoryBusy: true }, { blocksRef: { current: [mvBlock({ previsStudio: undefined })] } }]) {
      const ctx = openCtx(over);
      expect(() => makeOpen(ctx)("mv-shot-s3", "生成白模视频试看。", true)).toThrow();
      expect(ctx.setAdvisorQuestionSeed).not.toHaveBeenCalled();
      expect(ctx.setAdvisorPrevisClipId).not.toHaveBeenCalled();
    }
  });
  it("自动提问走面板 send：超额时进入现有 pendingPaid 确认，不带已确认付费", () => {
    // 种子 submit 分支只调 send(seed.question)，不传 confirmPaid；send 遇额度用完由服务端拒绝并 setPendingPaid 展示确认
    const effect = panelSource.slice(panelSource.indexOf("const appliedQuestionSeed"), panelSource.indexOf("const operationKey"));
    expect(effect).toMatch(/if \(seed\.submit && !draft\.trim\(\)\) \{\s*send\(seed\.question\);/);
    expect(effect).toMatch(/asking \|\| pendingPaid \|\| unresolvedFailed/);
    expect(panelSource).toMatch(/setPendingPaid\(\{ request, credits:/);
    expect(panelSource).toMatch(/确认支付 \{pendingPaid\.credits/);
  });
});

describe("采用后写回 MV 镜头块白模参考", () => {
  function receiptStudio(block: any) {
    const take = { jobId: "job-1", requestId: "22222222-2222-4222-8222-222222222222", gcsUri: "gs://test/previs.mp4", url: "https://test/previs.mp4", durationSec: 6, createdAt: "t", spec: block.previsStudio.spec };
    return { ...block.previsStudio, selectedJobId: "job-1", history: [take] };
  }
  function applyCtx(block: any, saved = true) {
    return { canUseManhua3d: true, factoryBusy: false, blocksRef: { current: [block] }, buildManhuaPrevisAudio: vi.fn(),
      adoptAdvisorPrevisTrial: vi.fn((_id: string, _s: unknown) => receiptStudio(block)), advisorPrevisCurrentStudio: (c: any) => c.previsStudio,
      adoptMvShotAdvisorPrevisReference: adoptRef, saveCanvasState: vi.fn(() => saved), edges: [], setBlocks: vi.fn(),
      toast: { success: vi.fn(), error: vi.fn() }, maskMediaProviderDetails: (s: string) => s };
  }
  const trial = { candidate: { target: { clipId: "mv-shot-s3" } }, request: {} };
  it("manhuaSegmentRefs.previs 更新为本次试看，旧参考进历史", () => {
    const old = { url: "https://test/old.mp4", gcsUri: "gs://test/old.mp4", durationSec: 6, updatedAt: "t0" };
    const block = mvBlock({ manhuaSegmentRefs: { previs: old } });
    const ctx = applyCtx(block);
    expect(makeApply(ctx)(trial, { jobId: "job-1" })).toBe(true);
    const saved = (ctx.blocksRef.current as any[])[0];
    expect(saved.manhuaSegmentRefs.previs).toMatchObject({ url: "https://test/previs.mp4", gcsUri: "gs://test/previs.mp4", durationSec: 6 });
    expect(saved.manhuaSegmentRefs.previs.motionGuideZh).toBeTruthy();
    expect(saved.previsStudio.referenceHistory).toContainEqual(old);
    expect(saved.previsStudio.selectedJobId).toBe("job-1");
    expect(ctx.setBlocks).toHaveBeenCalledTimes(1);
  });
  it("保存失败：块与原参考都不变", () => {
    const block = mvBlock();
    const ctx = applyCtx(block, false);
    expect(makeApply(ctx)(trial, { jobId: "job-1" })).toBe(false);
    expect((ctx.blocksRef.current as any[])[0]).toBe(block);
    expect(ctx.setBlocks).not.toHaveBeenCalled();
  });
  it("漫剧片段采用不写段参考（原行为：留给白模工作台审片后采用）", () => {
    const block = { id: "clip-e01-g01", status: "idle", previsStudio: mvBlock().previsStudio } as any;
    const ctx = applyCtx(block);
    (ctx as any).blocksRef.current = [block];
    const t = { candidate: { target: { clipId: "clip-e01-g01" } }, request: {} };
    expect(makeApply(ctx)(t, {})).toBe(true);
    expect((ctx.blocksRef.current as any[])[0].manhuaSegmentRefs).toBeUndefined();
  });
});
