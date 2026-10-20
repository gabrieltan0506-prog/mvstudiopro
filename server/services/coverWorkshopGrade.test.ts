import { expect, it } from "vitest";
import sharp from "sharp";
import { detectCoverFaces, gradePlatformCover } from "./platformCoverGrade";
it("2K真实像素后期保留尺寸，原图与处理图哈希及曲线回执可追溯", async () => {
  const source = await sharp({
    create: {
      width: 1152,
      height: 2048,
      channels: 3,
      background: { r: 214, g: 143, b: 95 },
    },
  })
    .png()
    .toBuffer();
  const result = await gradePlatformCover(source, "soft", [
    [0.3, 0.2, 0.4, 0.3],
  ]);
  expect((await sharp(result.image).metadata()).width).toBe(1152);
  expect((await sharp(result.image).metadata()).height).toBe(2048);
  expect(result.receipt.sourceSha256).not.toBe(result.receipt.outputSha256);
  expect(result.receipt.skinCorrection.status).toBe("applied");
  expect(result.receipt.skinCorrection.coverage).toBeGreaterThan(0);
  expect(result.receipt.localLight.method).toBe("low-frequency-dodge-burn");
  expect(result.receipt.toneCurve.curves).toHaveLength(3);
  expect(result.receipt.geometryChanged).toBe(false);
});
it.runIf(process.platform === "linux")(
  "Linux镜像真实人脸检测运行时与固定模型可用，无人物图如实返回空区域",
  async () => {
    const source = await sharp({
      create: { width: 1152, height: 2048, channels: 3, background: "#d8c7b2" },
    })
      .png()
      .toBuffer();
    expect(await detectCoverFaces(source)).toEqual([]);
  }
);
