import { describe, expect, it } from "vitest";
import {
  characterFootStageZ,
  marbleToStageTransform,
  placeCharacterOnGround,
  threeCameraRigForKeyframe,
  worldPointFromBinding,
} from "./manhuaWorldStage.js";

function mulRows(m: readonly number[], p: readonly [number, number, number]): [number, number, number] {
  const v = [p[0], p[1], p[2], 1];
  const out = [0, 0, 0];
  for (let r = 0; r < 3; r += 1) out[r] = m[r * 4]! * v[0]! + m[r * 4 + 1]! * v[1]! + m[r * 4 + 2]! * v[2]! + m[r * 4 + 3]! * v[3]!;
  return [out[0]!, out[1]!, out[2]!];
}

// 简易伪随机（可复现的属性式测试）
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("manhuaWorldStage", () => {
  it("变换可逆：toWorld(toStage(p)) ≈ p；矩阵与点函数一致；逆矩阵与 toWorld 一致", () => {
    const rnd = lcg(7);
    for (let i = 0; i < 200; i += 1) {
      const t = marbleToStageTransform({ metricScaleFactor: 0.2 + rnd() * 5, groundPlaneOffset: (rnd() - 0.5) * 6 });
      const p: [number, number, number] = [(rnd() - 0.5) * 40, (rnd() - 0.5) * 40, (rnd() - 0.5) * 40];
      const s = t.toStage(p);
      const back = t.toWorld(s);
      for (let k = 0; k < 3; k += 1) {
        expect(back[k]).toBeCloseTo(p[k]!, 6);
        expect(mulRows(t.matrixRows, p)[k]).toBeCloseTo(s[k]!, 6);
        expect(mulRows(t.inverseRows, s)[k]).toBeCloseTo(p[k]!, 6);
      }
    }
  });

  it("轴向：OpenCV 的 Y 下 → 舞台 Z 上；Z 前 → 舞台 +Y；地面 y=g/s 落到 z=0", () => {
    const t = marbleToStageTransform({ metricScaleFactor: 2, groundPlaneOffset: 1.6 });
    expect(t.toStage([0, 0.8, 0])).toEqual([0, 0, 0]); // 地面（raw y=0.8 × 2 = 1.6 = g）
    expect(t.toStage([0, 0, 1])).toEqual([0, 2, 1.6]); // 前方 1（×2）→ +Y 2
    expect(t.toStage([1, 0, 0])[0]).toBe(2);
    // 低于地面（OpenCV y 更大）→ 舞台 z 负
    expect(t.toStage([0, 2, 0])[2]).toBeLessThan(0);
    expect(t.translationStage).toEqual([0, 0, 1.6]);
    expect(t.rotationXDeg).toBe(-90);
    // 四元数：绕 X −90° → x 分量 −sin45
    expect(t.quaternionXYZW[0]).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(t.quaternionXYZW[3]).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it("缺省/非法尺度退为 1、偏移退为 0", () => {
    const t = marbleToStageTransform({ metricScaleFactor: Number.NaN, groundPlaneOffset: undefined });
    expect(t.scale).toBe(1);
    expect(t.groundPlaneOffset).toBe(0);
    expect(marbleToStageTransform({ metricScaleFactor: -3 }).scale).toBe(1);
  });

  it("角色贴地：任意身高/模型脚底偏移，脚底 z 恒等于地面偏移", () => {
    const rnd = lcg(11);
    for (let i = 0; i < 100; i += 1) {
      const foot = (rnd() - 0.5) * 2;
      const groundZ = (rnd() - 0.5) * 2;
      const height = 0.5 + rnd() * 2;
      const native = 0.5 + rnd() * 200; // 厘米单位的模型也能归一
      const placement = placeCharacterOnGround({ stagePoint: [rnd() * 10, rnd() * 10], characterHeightM: height, ground: { offset: groundZ }, modelNativeHeightM: native, modelFootOffset: foot });
      expect(characterFootStageZ(placement, foot)).toBeCloseTo(groundZ, 9);
      expect(placement.scale * native).toBeCloseTo(height, 9);
    }
    const simple = placeCharacterOnGround({ stagePoint: [1, 2], characterHeightM: 1.7 });
    expect(simple.position).toEqual([1, 2, 0]);
    expect(simple.scale).toBeCloseTo(1.7, 9);
  });

  it("绑定落点：world z_up 直用、y_up 换轴；screen/unresolved/缺失一律拒绝并给中文原因", () => {
    expect(worldPointFromBinding({ point: { space: "world", x: 1, y: 2, z: 0.5, unit: "m", axis: "z_up" } })).toEqual({ stage: [1, 2, 0.5] });
    expect(worldPointFromBinding({ space: "world", x: 1, y: 0.5, z: -2, unit: "m", axis: "y_up" })).toEqual({ stage: [1, 2, 0.5] });
    const rnd = lcg(3);
    for (let i = 0; i < 50; i += 1) {
      const r = worldPointFromBinding({ point: { space: "screen", x: rnd(), y: rnd() } });
      expect(r.stage).toBeNull();
      expect(r.reasonZh).toContain("不能冒充");
    }
    expect(worldPointFromBinding({ point: { space: "unresolved", reasonZh: "缺深度" } })).toEqual({ stage: null, reasonZh: "落点未解析：缺深度" });
    expect(worldPointFromBinding(null).stage).toBeNull();
    expect(worldPointFromBinding({ point: null }).reasonZh).toBe("这个绑定还没有落点");
  });

  it("三机位：过肩在过肩者身后 0.9/侧 0.45/高 1.55；单人正前 1.6 高 1.5；建立高位全景 28mm", () => {
    const subject = [0, 0, 0] as const;
    const over = [0, 2, 0] as const; // 过肩者在主体正前方 +Y 2 米
    const ots = threeCameraRigForKeyframe({ subjectStage: subject, kind: "ots", overStage: over });
    expect(ots.position[1]).toBeCloseTo(2.9, 9); // 身后 0.9（远离主体）
    expect(Math.abs(ots.position[0])).toBeCloseTo(0.45, 9);
    expect(ots.position[2]).toBeCloseTo(1.55, 9);
    expect(ots.target).toEqual([0, 0, 1.5]);
    expect(ots.lens).toBe(50);

    const single = threeCameraRigForKeyframe({ subjectStage: [3, 4, 0], kind: "single" });
    expect(single.position).toEqual([3, 4 - 1.6, 1.5]);
    expect(single.target).toEqual([3, 4, 1.5]);
    const facing = threeCameraRigForKeyframe({ subjectStage: [0, 0, 0], kind: "single", facingStage: [1, 0] });
    expect(facing.position[0]).toBeCloseTo(1.6, 9);

    const est = threeCameraRigForKeyframe({ subjectStage: [1, 1, 0], kind: "establish" });
    expect(est.position).toEqual([1, -6, 2.6]);
    expect(est.target).toEqual([1, 1, 1]);
    expect(est.lens).toBe(28);

    // 缺过肩对象：诚实退为单人正面
    const fallback = threeCameraRigForKeyframe({ subjectStage: subject, kind: "ots" });
    expect(fallback.kind).toBe("single");
    expect(fallback.labelZh).toContain("缺过肩对象");
  });
});
