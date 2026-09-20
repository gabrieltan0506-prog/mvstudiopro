import { describe, expect, it } from "vitest";
import {
  buildManhuaNativeSweepFramePlan,
  parseSweepSceneCutsFromShowinfo,
  parseSweepSpeechRegionsFromSilenceLog,
  SWEEP_BASE_STRIDE_SEC,
} from "./manhuaNativeSweepFramePlan.js";

describe("补扫取帧秒位规划", () => {
  it("切点两侧各取一帧，优先于有声窗与静段", () => {
    const plan = buildManhuaNativeSweepFramePlan({
      lenSec: 300, sceneCutsSec: [100], maxFrames: 2,
    });
    expect(plan).toEqual([99.7, 100.3]);
  });

  it("预算不够时先保切点，再有声窗，最后静段", () => {
    const plan = buildManhuaNativeSweepFramePlan({
      lenSec: 300, sceneCutsSec: [50, 150],
      speechRegions: [{ start: 200, end: 210 }], maxFrames: 4,
    });
    expect(plan).toEqual([49.7, 50.3, 149.7, 150.3]);
  });

  it("没有任何信号时退回静段均匀抽（步长写死 8 秒）", () => {
    const plan = buildManhuaNativeSweepFramePlan({ lenSec: 40, maxFrames: 99 });
    expect(SWEEP_BASE_STRIDE_SEC).toBe(8);
    expect(plan).toEqual([0, 8, 16, 24, 32]);
  });

  it("秒位去重：0.5 秒内不重复取帧（100 与 100.2 只留一对切点帧）", () => {
    const plan = buildManhuaNativeSweepFramePlan({
      lenSec: 300, sceneCutsSec: [100, 100.2], maxFrames: 10,
    });
    // 两个切点相距 0.2 秒，四个候选（99.7/100.3/99.9/100.5）去重后只剩 99.7 与 100.3。
    const near = plan.filter((t) => t > 99 && t < 101);
    expect(near).toEqual([99.7, 100.3]);
    // 余下预算由静段均匀帧补满，这是预期行为，不是漏判。
    expect(plan.length).toBe(10);
  });

  it("绝不超出本片范围，也不超 maxFrames", () => {
    const plan = buildManhuaNativeSweepFramePlan({
      lenSec: 10, sceneCutsSec: [0, 9.9, 100], speechRegions: [{ start: 0, end: 10 }], maxFrames: 5,
    });
    expect(plan.length).toBe(5);
    for (const t of plan) { expect(t).toBeGreaterThanOrEqual(0); expect(t).toBeLessThanOrEqual(9.9); }
  });

  it("lenSec 或 maxFrames 为 0 时返回空，不炸", () => {
    expect(buildManhuaNativeSweepFramePlan({ lenSec: 0, maxFrames: 5 })).toEqual([]);
    expect(buildManhuaNativeSweepFramePlan({ lenSec: 100, maxFrames: 0 })).toEqual([]);
  });
});

describe("ffmpeg 日志解析", () => {
  it("showinfo → 切点秒位（去重升序）", () => {
    const log = "[Parsed_showinfo_1 @ 0x1] n:0 pts_time:12.5 pos:1\n"
      + "[Parsed_showinfo_1 @ 0x1] n:1 pts_time:3.25 pos:2\n"
      + "[Parsed_showinfo_1 @ 0x1] n:2 pts_time:12.5 pos:3\n";
    expect(parseSweepSceneCutsFromShowinfo(log)).toEqual([3.3, 12.5]);
  });

  it("silencedetect → 有声区间（静音段的补集）", () => {
    const log = "[silencedetect @ 0x1] silence_start: 10\n"
      + "[silencedetect @ 0x1] silence_end: 20 | silence_duration: 10\n"
      + "[silencedetect @ 0x1] silence_start: 40\n"
      + "[silencedetect @ 0x1] silence_end: 45 | silence_duration: 5\n";
    expect(parseSweepSpeechRegionsFromSilenceLog(log, 60))
      .toEqual([{ start: 0, end: 10 }, { start: 20, end: 40 }, { start: 45, end: 60 }]);
  });

  it("全程静音（无 silence_end 收尾）不产生倒挂区间", () => {
    const log = "[silencedetect @ 0x1] silence_start: 0\n";
    expect(parseSweepSpeechRegionsFromSilenceLog(log, 30)).toEqual([{ start: 0, end: 30 }]);
  });

  it("空日志不炸", () => {
    expect(parseSweepSceneCutsFromShowinfo("")).toEqual([]);
    expect(parseSweepSpeechRegionsFromSilenceLog("", 10)).toEqual([{ start: 0, end: 10 }]);
  });
});
