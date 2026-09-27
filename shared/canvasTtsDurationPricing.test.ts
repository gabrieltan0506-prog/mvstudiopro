import { expect, it } from "vitest";
import { canvasTtsCreditsForDuration } from "./canvasGenerationPricing";

it("TTS 按实测时长每开始 0.2 秒收 2 积分", () => {
  expect(canvasTtsCreditsForDuration(4.704)).toBe(48);
  expect(canvasTtsCreditsForDuration(0.5)).toBe(6);
  expect(canvasTtsCreditsForDuration(0.51)).toBe(6);
  expect(canvasTtsCreditsForDuration(0.01)).toBe(2);
  expect(canvasTtsCreditsForDuration(0.000000001)).toBe(2);
  expect(canvasTtsCreditsForDuration(0.2)).toBe(2);
  expect(canvasTtsCreditsForDuration(0.201)).toBe(4);
  expect(() => canvasTtsCreditsForDuration(0)).toThrow("时长无效");
  expect(() => canvasTtsCreditsForDuration(3600.01)).toThrow("时长无效");
});
