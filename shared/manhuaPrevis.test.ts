import { describe, it, expect } from "vitest";
import {
  createManhuaPrevisStudio,
  manhuaPrevisDraftSchema,
  manhuaPrevisSpecSchema,
  manhuaPrevisStudioSchema,
  formatPrevisMotionGuide,
  PREVIS_RENDER_UNIT_BUDGET,
  previsCapacityIssueZh,
  previsMaxDurationSec,
  previsRenderCostUnits,
} from "./manhuaPrevis";
import {
  normalizeManhuaSegmentReferences,
  formatManhuaSegmentReferenceGuideZh,
} from "./manhuaSegmentReference";
const scope = "11111111-1111-4111-8111-111111111111";
const boundarySpec = createManhuaPrevisStudio(5, scope).spec;
const boundaryActor = boundarySpec.actors[0];
const actorInput = (patch: Record<string, unknown>) => ({
  ...boundarySpec,
  actors: [{ ...boundaryActor, ...patch }],
});
const capabilityCases = [
  { name: "默认配置", input: boundarySpec, accepted: true },
  {
    name: "项目角色编号只作映射",
    input: actorInput({ assetRef: "character-1" }),
    accepted: true,
  },
  {
    name: "人体出手",
    input: actorInput({
      actions: [{ kind: "strike", startSec: 1, endSec: 3 }],
    }),
    accepted: true,
  },
  {
    name: "直接加载GLB",
    input: actorInput({ glbGcsUri: "gs://test/model.glb" }),
    accepted: false,
    path: ["actors", 0],
    code: "unrecognized_keys",
  },
  {
    name: "自动绑骨",
    input: { ...boundarySpec, autoRig: true },
    accepted: false,
    path: [],
    code: "unrecognized_keys",
  },
  {
    name: "剧本自动编排",
    input: { ...boundarySpec, scriptZh: "角色出拳，对手闪避" },
    accepted: false,
    path: [],
    code: "unrecognized_keys",
  },
  {
    name: "四尾",
    input: actorInput({ tails: 4 }),
    accepted: false,
    path: ["actors", 0],
    code: "unrecognized_keys",
  },
  {
    name: "翼",
    input: actorInput({ wings: true }),
    accepted: false,
    path: ["actors", 0],
    code: "unrecognized_keys",
  },
  {
    name: "面部表情",
    input: actorInput({ expression: "微笑" }),
    accepted: false,
    path: ["actors", 0],
    code: "unrecognized_keys",
  },
  ...["transform", "combo"].map(kind => ({
    name: kind === "transform" ? "变身" : "连击",
    input: actorInput({ actions: [{ kind, startSec: 1, endSec: 3 }] }),
    accepted: false,
    path: ["actors", 0, "actions", 0, "kind"],
    code: "invalid_value",
  })),
  {
    name: "四足出手",
    input: actorInput({
      shape: "horse",
      actions: [{ kind: "strike", startSec: 1, endSec: 3 }],
    }),
    accepted: false,
    path: ["actors", 0, "actions"],
    code: "custom",
  },
];

