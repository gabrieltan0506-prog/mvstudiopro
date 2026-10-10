import { expect, it } from "vitest";
import { codeMotionVideoDurationMatches as matches } from "./codeMotionVideoDuration";
it("accepts native provider frame and container overrun while keeping nominal shot length", () => {
  for (const seconds of [5, 5.041667, 5.056, 5.088, 5.1]) expect(matches(seconds, 5)).toBe(true);
  expect(matches(4.088, 4)).toBe(true);
});
it("rejects short, materially longer, nonfinite and out-of-contract shots", () => {
  for (const seconds of [4.9, 5.101, 6, NaN, Infinity]) expect(matches(seconds, 5)).toBe(false);
  expect(matches(6, 6)).toBe(false);
});
