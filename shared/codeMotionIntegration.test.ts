import { describe, expect, it } from "vitest";
import {
  codeMotionBriefSchema,
  codeMotionLocalProjectSchema,
  compileCodeMotion,
  validateCodeMotionPlan,
} from "./codeMotion";
import { artMotionSpecSchema } from "./artMotion";
const projectId = "11111111-1111-4111-8111-111111111111";
const imageId = "22222222-2222-4222-8222-222222222222";
const audioId = "33333333-3333-4333-8333-333333333333";
const brief = codeMotionBriefSchema.parse({
  title: "原声驱动的逐镜作品",
  request: "上传原声作开场旁白，图片保持身份",
  style: "scenes",
  duration: 15,
  orientation: "landscape",
  images: [
    { id: imageId, name: "原图", gcsUri: "gs://bucket/uploads/u7/picture.png" },
  ],
  audios: [
    {
      id: audioId,
      name: "作者原声",
      gcsUri: `gs://bucket/post-prod/7/code-motion/${projectId}/audio/${audioId}/${"a".repeat(64)}.wav`,
      duration: 5,
      mimeType: "audio/wav",
      sha256: "a".repeat(64),
      bytes: 480044,
    },
  ],
});
const plan = {
  version: 1,
  summary: "先画线，再推出原图",
  audioTimeline: [
    {
      sourceId: audioId,
      role: "narration",
      at: 1,
      trimStart: 0,
      duration: 5,
      volume: 0.8,
      fadeIn: 0.1,
      fadeOut: 0.2,
    },
  ],
  scenes: [
    {
      heading: "线索",
      body: "",
      duration: 5.25,
      composition: {
        id: "opening",
        duration: 5.25,
        elements: [
          {
            id: "thread",
            type: "path",
            points: [
              [0, 0],
              [0.4, 0],
            ],
            keyframes: [
              { at: 0, reveal: 0 },
              { at: 2, reveal: 1 },
            ],
          },
        ],
      },
    },
    {
      heading: "原图",
      body: "",
      duration: 9.75,
      composition: {
        id: "picture",
        duration: 9.75,
        elements: [
          {
            id: "thread",
            type: "path",
            continuity: "carry",
            points: [
              [0, 0],
              [0.4, 0],
            ],
          },
          { id: "photo", type: "image", imageId },
        ],
      },
    },
  ],
};
describe("映客新编排从材料到渲染合同", () => {
  it("本机草稿保留尚未填完的音频秒窗，正式编译仍拒绝", () => {
    const draft = {
      id: "11111111-1111-4111-8111-111111111111",
      brief,
      plan: {
        ...plan,
        audioTimeline: [{ ...plan.audioTimeline[0], duration: 0 }],
      },
    };
    expect(
      codeMotionLocalProjectSchema.parse(draft).plan?.audioTimeline?.[0]
        .duration
    ).toBe(0);
    expect(() => compileCodeMotion(brief, draft.plan)).toThrow();
  });
  it("原声、镜内动作和已选图片同时编译，浮点镜长闭合且不重复合成口播", () => {
    const spec = compileCodeMotion(brief, plan);
    expect(spec.inkSpeech).toBeUndefined();
    expect(spec.codeAudio?.sources[0]).toEqual(brief.audios![0]);
    expect(spec.codeAudio?.audioTimeline[0].at).toBe(1);
    expect(spec.composition?.scenes[1].elements[1]).toMatchObject({
      type: "image",
      imageUri: brief.images[0].gcsUri,
    });
    expect(spec.cues).toEqual([
      { at: 0, kind: "image", imageUri: brief.images[0].gcsUri },
    ]);
    expect(JSON.stringify(spec.composition)).not.toContain("imageId");
  });
  it("旧图片字段不能假称逐镜元素已经使用图片", () => {
    const invalid = structuredClone(plan);
    invalid.scenes[1].composition.elements.splice(1);
    Object.assign(invalid.scenes[1], { imageId });
    expect(() => validateCodeMotionPlan(brief, invalid)).toThrow("遗漏");
  });
  it("镜头说明不能代替画面，音轨不能超出片长或原音", () => {
    expect(() =>
      compileCodeMotion(brief, {
        ...plan,
        scenes: [{ heading: "空壳", body: "", duration: 15 }],
      })
    ).toThrow();
    expect(() =>
      compileCodeMotion(brief, {
        ...plan,
        audioTimeline: [{ ...plan.audioTimeline[0], trimStart: 3 }],
      })
    ).toThrow("原声时长");
    expect(() =>
      compileCodeMotion(brief, {
        ...plan,
        audioTimeline: [{ ...plan.audioTimeline[0], at: 14 }],
      })
    ).toThrow("视频时长");
  });
  it("直接后期入口也拒绝未登记的编排图片", () => {
    const spec = compileCodeMotion(brief, plan);
    expect(() => artMotionSpecSchema.parse({ ...spec, cues: [] })).toThrow(
      "登记"
    );
  });
  it("旧工程和完整新编排都能通过恢复合同，无地址和动作丢失", () => {
    const saved = codeMotionLocalProjectSchema.parse({
      id: projectId,
      brief,
      plan,
    });
    expect(compileCodeMotion(saved.brief, saved.plan)).toEqual(
      compileCodeMotion(brief, plan)
    );
    const old = codeMotionLocalProjectSchema.parse({
      id: projectId,
      brief: { ...brief, style: "words", images: [], audios: undefined },
      plan: {
        version: 1,
        summary: "旧稿",
        scenes: [{ heading: "旧文字", body: "", duration: 15 }],
      },
    });
    expect(compileCodeMotion(old.brief, old.plan).grammar).toBe(
      "y5_kinetic_type"
    );
  });
});
