import { describe, expect, it } from "vitest";
import {
  blurAssessmentFromScore,
  buildUpscaleConfirmation,
  laplacianVariance,
} from "./imageBlurDetection";

describe("高清放大前的模糊提醒", () => {
  it("平坦画面会被保守标记为可能模糊", () => {
    const pixels = new Uint8Array(25).fill(128);
    expect(laplacianVariance(pixels, 5, 5)).toBe(0);
    expect(blurAssessmentFromScore(0).isLikelyBlurry).toBe(true);
  });

  it("具有高频边缘的画面不会触发提醒", () => {
    const pixels = Uint8Array.from({ length: 25 }, (_, index) =>
      (index + Math.floor(index / 5)) % 2 ? 255 : 0,
    );
    const score = laplacianVariance(pixels, 5, 5);
    expect(score).toBeGreaterThan(18);
    expect(blurAssessmentFromScore(score).isLikelyBlurry).toBe(false);
  });

  it("只有命中模糊风险时才加入知情确认与退款边界", () => {
    const warned = buildUpscaleConfirmation({
      factorLabel: "2×",
      credits: 15,
      assessment: blurAssessmentFromScore(0),
    });
    expect(warned).toContain("原图清晰度较低");
    expect(warned).toContain("不因上述原图质量原因退还本次积分");

    const normal = buildUpscaleConfirmation({
      factorLabel: "4×",
      credits: 35,
      assessment: blurAssessmentFromScore(100),
    });
    expect(normal).not.toContain("原图清晰度较低");
  });
});
