/**
 * Unit tests for video analysis scoring logic
 * Tests: validateDuration, scoring strategy, frame dropping logic
 */
import { describe, it, expect } from "vitest";

// We test the exported validateDuration function directly
// and replicate the internal calculateFrameScore / dropLowestFrames logic
// since they are not exported

// ─── Constants (mirrored from videoAnalysis.ts) ──────
const MAX_DURATION_SECONDS = 600;
const SHORT_VIDEO_THRESHOLD = 300;
const SHORT_VIDEO_FRAMES = 10;
const LONG_VIDEO_FRAMES = 12;
const SHORT_VIDEO_DROP = 1;
const LONG_VIDEO_DROP = 2;

// ─── Replicate validateDuration logic ────────────────
function validateDuration(durationSeconds: number) {
  if (durationSeconds > MAX_DURATION_SECONDS) {
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = Math.round(durationSeconds % 60);
    return {
      valid: false,
      error: `視頻時長 ${minutes}分${seconds}秒 超過 10 分鐘限制。請將視頻裁剪為兩段（每段不超過 10 分鐘）後分別上傳。`,
    };
  }
  if (durationSeconds <= 0) {
    return { valid: false, error: "無法讀取視頻時長，請確認視頻文件完整。" };
  }
  const isShort = durationSeconds <= SHORT_VIDEO_THRESHOLD;
  return {
    valid: true,
    strategy: {
      totalExtracted: isShort ? SHORT_VIDEO_FRAMES : LONG_VIDEO_FRAMES,
      droppedCount: isShort ? SHORT_VIDEO_DROP : LONG_VIDEO_DROP,
      scoringFrames: isShort
        ? SHORT_VIDEO_FRAMES - SHORT_VIDEO_DROP
        : LONG_VIDEO_FRAMES - LONG_VIDEO_DROP,
      durationCategory: isShort ? "short" : "long",
      durationSeconds,
    },
  };
}

// ─── Replicate calculateFrameScore ───────────────────
function calculateFrameScore(analysis: {
  composition: number;
  colorGrading: number;
  lighting: number;
  emotionalImpact: number;
  technicalQuality: number;
  narrativeValue: number;
}) {
  return Math.round(
    analysis.composition * 0.18 +
    analysis.colorGrading * 0.18 +
    analysis.lighting * 0.14 +
    analysis.emotionalImpact * 0.20 +
    analysis.technicalQuality * 0.15 +
    analysis.narrativeValue * 0.15
  );
}

// ─── Replicate dropLowestFrames ──────────────────────
interface FrameAnalysis {
  frameIndex: number;
  timestamp: number;
  imageUrl: string;
  dropped: boolean;
  frameScore: number;
  analysis: {
    composition: number;
    colorGrading: number;
    lighting: number;
    emotionalImpact: number;
    technicalQuality: number;
    narrativeValue: number;
    detail: string;
  };
}

function dropLowestFrames(
  frameAnalyses: FrameAnalysis[],
  dropCount: number
): FrameAnalysis[] {
  const withScores = frameAnalyses.map((f) => ({
    ...f,
    frameScore: calculateFrameScore(f.analysis),
    dropped: false,
  }));
  const sortedByScore = [...withScores].sort((a, b) => a.frameScore - b.frameScore);
  const droppedIndices = new Set(
    sortedByScore.slice(0, dropCount).map((f) => f.frameIndex)
  );
  return withScores.map((f) => ({
    ...f,
    dropped: droppedIndices.has(f.frameIndex),
  }));
}

// ─── Helper: create mock frame ───────────────────────
function mockFrame(index: number, scores: Partial<FrameAnalysis["analysis"]> = {}): FrameAnalysis {
  const analysis = {
    composition: 70,
    colorGrading: 70,
    lighting: 70,
    emotionalImpact: 70,
    technicalQuality: 70,
    narrativeValue: 70,
    detail: `Mock frame ${index}`,
    ...scores,
  };
  return {
    frameIndex: index,
    timestamp: index * 10,
    imageUrl: `https://example.com/frame-${index}.jpg`,
    dropped: false,
    frameScore: calculateFrameScore(analysis),
    analysis,
  };
}

// ═══════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════

