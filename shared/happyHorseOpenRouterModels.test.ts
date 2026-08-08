import { describe, expect, it } from "vitest";
import {
  CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1,
  clampHappyHorseCanvasDuration,
  isCanvasHappyHorseVideoModel,
  normalizeHappyHorseCanvasResolution,
} from "./happyHorseOpenRouterModels.js";

describe("happyHorseOpenRouterModels", () => {
  it("recognizes canvas videoModel aliases", () => {
    expect(isCanvasHappyHorseVideoModel(CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1)).toBe(true);
    expect(isCanvasHappyHorseVideoModel("alibaba/happyhorse-1.1")).toBe(true);
    expect(isCanvasHappyHorseVideoModel("seedance-2.0")).toBe(false);
  });

  it("clamps canvas duration to 5/10/15 and caps at 15", () => {
    expect(clampHappyHorseCanvasDuration(undefined)).toBe(15);
    expect(clampHappyHorseCanvasDuration(3)).toBe(5);
    expect(clampHappyHorseCanvasDuration(7)).toBe(10);
    expect(clampHappyHorseCanvasDuration(12)).toBe(15);
    expect(clampHappyHorseCanvasDuration(30)).toBe(15);
  });

  it("normalizes resolution to 720p/1080p only", () => {
    expect(normalizeHappyHorseCanvasResolution("1080p")).toBe("1080p");
    expect(normalizeHappyHorseCanvasResolution("2K")).toBe("720p");
    expect(normalizeHappyHorseCanvasResolution("")).toBe("720p");
  });
});
