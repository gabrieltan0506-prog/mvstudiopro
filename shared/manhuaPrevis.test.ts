import { describe, it, expect } from "vitest";
import {
  createManhuaPrevisStudio,
  manhuaPrevisDraftSchema,
  manhuaPrevisSpecSchema,
  manhuaPrevisStudioSchema,
  formatPrevisMotionGuide,
  PREVIS_LOOK_AT_CAMERA,
  PREVIS_RENDER_UNIT_BUDGET,
  previsActionForKind,
  normalizeFacingDeg,
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
    expect(PREVIS_RENDER_UNIT_BUDGET).toBe(2800);
  });

  it("超预算给的是能照做的中文：说清上限、同角色数最长几秒、同片长最多几个角色", () => {
    const issue = previsCapacityIssueZh({ durationSec: 30, actors: new Array(6) });
    expect(issue).toContain("6 个角色 × 30 秒");
    expect(issue).toContain("4320");
    expect(issue).toContain("2800");
    expect(issue).toContain("最多 19 秒");
    expect(issue).toContain("请拆成多段");
  });

  it("预算内不拦：单角色30秒、三角色30秒、六角色18秒都照常通过", () => {
    expect(previsCapacityIssueZh({ durationSec: 30, actors: new Array(1) })).toBeNull();
    expect(previsCapacityIssueZh({ durationSec: 30, actors: new Array(3) })).toBeNull();
    expect(previsCapacityIssueZh({ durationSec: 18, actors: new Array(6) })).toBeNull();
    expect(manhuaPrevisSpecSchema.safeParse(specOf(3, 20)).success).toBe(true);
    expect(manhuaPrevisSpecSchema.safeParse(specOf(4, 29)).success).toBe(true);
  });

  it("schema 事前拒绝超预算作业，不让它进渲染烧满时限", () => {
    const parsed = manhuaPrevisSpecSchema.safeParse(specOf(6, 30));
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("超出单次白模渲染能力");
  });

  it("同角色数的最长片长随预算算出来，至少给 2 秒", () => {
    expect(previsMaxDurationSec(1)).toBeGreaterThanOrEqual(30);
    expect(previsMaxDurationSec(6)).toBe(19);
    expect(previsMaxDurationSec(60)).toBe(2);
  });
});

describe("PR-6 · 节奏档字段随白模工作台状态往返", () => {
  it("cameraStyle / draftCameraPromptZh / draftTempoZh 可存可读；缺省不写入；非法风格档拒绝", () => {
    const studio = createManhuaPrevisStudio(6);
    expect(manhuaPrevisStudioSchema.parse(studio)).toEqual(studio);
    const withTempo = { ...studio, cameraStyle: "slow_orbit" as const, draftCameraPromptZh: ["0.00–3.00s 全景·平视·慢环绕：建立"], draftTempoZh: "慢 · 意图「静」且无接触" };
    expect(manhuaPrevisStudioSchema.parse(withTempo)).toEqual(withTempo);
    expect(manhuaPrevisStudioSchema.safeParse({ ...studio, cameraStyle: "dolly" }).success).toBe(false);
  });
});

