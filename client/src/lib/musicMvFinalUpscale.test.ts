import { describe, expect, it } from "vitest";
import { normalizeCanvasMusicMvState, type CanvasMusicMvFinalUpscale } from "@shared/canvasMusicMv";
import { canvasVideoUpscaleCredits } from "@shared/canvasGenerationPricing";
import {
  MV_FINAL_UPSCALE_TARGETS,
  mvFinalUpscaleBlocker,
  mvFinalUpscaleConfirmText,
  mvFinalUpscaleDownloadName,
  mvFinalUpscaleNeedsPoll,
  mvFinalUpscaleNeedsVersionBlock,
  mvFinalUpscaleQuote,
  mvFinalUpscaleScopeKey,
  mvFinalUpscaleStatusText,
  mvFinalUpscaleSupported,
  mvFinalUpscaleVersionBlockId,
} from "./musicMvFinalUpscale";

const rec = (over: Partial<CanvasMusicMvFinalUpscale> = {}): CanvasMusicMvFinalUpscale => ({
  id: "00000000-0000-4000-8000-0000000000aa",
  finalBlockId: "mvfinal-a",
  sourceUrl: "https://test.invalid/final.mp4",
  target: "4k",
  status: "running",
  taskId: "task-1",
  durationSec: 60,
  width: 720,
  height: 1280,
  creditsQuoted: 360,
  ...over,
});

const VENDOR = /wavespeed|seedance|bytedance|evolink|openrouter|vertex|gemini|fly|vercel|gcs/i;

describe("MV 成片超分", () => {
  it("报价与画布/首页同一计价函数（不另起价表）", () => {
    for (const t of MV_FINAL_UPSCALE_TARGETS)
      for (const sec of [1, 5, 30, 31, 60, 600])
        expect(mvFinalUpscaleQuote(t, sec)).toBe(canvasVideoUpscaleCredits(t, sec));
  });

  it("按实测规格限档：480p 只到 2K，720p 可 2K/4K，2K 以上不再升", () => {
    expect(mvFinalUpscaleSupported("480p", "2k")).toBe(true);
    expect(mvFinalUpscaleSupported("480p", "4k")).toBe(false);
    expect(mvFinalUpscaleSupported("720p", "2k")).toBe(true);
    expect(mvFinalUpscaleSupported("720p", "4k")).toBe(true);
    expect(mvFinalUpscaleSupported("4k", "4k")).toBe(false);
    expect(mvFinalUpscaleSupported(undefined, "2k")).toBe(false);
  });

  it("同一成片同一档：进行中/已成功/人工对账拦截，失败（已退分）与提交未确认放行", () => {
    expect(mvFinalUpscaleBlocker([], "mvfinal-a", "4k")).toBeNull();
    expect(mvFinalUpscaleBlocker([rec()], "mvfinal-a", "4k")).toMatch("进行中");
    expect(mvFinalUpscaleBlocker([rec({ status: "succeeded" })], "mvfinal-a", "4k")).toMatch("已有");
    expect(mvFinalUpscaleBlocker([rec({ status: "reconcile_manual" })], "mvfinal-a", "4k")).toMatch("人工核对");
    expect(mvFinalUpscaleBlocker([rec({ status: "failed" })], "mvfinal-a", "4k")).toBeNull();
    expect(mvFinalUpscaleBlocker([rec({ status: "submission_unknown" })], "mvfinal-a", "4k")).toBeNull();
    // 另一档、另一成片互不影响
    expect(mvFinalUpscaleBlocker([rec()], "mvfinal-a", "2k")).toBeNull();
    expect(mvFinalUpscaleBlocker([rec()], "mvfinal-b", "4k")).toBeNull();
  });

  it("只轮询有任务号且未终态的记录", () => {
    expect(mvFinalUpscaleNeedsPoll(rec())).toBe(true);
    expect(mvFinalUpscaleNeedsPoll(rec({ status: "queued" }))).toBe(true);
    expect(mvFinalUpscaleNeedsPoll(rec({ status: "timed_out_pending_reconcile" }))).toBe(true);
    expect(mvFinalUpscaleNeedsPoll(rec({ taskId: undefined }))).toBe(false);
    expect(mvFinalUpscaleNeedsPoll(rec({ status: "submitting" }))).toBe(false);
    expect(mvFinalUpscaleNeedsPoll(rec({ status: "succeeded" }))).toBe(false);
    expect(mvFinalUpscaleNeedsPoll(rec({ status: "failed" }))).toBe(false);
  });

  it("成功后只挂一次版本块，块号稳定且区分档位", () => {
    const done = rec({ status: "succeeded", videoUrl: "https://test.invalid/4k.mp4" });
    expect(mvFinalUpscaleNeedsVersionBlock(done)).toBe(true);
    expect(mvFinalUpscaleNeedsVersionBlock({ ...done, versionBlockId: "x" })).toBe(false);
    expect(mvFinalUpscaleNeedsVersionBlock(rec({ status: "succeeded" }))).toBe(false);
    expect(mvFinalUpscaleVersionBlockId("mvfinal-a", done)).toBe("mvfinal-a-up4k-00000000");
    expect(mvFinalUpscaleVersionBlockId("mvfinal-a", { ...done, target: "2k" })).not.toBe(
      mvFinalUpscaleVersionBlockId("mvfinal-a", done)
    );
  });

  it("幂等作用域绑定 MV 块 + 成片 + 档位", () => {
    expect(mvFinalUpscaleScopeKey("mv-1", "mvfinal-a", "2k")).toBe("music-mv:mv-1:mvfinal-a:2k");
  });

  it("确认文案含实测规格与预估积分，前台文案不出现引擎/供应商名", () => {
    const text = mvFinalUpscaleConfirmText({ target: "4k", width: 720, height: 1280, durationSec: 60, credits: 360 });
    expect(text).toContain("720×1280");
    expect(text).toContain("60 秒");
    expect(text).toContain("4K 超分预估 360 积分");
    expect(text).toContain("原成片保留");
    expect(text).not.toMatch(VENDOR);
    for (const status of ["submitting", "submission_unknown", "queued", "running", "succeeded", "failed", "timed_out_pending_reconcile", "reconcile_manual"] as const)
      expect(mvFinalUpscaleStatusText(rec({ status }))).not.toMatch(VENDOR);
  });

  it("下载文件名清洗非法字符并带档位", () => {
    expect(mvFinalUpscaleDownloadName('雨夜/告白:"版"', "4k")).toBe("雨夜-告白-版-4K.mp4");
    expect(mvFinalUpscaleDownloadName(undefined, "2k")).toBe("MV成片-2K.mp4");
  });

  it("超分记录随 MV 状态持久化（严格 schema 可解析，未知字段拒收）", () => {
    const base = { status: "done" as const, candidates: [], finalBlockId: "mvfinal-a" };
    const parsed = normalizeCanvasMusicMvState({ ...base, finalUpscales: [rec({ status: "succeeded", videoUrl: "https://test.invalid/4k.mp4", versionBlockId: "v" })] });
    expect(parsed.finalUpscales?.[0]?.versionBlockId).toBe("v");
    expect(() => normalizeCanvasMusicMvState({ ...base, finalUpscales: [{ ...rec(), provider: "x" }] })).toThrow();
    expect(() => normalizeCanvasMusicMvState({ ...base, finalUpscales: [rec({ target: "1080p" as never })] })).toThrow();
  });
});
