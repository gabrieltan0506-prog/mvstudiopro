import { describe, expect, it } from "vitest";
import {
  buildManhuaAssembleShotPieces,
  mergeManhuaSpeechRegions,
  resolveManhuaShotWindowsForSegment,
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
});
