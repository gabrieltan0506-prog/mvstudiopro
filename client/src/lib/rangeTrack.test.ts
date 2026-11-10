import { describe, expect, it } from "vitest";
import {
  clampSegmentBoundary, keyboardTarget, moveRangeThumb, moveSegmentBoundary, segmentBoundaryLimits, segmentsAreContiguous, snapToStep, snapWithin,
  type RangeTrackSegment,
} from "./rangeTrack";

describe("区间模式：不越界、不互相越过", () => {
  const bounds = { min: 0, max: 10, step: 0.1 };
  it("起点不能越过终点，终点不能越过起点", () => {
    expect(moveRangeThumb([2, 6], 0, 8, bounds)).toEqual([6, 6]);
    expect(moveRangeThumb([2, 6], 1, 1, bounds)).toEqual([2, 2]);
  });
  it("两端都不能拖出轨道范围", () => {
    expect(moveRangeThumb([2, 6], 0, -5, bounds)).toEqual([0, 6]);
    expect(moveRangeThumb([2, 6], 1, 99, bounds)).toEqual([2, 10]);
  });
  it("minGap 保留最小间隔", () => {
    expect(moveRangeThumb([2, 6], 0, 8, { ...bounds, minGap: 1 })).toEqual([5, 6]);
    expect(moveRangeThumb([2, 6], 1, 0, { ...bounds, minGap: 1 })).toEqual([2, 3]);
  });
  it("按步长吸附且无浮点尾差；非数字输入回落到下界", () => {
    expect(moveRangeThumb([0, 6], 0, 0.1 + 0.2, bounds)).toEqual([0.3, 6]);
    expect(moveRangeThumb([0, 6], 0, 1.26, bounds)).toEqual([1.3, 6]);
    expect(moveRangeThumb([2, 6], 0, Number.NaN, bounds)).toEqual([0, 6]);
    expect(snapToStep(2.5000000001, 0, 0.5)).toBe(2.5);
  });
  it("上界不在步长格点上时仍可到达上界，吸附不会推出界", () => {
    expect(moveRangeThumb([0, 5], 1, 9.99, { min: 0, max: 9.95, step: 0.1 })).toEqual([0, 9.95]);
    expect(snapWithin(9.94, 0, 9.95, 0, 0.5)).toBe(9.95);
  });
});

describe("键盘", () => {
  it("方向键 ±step，Shift ±1 秒，Home/End 到两端，其他键不处理", () => {
    expect(keyboardTarget(3, "ArrowRight", false, 0.1, 0, 10)).toBeCloseTo(3.1);
    expect(keyboardTarget(3, "ArrowLeft", false, 0.1, 0, 10)).toBeCloseTo(2.9);
    expect(keyboardTarget(3, "ArrowUp", true, 0.1, 0, 10)).toBe(4);
    expect(keyboardTarget(3, "ArrowDown", true, 0.1, 0, 10)).toBe(2);
    expect(keyboardTarget(3, "Home", false, 0.1, 1, 9)).toBe(1);
    expect(keyboardTarget(3, "End", false, 0.1, 1, 9)).toBe(9);
    expect(keyboardTarget(3, "a", false, 0.1, 0, 10)).toBeNull();
    expect(keyboardTarget(3, "Tab", false, 0.1, 0, 10)).toBeNull();
  });
  it("键盘结果经区间夹取后仍不越过另一端", () => {
    const target = keyboardTarget(5.9, "ArrowRight", true, 0.1, 0, 6)!;
    expect(moveRangeThumb([5.9, 6], 0, target, { min: 0, max: 10, step: 0.1 })).toEqual([6, 6]);
  });
});

describe("分段模式：边界移动保持首尾相接", () => {
  const segments: RangeTrackSegment[] = [
    { startSec: 0, endSec: 4, label: "一", tone: "ok" },
    { startSec: 4, endSec: 9, label: "二", tone: "warn" },
    { startSec: 9, endSec: 12, label: "三", tone: "bad" },
  ];
  it("移动边界只改相邻两段，首尾仍相接，总范围不变，其余字段保留", () => {
    const next = moveSegmentBoundary(segments, 0, 6.04, { step: 0.1, minLen: 0.1 });
    expect(next.map(s => [s.startSec, s.endSec])).toEqual([[0, 6], [6, 9], [9, 12]]);
    expect(segmentsAreContiguous(next)).toBe(true);
    expect(next[2]).toBe(segments[2]);
    expect(next[1]).toMatchObject({ label: "二", tone: "warn" });
    expect(segments[0]!.endSec).toBe(4);
  });
  it("边界不能越过相邻段的另一端，两侧各留最小段长", () => {
    expect(clampSegmentBoundary(segments, 0, 50, { step: 0.1, minLen: 0.5 })).toBe(8.5);
    expect(clampSegmentBoundary(segments, 0, -50, { step: 0.1, minLen: 0.5 })).toBe(0.5);
    expect(clampSegmentBoundary(segments, 1, 0, { step: 0.1, minLen: 0.5 })).toBe(4.5);
    expect(segmentBoundaryLimits(segments, 1, 0.5)).toEqual({ lo: 4.5, hi: 11.5 });
    const next = moveSegmentBoundary(segments, 1, 100, { step: 0.1, minLen: 0.5 });
    expect(next.map(s => [s.startSec, s.endSec])).toEqual([[0, 4], [4, 11.5], [11.5, 12]]);
    expect(segmentsAreContiguous(next)).toBe(true);
  });
  it("不存在的边界不改动任何段", () => {
    expect(clampSegmentBoundary(segments, 2, 5)).toBeNull();
    expect(moveSegmentBoundary(segments, 5, 5)).toEqual(segments);
  });
  it("两段挤不下最小段长时边界原地不动", () => {
    const tight: RangeTrackSegment[] = [{ startSec: 0, endSec: 0.3 }, { startSec: 0.3, endSec: 0.6 }];
    expect(clampSegmentBoundary(tight, 0, 0.5, { step: 0.1, minLen: 0.5 })).toBe(0.3);
  });
});
