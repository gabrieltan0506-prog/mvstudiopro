import { describe, it, expect } from "vitest";
import {
  createManhuaPrevisStudio,
  manhuaPrevisSpecSchema,
  manhuaPrevisStudioSchema,
  formatPrevisMotionGuide,
} from "./manhuaPrevis";
import {
  normalizeManhuaSegmentReferences,
  formatManhuaSegmentReferenceGuideZh,
} from "./manhuaSegmentReference";
const scope = "11111111-1111-4111-8111-111111111111";
describe("白模配置与旧引用兼容", () => {
  it("引用说明完整保存，不以固定字符数截掉末尾动作", () => {
    const motionGuideZh = "动作说明".repeat(1200) + "最后角色最后动作";
    const refs = normalizeManhuaSegmentReferences({
      previs: {
        url: "https://test.invalid/previs.mp4",
        updatedAt: "2026-09-11",
        motionGuideZh,
      },
    })!;
    expect(refs.previs?.motionGuideZh).toBe(motionGuideZh);
  });
  it("切镜区间少于实际一帧时拒绝，不产生倒序关键帧", () => {
    const spec = createManhuaPrevisStudio(10, scope).spec;
    spec.cameras = [
      { ...spec.cameras[0], endSec: 0.001 },
      { ...spec.cameras[0], startSec: 0.001 },
    ];
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
    spec.cameras = [
      { ...spec.cameras[0], endSec: 1 / 48 },
      { ...spec.cameras[1], startSec: 1 / 48 },
    ];
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(true);
  });
  it("编辑中的空名称与未闭合时间可以保存，但不能提交渲染", () => {
    const studio = createManhuaPrevisStudio(10, scope);
    studio.spec.actors[0].nameZh = "";
    studio.spec.durationSec = 0;
    studio.spec.actors[0].moveEndSec = 0;
    expect(manhuaPrevisStudioSchema.parse(studio)).toEqual(studio);
    expect(manhuaPrevisSpecSchema.safeParse(studio.spec).success).toBe(false);
  });
  it("默认配置可渲染，不编造剧本动作", () => {
    const s = createManhuaPrevisStudio(10, scope);
    expect(manhuaPrevisSpecSchema.parse(s.spec).actors[0].actions).toEqual([]);
    expect(manhuaPrevisStudioSchema.parse(s)).toEqual(s);
  });
  it("拒绝脚本、速度过快、动作重叠与镜头缺口", () => {
    const spec = createManhuaPrevisStudio(10, scope).spec;
    expect(
      manhuaPrevisSpecSchema.safeParse({ ...spec, python: "print(1)" }).success
    ).toBe(false);
    expect(
      manhuaPrevisSpecSchema.safeParse({
        ...spec,
        actors: [{ ...spec.actors[0], end: [12, 12], moveEndSec: 1 }],
      }).success
    ).toBe(false);
    expect(
      manhuaPrevisSpecSchema.safeParse({
        ...spec,
        actors: [
          {
            ...spec.actors[0],
            actions: [
              { kind: "guard", startSec: 1, endSec: 5 },
              { kind: "strike", startSec: 4, endSec: 8 },
            ],
          },
        ],
      }).success
    ).toBe(false);
    expect(
      manhuaPrevisSpecSchema.safeParse({
        ...spec,
        cameras: [{ ...spec.cameras[0], startSec: 1 }],
      }).success
    ).toBe(false);
  });
  it("动作名和时间进入实际参考引导，旧稿保持无动作段", () => {
    const spec = createManhuaPrevisStudio(10, scope).spec;
    spec.actors[0].nameZh = "阿菁";
    spec.actors[0].actions = [{ kind: "guard", startSec: 2, endSec: 6 }];
    const motionGuideZh = formatPrevisMotionGuide(spec);
    const refs = normalizeManhuaSegmentReferences({
      previs: {
        url: "https://test.invalid/previs.mp4",
        updatedAt: "2026-09-11",
        motionGuideZh,
      },
    })!;
    expect(refs.previs?.motionGuideZh).toContain("2—6秒抬臂保护");
    expect(
      formatManhuaSegmentReferenceGuideZh({
        previsVideoIndex: 1,
        motionGuideZh,
      })
    ).toContain("白模角色1对应阿菁");
    expect(
      formatManhuaSegmentReferenceGuideZh({ previsVideoIndex: 1 })
    ).not.toContain("【白模动作】");
  });
});
