import { describe, expect, it } from "vitest";
import { buildVideoEditSpliceConcat, planVideoEditSegment, quoteVideoEdit, videoEditCredits } from "./videoEditPricing";

describe("videoEditCredits：每 2 秒 30 积分，不足 2 秒按 2 秒", () => {
  it.each([[0.1, 30], [2.0, 30], [2.1, 60], [4, 60], [29.7, 450], [30, 450]])("%s 秒 → %s 积分", (sec, credits) => {
    expect(videoEditCredits(sec)).toBe(credits);
  });
  it("浮点误差不多收一档", () => expect(videoEditCredits(0.1 + 0.2 + 1.7)).toBe(30));
  it("无效时长拒绝", () => expect(() => videoEditCredits(0)).toThrow());
});

describe("planVideoEditSegment", () => {
  it("≥4 秒原样保留一位小数", () => {
    expect(planVideoEditSegment(20, 3.04, 9.46)).toMatchObject({ startSec: 3, endSec: 9.5, segmentSec: 6.5, expanded: false });
  });
  it("不足 4 秒以中心向两侧扩展并提示", () => {
    const plan = planVideoEditSegment(20, 10, 11);
    expect(plan).toMatchObject({ startSec: 8.5, endSec: 12.5, segmentSec: 4, expanded: true });
    expect(plan.notice).toContain("8.5–12.5");
  });
  it("贴开头扩展向后补", () => expect(planVideoEditSegment(20, 0, 1)).toMatchObject({ startSec: 0, endSec: 4, segmentSec: 4 }));
  it("贴结尾扩展向前补", () => expect(planVideoEditSegment(20, 19.5, 20)).toMatchObject({ startSec: 16, endSec: 20, segmentSec: 4 }));
  it("计费按扩展后的实际提交时长", () => expect(quoteVideoEdit(planVideoEditSegment(20, 10, 10.5), false).credits).toBe(60));
  it("管理员/supervisor 报 0", () => expect(quoteVideoEdit(planVideoEditSegment(20, 0, 10), true)).toMatchObject({ credits: 0, waived: true }));
  it("超 30 秒、越界、原片不足 4 秒拒绝", () => {
    expect(() => planVideoEditSegment(60, 0, 30.5)).toThrow("30");
    expect(() => planVideoEditSegment(10, 5, 10.5)).toThrow();
    expect(() => planVideoEditSegment(3.5, 0, 1)).toThrow("不足");
  });
});

describe("buildVideoEditSpliceConcat：前段+编辑段+后段，总时长不变", () => {
  it("中段修改三段拼回", () => {
    const out = buildVideoEditSpliceConcat({ sourceUri: "gs://b/src.mp4", editedUri: "gs://b/ed.mp4", startSec: 3, endSec: 9.5, sourceDurationSec: 20, width: 1281, height: 720, fps: 29.97 });
    expect(out.clips).toEqual(["gs://b/src.mp4", "gs://b/ed.mp4", "gs://b/src.mp4"]);
    expect(out.trims).toEqual([{ startSec: 0, endSec: 3 }, { startSec: 0, endSec: 6.5 }, { startSec: 9.5, endSec: 20 }]);
    expect(out.totalSec).toBeCloseTo(20, 6);
    expect(out).toMatchObject({ width: 1282, height: 720, fps: 30 });
  });
  it("从开头或到结尾修改时省略空段", () => {
    const head = buildVideoEditSpliceConcat({ sourceUri: "s", editedUri: "e", startSec: 0, endSec: 4, sourceDurationSec: 10, width: 720, height: 1280, fps: 24 });
    expect(head.clips).toEqual(["e", "s"]);
    expect(head.totalSec).toBeCloseTo(10, 6);
    const tail = buildVideoEditSpliceConcat({ sourceUri: "s", editedUri: "e", startSec: 6, endSec: 10, sourceDurationSec: 10, width: 720, height: 1280, fps: 24 });
    expect(tail.clips).toEqual(["s", "e"]);
    expect(tail.totalSec).toBeCloseTo(10, 6);
  });
});
