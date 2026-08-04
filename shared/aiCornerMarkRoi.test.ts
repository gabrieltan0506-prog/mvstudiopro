import { describe, expect, it } from "vitest";
import {
  computeAiCornerMarkRoiPx,
  formatDelogoFilter,
} from "./aiCornerMarkRoi";

describe("aiCornerMarkRoi", () => {
  it("computes top-left ROI inside 1280x720", () => {
    const roi = computeAiCornerMarkRoiPx(1280, 720);
    expect(roi.x).toBeGreaterThanOrEqual(0);
    expect(roi.y).toBeGreaterThanOrEqual(0);
    expect(roi.x + roi.w).toBeLessThan(1280);
    expect(roi.y + roi.h).toBeLessThan(720);
    expect(roi.w).toBeGreaterThan(80);
    expect(roi.h).toBeGreaterThan(20);
    expect(roi.x % 2).toBe(0);
    expect(roi.y % 2).toBe(0);
  });

  it("computes ROI for portrait 1080x1920", () => {
    const roi = computeAiCornerMarkRoiPx(1080, 1920);
    expect(roi.x + roi.w).toBeLessThan(1080);
    expect(roi.y + roi.h).toBeLessThan(1920);
    expect(roi.w / 1080).toBeGreaterThan(0.1);
  });

  it("formats delogo filter", () => {
    expect(formatDelogoFilter({ x: 8, y: 6, w: 200, h: 48 })).toBe(
      "delogo=x=8:y=6:w=200:h=48:show=0",
    );
  });
});
