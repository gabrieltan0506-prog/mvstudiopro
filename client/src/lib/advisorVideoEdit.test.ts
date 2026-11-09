import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
// 测试环境 JSX 走经典转换
(globalThis as { React?: typeof React }).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { creativeVoiceProductionSchema } from "@shared/creativeVoiceProduction";
import { MANHUA_ADVISOR_WORKFLOW_HELP } from "@shared/manhuaAdvisorWorkflow";
import { confirmAndQueueVideoPartialEdit, prepareAdvisorVideoEditPrefill, videoPartialEditConfirmText, type AdvisorVideoEditPrefill } from "@shared/advisorVideoEdit";
import { createAdvisorVideoEditControl } from "./advisorVideoEditControl";
import { AdvisorVideoEditDock } from "@/components/canvas/AdvisorVideoEditDock";

const targets = [{ id: "clip-1", label: "第1段成片", url: "https://cdn.test/a.mp4", durationSec: 40 }];
const refs = [{ id: "ref-1", label: "商店门口", url: "https://cdn.test/shop.png" }];
const sig = () => new AbortController().signal;
const prefillAction = (startSec: number, endSec: number, extra: Record<string, unknown> = {}) =>
  ({ action: "videoEdit", operation: "prefill", targetId: "clip-1", startSec, endSec, promptZh: "背景换成商店门口，人物动作与衣着不变", ...extra }) as const;
const TECH = /Seedance|BytePlus|EvoLink|Gemini|Vertex|Veo|GPT|Claude/i;

describe("顾问 videoEdit 契约", () => {
  it("inspect/prefill 通过；缺参、错位字段、结束不大于开始拒绝；提示写明只预填", () => {
    const ok = (v: unknown) => creativeVoiceProductionSchema.safeParse(v).success;
    expect(ok({ action: "videoEdit", operation: "inspect" })).toBe(true);
    expect(ok(prefillAction(24, 30, { refAssetId: "ref-1" }))).toBe(true);
    expect(ok({ action: "videoEdit", operation: "prefill", targetId: "clip-1", startSec: 24, endSec: 30 })).toBe(false);
    expect(ok({ ...prefillAction(24, 30), sourceUrl: "https://x" })).toBe(false);
    expect(ok({ action: "videoEdit", operation: "inspect", promptZh: "改背景" })).toBe(false);
    expect(ok(prefillAction(30, 24))).toBe(false);
    expect(MANHUA_ADVISOR_WORKFLOW_HELP).toContain("videoEdit(inspect/prefill");
    expect(MANHUA_ADVISOR_WORKFLOW_HELP).toContain("只打开视频局部修改面板并预填");
  });
});

describe("顾问 videoEdit 只预填不提交", () => {
  it("inspect 列真实视频与时长；prefill 打开面板预填、可多轮覆盖，不调用提交", async () => {
    const open = vi.fn();
    const queue = vi.fn();
    const control = createAdvisorVideoEditControl({ targets: () => targets, refs: () => refs, open });
    expect(JSON.parse(await control({ action: "videoEdit", operation: "inspect" }, sig()))).toMatchObject({ videos: [{ targetId: "clip-1", durationSec: 40 }], minSec: 4, maxSec: 30 });
    const r1 = JSON.parse(await control(prefillAction(24, 30, { refAssetId: "ref-1" }), sig()));
    expect(r1).toMatchObject({ status: "prefilled", startSec: 24, endSec: 30 });
    expect(r1.note).toContain("尚未提交、未扣积分");
    expect(JSON.stringify(r1)).not.toMatch(TECH);
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ sourceUrl: "https://cdn.test/a.mp4", referenceImageUrl: "https://cdn.test/shop.png" }));
    await control(prefillAction(25, 31.5), sig());
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[1]![0]).toMatchObject({ startSec: 25, endSec: 31.5 });
    expect(queue).not.toHaveBeenCalled();
  });
  it("越界 / 超 30 秒 / 非一位小数 / 未知视频拒绝且不打开；不足 4 秒按中心扩展并说明", async () => {
    const open = vi.fn();
    const control = createAdvisorVideoEditControl({ targets: () => targets, open });
    const err = (a: unknown) => control(a as never, sig()).then(() => "ok", (e: Error) => e.message);
    expect(await err(prefillAction(36, 41))).toContain("超出视频时长 40 秒");
    expect(await err(prefillAction(0, 31))).toContain("最多 30 秒");
    expect(await err(prefillAction(0, 31))).toContain("拆成几段");
    expect(await err(prefillAction(1.25, 6))).toContain("一位小数");
    expect(await err({ ...prefillAction(1, 6), targetId: "nope" })).toContain("不在当前可编辑清单");
    expect(await err({ ...prefillAction(1, 6), refAssetId: "nope" })).toContain("参考图不在");
    expect(open).not.toHaveBeenCalled();
    const short = JSON.parse(await control(prefillAction(26, 27), sig()));
    expect(short).toMatchObject({ startSec: 24.5, endSec: 28.5 });
    expect(short.notice).toContain("最短 4 秒");
    expect(prepareAdvisorVideoEditPrefill(prefillAction(39, 40), targets)).toMatchObject({ startSec: 36, endSec: 40 });
    expect(prepareAdvisorVideoEditPrefill(prefillAction(0, 1), targets)).toMatchObject({ startSec: 0, endSec: 4 });
  });
});

