import { expect, it } from "vitest";
import {
  codeMotionTimingSchema,
  applyCodeMotionTiming,
  validateCodeMotionTimingSource,
} from "./codeMotionTiming";
import { codeMotionCompositionSchema } from "./codeMotionComposition";
const sourceId = "22222222-2222-4222-8222-222222222222";
const timing = codeMotionTimingSchema.parse({
  version: 1,
  sourceId,
  sourceSha256: "a".repeat(64),
  method: "manual",
  review: "confirmed",
  words: [
    {
      id: "a",
      text: "升起",
      startSec: 4.13,
      endSec: 4.45,
      confidence: 1,
      action: "rise",
    },
    {
      id: "b",
      text: "旋转",
      startSec: 5.22,
      endSec: 5.75,
      confidence: 0.8,
      action: "spin",
    },
  ],
  beats: [{ id: "b1", at: 4.31, strength: 0.7 }],
});
const composition = codeMotionCompositionSchema.parse({
  version: 1,
  scenes: [
    {
      id: "one",
      duration: 2,
      elements: [{ id: "base", type: "shape", shape: "rect" }],
    },
    {
      id: "two",
      duration: 2,
      elements: [{ id: "base", type: "shape", shape: "rect" }],
    },
  ],
});
const clips = [
  {
    sourceId,
    role: "narration" as const,
    at: 1,
    trimStart: 4,
    duration: 2,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
  },
];
it("maps actual irregular source word and beat times through trim into scene-local semantic keyframes", () => {
  const result = applyCodeMotionTiming(composition, timing, clips);
  const rise = result.scenes[0].elements.find(e => e.type === "text")!;
  expect(rise.start).toBeCloseTo(1.13);
  expect(rise.end).toBeCloseTo(1.45);
  expect(rise.keyframes[0].y).toBe(0.96);
  const spin = result.scenes[1].elements.find(e => e.type === "text")!;
  expect(spin.start).toBeCloseTo(0.22);
  expect(spin.keyframes[0].rotation).toBe(-20);
  expect(
    result.scenes[0].elements.find(e => e.id.startsWith("timing-beat"))!.start
  ).toBeCloseTo(1.31);
  expect(composition.scenes[0].elements).toHaveLength(1);
});
it("requires confirmed bounded true-source timing instead of accepting stale or uniform invented data", () => {
  expect(() =>
    applyCodeMotionTiming(
      composition,
      { ...timing, review: "needs-review" },
      clips
    )
  ).toThrow(/核对/);
  expect(() =>
    codeMotionTimingSchema.parse({
      ...timing,
      words: [{ ...timing.words[0], endSec: 4 }],
    })
  ).toThrow();
  expect(() =>
    validateCodeMotionTimingSource(
      timing,
      [{ id: sourceId, sha256: "b".repeat(64), duration: 8 } as any],
      clips
    )
  ).toThrow(/身份/);
});
