import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
function internals() {
  const sandbox = { window: {}, console, Math, Map, Set, URL };
  vm.runInNewContext(
    readFileSync("client/public/art-motion/engine/composition.js", "utf8"),
    sandbox
  );
  return (sandbox.window as any).CODE_MOTION_COMPOSITION_INTERNALS;
}
describe("逐镜动画确定性求值", () => {
  it("任意顺序seek与逐帧求值一致，稀疏关键帧逐字段插值", () => {
    const { sample } = internals();
    const initial = { x: 0, y: 0, fill: "#000000", opacity: 1 };
    const keys = [
      { at: 1, x: 1 },
      { at: 2, y: 1 },
      { at: 3, x: 2, fill: "#ffffff" },
    ];
    const expected = sample(initial, keys, 1.5);
    expect(expected.x).toBe(1.25);
    expect(expected.y).toBe(0.75);
    expect(expected.fill).toBe("#808080");
    for (const t of [0, 3, 0.1, 2, 1.5]) sample(initial, keys, t);
    expect(sample(initial, keys, 1.5)).toEqual(expected);
  });
  it("step关键帧在到达前保持，旋转和透视产生真实深度变化", () => {
    const { sample, rotate, projector } = internals();
    expect(sample({ x: 0 }, [{ at: 2, x: 1, ease: "step" }], 1.99).x).toBe(0);
    expect(sample({ x: 0 }, [{ at: 2, x: 1, ease: "step" }], 2).x).toBe(1);
    expect(rotate([1, 0, 0], 0, 90, 0)[2]).toBeCloseTo(-1);
    const project = projector(
      { x: 0.5, y: 0.5, z: 4, zoom: 1, rotationX: 0, rotationY: 0 },
      1280,
      720
    );
    expect(project([1, 0, 1]).scale).toBeGreaterThan(project([1, 0, 0]).scale);
    expect(project([0, 0, 5])).toBeNull();
  });
  it("固定粒子种子可重放且不同粒子不共享位置", () => {
    const { hash } = internals();
    const values = Array.from({ length: 100 }, (_, i) => hash(42, i));
    expect(new Set(values).size).toBe(100);
    expect(values).toEqual(Array.from({ length: 100 }, (_, i) => hash(42, i)));
    expect(values.every(n => n >= 0 && n < 1)).toBe(true);
  });
  it("三维面跨过近裁面保留可见部分且投影全部有限", () => {
    const { projector } = internals();
    const project = projector(
      { x: 0.5, y: 0.5, z: 4, zoom: 1, rotationX: 0, rotationY: 0 },
      1280,
      720
    );
    const polygon = project.polygon([
      [-1, 0, 3],
      [1, 0, 3],
      [0, 1, 5],
    ]);
    expect(polygon.length).toBe(4);
    expect(
      polygon.every(
        (p: any) =>
          p.depth >= 0.025 && Number.isFinite(p.x) && Number.isFinite(p.y)
      )
    ).toBe(true);
    expect(
      project.polygon([
        [0, 0, 5],
        [1, 0, 5],
        [0, 1, 5],
      ])
    ).toEqual([]);
  });
});
