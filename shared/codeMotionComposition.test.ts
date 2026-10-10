import { describe, expect, it } from "vitest";
import {
  codeMotionCompositionSchema,
  codeMotionPlanSceneSchema,
  codeMotionSceneSchema,
  resolveCodeMotionCompositionImages,
  retimeCodeMotionPlanScene,
} from "./codeMotionComposition";
const scene = () => ({
  id: "opening",
  duration: 4,
  elements: [
    {
      id: "thread",
      type: "path",
      points: [
        [-0.2, 0],
        [0.2, 0],
      ],
      keyframes: [
        { at: 0, reveal: 0 },
        { at: 4, reveal: 1 },
      ],
    },
  ],
});
describe("逐镜安全编排合同", () => {
  it("保留实际几何与关键帧而非模板文案", () => {
    const result = codeMotionSceneSchema.parse(scene());
    expect(result.elements[0].type).toBe("path");
    expect(result.elements[0].keyframes).toHaveLength(2);
    expect(result.elements[0].transform).toEqual({});
  });
  it("拒绝重复ID、越界/乱序关键帧和隐含脚本字段", () => {
    expect(
      codeMotionSceneSchema.safeParse({
        ...scene(),
        elements: [...scene().elements, ...scene().elements],
      }).success
    ).toBe(false);
    for (const frames of [
      [{ at: 5, x: 1 }],
      [
        { at: 2, x: 0 },
        { at: 1, x: 1 },
      ],
      [{ at: 0, x: Infinity }],
    ])
      expect(
        codeMotionSceneSchema.safeParse({
          ...scene(),
          elements: [{ ...scene().elements[0], keyframes: frames }],
        }).success
      ).toBe(false);
    expect(
      codeMotionSceneSchema.safeParse({
        ...scene(),
        script: "fetch('https://invalid')",
      }).success
    ).toBe(false);
  });
  it("跨镜贯穿要求上一镜同一实体和类型", () => {
    const next = {
      ...scene(),
      id: "next",
      elements: [{ ...scene().elements[0], continuity: "carry" }],
    };
    expect(
      codeMotionCompositionSchema.safeParse({
        version: 1,
        scenes: [scene(), next],
      }).success
    ).toBe(true);
    expect(
      codeMotionCompositionSchema.safeParse({ version: 1, scenes: [next] })
        .success
    ).toBe(false);
    expect(
      codeMotionCompositionSchema.safeParse({
        version: 1,
        scenes: [
          scene(),
          {
            ...next,
            elements: [
              {
                id: "thread",
                type: "text",
                text: "不同实体",
                continuity: "carry",
              },
            ],
          },
        ],
      }).success
    ).toBe(false);
  });
  it("图片只允许本次素材ID转换，计划不能夹带链接", () => {
    const imageId = "10000000-0000-4000-8000-000000000001";
    const plan = codeMotionPlanSceneSchema.parse({
      id: "photo",
      duration: 2,
      elements: [{ id: "photo", type: "image", imageId }],
    });
    const result = resolveCodeMotionCompositionImages(
      [plan],
      [{ id: imageId, gcsUri: "gs://test-bucket/owned/test.png" }]
    );
    expect(result.scenes[0].elements[0]).toMatchObject({
      imageUri: "gs://test-bucket/owned/test.png",
    });
    expect(result.scenes[0].elements[0]).not.toHaveProperty("imageId");
    expect(() => resolveCodeMotionCompositionImages([plan], [])).toThrow(
      "未绑定"
    );
    expect(
      codeMotionPlanSceneSchema.safeParse({
        ...plan,
        elements: [{ ...plan.elements[0], imageUri: "https://invalid" }],
      }).success
    ).toBe(false);
  });
  it("限制粒子、路径、镜头、时长和转场容量", () => {
    expect(
      codeMotionSceneSchema.safeParse({
        ...scene(),
        transition: { type: "fade", duration: 3 },
      }).success
    ).toBe(false);
    expect(
      codeMotionSceneSchema.safeParse({
        ...scene(),
        elements: [{ id: "dust", type: "particles", count: 301 }],
      }).success
    ).toBe(false);
    expect(
      codeMotionSceneSchema.safeParse({
        ...scene(),
        elements: [{ ...scene().elements[0], points: Array(129).fill([0, 0]) }],
      }).success
    ).toBe(false);
    expect(
      codeMotionCompositionSchema.safeParse({
        version: 1,
        scenes: [
          { ...scene(), duration: 180 },
          { ...scene(), id: "second" },
        ],
      }).success
    ).toBe(false);
  });
  it("拒绝没有渲染消费者的轴旋转和超量粒子，并严格拒绝未知元素字段", () => {
    expect(
      codeMotionSceneSchema.safeParse({
        ...scene(),
        elements: [
          {
            id: "text",
            type: "text",
            text: "字",
            transform: { rotationX: 30 },
          },
        ],
      }).success
    ).toBe(false);
    expect(
      codeMotionSceneSchema.safeParse({
        ...scene(),
        elements: [{ ...scene().elements[0], src: "https://invalid.test" }],
      }).success
    ).toBe(false);
    expect(
      codeMotionCompositionSchema.safeParse({
        version: 1,
        scenes: [
          {
            id: "many",
            duration: 4,
            elements: Array.from({ length: 6 }, (_, i) => ({
              id: `p${i}`,
              type: "particles",
              count: 300,
            })),
          },
        ],
      }).success
    ).toBe(false);
    for (const window of [{ start: 4 }, { start: 2, end: 1 }, { end: 5 }])
      expect(
        codeMotionSceneSchema.safeParse({
          ...scene(),
          elements: [{ ...scene().elements[0], ...window }],
        }).success
      ).toBe(false);
  });
});