describe("白模配置与旧引用兼容", () => {
  it.each(capabilityCases)(
    "能力边界：$name",
    ({ input, accepted, path, code }) => {
      const result = manhuaPrevisSpecSchema.safeParse(input);
      expect(result.success).toBe(accepted);
      if (result.success) expect(result.data).toEqual(input);
      else
        expect(result.error.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ path, code })])
        );
    }
  );
  it("草稿不把未实现的能力静默剥掉", () => {
    for (const entry of capabilityCases.filter(
      c => !c.accepted && c.code !== "custom"
    )) {
      expect(
        manhuaPrevisDraftSchema.safeParse(entry.input).success,
        entry.name
      ).toBe(false);
    }
  });
  it("六角色八机位十二动作保持全量，超限明确拒绝", () => {
    // 0911 实测：六角色 30 秒在隔离机烧满 600 秒生产时限也交不出视频，
    // 现在按渲染预算事前拒绝；同样六角色在预算内的片长仍要保持全量能力。
    const spec = createManhuaPrevisStudio(18, scope).spec;
    spec.actors = Array.from({ length: 6 }, (_, i) => ({
      ...spec.actors[0],
      id: `actor-${i}`,
      nameZh: `角色${i}`,
      actions: Array.from({ length: 12 }, (_, j) => ({
        kind: "guard" as const,
        startSec: j * 1.5,
        endSec: j * 1.5 + 1,
      })),
    }));
    spec.cameras = Array.from({ length: 8 }, (_, i) => ({
      ...spec.cameras[0],
      startSec: i * 2.25,
      endSec: (i + 1) * 2.25,
    }));
    expect(manhuaPrevisSpecSchema.parse(spec)).toEqual(spec);
    expect(manhuaPrevisDraftSchema.parse(spec)).toEqual(spec);
    expect(formatPrevisMotionGuide(spec)).toContain("白模角色6对应角色5：");
    expect(
      formatPrevisMotionGuide(spec).match(/16\.5—17\.5秒抬臂保护|17—18秒抬臂保护/g)
    ).toHaveLength(6);
    const excess = [
      {
        ...spec,
        actors: [...spec.actors, { ...spec.actors[0], id: "actor-7" }],
      },
      { ...spec, cameras: [...spec.cameras, spec.cameras[0]] },
      {
        ...spec,
        actors: [
          {
            ...spec.actors[0],
            actions: [
              ...spec.actors[0].actions,
              { kind: "idle", startSec: 17, endSec: 17.5 },
            ],
          },
        ],
      },
    ];
    for (const value of excess) {
      expect(manhuaPrevisSpecSchema.safeParse(value).success).toBe(false);
      expect(manhuaPrevisDraftSchema.safeParse(value).success).toBe(false);
    }
  });
  it("编辑中零值与空数组可保存，生产提交必须拒绝", () => {
    const studio = createManhuaPrevisStudio(5, scope);
    studio.spec.actors[0].actions = [{ kind: "guard", startSec: 0, endSec: 0 }];
    studio.spec.cameras[0] = {
      startSec: 0,
      endSec: 0,
      position: [0, 0, 0],
      target: [0, 0, 0],
      lens: 0,
    };
    expect(manhuaPrevisStudioSchema.parse(studio)).toEqual(studio);
    expect(manhuaPrevisSpecSchema.safeParse(studio.spec).success).toBe(false);
    studio.spec.actors = [];
    studio.spec.cameras = [];
    expect(manhuaPrevisStudioSchema.parse(studio)).toEqual(studio);
    expect(manhuaPrevisSpecSchema.safeParse(studio.spec).success).toBe(false);
  });
  it.each([NaN, Infinity, -Infinity])(
    "草稿和提交都拒绝非有限数值 %s",
    value => {
      const spec = { ...boundarySpec, durationSec: value };
      expect(manhuaPrevisDraftSchema.safeParse(spec).success).toBe(false);
      expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
    }
  );
  it("片长边界只接收二到三十整秒，不以裁切静默接收", () => {
    for (const duration of [2, 30])
      expect(
        manhuaPrevisSpecSchema.parse(
          createManhuaPrevisStudio(duration, scope).spec
        ).durationSec
      ).toBe(duration);
    for (const durationSec of [0, 1, 2.5, 31])
      expect(
        manhuaPrevisSpecSchema.safeParse({ ...boundarySpec, durationSec })
          .success
      ).toBe(false);
  });
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

describe("单次渲染预算：按实测定的能力边界（0911）", () => {
  const specOf = (actorCount: number, durationSec: number) => {
    const base = createManhuaPrevisStudio(durationSec, scope).spec;
    return {
      ...base,
      actors: Array.from({ length: actorCount }, (_, i) => ({
        ...base.actors[0],
        id: `actor-${i}`,
        nameZh: `角色${i}`,
        actions: base.actors[0].actions.filter(a => a.endSec <= durationSec),
        moveStartSec: 0,
        moveEndSec: Math.min(base.actors[0].moveEndSec, durationSec),
      })),
      cameras: base.cameras.map(c => ({ ...c, endSec: Math.min(c.endSec, durationSec) })),
    };
  };

  it("成本按帧数×角色数算；六角色30秒就是那次烧满十分钟没出片的规格", () => {
    expect(previsRenderCostUnits({ durationSec: 30, actors: new Array(6) })).toBe(4320);
    expect(previsRenderCostUnits({ durationSec: 5, actors: new Array(1) })).toBe(120);
    expect(PREVIS_RENDER_UNIT_BUDGET).toBe(2700);
  });

  it("超预算给的是能照做的中文：说清上限、同角色数最长几秒、同片长最多几个角色", () => {
    const issue = previsCapacityIssueZh({ durationSec: 30, actors: new Array(6) });
    expect(issue).toContain("6 个角色 × 30 秒");
    expect(issue).toContain("4320");
    expect(issue).toContain("2700");
    expect(issue).toContain("最多 18 秒");
    expect(issue).toContain("请拆成多段");
  });

  it("预算内不拦：单角色30秒、三角色30秒、六角色18秒都照常通过", () => {
    expect(previsCapacityIssueZh({ durationSec: 30, actors: new Array(1) })).toBeNull();
    expect(previsCapacityIssueZh({ durationSec: 30, actors: new Array(3) })).toBeNull();
    expect(previsCapacityIssueZh({ durationSec: 18, actors: new Array(6) })).toBeNull();
    expect(manhuaPrevisSpecSchema.safeParse(specOf(3, 20)).success).toBe(true);
  });

  it("schema 事前拒绝超预算作业，不让它进渲染烧满时限", () => {
    const parsed = manhuaPrevisSpecSchema.safeParse(specOf(6, 30));
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("超出单次白模渲染能力");
  });

  it("同角色数的最长片长随预算算出来，至少给 2 秒", () => {
    expect(previsMaxDurationSec(1)).toBeGreaterThanOrEqual(30);
    expect(previsMaxDurationSec(6)).toBe(18);
    expect(previsMaxDurationSec(60)).toBe(2);
  });
});