describe("确认后才提交 + 报价显示", () => {
  const p: AdvisorVideoEditPrefill = { targetId: "clip-1", label: "第1段成片", sourceUrl: "https://cdn.test/a.mp4", startSec: 24, endSec: 30, promptZh: "背景换成商店门口，人别动", referenceImageUrl: "https://cdn.test/shop.png" };
  const quote = { credits: 90, confirmNotice: "按原秒点拼回原片" };
  it("无报价不提交；用户取消不提交；确认后按报价积分提交一次", async () => {
    const queue = vi.fn(async () => ({ jobId: "j1" }));
    await expect(confirmAndQueueVideoPartialEdit(p, undefined, { confirm: () => true, queue, requestId: () => "r" })).rejects.toThrow("报价未就绪");
    expect(await confirmAndQueueVideoPartialEdit(p, quote, { confirm: () => false, queue, requestId: () => "r" })).toEqual({ submitted: false });
    expect(queue).not.toHaveBeenCalled();
    const texts: string[] = [];
    const r = await confirmAndQueueVideoPartialEdit(p, quote, { confirm: t => (texts.push(t), true), queue, requestId: () => "req-1" });
    expect(r).toEqual({ submitted: true, result: { jobId: "j1" } });
    expect(queue).toHaveBeenCalledWith({ sourceUrl: "https://cdn.test/a.mp4", startSec: 24, endSec: 30, promptZh: "背景换成商店门口，人别动", referenceImageUrls: ["https://cdn.test/shop.png"], requestId: "req-1", expectedCredits: 90 });
    expect(texts[0]).toContain("本次 90 积分");
    expect(texts[0]).toContain("提交后无法取消");
    expect(texts[0]).toContain("按原秒点拼回原片");
    expect(texts[0]).not.toMatch(TECH);
    expect(videoPartialEditConfirmText(p, { credits: 0 })).toContain("本次 0 积分");
  });
  it("面板显示区间、描述与报价；报价未就绪时确认按钮不可用；无引擎名", () => {
    const html = renderToStaticMarkup(createElement(AdvisorVideoEditDock, { prefill: p, quote, queue: async () => ({}), onClose: () => {} }));
    expect(html).toContain("24–30 秒");
    expect(html).toContain("背景换成商店门口，人别动");
    expect(html).toContain("本次 90 积分");
    expect(html).toContain("提交后不可取消");
    expect(html).not.toMatch(TECH);
    const pending = renderToStaticMarkup(createElement(AdvisorVideoEditDock, { prefill: p, quoteLoading: true, queue: async () => ({}), onClose: () => {} }));
    expect(pending).toContain("正在计算积分");
    expect(pending).toMatch(/<button[^>]*disabled[^>]*>确认提交/);
  });
});