describe("文戏动作库（0917 PR-E）", () => {
  type LooseActor = {
    id: string;
    nameZh: string;
    shape: string;
    start: [number, number];
    end: [number, number];
    moveStartSec: number;
    moveEndSec: number;
    facingDeg: number;
    actions: Record<string, unknown>[];
    motionRoute?: unknown;
    weapon?: string;
    assetRef?: string;
    riggedModel?: Record<string, unknown>;
  };
  const base = (): {
    version: 1;
    durationSec: number;
    aspect: "16:9";
    actors: LooseActor[];
    cameras: Record<string, unknown>[];
  } => ({
    version: 1 as const,
    durationSec: 4,
    aspect: "16:9" as const,
    actors: [
      {
        id: "a",
        nameZh: "阿菁",
        shape: "human",
        start: [0, 0] as [number, number],
        end: [0, 0] as [number, number],
        moveStartSec: 0,
        moveEndSec: 4,
        facingDeg: 0,
        actions: [] as Record<string, unknown>[],
      },
      {
        id: "b",
        nameZh: "娘",
        shape: "human",
        start: [1, 1] as [number, number],
        end: [1, 1] as [number, number],
        moveStartSec: 0,
        moveEndSec: 4,
        facingDeg: 180,
        actions: [] as Record<string, unknown>[],
      },
    ],
    cameras: [{ startSec: 0, endSec: 4, position: [2, -5, 2.3], target: [0, 0, 1], lens: 40 }],
  });
  const withAction = (action: Record<string, unknown>) => {
    const spec = base();
    spec.actors[0].actions = [action];
    return manhuaPrevisSpecSchema.safeParse(spec);
  };

  it("六类文戏动作可提交", () => {
    for (const kind of ["sit", "gesture_point", "bow"])
      expect(withAction({ kind, startSec: 0, endSec: 2 }).success).toBe(true);
    const walking = base();
    walking.actors[0].end = [2, 0];
    walking.actors[0].actions = [{ kind: "walk", startSec: 0, endSec: 2 }];
    expect(manhuaPrevisSpecSchema.safeParse(walking).success).toBe(true);
    expect(withAction({ kind: "turn", startSec: 0, endSec: 2, facingDeg: 90 }).success).toBe(true);
    expect(withAction({ kind: "look", startSec: 0, endSec: 2, lookAtId: "b" }).success).toBe(true);
    expect(withAction({ kind: "look", startSec: 0, endSec: 2, lookAtId: PREVIS_LOOK_AT_CAMERA }).success).toBe(true);
  });

  it("带骨角色的坐下在提交处直接拒绝（实测脚会穿地 21—32 厘米）", () => {
    const rigged = base();
    rigged.actors[0].riggedModel = {
      sourceJobId: "m3d_test_only",
      forwardAxis: "+X",
      targetHeight: 1.7,
    };
    rigged.actors[0].assetRef = "qing";
    rigged.actors[0].actions = [{ kind: "sit", startSec: 0, endSec: 2 }];
    expect(manhuaPrevisSpecSchema.safeParse(rigged).success).toBe(false);
    // 反例对照①：同一个带骨角色换成行礼/指向/看向照常放行，不是把带骨角色整体禁掉
    for (const action of [
      { kind: "bow", startSec: 0, endSec: 2 },
      { kind: "gesture_point", startSec: 0, endSec: 2 },
      { kind: "look", startSec: 0, endSec: 2, lookAtId: "b" },
    ]) {
      rigged.actors[0].actions = [action];
      expect(manhuaPrevisSpecSchema.safeParse(rigged).success).toBe(true);
    }
    // 反例对照②：去掉 riggedModel 之后同一个坐下必须通过，证明红的是带骨这一条
    delete rigged.actors[0].riggedModel;
    rigged.actors[0].actions = [{ kind: "sit", startSec: 0, endSec: 2 }];
    expect(manhuaPrevisSpecSchema.safeParse(rigged).success).toBe(true);
  });

  it("参数只属于需要它的动作，缺了/多了都拒", () => {
    expect(withAction({ kind: "turn", startSec: 0, endSec: 2 }).success).toBe(false);
    expect(withAction({ kind: "look", startSec: 0, endSec: 2 }).success).toBe(false);
    // 看向自己、看向不在场的人都不算目标
    expect(withAction({ kind: "look", startSec: 0, endSec: 2, lookAtId: "a" }).success).toBe(false);
    expect(withAction({ kind: "look", startSec: 0, endSec: 2, lookAtId: "查无此人" }).success).toBe(false);
    expect(withAction({ kind: "walk", startSec: 0, endSec: 2, facingDeg: 90 }).success).toBe(false);
    expect(withAction({ kind: "strike", startSec: 0, endSec: 2, lookAtId: "b" }).success).toBe(false);
  });

  it("走位必须落在真实位移区间内，原地摆臂假装在走一律拒", () => {
    // 反例①：起止站位相同——白模只会原地摆臂
    expect(withAction({ kind: "walk", startSec: 0, endSec: 2 }).success).toBe(false);
    // 反例②：有位移，但走位窗口整个落在位移区间之外
    const offWindow = base();
    offWindow.actors[0].end = [2, 0];
    offWindow.actors[0].moveStartSec = 0;
    offWindow.actors[0].moveEndSec = 1;
    offWindow.actors[0].actions = [{ kind: "walk", startSec: 2, endSec: 4 }];
    expect(manhuaPrevisSpecSchema.safeParse(offWindow).success).toBe(false);
    // 正例：窗口与位移区间有交集
    const inWindow = base();
    inWindow.actors[0].end = [2, 0];
    inWindow.actors[0].moveStartSec = 1;
    inWindow.actors[0].moveEndSec = 4;
    inWindow.actors[0].actions = [{ kind: "walk", startSec: 0, endSec: 2 }];
    expect(manhuaPrevisSpecSchema.safeParse(inWindow).success).toBe(true);
    // 轨迹角色的位移由 motionRoute 负责，不受站位判据管
    const routed = base();
    routed.actors[0].end = [2, 0];
    routed.actors[0].motionRoute = [
      { timeSec: 0, position: [0, 0], facingDeg: 0 },
      { timeSec: (4 * 24 - 1) / 24, position: [2, 0], facingDeg: 0 },
    ];
    routed.actors[0].actions = [{ kind: "walk", startSec: 0, endSec: 2 }];
    expect(manhuaPrevisSpecSchema.safeParse(routed).success).toBe(true);
  });

  it("朝向有两个真源时拒绝：已设运动轨迹就不能再用转身", () => {
    // 0917 四轮审查：这条原来用的节点时间是 timeSec=4（等于片长，越界），
    // 于是把「转身×轨迹」互斥规则整条删掉它照样红——断言永远为真，规则实际上没人测。
    // 改成合法轨迹 + 指名报错内容 + 正例对照。
    const route = [
      { timeSec: 0, position: [0, 0], facingDeg: 0 },
      { timeSec: (4 * 24 - 1) / 24, position: [1, 0], facingDeg: 90 },
    ];
    const spec = base();
    spec.actors[0].end = [1, 0];
    spec.actors[0].motionRoute = route;
    spec.actors[0].actions = [{ kind: "turn", startSec: 0, endSec: 2, facingDeg: 90 }];
    const rejected = manhuaPrevisSpecSchema.safeParse(spec);
    expect(rejected.success).toBe(false);
    expect(
      !rejected.success &&
        rejected.error.issues.some(issue => issue.message.includes("转身"))
    ).toBe(true);
    // 正例对照：同一条轨迹只要不叠转身动作必须绿，证明红的是互斥规则而不是这条轨迹本身
    const accepted = base();
    accepted.actors[0].end = [1, 0];
    accepted.actors[0].motionRoute = route;
    accepted.actors[0].actions = [{ kind: "idle", startSec: 0, endSec: 2 }];
    expect(manhuaPrevisSpecSchema.safeParse(accepted).success).toBe(true);
  });

  it("四足角色与持剑白模的旧门禁没被扩库放宽", () => {
    const spec = base();
    spec.actors[0].shape = "horse";
    spec.actors[0].actions = [{ kind: "walk", startSec: 0, endSec: 2 }];
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
    const sword = base();
    sword.actors[0].weapon = "practice_sword";
    sword.actors[0].actions = [{ kind: "bow", startSec: 0, endSec: 2 }];
    expect(manhuaPrevisSpecSchema.safeParse(sword).success).toBe(false);
  });

  it("换动作类型时旧参数丢掉、新参数补上", () => {
    const ctx = { actorFacingDeg: 0, otherActorIds: ["b"] };
    const turned = previsActionForKind(
      { kind: "look", startSec: 0, endSec: 2, lookAtId: "b" } as {
        kind: string;
        startSec: number;
        endSec: number;
        lookAtId?: string;
        facingDeg?: number;
      },
      "turn",
      ctx,
    );
    expect(turned).toEqual({ kind: "turn", startSec: 0, endSec: 2, facingDeg: 180 });
    const looked = previsActionForKind(turned, "look", ctx);
    expect(looked).toEqual({ kind: "look", startSec: 0, endSec: 2, lookAtId: "b" });
    const idle = previsActionForKind(looked, "idle", ctx);
    expect(idle).toEqual({ kind: "idle", startSec: 0, endSec: 2 });
    // 场上只有自己时退回看向镜头，而不是留一个空目标
    expect(previsActionForKind(idle, "look", { actorFacingDeg: 0, otherActorIds: [] }).lookAtId).toBe(
      PREVIS_LOOK_AT_CAMERA,
    );
    // 朝向归一到 ±180，不出现 270 这种提交会被拒的值
    expect(previsActionForKind(idle, "turn", { actorFacingDeg: 90, otherActorIds: [] }).facingDeg).toBe(-90);
  });
});

