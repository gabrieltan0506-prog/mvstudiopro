/** 仅数值像素缓冲测试，无Blender、图片输出或媒体生成。 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { composeVfxWorldLayers, makeVfxInteractionCorrection, reconstructVfxWorldFrame } from "./manhuaVfxWorldLayers";
import { manhuaVfxWorldRenderSchema } from "../../shared/manhuaVfxChoreography";

it("所有透明度下真实消费底层、碎片和正负受光差值，精确恢复原像素", () => {
  const beauty = Buffer.alloc(256 * 4), plate = Buffer.alloc(256 * 4), fragment = Buffer.alloc(256 * 4);
  for (let alpha = 0; alpha <= 255; alpha++) {
    beauty.set([alpha % 2 ? 255 : 0, (alpha * 23) % 256, 200, 255], alpha * 4);
    plate.set([255 - alpha, 31, 128, 255], alpha * 4);
    fragment.set([alpha, 200, 37, alpha], alpha * 4);
  }
  const correction = makeVfxInteractionCorrection(beauty, plate, fragment);
  expect(reconstructVfxWorldFrame(plate, fragment, correction)).toEqual(beauty);
  const wrongPlate = Buffer.from(plate); wrongPlate[1] = 32;
  expect(reconstructVfxWorldFrame(wrongPlate, fragment, correction)).not.toEqual(beauty);
});
it("拒绝损坏长度、非不透明底层、膨胀数据和越界合成，不能静默截断", () => {
  const opaque = Buffer.from([10, 20, 30, 255]), fragment = Buffer.from([0, 0, 0, 0]);
  expect(() => makeVfxInteractionCorrection(opaque, Buffer.alloc(8), fragment)).toThrow();
  expect(() => makeVfxInteractionCorrection(Buffer.alloc(4), opaque, fragment)).toThrow("不透明");
  expect(() => reconstructVfxWorldFrame(opaque, fragment, deflateSync(Buffer.alloc(12)))).toThrow();
  expect(() => reconstructVfxWorldFrame(opaque, fragment, deflateSync(Buffer.alloc(4)))).toThrow("长度");
  const bad = Buffer.alloc(6); bad.writeInt16LE(256, 0);
  expect(() => reconstructVfxWorldFrame(opaque, fragment, deflateSync(bad))).toThrow("越界");
});
it("透明碎片分层只能使用支持遮挡挖空的精细受光合同", () => {
  const config = { quality: "preview", samples: 32, exposure: 0, keyEnergy: 1000, fillRatio: .35, exportLayers: true };
  expect(manhuaVfxWorldRenderSchema.safeParse(config).success).toBe(false);
  expect(manhuaVfxWorldRenderSchema.safeParse({ ...config, quality: "beauty" }).success).toBe(true);
});

it("分层相机错位或路径越界时，在读取任何图层之前拒绝", async () => {
  const camera = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]], hash = "a".repeat(64);
  const base = { eventId: "test-only", sceneJobId: "test-only", sceneSha256: hash,
    files: [{ frame: 1, sha256: hash }], frames: [{ effects: [{ active: true, cameraClip: [.1,100], cameraMatrixWorld: camera }] }],
    separated: { version: 1, complete: true, bytes: 4, depthEncoding: "linear_z_pass_clip_normalized_u16",
      frames: [{ frame: 1, active: true, clipStart: .1, clipEnd: 100, cameraMatrixWorld: camera,
        files: ["plate", "fragments", "actors", "depth"].map(layer => ({ layer, frame: 1, active: true, path: `separated/${layer}/frame-000001.png`, bytes: 1, sha256: hash })) }] } };
  for (const mutation of ["clip", "matrix", "path"]) {
    const root = await mkdtemp(path.join(tmpdir(), "vfx-layer-contract-test-"));
    try {
      const input = structuredClone(base);
      if (mutation === "clip") input.separated.frames[0].clipEnd = 101;
      if (mutation === "matrix") input.separated.frames[0].cameraMatrixWorld = camera.map((row, i) => row.map((v,j) => i === 0 && j === 3 ? 1 : v));
      if (mutation === "path") input.separated.frames[0].files[0].path = "../private.png";
      await expect(composeVfxWorldLayers(root, input, { width: 2, height: 2, fps: 24, durationSec: 1/24 }, new AbortController().signal))
        .rejects.toThrow(mutation === "path" ? "路径" : "相机");
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