describe("镜长调整同步关键帧", () => {
  it("缩短时同步元素秒窗、动作、相机与转场且不修改原稿", () => {
    const before = codeMotionPlanSceneSchema.parse({
      id: "time",
      duration: 10,
      transition: { type: "fade", duration: 2 },
      camera: {
        keyframes: [
          { at: 0, zoom: 1 },
          { at: 10, zoom: 2 },
        ],
      },
      elements: [
        {
          id: "picture",
          type: "image",
          imageId: "10000000-0000-4000-8000-000000000001",
          start: 2,
          end: 10,
          keyframes: [
            { at: 2, opacity: 0 },
            { at: 10, opacity: 1 },
          ],
        },
      ],
    });
    const after = retimeCodeMotionPlanScene(before, 2);
    expect(after.duration).toBe(2);
    expect(after.transition?.duration).toBe(0.4);
    expect(after.camera?.keyframes.map(k => k.at)).toEqual([0, 2]);
    expect(after.elements[0]).toMatchObject({
      start: 0.4,
      end: 2,
      imageId: "10000000-0000-4000-8000-000000000001",
    });
    expect(after.elements[0].keyframes.map(k => k.at)).toEqual([0.4, 2]);
    expect(before.duration).toBe(10);
    expect(before.elements[0].keyframes[1].at).toBe(10);
  });
  it("延长仍限制转场并保留精确结尾与未填写end", () => {
    const before = codeMotionPlanSceneSchema.parse({
      id: "time",
      duration: 3,
      transition: { type: "wipe", duration: 1 },
      elements: [
        {
          id: "title",
          type: "text",
          text: "内容",
          keyframes: [
            { at: 0, x: 0 },
            { at: 3, x: 1 },
          ],
        },
      ],
    });
    const after = retimeCodeMotionPlanScene(before, 100);
    expect(after.transition?.duration).toBe(2);
    expect(after.elements[0].keyframes[1].at).toBe(100);
    expect(after.elements[0].end).toBeUndefined();
  });
  it("拒绝非有限和越界镜长，避免除零或损坏草稿", () => {
    const before = codeMotionPlanSceneSchema.parse(scene());
    for (const duration of [0, 0.49, 181, NaN, Infinity])
      expect(() => retimeCodeMotionPlanScene(before, duration)).toThrow();
  });
});
