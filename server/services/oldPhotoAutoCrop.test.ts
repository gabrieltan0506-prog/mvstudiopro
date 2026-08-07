import { describe, expect, it } from "vitest";
import {
  computeOldPhotoCropBox,
  parseOldPhotoCropDecision,
} from "./oldPhotoAutoCrop";

describe("oldPhotoAutoCrop", () => {
  it("解析视觉模型返回的纸质照片边界", () => {
    expect(
      parseOldPhotoCropDecision(
        '```json\n{"containsPhysicalPhoto":true,"confidence":0.91,"left":70,"top":180,"right":940,"bottom":860}\n```'
      )
    ).toEqual({
      containsPhysicalPhoto: true,
      confidence: 0.91,
      left: 70,
      top: 180,
      right: 940,
      bottom: 860,
    });
  });

  it("把归一化边界换算成真实像素", () => {
    expect(
      computeOldPhotoCropBox(
        {
          containsPhysicalPhoto: true,
          confidence: 0.91,
          left: 100,
          top: 200,
          right: 900,
          bottom: 800,
        },
        1000,
        2000
      )
    ).toEqual({ left: 100, top: 400, width: 800, height: 1200 });
  });

  it("低置信度、数字原图和几乎全幅边界都回退原图", () => {
    const base = {
      containsPhysicalPhoto: true,
      confidence: 0.71,
      left: 100,
      top: 100,
      right: 900,
      bottom: 900,
    };
    expect(computeOldPhotoCropBox(base, 1000, 1000)).toBeNull();
    expect(
      computeOldPhotoCropBox(
        { ...base, containsPhysicalPhoto: false, confidence: 0.99 },
        1000,
        1000
      )
    ).toBeNull();
    expect(
      computeOldPhotoCropBox(
        { ...base, confidence: 0.99, left: 5, top: 5, right: 995, bottom: 995 },
        1000,
        1000
      )
    ).toBeNull();
  });
});
