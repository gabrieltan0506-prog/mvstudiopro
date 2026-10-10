import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { codeMotionProjectSchema, compileCodeMotion } from "./codeMotion";
import { applyCodeMotionEffect } from "./codeMotionEffects";
import { codeMotionPlanElementSchema } from "./codeMotionComposition";

const images = Array.from({ length: 4 }, (_, i) => ({
  id: `10000000-0000-4000-8000-00000000000${i}`,
  name: ["原始地形笔记", "原始天候笔记", "原始交通笔记", "原始装备笔记"][i],
  gcsUri: `gs://fixture/selected/${i}.png`,
}));
const project = () =>
  codeMotionProjectSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    brief: {
      title: "我的观察记录",
      request: "将我的四张材料整理成片",
      style: "scenes",
      duration: 15,
      durationMode: "natural",
      orientation: "portrait",
      images,
    },
    plan: {
      version: 1,
      summary: "保留原有材料和说明",
      scenes: Array.from({ length: 3 }, (_, i) => ({
        heading: `原有段落${i + 1}`,
        body: "作者原文保持不变",
        duration: 5,
        composition: {
          id: `scene-${i}`,
          duration: 5,
          elements: [
            {
              id: "author-title",
              type: "text",
              text: "作者自己的标题",
              transform: { x: 0.5, y: 0.07 },
            },
            ...images.map((image, n) => ({
              id: `author-image-${n}`,
              type: "image",
              imageId: image.id,
              fit: "contain",
              transform: { x: 0.2 + n * 0.2, y: 0.4 },
              keyframes: [
                { at: 0, x: 0.2, reveal: 0.25 },
                { at: 1.2, x: 0.5, reveal: 1, ease: "easeIn" },
                { at: 5, x: 0.7, ease: "easeOut" },
              ],
            })),
          ],
        },
      })),
    },
  });

// Consume the production engine's pure sampler without creating canvas/media.
const runtimeWindow: Record<string, any> = {};
runInNewContext(
  readFileSync(
    new URL(
      "../client/public/art-motion/engine/composition.js",
      import.meta.url
    ),
    "utf8"
  ),
  { window: runtimeWindow }
);
const sample = runtimeWindow.CODE_MOTION_COMPOSITION_INTERNALS.sample as (
  initial: Record<string, unknown>,
  frames: unknown[],
  time: number
) => Record<string, number>;
const state = (element: any, time: number) =>
  sample(
    {
      x: 0.5,
      y: 0.5,
      opacity: 1,
      rotation: 0,
      reveal: 1,
      ...element.transform,
    },
    element.keyframes,
    time
  );

