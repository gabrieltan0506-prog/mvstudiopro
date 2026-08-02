import { describe, expect, it } from "vitest";
import {
  CANVAS_VIDEO_MODEL_HAILUO_H3,
  clampHailuoOpenRouterDuration,
  HAILUO_OPENROUTER_MODEL_ID,
  isCanvasHailuoH3VideoModel,
  normalizeHailuoOpenRouterAspectRatio,
} from "./hailuoOpenRouterModels";

describe("hailuoOpenRouterModels", () => {
  it("resolves canvas / alias ids", () => {
    expect(isCanvasHailuoH3VideoModel(CANVAS_VIDEO_MODEL_HAILUO_H3)).toBe(true);
    expect(isCanvasHailuoH3VideoModel("minimax/hailuo-3")).toBe(true);
    expect(isCanvasHailuoH3VideoModel("hailuo-3")).toBe(true);
    expect(isCanvasHailuoH3VideoModel("seedance-2.0")).toBe(false);
  });

  it("clamps duration to OpenRouter 5–15", () => {
    expect(clampHailuoOpenRouterDuration(4)).toBe(5);
    expect(clampHailuoOpenRouterDuration(10)).toBe(10);
    expect(clampHailuoOpenRouterDuration(99)).toBe(15);
    expect(clampHailuoOpenRouterDuration("x")).toBe(10);
  });

  it("normalizes aspect ratio", () => {
    expect(normalizeHailuoOpenRouterAspectRatio("9:16")).toBe("9:16");
    expect(normalizeHailuoOpenRouterAspectRatio("weird")).toBe("16:9");
  });

  it("keeps OpenRouter model slug stable", () => {
    expect(HAILUO_OPENROUTER_MODEL_ID).toBe("minimax/hailuo-3");
  });
});
