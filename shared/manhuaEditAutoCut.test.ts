import { describe, expect, it } from "vitest";
import {
  buildManhuaManualClipEditTrim,
  buildManhuaAssembleShotPieces,
  mergeManhuaSpeechRegions,
  resolveManhuaShotWindowsForSegment,
  restoreManhuaFineCutsFromShotPieces,
  suggestManhuaFineCutFromSpeechRegions,
  suggestManhuaFineCutsForSegmentShots,
} from "./manhuaEditAutoCut";
import { speechRegionsFromSilenceDetectLog } from "./manhuaTemplateLearnFramePlan";

const directorPrompt = `
【视频生成导戏单·第1段·一轮】
本段一条成片约 12 秒
分镜1｜近景｜4秒｜约0–4s｜切镜：开场建立
  说话人锁：@角色1
  对白：@角色1（冷）：「站住。」
分镜2｜中景｜4秒｜约4–8s｜切镜：承接
  说话人锁：@角色2
  对白：@角色2（急）：「别冲动！」
分镜3｜近景｜4秒｜约8–12s｜切镜：承接
  说话人锁：@角色3
  对白：@角色3（稳）：「听我说完。」
`;

describe("manhuaEditAutoCut", () => {
  it("交换粗剪顺序不会交换源片镜窗，细剪仍切原镜头", () => {
    const shots = [
      { shotIndex: 2, durationSec: 6 },
      { shotIndex: 1, durationSec: 4 },
    ];
    const fineCutByShot = {
      1: { inSec: 1, outSec: 4 },
      2: { inSec: 0, outSec: 5 },
    };
    const trim = buildManhuaManualClipEditTrim({
      videoDurationSec: 20,
      shots,
      fineCutByShot,
    });
    expect(trim.shotPieces).toEqual([
      { shotIndex: 2, trimInSec: 8, trimOutSec: 18, durationSec: 10 },
      { shotIndex: 1, trimInSec: 2, trimOutSec: 8, durationSec: 6 },
    ]);
    expect(restoreManhuaFineCutsFromShotPieces({
      videoDurationSec: 20, shots, shotPieces: trim.shotPieces,
    })).toEqual(fineCutByShot);
    expect(shots.map((shot) => shot.shotIndex)).toEqual([2, 1]);
  });

  it("trims head/tail silence from speech envelope", () => {
    const r = suggestManhuaFineCutFromSpeechRegions(
      [
        { start: 1.2, end: 3 },
        { start: 3.2, end: 7.5 },
      ],
      10,
    );
    expect(r.source).toBe("speech");
    expect(r.trim.inSec).toBeGreaterThanOrEqual(0.5);
    expect(r.trim.outSec).toBeLessThanOrEqual(8.5);
    expect(r.trim.outSec - r.trim.inSec).toBeGreaterThanOrEqual(2);
  });

  it("段内镜标签只有局部序号时，重排仍按原镜号映射导戏时间窗", () => {
    const wins = resolveManhuaShotWindowsForSegment({
      directorPrompt,
      videoDurationSec: 12,
      shots: [6, 4, 5].map((shotIndex) => ({ shotIndex, durationSec: 4 })),
    });
    expect(wins.map((win) => [win.shotIndex, win.winStart, win.winEnd, win.source])).toEqual([
      [4, 0, 4, "cue"], [5, 4, 8, "cue"], [6, 8, 12, "cue"],
    ]);
  });

  it("falls back to full length when no speech", () => {
    const r = suggestManhuaFineCutFromSpeechRegions([], 8);
    expect(r.source).toBe("fallback");
    expect(r.trim).toEqual({ inSec: 0, outSec: 8 });
  });

  it("resolves shot windows from director cue seconds", () => {
    const wins = resolveManhuaShotWindowsForSegment({
      directorPrompt,
      videoDurationSec: 12,
      shots: [
        { shotIndex: 1, durationSec: 4 },
        { shotIndex: 2, durationSec: 4 },
        { shotIndex: 3, durationSec: 4 },
      ],
    });
    expect(wins.every((w) => w.source === "cue")).toBe(true);
    expect(wins[1]?.winStart).toBe(4);
    expect(wins[1]?.winEnd).toBe(8);
  });

  it("maps segment speech into per-shot local trims with cue windows", () => {
    const { fineCutByShot, segmentSuggest, windowSource, windows } =
      suggestManhuaFineCutsForSegmentShots({
        speechRegions: [
          { start: 0.5, end: 3.8 },
          { start: 4.2, end: 7.6 },
          { start: 8.2, end: 11.5 },
        ],
        videoDurationSec: 12,
        directorPrompt,
        shots: [
          { shotIndex: 1, durationSec: 4 },
          { shotIndex: 2, durationSec: 4 },
          { shotIndex: 3, durationSec: 4 },
        ],
      });
    expect(segmentSuggest.source).toBe("speech");
    expect(windowSource).toBe("cue");
    expect(fineCutByShot[2]).toBeTruthy();
    const pieces = buildManhuaAssembleShotPieces({
      videoDurationSec: 12,
      fineCutByShot,
      windows,
      shots: [
        { shotIndex: 1, durationSec: 4 },
        { shotIndex: 2, durationSec: 4 },
        { shotIndex: 3, durationSec: 4 },
      ],
    });
    expect(pieces).toHaveLength(3);
    expect(pieces[1]!.trimInSec).toBeGreaterThanOrEqual(4);
    expect(pieces[1]!.trimOutSec).toBeLessThanOrEqual(8.5);
    expect(pieces[1]!.trimOutSec - pieces[1]!.trimInSec).toBeGreaterThanOrEqual(0.5);
  });

  it("parses silencedetect log then suggests", () => {
    const log = `
silence_start: 0
silence_end: 1.0
silence_start: 8.0
silence_end: 10.0
`;
    const regions = speechRegionsFromSilenceDetectLog(log, 10);
    expect(mergeManhuaSpeechRegions(regions).length).toBeGreaterThan(0);
    const r = suggestManhuaFineCutFromSpeechRegions(regions, 10);
    expect(r.source).toBe("speech");
    expect(r.trim.inSec).toBeGreaterThanOrEqual(0.5);
  });

  it("maps a manual per-shot cut into the same absolute shotPieces contract and restores it", () => {
    const shots = [
      { shotIndex: 1, durationSec: 4 },
      { shotIndex: 2, durationSec: 4 },
      { shotIndex: 3, durationSec: 4 },
    ];
    const trim = buildManhuaManualClipEditTrim({
      videoDurationSec: 12,
      directorPrompt,
      shots,
      fineCutByShot: {
        1: { inSec: 0.5, outSec: 4 },
        2: { inSec: 0, outSec: 3.5 },
        3: { inSec: 1, outSec: 4 },
      },
    });
    expect(trim).toEqual({
      sourceDurationSec: 12,
      inSec: 0,
      outSec: 12,
      shotPieces: [
        { shotIndex: 1, trimInSec: 0.5, trimOutSec: 4, durationSec: 3.5 },
        { shotIndex: 2, trimInSec: 4, trimOutSec: 7.5, durationSec: 3.5 },
        { shotIndex: 3, trimInSec: 9, trimOutSec: 12, durationSec: 3 },
      ],
    });
    expect(
      restoreManhuaFineCutsFromShotPieces({
        videoDurationSec: 12,
        directorPrompt,
        shots,
        shotPieces: trim.shotPieces,
      }),
    ).toEqual({
      1: { inSec: 0.5, outSec: 4 },
      2: { inSec: 0, outSec: 3.5 },
      3: { inSec: 1, outSec: 4 },
    });
  });

  it("keeps the original 15-second shot windows after an automatic tail cut to 12 seconds", () => {
    const shots = [
      { shotIndex: 1, durationSec: 5 },
      { shotIndex: 2, durationSec: 5 },
      { shotIndex: 3, durationSec: 5 },
    ];
    const manual = buildManhuaManualClipEditTrim({
      videoDurationSec: 15,
      shots,
      fineCutByShot: {
        1: { inSec: 0, outSec: 5 },
        2: { inSec: 0, outSec: 5 },
        3: { inSec: 0, outSec: 2 },
      },
    });
    expect(manual.sourceDurationSec).toBe(15);
    expect(manual.outSec).toBe(15);
    expect(manual.shotPieces[2]).toEqual({
      shotIndex: 3,
      trimInSec: 10,
      trimOutSec: 12,
      durationSec: 2,
    });
  });
});
