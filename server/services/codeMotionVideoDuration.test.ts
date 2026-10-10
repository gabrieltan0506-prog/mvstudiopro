import { expect, it } from "vitest";
import { codeMotionVideoDurationMatches as usable } from "./codeMotionVideoDuration";
it("accepts valid source durations independently of the nominal timeline slot", () => {
  for (const seconds of [1, 4.59, 4.98, 5, 5.041667, 5.088, 5.3, 6]) expect(usable(seconds, 5)).toBe(true);
  expect(usable(4.088, 4)).toBe(true);
});
it("rejects empty/nonfinite media and invalid nominal slots, not ordinary drift", () => {
  for (const seconds of [0, -1, NaN, Infinity]) expect(usable(seconds, 5)).toBe(false);
  expect(usable(6, 31)).toBe(false);
});
it("accepts the paid8-second timeline without changing actual-duration compatibility",()=>{
  expect(usable(8.04,8)).toBe(true);
  expect(usable(7.6,8)).toBe(true);
  expect(usable(30.1,30)).toBe(true);
});