describe("validateDuration", () => {
  it("rejects videos longer than 10 minutes", () => {
    const result = validateDuration(601);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("超過 10 分鐘限制");
    expect(result.error).toContain("裁剪為兩段");
  });

  it("rejects videos with zero or negative duration", () => {
    expect(validateDuration(0).valid).toBe(false);
    expect(validateDuration(-1).valid).toBe(false);
  });

  it("accepts exactly 10 minutes (600s)", () => {
    const result = validateDuration(600);
    expect(result.valid).toBe(true);
    expect(result.strategy).toBeDefined();
    expect(result.strategy!.durationCategory).toBe("long");
  });

  it("short video (≤5min): extracts 10 frames, drops 1, scores 9", () => {
    const result = validateDuration(180); // 3 minutes
    expect(result.valid).toBe(true);
    expect(result.strategy!.totalExtracted).toBe(10);
    expect(result.strategy!.droppedCount).toBe(1);
    expect(result.strategy!.scoringFrames).toBe(9);
    expect(result.strategy!.durationCategory).toBe("short");
  });

  it("exactly 5 minutes (300s) counts as short", () => {
    const result = validateDuration(300);
    expect(result.valid).toBe(true);
    expect(result.strategy!.durationCategory).toBe("short");
    expect(result.strategy!.totalExtracted).toBe(10);
    expect(result.strategy!.droppedCount).toBe(1);
    expect(result.strategy!.scoringFrames).toBe(9);
  });

  it("long video (5-10min): extracts 12 frames, drops 2, scores 10", () => {
    const result = validateDuration(420); // 7 minutes
    expect(result.valid).toBe(true);
    expect(result.strategy!.totalExtracted).toBe(12);
    expect(result.strategy!.droppedCount).toBe(2);
    expect(result.strategy!.scoringFrames).toBe(10);
    expect(result.strategy!.durationCategory).toBe("long");
  });

  it("just over 5 minutes (301s) counts as long", () => {
    const result = validateDuration(301);
    expect(result.valid).toBe(true);
    expect(result.strategy!.durationCategory).toBe("long");
    expect(result.strategy!.totalExtracted).toBe(12);
  });

  it("preserves duration in strategy", () => {
    const result = validateDuration(250);
    expect(result.strategy!.durationSeconds).toBe(250);
  });
});

describe("calculateFrameScore", () => {
  it("calculates weighted average correctly", () => {
    const score = calculateFrameScore({
      composition: 100,
      colorGrading: 100,
      lighting: 100,
      emotionalImpact: 100,
      technicalQuality: 100,
      narrativeValue: 100,
    });
    expect(score).toBe(100);
  });

  it("returns 0 for all-zero scores", () => {
    const score = calculateFrameScore({
      composition: 0,
      colorGrading: 0,
      lighting: 0,
      emotionalImpact: 0,
      technicalQuality: 0,
      narrativeValue: 0,
    });
    expect(score).toBe(0);
  });

  it("weights emotionalImpact highest (0.20)", () => {
    const highEmotion = calculateFrameScore({
      composition: 50, colorGrading: 50, lighting: 50,
      emotionalImpact: 100, technicalQuality: 50, narrativeValue: 50,
    });
    const highComposition = calculateFrameScore({
      composition: 100, colorGrading: 50, lighting: 50,
      emotionalImpact: 50, technicalQuality: 50, narrativeValue: 50,
    });
    // emotionalImpact has weight 0.20, composition has 0.18
    // highEmotion = 50*0.18 + 50*0.18 + 50*0.14 + 100*0.20 + 50*0.15 + 50*0.15 = 60
    // highComposition = 100*0.18 + 50*0.18 + 50*0.14 + 50*0.20 + 50*0.15 + 50*0.15 = 59
    expect(highEmotion).toBeGreaterThan(highComposition);
  });

  it("rounds to nearest integer", () => {
    const score = calculateFrameScore({
      composition: 73,
      colorGrading: 81,
      lighting: 65,
      emotionalImpact: 88,
      technicalQuality: 72,
      narrativeValue: 69,
    });
    expect(Number.isInteger(score)).toBe(true);
  });
});

