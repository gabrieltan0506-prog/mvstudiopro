import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { gradePlatformCover } from "./platformCoverGrade";

async function fixture() {
  const width = 160, height = 160, data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = x < 40 ? [0, 0, 0] : x < 80 ? [255, 255, 255] : x < 120 ? [190, 125, 80] : [40, 120, 180];
    const i = (y * width + x) * 3;
    for (let c = 0; c < 3; c++) data[i + c] = color[c];
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}
describe("独立封面后期", () => {
  it("实际改变像素并保留尺寸、黑白文字和原图指纹", async () => {
    const source = await fixture();
    const result = await gradePlatformCover(source, "natural", [[.5, 0, .25, 1]]);
    expect(result.receipt.sourceSha256).toBe(createHash("sha256").update(source).digest("hex"));
    expect(result.receipt.outputSha256).not.toBe(result.receipt.sourceSha256);
    expect(result.receipt.changedChannelFraction).toBeGreaterThan(.2);
    const { data, info } = await sharp(result.image).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([160, 160]);
    expect(data[0]).toBeLessThan(6);
    expect(data[(80 * 160 + 60) * 3]).toBeGreaterThan(245);
    expect(result.receipt.skinCorrection.coverage).toBeGreaterThan(.02);
    expect(result.receipt.skinCorrection.semanticFaceDetection).toBe(false);
    expect(result.receipt.geometryChanged).toBe(false);
  });
  it("暖色背景不能进入人脸蒙版，区域外像素与无脸处理相同", async () => {
    const source = await sharp({ create: { width: 160, height: 160, channels: 3, background: { r: 200, g: 120, b: 65 } } }).png().toBuffer();
    const withFace = await gradePlatformCover(source, "natural", [[.1, .1, .2, .2]]);
    const withoutFace = await gradePlatformCover(source, "natural");
    expect(withFace.receipt.skinCorrection.coverage).toBeLessThan(.06);
    expect(withoutFace.receipt.skinCorrection.status).toBe("no-face-detected-skipped");
    const a = await sharp(withFace.image).raw().toBuffer(), b = await sharp(withoutFace.image).raw().toBuffer();
    expect(a.subarray((100 * 160 + 100) * 3, (100 * 160 + 100) * 3 + 3)).toEqual(b.subarray((100 * 160 + 100) * 3, (100 * 160 + 100) * 3 + 3));
    expect(a.equals(b)).toBe(false);
  });
  it("三种曲线可复现且保持单调，不反转明暗", async () => {
    const source = await fixture();
    const results = await Promise.all((["natural", "soft", "cinematic"] as const).map(s => gradePlatformCover(source, s)));
    expect(new Set(results.map(r => r.receipt.outputSha256)).size).toBe(3);
    for (const result of results) for (const curve of result.receipt.toneCurve.curves) {
      expect(curve).toHaveLength(256);
      for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
    }
    expect((await gradePlatformCover(source, "natural")).image.equals(results[0].image)).toBe(true);
  });
  it("无肤色的蓝色图片不伪称检测到人脸，坏图明确失败", async () => {
    const source = await sharp({ create: { width: 64, height: 64, channels: 3, background: "blue" } }).png().toBuffer();
    expect((await gradePlatformCover(source, "soft")).receipt.skinCorrection.coverage).toBe(0);
    await expect(gradePlatformCover(Buffer.from("not-image"), "soft")).rejects.toThrow();
  });
});
