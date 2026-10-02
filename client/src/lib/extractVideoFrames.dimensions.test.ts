import { describe, expect, it } from "vitest";
import { videoReferenceFrameSize } from "./extractVideoFrames";

describe("上传给视频供应商的接续帧图片尺寸", () => {
  it.each([[480, 270], [270, 480], [1920, 1080], [720, 1280]])("%s×%s保持比例且两边至少300像素", (width, height) => {
    const result = videoReferenceFrameSize(width, height);
    expect(result.width).toBeGreaterThanOrEqual(300);
    expect(result.height).toBeGreaterThanOrEqual(300);
    expect(Math.abs(result.width / result.height - width / height)).toBeLessThan(0.01);
  });
  it("需要三倍时选择四倍，避免任意倍率", () => {
    expect(videoReferenceFrameSize(100, 100)).toEqual({ width: 400, height: 400 });
  });
  it("正常竖屏不缩小，高清视频仍按抽帧上限压缩", () => {
    expect(videoReferenceFrameSize(720, 1280)).toEqual({ width: 720, height: 1280 });
    expect(videoReferenceFrameSize(1920, 1080)).toEqual({ width: 768, height: 432 });
  });
});