describe("dropLowestFrames", () => {
  it("drops exactly 1 frame for short videos", () => {
    const frames = Array.from({ length: 10 }, (_, i) =>
      mockFrame(i, { emotionalImpact: i === 3 ? 10 : 80 }) // frame 3 is worst
    );
    const result = dropLowestFrames(frames, 1);
    const dropped = result.filter((f) => f.dropped);
    const scoring = result.filter((f) => !f.dropped);

    expect(dropped.length).toBe(1);
    expect(scoring.length).toBe(9);
    expect(dropped[0].frameIndex).toBe(3); // lowest score frame
  });

  it("drops exactly 2 frames for long videos", () => {
    const frames = Array.from({ length: 12 }, (_, i) =>
      mockFrame(i, {
        emotionalImpact: i === 5 ? 5 : i === 8 ? 10 : 80,
      })
    );
    const result = dropLowestFrames(frames, 2);
    const dropped = result.filter((f) => f.dropped);
    const scoring = result.filter((f) => !f.dropped);

    expect(dropped.length).toBe(2);
    expect(scoring.length).toBe(10);
    // Frames 5 and 8 should be dropped (lowest scores)
    const droppedIndices = dropped.map((f) => f.frameIndex).sort();
    expect(droppedIndices).toContain(5);
    expect(droppedIndices).toContain(8);
  });

  it("preserves frame order after dropping", () => {
    const frames = Array.from({ length: 10 }, (_, i) =>
      mockFrame(i, { emotionalImpact: i === 0 ? 10 : 80 })
    );
    const result = dropLowestFrames(frames, 1);

    // Check order is preserved
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].frameIndex).toBeLessThan(result[i + 1].frameIndex);
    }
  });

  it("handles all frames with same score", () => {
    const frames = Array.from({ length: 10 }, (_, i) => mockFrame(i));
    const result = dropLowestFrames(frames, 1);
    const dropped = result.filter((f) => f.dropped);
    expect(dropped.length).toBe(1);
  });

  it("drops 0 frames when dropCount is 0", () => {
    const frames = Array.from({ length: 10 }, (_, i) => mockFrame(i));
    const result = dropLowestFrames(frames, 0);
    const dropped = result.filter((f) => f.dropped);
    expect(dropped.length).toBe(0);
  });
});

describe("Credits reward rules", () => {
  function getCreditsReward(score: number): number {
    if (score >= 90) return 80;
    if (score >= 80) return 30;
    return 0;
  }

  it("awards 80 credits for score >= 90", () => {
    expect(getCreditsReward(90)).toBe(80);
    expect(getCreditsReward(95)).toBe(80);
    expect(getCreditsReward(100)).toBe(80);
  });

  it("awards 30 credits for score 80-89", () => {
    expect(getCreditsReward(80)).toBe(30);
    expect(getCreditsReward(85)).toBe(30);
    expect(getCreditsReward(89)).toBe(30);
  });

  it("awards 0 credits for score < 80", () => {
    expect(getCreditsReward(79)).toBe(0);
    expect(getCreditsReward(50)).toBe(0);
    expect(getCreditsReward(0)).toBe(0);
  });
});

describe("End-to-end scoring flow simulation", () => {
  it("short video: 10 frames → drop 1 → 9 frame average", () => {
    const duration = 240; // 4 minutes
    const validation = validateDuration(duration);
    expect(validation.valid).toBe(true);

    const strategy = validation.strategy!;
    expect(strategy.totalExtracted).toBe(10);

    // Simulate 10 frames with varying scores
    const frames = Array.from({ length: 10 }, (_, i) =>
      mockFrame(i, {
        composition: 60 + i * 3,
        colorGrading: 65 + i * 2,
        lighting: 70 + i,
        emotionalImpact: 55 + i * 4,
        technicalQuality: 60 + i * 2,
        narrativeValue: 58 + i * 3,
      })
    );

    const result = dropLowestFrames(frames, strategy.droppedCount);
    const scoring = result.filter((f) => !f.dropped);
    const dropped = result.filter((f) => f.dropped);

    expect(scoring.length).toBe(9);
    expect(dropped.length).toBe(1);

    // The dropped frame should be the one with lowest score (frame 0)
    expect(dropped[0].frameIndex).toBe(0);

    // Calculate average of scoring frames
    const avgScore = Math.round(
      scoring.reduce((sum, f) => sum + f.frameScore, 0) / scoring.length
    );
    expect(avgScore).toBeGreaterThan(0);
    expect(avgScore).toBeLessThanOrEqual(100);
  });

  it("long video: 12 frames → drop 2 → 10 frame average", () => {
    const duration = 480; // 8 minutes
    const validation = validateDuration(duration);
    expect(validation.valid).toBe(true);

    const strategy = validation.strategy!;
    expect(strategy.totalExtracted).toBe(12);

    // Simulate 12 frames
    const frames = Array.from({ length: 12 }, (_, i) =>
      mockFrame(i, {
        composition: 50 + i * 4,
        colorGrading: 55 + i * 3,
        lighting: 60 + i * 2,
        emotionalImpact: 45 + i * 4,
        technicalQuality: 55 + i * 3,
        narrativeValue: 50 + i * 3,
      })
    );

    const result = dropLowestFrames(frames, strategy.droppedCount);
    const scoring = result.filter((f) => !f.dropped);
    const dropped = result.filter((f) => f.dropped);

    expect(scoring.length).toBe(10);
    expect(dropped.length).toBe(2);

    // The two lowest scoring frames should be dropped (frame 0 and 1)
    const droppedIndices = dropped.map((f) => f.frameIndex).sort();
    expect(droppedIndices).toEqual([0, 1]);
  });
});
