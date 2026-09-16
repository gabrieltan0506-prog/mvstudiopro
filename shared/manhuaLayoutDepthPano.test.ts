import { describe, expect, it } from "vitest";
import {
  decodeDepth8bitOfficial,
  depth8bitToMeters,
  depthPanoDirection,
  depthPanoSceneFromPrevisActors,
  encodeDepthMetersOfficial,
  encodeGrayPng,
  quantizeDepthForUpload,
  quantizeDepthTo8bit,
  renderLayoutDepthPano,
  renderLayoutDepthPanoPng,
  validateDepthPanoUploadMeta,
} from "./manhuaLayoutDepthPano.js";

describe("manhuaLayoutDepthPano", () => {
  it("方向：中央列为 +Y 正前；顶行朝上；2:1 且不超过 2048 宽", () => {
    const d = depthPanoDirection(511.5, 255.5, 1024, 512);
    expect(d[1]).toBeCloseTo(1, 3);
    expect(Math.abs(d[0])).toBeLessThan(0.01);
    expect(depthPanoDirection(0, 0, 1024, 512)[2]).toBeCloseTo(1, 2);
    const r = renderLayoutDepthPano({}, { width: 5000 });
    expect(r.width).toBe(2048);
    expect(r.height).toBe(1024);
    expect(renderLayoutDepthPano({}, { width: 256 }).height).toBe(128);
  });

  it("空场景只有地面：上半球全是 far；下半球随俯角变浅、越靠地平线越远，正下方 ≈ 视高", () => {
    const r = renderLayoutDepthPano({ eye: [0, 0, 1.6] }, { width: 256, zMax: 50 });
    const { width, height, depth, meta } = r;
    for (let v = 0; v < height / 2; v += 1) for (let u = 0; u < width; u += 1) expect(depth[v * width + u]).toBe(meta.zMax);
    const col = 0;
    let prev = Number.POSITIVE_INFINITY;
    for (let v = height / 2; v < height; v += 1) {
      const d = depth[v * width + col]!;
      expect(d).toBeLessThanOrEqual(prev);
      prev = d;
    }
    expect(depth[(height - 1) * width + width / 2]).toBeCloseTo(1.6, 1);
    expect(depth[(height / 2) * width]).toBeGreaterThan(20);
  });

  it("正前方一个立方体：0° 方位中带出现较近深度（≈ 到近面距离）；背后仍是 far", () => {
    const r = renderLayoutDepthPano({ eye: [0, 0, 1.6], boxes: [{ center: [0, 4] as const, size: [1, 1, 3] as const }] }, { width: 512, zMax: 50 });
    const { width, height, depth } = r;
    const horizon = height / 2;
    const front = depth[horizon * width + width / 2]!;
    expect(front).toBeCloseTo(3.5, 1);
    // 背后（u=0 → −180°）水平视线仍是 far
    expect(depth[horizon * width]).toBe(50);
    // 侧向 +90°（u = 3/4 宽）也没有盒子
    expect(depth[horizon * width + (width * 3) / 4]).toBe(50);
  });

  it("演员只定视点，全部留在独立角色层；静态几何才进入背景", () => {
    const scene = depthPanoSceneFromPrevisActors([{ id: "a", start: [0, 0] }]);
    expect(scene.eye).toEqual([0, 0, 1.6]);
    const solo = renderLayoutDepthPano(scene, { width: 128, zMax: 30 });
    expect(solo.depth[(solo.height / 2) * solo.width + solo.width / 2]).toBe(30);
    const two = renderLayoutDepthPano(depthPanoSceneFromPrevisActors([{ id: "a", start: [0, -2] }, { id: "b", start: [0, 2] }]), { width: 128, zMax: 30 });
    expect(two.depth[(two.height / 2) * two.width + two.width / 2]).toBe(30);
    const staticBox = { id: "wall", center: [0, 4] as const, size: [1, 1, 3] as const };
    expect(depthPanoSceneFromPrevisActors([{ id: "a", start: [0, 0] }], [staticBox]).boxes).toEqual([staticBox]);
  });

  it("显示预览量化：near→255、far→0、线性可逆（只作屏幕预览，不上传）", () => {
    const meta = { zMin: 0.3, zMax: 60 };
    const q = quantizeDepthTo8bit({ depth: new Float32Array([0.3, 60, 30.15]), meta: meta as never });
    expect(Array.from(q)).toEqual([255, 0, 128]);
    expect(depth8bitToMeters(255, meta)).toBeCloseTo(0.3, 9);
    expect(depth8bitToMeters(0, meta)).toBeCloseTo(60, 9);
  });

  it("WL-D01 上传编码 = 官方范例：encoded = 1 − (ln z − ln zMin)/(ln zMax − ln zMin)；固定样例核距离，不只测自家互逆", () => {
    // 官方 web-chisel-depth-png：zMin=0.1, zMax=100 时 z=1 → n=1/3 → encoded=2/3；z=10 → n=2/3 → encoded=1/3
    const meta = { zMin: 0.1, zMax: 100 };
    expect(encodeDepthMetersOfficial(1, meta)).toBeCloseTo(2 / 3, 9);
    expect(encodeDepthMetersOfficial(10, meta)).toBeCloseTo(1 / 3, 9);
    expect(encodeDepthMetersOfficial(0.1, meta)).toBe(1);
    expect(encodeDepthMetersOfficial(100, meta)).toBe(0);
    // 越界夹住
    expect(encodeDepthMetersOfficial(0.01, meta)).toBe(1);
    expect(encodeDepthMetersOfficial(1e6, meta)).toBe(0);
    const q = quantizeDepthForUpload({ depth: new Float32Array([0.1, 1, 10, 100]), meta: meta as never });
    expect(Array.from(q)).toEqual([255, 170, 85, 0]);
    expect(decodeDepth8bitOfficial(170, meta)).toBeCloseTo(1, 1);
    expect(decodeDepth8bitOfficial(85, meta)).toBeCloseTo(10, 0);
    // 与线性预览不同：对数编码近处分辨率更高（1m 与 10m 之间隔 85 级，线性只有 23 级）
    const lin = quantizeDepthTo8bit({ depth: new Float32Array([1, 10]), meta: meta as never });
    expect(lin[0]! - lin[1]!).toBeLessThan(30);
  });

  it("上传 PNG：RGB 三通道同值（官方范例形态）、8bit、2:1、IEND 收尾；meta 带 zMin/zMax/encoding", () => {
    const { png, meta: m } = renderLayoutDepthPanoPng({ eye: [0, 0, 1.6] }, { width: 64 });
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(64);
    expect(view.getUint32(20)).toBe(32);
    expect(png[24]).toBe(8); // 位深
    expect(png[25]).toBe(2); // RGB
    expect(String.fromCharCode.apply(null, Array.from(png.subarray(png.length - 8, png.length - 4)))).toBe("IEND");
    expect(m).toMatchObject({ width: 64, height: 32, zMin: 0.3, zMax: 60, encoding: "log_inverse_01" });
    expect(() => encodeGrayPng(2, 2, new Uint8Array(3))).toThrow("gray_png_size_mismatch");
    const gray = encodeGrayPng(2, 2, new Uint8Array(4));
    expect(gray[25]).toBe(0);
  });

  it("结构化元数据校验：0<zMin<zMax、2:1、编码固定；不合格给中文原因", () => {
    expect(validateDepthPanoUploadMeta({ width: 1024, height: 512, zMin: 0.3, zMax: 60, encoding: "log_inverse_01" })).toEqual({ ok: true, meta: { width: 1024, height: 512, zMin: 0.3, zMax: 60, encoding: "log_inverse_01" } });
    expect(validateDepthPanoUploadMeta({ width: 1024, height: 512, zMin: 0, zMax: 60, encoding: "log_inverse_01" })).toMatchObject({ ok: false, reasonZh: expect.stringContaining("z_min") });
    expect(validateDepthPanoUploadMeta({ width: 1024, height: 512, zMin: 60, zMax: 60, encoding: "log_inverse_01" })).toMatchObject({ ok: false });
    expect(validateDepthPanoUploadMeta({ width: 1024, height: 500, zMin: 0.3, zMax: 60, encoding: "log_inverse_01" })).toMatchObject({ ok: false, reasonZh: expect.stringContaining("2:1") });
    expect(validateDepthPanoUploadMeta({ width: 1024, height: 512, zMin: 0.3, zMax: 60, encoding: "near_bright_linear" })).toMatchObject({ ok: false, reasonZh: expect.stringContaining("编码") });
    expect(validateDepthPanoUploadMeta(undefined)).toMatchObject({ ok: false });
  });
});
