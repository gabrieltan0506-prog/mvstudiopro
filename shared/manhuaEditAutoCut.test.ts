import { describe, expect, it } from "vitest";
import {
  mergeManhuaSpeechRegions,
  suggestManhuaFineCutFromSpeechRegions,
  suggestManhuaFineCutsForSegmentShots,
} from "./manhuaEditAutoCut";
import { speechRegionsFromSilenceDetectLog } from "./manhuaTemplateLearnFramePlan";

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

  it("maps segment speech into per-shot local trims", () => {
    const { fineCutByShot, segmentSuggest } = suggestManhuaFineCutsForSegmentShots({
      speechRegions: [
        { start: 0.5, end: 4.5 },
        { start: 5.5, end: 11 },
      ],
      videoDurationSec: 12,
      shots: [
        { shotIndex: 1, durationSec: 4 },
        { shotIndex: 2, durationSec: 4 },
        { shotIndex: 3, durationSec: 4 },
      ],
    });
    expect(segmentSuggest.source).toBe("speech");
    expect(fineCutByShot[1]).toBeTruthy();
    expect(fineCutByShot[2]).toBeTruthy();
    expect(fineCutByShot[3]).toBeTruthy();
    expect(fineCutByShot[1]!.outSec - fineCutByShot[1]!.inSec).toBeGreaterThanOrEqual(0.5);
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