describe("workbench code effect recipes", () => {
  it("keeps columns aligned and annotations accumulated through the formal save/restore/compile path", () => {
    const original = project(),
      snapshot = structuredClone(original);
    const applied = applyCodeMotionEffect(original, "columnAnnotations");
    const restored = codeMotionProjectSchema.parse(
      JSON.parse(JSON.stringify(applied))
    );
    const spec = compileCodeMotion(restored.brief, restored.plan);
    const scene = spec.composition!.scenes[0];
    const notes = scene.elements.filter(e => /column-\d-note$/.test(e.id));
    const photos = scene.elements.filter(e => /column-\d-image$/.test(e.id));
    expect(photos).toHaveLength(3);
    expect(photos.map(e => e.type === "image" && e.imageUri)).toEqual(
      images.slice(0, 3).map(i => i.gcsUri)
    );
    expect(photos.map(e => state(e, 0.1).x)).toEqual(
      photos.map(e => state(e, 4.9).x)
    );
    expect(notes.map(e => state(e, 4.9).opacity)).toEqual([1, 1, 1]);
    expect(notes.map(e => e.end)).toEqual([5, 5, 5]);
    expect(
      scene.elements
        .filter(e => /column-\d-label$/.test(e.id))
        .map(e => e.type === "text" && e.text)
    ).toEqual(images.slice(0, 3).map(i => i.name));
    expect(original).toEqual(snapshot);
    expect(restored.brief.images).toEqual(original.brief.images);
    expect(restored.plan!.scenes[0].composition!.elements.slice(0, 5)).toEqual(
      original.plan!.scenes[0].composition!.elements
    );
    expect(applyCodeMotionEffect(restored, "columnAnnotations")).toEqual(
      restored
    );
  });

  it("retains earlier square full pages while later pages enter in deterministic depth order", () => {
    const original = project();
    const applied = applyCodeMotionEffect(original, "paperStack");
    const restored = codeMotionProjectSchema.parse(
      JSON.parse(JSON.stringify(applied))
    );
    const compiled = compileCodeMotion(restored.brief, restored.plan);
    const elements = compiled.composition!.scenes[0].elements;
    const sheets = elements.filter(e => /paper-\d-sheet$/.test(e.id));
    const photos = elements.filter(e => /paper-\d-image$/.test(e.id));
    expect(sheets).toHaveLength(4);
    expect(sheets.map(e => e.type === "shape" && e.radius)).toEqual([
      0, 0, 0, 0,
    ]);
    expect(photos.map(e => e.type === "image" && e.fit)).toEqual([
      "contain",
      "contain",
      "contain",
      "contain",
    ]);
    expect(photos.map(e => e.type === "image" && e.imageUri)).toEqual(
      images.map(i => i.gcsUri)
    );
    expect(sheets.map(e => state(e, 4.8).opacity)).toEqual([1, 1, 1, 1]);
    expect(sheets.map(e => state(e, 4.8).rotation)).toEqual([-6, 3, -2, 5]);
    expect(
      sheets.every((e, i) => i === 0 || e.layer > sheets[i - 1].layer)
    ).toBe(true);
    const later = state(sheets[3], 4.8);
    state(sheets[3], 0);
    expect(state(sheets[3], 4.8)).toEqual(later);
    expect(applied.plan!.scenes.map(s => [s.heading, s.body])).toEqual(
      original.plan!.scenes.map(s => [s.heading, s.body])
    );
    expect(applyCodeMotionEffect(applied, "paperStack")).toEqual(applied);
  });

  it("does not touch a scene covered even partially by an original video, or replace the saved video", () => {
    const original = project();
    original.plan!.codeVideo = {
      version: 1,
      assets: [
        {
          id: "original",
          videoUri: "gs://fixture/original.mp4",
          durationSec: 4,
          sha256: "a".repeat(64),
        },
      ],
      clips: [
        {
          assetId: "original",
          at: 0,
          duration: 4,
          sourceStartSec: 0,
          fit: "cover",
        },
      ],
    };
    const applied = applyCodeMotionEffect(original, "columnAnnotations");
    expect(applied.plan!.scenes[0]).toBe(original.plan!.scenes[0]);
    expect(applied.plan!.codeVideo).toBe(original.plan!.codeVideo);
    expect(
      applied.plan!.scenes[1].composition!.elements.length
    ).toBeGreaterThan(original.plan!.scenes[1].composition!.elements.length);
    expect(
      codeMotionProjectSchema.parse(JSON.parse(JSON.stringify(applied))).plan!
        .codeVideo
    ).toEqual(original.plan!.codeVideo);
  });

  it("rejects missing materials and capacity atomically without inventing content", () => {
    const missing = project();
    missing.brief.images = [];
    const before = structuredClone(missing);
    expect(() => applyCodeMotionEffect(missing, "columnAnnotations")).toThrow(
      "至少3张"
    );
    expect(() => applyCodeMotionEffect(missing, "paperStack")).toThrow(
      "至少2张"
    );
    expect(missing).toEqual(before);
    const full = project();
    full.plan!.scenes[1].composition!.elements.push(
      ...Array.from({ length: 35 }, (_, i) =>
        codeMotionPlanElementSchema.parse({
          id: `preserve-${i}`,
          type: "shape",
          shape: "rect",
        })
      )
    );
    const snapshot = structuredClone(full);
    expect(() => applyCodeMotionEffect(full, "columnAnnotations")).toThrow(
      "元素已满"
    );
    expect(full).toEqual(snapshot);
  });

  it("image reveal preserves original identity, fit and non-reveal motion, including easing collisions", () => {
    const original = project();
    const applied = applyCodeMotionEffect(original, "imageReveal");
    const before = original.plan!.scenes[0].composition!.elements[1];
    const after = applied.plan!.scenes[0].composition!.elements[1];
    expect(after).toMatchObject({
      id: before.id,
      type: "image",
      imageId: images[0].id,
      fit: "contain",
      revealDirection: "left",
    });
    for (const time of [0, 0.2, 0.7, 1.2, 2.1, 4.9])
      expect(state(after, time).x).toBe(state(before, time).x);
    expect(state(after, 0).reveal).toBe(0);
    expect(state(after, 2).reveal).toBe(1);
    expect(after.keyframes.find(k => k.at === 1.2)?.ease).toBe("easeIn");
    expect(applyCodeMotionEffect(applied, "imageReveal")).toEqual(applied);
    expect(
      codeMotionProjectSchema.parse(JSON.parse(JSON.stringify(applied)))
    ).toEqual(applied);
  });

  it("free 3D recipe writes real point morph and camera orbit while keeping existing camera motion", () => {
    const original = project();
    original.brief.generationTier = "free";
    original.plan!.scenes[0].composition!.camera = {
      zoom: 1.1,
      x: 0.45,
      keyframes: [
        { at: 0, zoom: 1.1 },
        { at: 5, zoom: 1.3, ease: "easeIn" },
      ],
    };
    const applied = applyCodeMotionEffect(original, "pointMorph3d");
    const restored = codeMotionProjectSchema.parse(
      JSON.parse(JSON.stringify(applied))
    );
    const spec = compileCodeMotion(restored.brief, restored.plan);
    const effect = spec.composition!.scenes[0].elements.find(
      e => e.id === "ink-menu-effect"
    )!;
    expect(effect).toMatchObject({
      type: "pointMorph",
      from: "sphere",
      to: "torus",
      count: 240,
      seed: 41,
    });
    expect(spec.composition!.scenes[0].camera).toMatchObject({
      x: 0.45,
      zoom: 1.1,
      orbitY: 0,
    });
    expect(spec.composition!.scenes[0].camera!.keyframes).toEqual([
      { at: 0, zoom: 1.1, orbitY: 0 },
      { at: 5, zoom: 1.3, orbitY: 35, ease: "easeIn" },
    ]);
    expect(effect.keyframes.map(k => k.morph)).toEqual([0, 1, 1]);
    expect(applied.brief.images).toEqual(original.brief.images);
    expect(applyCodeMotionEffect(applied, "pointMorph3d")).toEqual(applied);
  });

  it("keeps the new 3D effect visible over a prior layout and rejects particle overflow without changing the project", () => {
    const layout = applyCodeMotionEffect(project(), "paperStack");
    const with3d = applyCodeMotionEffect(layout, "pointMorph3d");
    const elements = with3d.plan!.scenes[0].composition!.elements;
    expect(
      elements.find(e => e.id === "ink-menu-effect")!.layer
    ).toBeGreaterThan(
      Math.max(
        ...layout.plan!.scenes[0].composition!.elements.map(e => e.layer)
      )
    );
    const crowded = project();
    crowded.plan!.scenes[0].composition!.elements.push(
      ...Array.from({ length: 5 }, (_, i) =>
        codeMotionPlanElementSchema.parse({
          id: `author-particles-${i}`,
          type: "particles",
          count: 280,
        })
      )
    );
    const snapshot = structuredClone(crowded);
    expect(() => applyCodeMotionEffect(crowded, "pointMorph3d")).toThrow(
      "粒子已满"
    );
    expect(crowded).toEqual(snapshot);
  });
});