describe("文戏动作库 · 0917 二轮审查补漏", () => {
  const spec2s = (actions: Record<string, unknown>[]) => ({
    version: 1 as const,
    durationSec: 2,
    aspect: "16:9" as const,
    actors: [
      {
        id: "a",
        nameZh: "阿菁",
        shape: "human" as const,
        start: [0, 0] as [number, number],
        end: [0, 0] as [number, number],
        moveStartSec: 0,
        moveEndSec: 2,
        facingDeg: 0,
        actions,
      },
      {
        id: "b",
        nameZh: "娘",
        shape: "human" as const,
        start: [1, 1] as [number, number],
        end: [1, 1] as [number, number],
        moveStartSec: 0,
        moveEndSec: 2,
        facingDeg: 180,
        actions: [] as Record<string, unknown>[],
      },
    ],
    cameras: [{ startSec: 0, endSec: 2, position: [2, -5, 2.3], target: [0, 0, 1], lens: 40 }],
  });

  it("朝向归一是唯一入口：面板填 270 要能落成 -90，而不是交上去被 zod 拒", () => {
    // 面板的「目标朝向」输入框不限范围（numeric 只做 Number.isFinite），
    // 归一必须在写回 spec 之前发生，否则用户看到的是一条 zod 范围错。
    expect(normalizeFacingDeg(270)).toBe(-90);
    expect(normalizeFacingDeg(-270)).toBe(90);
    expect(normalizeFacingDeg(360)).toBe(0);
    expect(normalizeFacingDeg(540)).toBe(180);
    expect(normalizeFacingDeg(-180)).toBe(180);
    expect(normalizeFacingDeg(180)).toBe(180);
    expect(normalizeFacingDeg(0)).toBe(0);
    for (const raw of [270, -270, 540, -540, 1080, -1e3])
      expect(
        manhuaPrevisSpecSchema.safeParse(
          spec2s([{ kind: "turn", startSec: 0, endSec: 2, facingDeg: normalizeFacingDeg(raw) }])
        ).success
      ).toBe(true);
  });

  it("时间轴边界：2 秒极短片、紧贴片头片尾、零间隔都可提交", () => {
    expect(manhuaPrevisSpecSchema.safeParse(spec2s([{ kind: "sit", startSec: 0, endSec: 2 }])).success).toBe(true);
    expect(
      manhuaPrevisSpecSchema.safeParse(
        spec2s([
          { kind: "sit", startSec: 0, endSec: 1 },
          { kind: "bow", startSec: 1, endSec: 2 },
        ])
      ).success
    ).toBe(true);
    // 反例：重叠一帧就必须红，否则「零间隔可以」这条等于没判据
    expect(
      manhuaPrevisSpecSchema.safeParse(
        spec2s([
          { kind: "sit", startSec: 0, endSec: 1.2 },
          { kind: "bow", startSec: 1, endSec: 2 },
        ])
      ).success
    ).toBe(false);
    // 反例：超出片长、短于半秒也必须红
    expect(manhuaPrevisSpecSchema.safeParse(spec2s([{ kind: "bow", startSec: 1, endSec: 2.5 }])).success).toBe(false);
    expect(manhuaPrevisSpecSchema.safeParse(spec2s([{ kind: "bow", startSec: 1, endSec: 1.3 }])).success).toBe(false);
  });

  it("向后兼容：只有打戏四类、没有新字段的旧存稿仍能提交与往返", () => {
    const legacy = spec2s([
      { kind: "idle", startSec: 0, endSec: 1 },
      { kind: "strike", startSec: 1, endSec: 2 },
    ]);
    const parsed = manhuaPrevisSpecSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    // 新字段是 optional，解析后不许被补上默认值——否则旧存稿的 key 会漂移
    expect(parsed.success && parsed.data.actors[0].actions.every(a => !("facingDeg" in a) && !("lookAtId" in a))).toBe(
      true
    );
    expect(parsed.success && JSON.stringify(parsed.data)).toBe(JSON.stringify(legacy));
    // 旧稿用 motionRoute 走位、没有 walk 动作：新增的 walk 位移校验不得误伤
    const routed = spec2s([{ kind: "idle", startSec: 0, endSec: 2 }]);
    (routed.actors[0] as Record<string, unknown>).end = [1, 0];
    (routed.actors[0] as Record<string, unknown>).motionRoute = [
      { timeSec: 0, position: [0, 0], facingDeg: 0 },
      { timeSec: (2 * 24 - 1) / 24, position: [1, 0], facingDeg: 0 },
    ];
    expect(manhuaPrevisSpecSchema.safeParse(routed).success).toBe(true);
  });

  it("走位判据收口：轨迹角色也要真的在走，不能从 motionRoute 这扇门绕过去", () => {
    // 一条原地不动的轨迹 + walk：过去 schema 对轨迹角色整条跳过，白模照样原地摆臂
    const stillRoute = [
      { timeSec: 0, position: [0, 0], facingDeg: 0 },
      { timeSec: 1, position: [0, 0], facingDeg: 0 },
      { timeSec: (2 * 24 - 1) / 24, position: [0, 0], facingDeg: 0 },
    ];
    const still = spec2s([{ kind: "walk", startSec: 0, endSec: 2 }]);
    (still.actors[0] as Record<string, unknown>).motionRoute = stillRoute;
    expect(manhuaPrevisSpecSchema.safeParse(still).success).toBe(false);
    // 正例对照：同一条原地轨迹挂 idle 必须绿，证明上面红的是 walk 判据本身，
    // 不是这条轨迹碰巧违反了别的门禁（第一版这条测试就是这样假红的）
    const stillIdle = spec2s([{ kind: "idle", startSec: 0, endSec: 2 }]);
    (stillIdle.actors[0] as Record<string, unknown>).motionRoute = stillRoute;
    expect(manhuaPrevisSpecSchema.safeParse(stillIdle).success).toBe(true);
    // 正例对照：同一条轨迹只要真的挪了位置就放行，证明红的是「没在走」而不是「有轨迹」
    const moving = spec2s([{ kind: "walk", startSec: 0, endSec: 2 }]);
    (moving.actors[0] as Record<string, unknown>).end = [1, 0];
    (moving.actors[0] as Record<string, unknown>).motionRoute = [
      { timeSec: 0, position: [0, 0], facingDeg: 0 },
      { timeSec: 1, position: [0.5, 0], facingDeg: 0 },
      { timeSec: (2 * 24 - 1) / 24, position: [1, 0], facingDeg: 0 },
    ];
    expect(manhuaPrevisSpecSchema.safeParse(moving).success).toBe(true);
    // 走了，但走的时段与动作窗口不重叠：也要红
    const offWindow = spec2s([{ kind: "walk", startSec: 0, endSec: 1 }]);
    (offWindow.actors[0] as Record<string, unknown>).end = [1, 0];
    (offWindow.actors[0] as Record<string, unknown>).motionRoute = [
      { timeSec: 0, position: [0, 0], facingDeg: 0 },
      { timeSec: 1, position: [0, 0], facingDeg: 0 },
      { timeSec: (2 * 24 - 1) / 24, position: [1, 0], facingDeg: 0 },
    ];
    expect(manhuaPrevisSpecSchema.safeParse(offWindow).success).toBe(false);
  });
});
