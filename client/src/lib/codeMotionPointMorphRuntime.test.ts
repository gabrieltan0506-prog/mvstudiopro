import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import { afterAll, expect, it } from "vitest";
import {
  codeMotionCompositionSchema,
  codeMotionPlanSceneSchema,
  resolveCodeMotionCompositionImages,
} from "../../../shared/codeMotionComposition";
import { artMotionSpecSchema } from "../../../shared/artMotion";

type Point = [number, number, number];
type Camera = {
  x: number;
  y: number;
  z: number;
  zoom: number;
  rotationX: number;
  rotationY: number;
  orbitX?: number;
  orbitY?: number;
};
type Projected = { x: number; y: number; scale: number; depth: number };
type Morph = {
  from: string;
  to: string;
  count: number;
  seed: number;
  spread: number;
};
type Internals = {
  pointTarget: (
    shape: string,
    seed: number,
    index: number,
    count: number
  ) => Point;
  morphPoints: (element: Morph, progress: number) => Point[];
  projector: (
    camera: Camera,
    width: number,
    height: number
  ) => (point: Point) => Projected | null;
};
const observations: unknown[] = [];
const camera: Camera = {
  x: 0.5,
  y: 0.5,
  z: 4,
  zoom: 1,
  rotationX: 0,
  rotationY: 0,
};
const element = {
  id: "cloud",
  type: "pointMorph",
  from: "sphere",
  to: "torus",
  count: 120,
  seed: 42,
  spread: 0.6,
  size: 0.004,
  transform: { fill: "#eecc88", morph: 0 },
  keyframes: [{ at: 2, morph: 1 }],
} as const;
function makeSpec(orbit = true) {
  const scene = codeMotionPlanSceneSchema.parse({
    id: "morph",
    duration: 3,
    camera: {
      ...camera,
      keyframes: orbit ? [{ at: 2, orbitX: 15, orbitY: 65 }] : [],
    },
    elements: [element],
  });
  return artMotionSpecSchema.parse({
    version: 1,
    grammar: "y5_kinetic_type",
    mode: "animation",
    width: 1280,
    height: 720,
    duration: 3,
    fps: 30,
    background: "#112233",
    cues: [],
    composition: resolveCodeMotionCompositionImages([scene], []),
  });
}
async function runtime(spec = makeSpec()) {
  const arcs: number[][] = [];
  const noop = () => {};
  const context = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "",
    strokeStyle: "",
    save: noop,
    restore: noop,
    beginPath: noop,
    rect: noop,
    clip: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    fillRect: noop,
    setTransform: noop,
    clearRect: noop,
    fill: noop,
    arc: (...values: number[]) => arcs.push(values),
  };
  const canvas = { width: 0, height: 0, getContext: () => context };
  const window: {
    COMPOSITION_SPEC: typeof spec;
    CODE_MOTION_COMPOSITION_INTERNALS?: Internals;
    renderFrame?: (seconds: number) => void;
    __ready?: boolean;
    __bootFailed?: string;
  } = { COMPOSITION_SPEC: spec };
  vm.runInNewContext(
    readFileSync("client/public/art-motion/engine/composition.js", "utf8"),
    {
      window,
      document: {
        getElementById: () => canvas,
        fonts: { ready: Promise.resolve() },
      },
      console,
      Math,
      Map,
      Set,
      URL,
    }
  );
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(window.__bootFailed).toBeUndefined();
  expect(window.__ready).toBe(true);
  return {
    internals: window.CODE_MOTION_COMPOSITION_INTERNALS!,
    render: (time: number) => {
      arcs.length = 0;
      window.renderFrame!(time);
      return arcs.map(a => [...a]);
    },
  };
}
it("formal plan→resolved→spec→runtime retains morph and orbit with no asset fetch", async () => {
  const spec = makeSpec();
  const r = await runtime(spec);
  const frames = [0, 1, 2].map(t => r.render(t));
  for (const frame of frames) {
    expect(frame).toHaveLength(120);
    expect(frame.flat().every(Number.isFinite)).toBe(true);
  }
  expect(frames[0]).not.toEqual(frames[1]);
  expect(frames[1]).not.toEqual(frames[2]);
  observations.push({
    formalRuntimeFrames: frames.map(f => ({ count: f.length, first: f[0] })),
  });
});
it("each target has equal count, nonzero XYZ extent and exact stable point correspondence", async () => {
  const { internals: i } = await runtime();
  for (const shape of ["sphere", "torus", "helix"]) {
    const e = { ...element, from: shape, to: shape };
    const points = i.morphPoints(e, 0);
    expect(points).toHaveLength(120);
    expect(points).toEqual(i.morphPoints(e, 1));
    for (let axis = 0; axis < 3; axis++)
      expect(
        Math.max(...points.map(p => p[axis])) -
          Math.min(...points.map(p => p[axis]))
      ).toBeGreaterThan(0.3);
    expect(points).not.toEqual(i.morphPoints({ ...e, seed: 43 }, 0));
  }
  const a = i.morphPoints(element, 0),
    b = i.morphPoints(element, 1),
    m = i.morphPoints(element, 0.5);
  for (let index = 0; index < 120; index++)
    for (let axis = 0; axis < 3; axis++)
      expect(m[index][axis]).toBeCloseTo(
        (a[index][axis] + b[index][axis]) / 2,
        12
      );
});
it("orbit fixes target in center while depth and perspective change; absent orbit is legacy", async () => {
  const { internals: i } = await runtime();
  const p = i.projector(camera, 1280, 720),
    q = i.projector({ ...camera, orbitY: 90 }, 1280, 720);
  expect(q([0, 0, 0])).toEqual(p([0, 0, 0]));
  const a = p([1, 0, 0])!,
    b = q([1, 0, 0])!;
  expect(a.x).toBeCloseTo(1360);
  expect(a.depth).toBe(4);
  expect(b.x).toBeCloseTo(640);
  expect(b.depth).toBeCloseTo(3);
  expect(b.scale).toBeGreaterThan(a.scale);
  expect(p([0.2, 0.3, 0.4])).toEqual(
    i.projector({ ...camera, orbitX: 0, orbitY: 0 }, 1280, 720)([0.2, 0.3, 0.4])
  );
  expect(q([5, 0, 0])).toBeNull();
});
it("reverse and repeated absolute-frame seeks produce identical sorted canvas draws", async () => {
  const r = await runtime();
  const expected = r.render(1);
  for (const t of [2.9, 0, 0.25, 2, 1.5]) r.render(t);
  expect(r.render(1)).toEqual(expected);
  expect(r.render(1)).toEqual(expected);
  // Fixed point size scales with depth; painter ordering is far-to-near.
  for (let i = 1; i < expected.length; i++)
    expect(expected[i][2]).toBeGreaterThanOrEqual(expected[i - 1][2]);
  observations.push({
    reverseSeekExact: true,
    depthSorted: true,
    points: expected.length,
  });
});
it("morph changes xyz projection with static camera independently of camera motion", async () => {
  const r = await runtime(makeSpec(false));
  expect(r.render(0)).not.toEqual(r.render(2));
});
it("schema rejects overflow, arbitrary shapes, executable URLs and morph on 2D elements", () => {
  for (const bad of [
    { ...element, count: 301 },
    { ...element, to: "remote" },
    { ...element, url: "https://example.com/model" },
    { id: "bad", type: "shape", shape: "rect", transform: { morph: 0.5 } },
  ])
    expect(
      codeMotionPlanSceneSchema.safeParse({
        id: "bad",
        duration: 3,
        elements: [bad],
      }).success
    ).toBe(false);
  const spec = makeSpec();
  expect(
    codeMotionCompositionSchema.safeParse({
      ...spec.composition,
      scenes: [
        {
          ...spec.composition!.scenes[0],
          elements: Array.from({ length: 6 }, (_, i) => ({
            ...element,
            id: `p${i}`,
            count: 300,
          })),
        },
      ],
    }).success
  ).toBe(false);
});
afterAll(() => {
  if (process.env.INK_POINT_MORPH_EVIDENCE) {
    const file = process.env.INK_POINT_MORPH_EVIDENCE;
    mkdirSync(file.slice(0, file.lastIndexOf("/")), { recursive: true });
    writeFileSync(file, JSON.stringify(observations, null, 2));
  }
});
