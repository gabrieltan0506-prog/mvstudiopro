import { describe, expect, it } from "vitest";
import {
  BASE_STRIDE_SEC,
  CLIMAX_STRIDE_SEC,
  buildAdaptiveFramePlan,
  buildBaseFrameTimestamps,
  detectClimaxWindowsFromGeminiAudioSections,
  detectClimaxWindowsFromTranscript,
  densifyTimestampsInWindows,
  parseTimeRangeToSec,
  speechRegionsFromSilenceDetectLog,
} from "./manhuaTemplateLearnFramePlan";

describe("manhuaTemplateLearnFramePlan", () => {
  it("base plan: intro within 5s + ~10s stride", () => {
    const ts = buildBaseFrameTimestamps(180);
    expect(ts.filter((t) => t <= 5)).toEqual([1, 2.5, 5]);
    expect(ts).toContain(10);
    expect(ts).toContain(20);
    const mid = ts.filter((t) => t >= 10 && t <= 170);
    for (let i = 1; i < mid.length; i++) {
      expect(mid[i]! - mid[i - 1]!).toBeGreaterThanOrEqual(BASE_STRIDE_SEC - 0.01);
    }
  });

  it("densifies climax windows to ~3s", () => {
    const base = buildBaseFrameTimestamps(120);
    const windows = detectClimaxWindowsFromTranscript(
      [{ start: 58, end: 62, text: "这一掌打脸翻盘了" }],
      120,
    );
    expect(windows.length).toBe(1);
    const dense = densifyTimestampsInWindows(base, windows, 120, CLIMAX_STRIDE_SEC);
    const inWindow = dense.filter((t) => t >= windows[0]!.startSec && t <= windows[0]!.endSec);
    expect(inWindow.length).toBeGreaterThanOrEqual(3);
    const gaps = inWindow.slice(1).map((t, i) => t - inWindow[i]!);
    expect(Math.min(...gaps)).toBeLessThanOrEqual(CLIMAX_STRIDE_SEC + 0.01);
  });

  it("adaptive plan prefers transcript over silence regions", () => {
    const plan = buildAdaptiveFramePlan({
      durationSec: 90,
      transcriptSegments: [{ start: 40, end: 45, text: "最终绝杀" }],
      speechRegions: [{ start: 10, end: 30 }],
    });
    expect(plan.climaxWindows.some((w) => /绝杀|对白/.test(w.reasonZh))).toBe(true);
    expect(plan.densifiedCount).toBeGreaterThan(0);
  });

  it("parses silencedetect log into speech regions", () => {
    const log = `
silence_start: 0.0
silence_end: 2.0
silence_start: 20.0
silence_end: 22.5
`;
    const regions = speechRegionsFromSilenceDetectLog(log, 40);
    expect(regions.some((r) => r.start >= 1.5 && r.end <= 21)).toBe(true);
  });

  it("parses Gemini timeRange and high-energy sections", () => {
    expect(parseTimeRangeToSec("0:58-1:12")).toEqual({ start: 58, end: 72 });
    expect(parseTimeRangeToSec("58-72")?.start).toBe(58);
    const windows = detectClimaxWindowsFromGeminiAudioSections(
      [
        { name: "铺垫", timeRange: "0:00-0:40", energy: "中" },
        { name: "反转高潮", timeRange: "1:00-1:20", energy: "极高", lyrics: "打脸翻盘" },
      ],
      180,
    );
    expect(windows.length).toBe(1);
    expect(windows[0]!.startSec).toBeLessThan(60);
    expect(windows[0]!.endSec).toBeGreaterThan(80);
  });

  it("adaptive plan prefers Gemini sections", () => {
    const plan = buildAdaptiveFramePlan({
      durationSec: 120,
      geminiSections: [{ name: "对决", timeRange: "50-70", energy: "高" }],
      speechRegions: [{ start: 10, end: 30 }],
    });
    expect(plan.climaxWindows.some((w) => /音频段/.test(w.reasonZh))).toBe(true);
    expect(plan.densifiedCount).toBeGreaterThan(0);
  });
});
