import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.hoisted(async () => {
  (globalThis as { React?: unknown }).React = await import("react");
});

const calls: string[] = [];
vi.mock("@/lib/trpc", () => ({
  trpc: {
    mvAnalysis: {
      quoteVideoPartialEdit: { useQuery: () => (calls.push("quote"), { data: undefined }) },
      queueVideoPartialEdit: { useMutation: () => ({ mutateAsync: async () => (calls.push("queue"), { jobId: "never" }) }) },
      getPostProdJob: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

import { VideoEditPanel } from "@/components/canvas/VideoEditPanel";
import {
  buildVideoEditSubmitInput,
  checkVideoEditRange,
  readVideoEditJob,
  readVideoEditQuote,
  submitVideoEdit,
  videoEditDurationSec,
  videoEditPrefillBlockReason,
} from "./videoEditSubmit";

const SIGNED = "https://storage.googleapis.com/mv-bucket/post-prod/7/a.mp4?X-Goog-Signature=abc";
const CDN = "https://d2h7xmz5gqybh9.cloudfront.net/out/x.mp4";

describe("区间校验", () => {
  it("一位小数；4–30 秒正常；不足 4 秒给出自动扩展预估（先向后、碰片尾向前）", () => {
    expect(checkVideoEditRange(1.04, 6.06, 20)).toMatchObject({ startSec: 1, endSec: 6.1, lengthSec: 5.1, expandedTo: null, problem: "" });
    expect(checkVideoEditRange(2, 3.5, 20)).toMatchObject({ expandedTo: { startSec: 2, endSec: 6 }, problem: "" });
    expect(checkVideoEditRange(9, 10, 10)).toMatchObject({ expandedTo: { startSec: 6, endSec: 10 }, problem: "" });
  });
  it("片长按实测秒数一位小数向下取（同服务端，不超过原片），不向上取整", () => {
    expect(videoEditDurationSec(10.08)).toBe(10);
    expect(videoEditDurationSec(10.1)).toBe(10.1);
    expect(videoEditDurationSec(10.99)).toBe(10.9);
    expect(videoEditDurationSec(12)).toBe(12);
    for (const bad of [0, -1, Number.NaN, undefined, null]) expect(videoEditDurationSec(bad)).toBe(0);
    // 10.08 秒原片：终点 10.1 越界（服务端也拒），10.0 可选；不足 4 秒贴尾扩展到 6.0–10.0
    expect(checkVideoEditRange(6, 10.1, 10.08).problem).toContain("片长 10.0 秒");
    expect(checkVideoEditRange(6, 10, 10.08).problem).toBe("");
    expect(checkVideoEditRange(9, 10, 10.08)).toMatchObject({ expandedTo: { startSec: 6, endSec: 10 }, problem: "" });
  });
  it("超 30 秒、倒置、越过片长、片长不足 4 秒均不可提交", () => {
    expect(checkVideoEditRange(0, 30.1, 60).problem).toContain("最多修改 30 秒");
    expect(checkVideoEditRange(0, 30, 60).problem).toBe("");
    expect(checkVideoEditRange(5, 5, 60).problem).toContain("晚于起点");
    expect(checkVideoEditRange(0, 12, 10).problem).toContain("片长");
    expect(checkVideoEditRange(0, 2, 3).problem).toContain("不足 4 秒");
  });
});

describe("提交参数", () => {
  const base = { videoUrl: SIGNED, startSec: 1.23, endSec: 7.88, promptZh: "  把背景换成商店门口，人物动作不变 ", expectedCredits: 120, durationSec: 20 };

  it("按 VE1 约定组参：sourceUrl/startSec/endSec 一位小数/promptZh 去空白/requestId/expectedCredits；无参考图不带字段", async () => {
    const submit = vi.fn(async () => ({ jobId: "job-1" }));
    const res = await submitVideoEdit(base, { submit, newRequestId: () => "rid-1" });
    expect(res).toEqual({ jobId: "job-1", requestId: "rid-1" });
    expect(submit).toHaveBeenCalledWith({
      sourceUrl: SIGNED,
      startSec: 1.2,
      endSec: 7.9,
      promptZh: "把背景换成商店门口，人物动作不变",
      requestId: "rid-1",
      expectedCredits: 120,
    });
  });

  it("回执带实际区间（不足 4 秒已扩展）时原样给 editedRange；只回 jobId 时不带", async () => {
    const submit = vi.fn(async () => ({ jobId: "job-x", status: "queued", startSec: 0.8, endSec: 4.8, segmentSec: 4, expanded: true }));
    const res = await submitVideoEdit({ ...base, startSec: 2, endSec: 3.5 }, { submit, newRequestId: () => "rid-x" });
    expect(res).toEqual({ jobId: "job-x", requestId: "rid-x", editedRange: { startSec: 0.8, endSec: 4.8 } });
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ startSec: 2, endSec: 3.5 }));
    const bare = await submitVideoEdit(base, { submit: async () => ({ jobId: "job-y", startSec: Number.NaN }), newRequestId: () => "rid-y" });
    expect(bare).toEqual({ jobId: "job-y", requestId: "rid-y" });
  });

  it("CloudFront 来源与参考图先导入为本人 gs://（同调色写法）；gs:// 原样", async () => {
    const importSource = vi.fn(async (u: string) => `gs://mine/${u.split("/").pop()}`);
    const submit = vi.fn(async () => "job-2");
    await submitVideoEdit(
      { ...base, videoUrl: CDN, referenceImageUrls: ["https://d2h7xmz5gqybh9.cloudfront.net/i/r.png", "gs://mine/bg.png"] },
      { submit, importSource, newRequestId: () => "rid-2" }
    );
    const input = (submit.mock.calls[0] as unknown[])[0] as { sourceUrl: string; referenceImageUrls: string[] };
    expect(input.sourceUrl).toBe("gs://mine/x.mp4");
    expect(input.referenceImageUrls).toEqual(["gs://mine/r.png", "gs://mine/bg.png"]);
  });

  it("每次提交不传 requestId 就新生成 uuid；同一次点击重试传回同一个", async () => {
    const submit = vi.fn(async () => "job");
    const a = await submitVideoEdit(base, { submit });
    const b = await submitVideoEdit(base, { submit });
    expect(a.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.requestId).not.toBe(b.requestId);
    const c = await submitVideoEdit({ ...base, requestId: a.requestId }, { submit });
    expect(c.requestId).toBe(a.requestId);
  });

  it("校验不过不入队、不导入：描述空、超 30 秒、无报价、参考图超 4 张、来源非 https/gs", async () => {
    const submit = vi.fn();
    const importSource = vi.fn();
    for (const bad of [
      { ...base, promptZh: "  " },
      { ...base, endSec: 40, durationSec: 60 },
      { ...base, expectedCredits: Number.NaN },
      { ...base, referenceImageUrls: ["gs://a", "gs://b", "gs://c", "gs://d", "gs://e"] },
      { ...base, videoUrl: "blob:local" },
    ]) {
      await expect(submitVideoEdit(bad, { submit, importSource })).rejects.toThrow();
    }
    expect(submit).not.toHaveBeenCalled();
    expect(importSource).not.toHaveBeenCalled();
    expect(() => buildVideoEditSubmitInput({ ...base, promptZh: "x".repeat(2001) }, "r")).toThrow("2000");
  });
});

describe("顾问预填闸门", () => {
  const idle = { running: false, submitting: false, confirming: false, disabled: false, quoting: false };
  it("空闲放行；确认中/报价中/提交中/任务进行中/停用各给中文原因，任务进行中优先", () => {
    expect(videoEditPrefillBlockReason(idle)).toBe("");
    expect(videoEditPrefillBlockReason({ ...idle, confirming: true })).toContain("用户正在确认");
    expect(videoEditPrefillBlockReason({ ...idle, quoting: true })).toContain("正在计算所需积分");
    expect(videoEditPrefillBlockReason({ ...idle, submitting: true, confirming: true })).toContain("正在提交");
    expect(videoEditPrefillBlockReason({ ...idle, disabled: true })).toContain("暂不可操作");
    expect(videoEditPrefillBlockReason({ running: true, submitting: true, confirming: true, disabled: true, quoting: true })).toContain("任务进行中");
    for (const k of ["running", "submitting", "confirming", "disabled", "quoting"] as const) {
      const why = videoEditPrefillBlockReason({ ...idle, [k]: true });
      expect(why).toContain("未改动");
      expect(why).not.toMatch(/Seedance|BytePlus|EvoLink|Gemini|GPT|Veo|Kling|WaveSpeed/i);
    }
  });
});

describe("任务与报价读取", () => {
  it("成功读 output.url/editedRange；失败读中性 error 与退款；处理中", () => {
    expect(readVideoEditJob({ status: "running" })).toEqual({ status: "active" });
    expect(
      readVideoEditJob({ status: "succeeded", output: { gcsUri: "gs://m/e.mp4", url: "https://x/e.mp4", durationSec: 20, editedRange: { startSec: 2, endSec: 6 }, creditsCharged: 60, debug: { channel: "a" } } })
    ).toMatchObject({ status: "succeeded", url: "https://x/e.mp4", gcsUri: "gs://m/e.mp4", editedRange: { startSec: 2, endSec: 6 }, debug: { channel: "a" } });
    expect(readVideoEditJob({ status: "failed", error: "修改未通过审核", output: { refund: { credits: 60, refunded: true } } })).toMatchObject({
      status: "failed",
      error: "修改未通过审核",
      refundedCredits: 60,
    });
    expect(readVideoEditQuote({ credits: 0, waived: true })).toMatchObject({ credits: 0 });
    expect(readVideoEditQuote({})).toBeNull();
  });
});

describe("VideoEditPanel 静态渲染", () => {
  it("区间、描述、参考图、报价占位、提交按钮（无描述禁用）；未确认前不入队；前台无引擎名", () => {
    const html = renderToStaticMarkup(
      createElement(VideoEditPanel, { source: SIGNED, durationSec: 12, referenceImages: [{ url: "gs://m/bg.png", label: "场景底图" }] })
    );
    for (const label of ["起点滑杆", "起点秒", "终点滑杆", "终点秒", "修改描述", "参考图", "报价"]) expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain("把背景换成商店门口，人物动作不变");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>提交局部修改<\/button>/);
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toMatch(/Seedance|BytePlus|EvoLink|ffmpeg|Gemini|GPT|Veo|Kling|WaveSpeed/i);
    expect(calls).not.toContain("queue");
  });
  it("实测 10.08 秒：显示原片 10.0 秒，选区上限 10（不按 10.1 或 11 秒）", () => {
    const html = renderToStaticMarkup(createElement(VideoEditPanel, { source: SIGNED, durationSec: 10.08 }));
    expect(html).toContain("原片 10.0 秒");
    expect(html).toMatch(/aria-label="终点滑杆"[^>]*max="10"/);
    expect(html).toMatch(/aria-label="终点秒"[^>]*max="10"/);
  });
});
