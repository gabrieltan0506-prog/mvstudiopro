import { describe, expect, it } from "vitest";
import {
  CANVAS_VIDEO_MODEL_HAILUO_H3,
  clampHailuoOpenRouterDuration,
  HAILUO_OPENROUTER_MODEL_ID,
  HAILUO_OPENROUTER_RESOLUTION_DEFAULT,
  isCanvasHailuoH3VideoModel,
  normalizeHailuoOpenRouterAspectRatio,
  normalizeHailuoOpenRouterResolution,
} from "./hailuoOpenRouterModels";

describe("hailuoOpenRouterModels", () => {
  it("resolves canvas / alias ids", () => {
    expect(isCanvasHailuoH3VideoModel(CANVAS_VIDEO_MODEL_HAILUO_H3)).toBe(true);
    expect(isCanvasHailuoH3VideoModel("minimax/hailuo-3")).toBe(true);
    expect(isCanvasHailuoH3VideoModel("hailuo-3")).toBe(true);
    expect(isCanvasHailuoH3VideoModel("seedance-2.0")).toBe(false);
  });

  /** 用户 2026-08-09 拍板：三档 5/10/15，取代 08-05 的「钉死 15s」 */
  it("snaps duration to the 5 / 10 / 15 tiers", () => {
    expect(clampHailuoOpenRouterDuration(5)).toBe(5);
    expect(clampHailuoOpenRouterDuration(10)).toBe(10);
    expect(clampHailuoOpenRouterDuration(15)).toBe(15);
    // 上游只收 4–15 的整数，档外的值就近归档，不透传
    expect(clampHailuoOpenRouterDuration(4)).toBe(5);
    expect(clampHailuoOpenRouterDuration(7)).toBe(5);
    expect(clampHailuoOpenRouterDuration(12)).toBe(10);
    expect(clampHailuoOpenRouterDuration(99)).toBe(15);
  });

  it("falls back to 15s when duration is absent or unreadable", () => {
    expect(clampHailuoOpenRouterDuration("x")).toBe(15);
    expect(clampHailuoOpenRouterDuration(undefined)).toBe(15);
    expect(clampHailuoOpenRouterDuration(0)).toBe(15);
  });

  /**
   * 默认 2K（用户 2026-08-09 拍板）：H3 的 2K 上游 $0.13/秒，比 Seedance 720p 还便宜，
   * 而且是站内唯一能出 2K 的引擎——默认压到 768p 等于把最便宜的高画质藏起来。
   */
  it("defaults resolution to 2K", () => {
    expect(HAILUO_OPENROUTER_RESOLUTION_DEFAULT).toBe("2K");
    expect(normalizeHailuoOpenRouterResolution(undefined)).toBe("2K");
    expect(normalizeHailuoOpenRouterResolution("2K")).toBe("2K");
    expect(normalizeHailuoOpenRouterResolution("2k")).toBe("2K");
  });

  /** 上游只认 768p / 2k，其余值（1080p、4K）不是降级而是回到默认档 */
  it("gives 768p only when explicitly asked, and folds unknown values into 2K", () => {
    expect(normalizeHailuoOpenRouterResolution("768p")).toBe("768p");
    expect(normalizeHailuoOpenRouterResolution("1080p")).toBe("2K");
    expect(normalizeHailuoOpenRouterResolution("4K")).toBe("2K");
  });

  it("normalizes aspect ratio", () => {
    expect(normalizeHailuoOpenRouterAspectRatio("9:16")).toBe("9:16");
    expect(normalizeHailuoOpenRouterAspectRatio("weird")).toBe("16:9");
  });

  it("keeps OpenRouter model slug stable", () => {
    expect(HAILUO_OPENROUTER_MODEL_ID).toBe("minimax/hailuo-3");
  });
});
