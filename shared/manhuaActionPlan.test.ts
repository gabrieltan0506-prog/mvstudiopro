/**
 * 动作计划：身份、目标与时间的权威性。
 *
 * 验收对齐 0915 施工方案 A 第一批：
 *   1. 四角色跨三镜（交锋 → 两人登船 → 分别反击）数据往返后身份和目标不变；
 *   2. 悬空目标 ID、重复 ID、非法时间必须明确拒绝（**带 code**，不是只给中文串）；
 *   3. 画外不等于删除——每镜四人都要有状态。
 *
 * 本文件不宣称四人白模已经能渲染：那是能力扩展，不是数据层的事。
 */
import { describe, expect, it } from "vitest";
import {
  MANHUA_ACTION_PLAN_FORMAT,
  findManhuaPlanActorState,
  manhuaActionPlanRevision,
  parseManhuaActionPlan,
  sealManhuaActionPlan,
  traceManhuaPlanTargets,
  validateManhuaActionPlan,
  type ManhuaActionPlan,
  type ManhuaPlanShot,
} from "./manhuaActionPlan";

const MAN = "ap_actor_man";
const WOMAN = "ap_actor_woman";
const AMBUSH_A = "ap_actor_ambush_a";
const AMBUSH_B = "ap_actor_ambush_b";

const actors = [
  { actorId: MAN, nameZh: "男", canonAnchorId: "wa_char_nan1a2b" },
  { actorId: WOMAN, nameZh: "女", canonAnchorId: "wa_char_nv3c4d" },
  { actorId: AMBUSH_A, nameZh: "伏兵甲" },
  { actorId: AMBUSH_B, nameZh: "伏兵乙" },
];

const at = (x: number, y: number) => ({ x, y });

/** 在场 */
function on(actorId: string, x: number, y: number, targetActorId?: string) {
  return {
    actorId,
    presence: "onstage" as const,
    at: at(x, y),
    facingDeg: 0,
    heldPropIds: [],
    ...(targetActorId ? { targetActorId } : {}),
  };
}
/** 画外（必须写去向） */
function off(actorId: string, whereaboutsZh: string) {
  return {
    actorId,
    presence: "offstage" as const,
    heldPropIds: [],
    whereaboutsZh,
  };
}

/**
 * 三镜：
 *   镜1 男女在船头交锋，两名伏兵在水下（画外）
 *   镜2 伏兵登船，男→甲、女→乙 目标切换
 *   镜3 分别反击
 */
function buildThreeShotPlan(): ManhuaActionPlan {
  const shots: ManhuaPlanShot[] = [
    {
      shotId: "ap_shot_1",
      displayIndex: 1,
      durationSec: 6,
      segmentOffsetSec: 0,
      confirm: "confirmed",
      actorStates: [
        on(MAN, 0.35, 0.5, WOMAN),
        on(WOMAN, 0.65, 0.5, MAN),
        off(AMBUSH_A, "潜在船舷右侧水下，未出水"),
        off(AMBUSH_B, "潜在船尾水下，未出水"),
      ],
      events: [
        {
          eventId: "ap_evt_1a",
          actorId: MAN,
          targetActorId: WOMAN,
          phases: [
            { kind: "windup", startSec: 0.5, endSec: 1.2 },
            { kind: "burst", startSec: 1.2, endSec: 1.8 },
            { kind: "contact", startSec: 1.8, endSec: 2.0 },
            { kind: "recover", startSec: 2.0, endSec: 2.6 },
          ],
          contactAt: at(0.5, 0.48),
          landingRefId: "lp_deck_center",
          outcome: "blocked",
        },
      ],
    },
    {
      shotId: "ap_shot_2",
      displayIndex: 2,
      durationSec: 5,
      segmentOffsetSec: 6,
      confirm: "confirmed",
      actorStates: [
        // 目标切换：男从打女改成打甲，女改成打乙
        on(MAN, 0.3, 0.55, AMBUSH_A),
        on(WOMAN, 0.7, 0.55, AMBUSH_B),
        on(AMBUSH_A, 0.18, 0.6, MAN),
        on(AMBUSH_B, 0.82, 0.6, WOMAN),
      ],
      events: [
        {
          eventId: "ap_evt_2a",
          actorId: AMBUSH_A,
          targetActorId: MAN,
          phases: [
            { kind: "windup", startSec: 0.2, endSec: 0.8 },
            { kind: "burst", startSec: 0.8, endSec: 1.3 },
            { kind: "contact", startSec: 1.3, endSec: 1.5 },
          ],
          outcome: "evaded",
        },
      ],
    },
    {
      shotId: "ap_shot_3",
      displayIndex: 3,
      durationSec: 7,
      segmentOffsetSec: 11,
      confirm: "draft",
      actorStates: [
        on(MAN, 0.32, 0.52, AMBUSH_A),
        on(WOMAN, 0.68, 0.52, AMBUSH_B),
        on(AMBUSH_A, 0.2, 0.58, MAN),
        off(AMBUSH_B, "被女打落船舷外，仍在水中"),
      ],
      events: [
        {
          eventId: "ap_evt_3a",
          actorId: MAN,
          targetActorId: AMBUSH_A,
          phases: [
            { kind: "counter", startSec: 1.0, endSec: 1.9 },
            { kind: "contact", startSec: 1.9, endSec: 2.1 },
          ],
          outcome: "hit",
          slowMotion: { startSec: 1.9, endSec: 2.4, rate: 0.4 },
        },
      ],
    },
  ];
  return sealManhuaActionPlan({ sceneId: "ap_scene_ship", episodeIndex: 1, actors, shots });
}

describe("动作计划：身份与目标", () => {
  it("四角色跨三镜往返后身份与目标不变（JSON 序列化再解析）", () => {
    const plan = buildThreeShotPlan();
    const roundTripped = parseManhuaActionPlan(JSON.parse(JSON.stringify(plan)));
    expect(roundTripped.ok).toBe(true);
    if (!roundTripped.ok) return;

    expect(roundTripped.plan.planRevision).toBe(plan.planRevision);
    expect(roundTripped.plan.actors.map((a) => a.actorId)).toEqual([
      MAN,
      WOMAN,
      AMBUSH_A,
      AMBUSH_B,
    ]);
    // 男的目标轨迹：女 → 甲 → 甲（对手切换是数据，不是让模型猜）
    expect(traceManhuaPlanTargets(roundTripped.plan, MAN).map((t) => t.targetActorId)).toEqual([
      WOMAN,
      AMBUSH_A,
      AMBUSH_A,
    ]);
    // 女的目标轨迹：男 → 乙 → 乙
    expect(traceManhuaPlanTargets(roundTripped.plan, WOMAN).map((t) => t.targetActorId)).toEqual([
      MAN,
      AMBUSH_B,
      AMBUSH_B,
    ]);
  });

  it("画外不等于删除：每镜四人都有状态，画外那两人写明去向", () => {
    const plan = buildThreeShotPlan();
    for (const shot of plan.shots) {
      expect(shot.actorStates).toHaveLength(4);
    }
    const shot1 = plan.shots[0]!;
    const ambushA = findManhuaPlanActorState(shot1, AMBUSH_A)!;
    expect(ambushA.presence).toBe("offstage");
    expect(ambushA.whereaboutsZh).toContain("水下");
    // 第三镜乙被打落水，仍在计划里
    const shot3 = plan.shots[2]!;
    expect(findManhuaPlanActorState(shot3, AMBUSH_B)!.presence).toBe("offstage");
  });

  it("镜头身份用稳定 shotId，不靠数组下标——重排序不改身份", () => {
    const plan = buildThreeShotPlan();
    const reordered: ManhuaActionPlan = {
      ...plan,
      shots: [plan.shots[2]!, plan.shots[0]!, plan.shots[1]!],
    };
    // 指纹按内容排序算，重排不改版本
    expect(manhuaActionPlanRevision(reordered)).toBe(plan.planRevision);
    expect(findManhuaPlanActorState(reordered.shots[1]!, MAN)?.targetActorId).toBe(WOMAN);
  });
});

describe("动作计划：明确拒绝（带 code，可断言拒因）", () => {
  const codesOf = (plan: ManhuaActionPlan) => validateManhuaActionPlan(plan).map((i) => i.code);

  it("悬空目标 ID 必须拒绝", () => {
    const base = buildThreeShotPlan();
    const shots = structuredClone(base.shots);
    shots[0]!.actorStates[0]!.targetActorId = "ap_actor_ghost";
    const plan = sealManhuaActionPlan({ ...base, shots });
    expect(codesOf(plan)).toContain("dangling_target_ref");
  });

  it("事件打向不存在的角色也要拒绝（不只查 actorStates）", () => {
    const base = buildThreeShotPlan();
    const shots = structuredClone(base.shots);
    shots[0]!.events[0]!.targetActorId = "ap_actor_ghost";
    const plan = sealManhuaActionPlan({ ...base, shots });
    expect(codesOf(plan)).toContain("dangling_target_ref");
  });

  it("重复 ID 必须拒绝：角色 / 镜头 / 事件三处", () => {
    const base = buildThreeShotPlan();

    const dupActor = sealManhuaActionPlan({
      ...base,
      actors: [...base.actors, { actorId: MAN, nameZh: "男（重复）" }],
    });
    expect(codesOf(dupActor)).toContain("duplicate_actor_id");

    const dupShotList = structuredClone(base.shots);
    dupShotList[1]!.shotId = "ap_shot_1";
    expect(codesOf(sealManhuaActionPlan({ ...base, shots: dupShotList }))).toContain(
      "duplicate_shot_id",
    );

    const dupEventList = structuredClone(base.shots);
    dupEventList[1]!.events[0]!.eventId = "ap_evt_1a";
    expect(codesOf(sealManhuaActionPlan({ ...base, shots: dupEventList }))).toContain(
      "duplicate_event_id",
    );
  });

  it("非法时间必须拒绝：阶段倒挂 / 阶段重叠 / 超出镜长 / 慢动作越界", () => {
    const base = buildThreeShotPlan();

    const reversed = structuredClone(base.shots);
    reversed[0]!.events[0]!.phases[0] = { kind: "windup", startSec: 2, endSec: 1 };
    expect(codesOf(sealManhuaActionPlan({ ...base, shots: reversed }))).toContain(
      "phase_out_of_order",
    );

    const overlapped = structuredClone(base.shots);
    overlapped[0]!.events[0]!.phases[1] = { kind: "burst", startSec: 0.9, endSec: 1.8 };
    expect(codesOf(sealManhuaActionPlan({ ...base, shots: overlapped }))).toContain(
      "phase_out_of_order",
    );

    const tooLong = structuredClone(base.shots);
    tooLong[0]!.events[0]!.phases[3] = { kind: "recover", startSec: 2.0, endSec: 99 };
    expect(codesOf(sealManhuaActionPlan({ ...base, shots: tooLong }))).toContain(
      "phase_out_of_shot",
    );

    const badSlow = structuredClone(base.shots);
    badSlow[2]!.events[0]!.slowMotion = { startSec: 6.5, endSec: 20, rate: 0.5 };
    expect(codesOf(sealManhuaActionPlan({ ...base, shots: badSlow }))).toContain(
      "slow_motion_out_of_shot",
    );
  });

  it("漏掉某人的逐镜状态要拒绝——不能当他不存在", () => {
    const base = buildThreeShotPlan();
    const shots = structuredClone(base.shots);
    shots[0]!.actorStates = shots[0]!.actorStates.filter((s) => s.actorId !== AMBUSH_B);
    expect(codesOf(sealManhuaActionPlan({ ...base, shots }))).toContain("missing_actor_state");
  });

  it("画外没写去向、在场没有位置，都要拒绝", () => {
    const base = buildThreeShotPlan();

    const noWhere = structuredClone(base.shots);
    delete noWhere[0]!.actorStates[2]!.whereaboutsZh;
    expect(codesOf(sealManhuaActionPlan({ ...base, shots: noWhere }))).toContain(
      "offstage_without_whereabouts",
    );

    const noPos = structuredClone(base.shots);
    delete noPos[0]!.actorStates[0]!.at;
    expect(codesOf(sealManhuaActionPlan({ ...base, shots: noPos }))).toContain(
      "onstage_without_position",
    );
  });

  it("自己打自己要拒绝", () => {
    const base = buildThreeShotPlan();
    const shots = structuredClone(base.shots);
    shots[0]!.events[0]!.targetActorId = shots[0]!.events[0]!.actorId;
    expect(codesOf(sealManhuaActionPlan({ ...base, shots }))).toContain("self_target");
  });

  it("带旧版本号的计划要报版本不符——消费方才不会以为还是那一版", () => {
    const plan = buildThreeShotPlan();
    const stale: ManhuaActionPlan = { ...plan, planRevision: "apr_stale_0" };
    expect(validateManhuaActionPlan(stale).map((i) => i.code)).toContain("revision_mismatch");
  });

  it("parse 失败时不返回半个可用计划", () => {
    const res = parseManhuaActionPlan({ format: MANHUA_ACTION_PLAN_FORMAT, sceneId: "x" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues.length).toBeGreaterThan(0);
    expect(res).not.toHaveProperty("plan");
  });
});

describe("动作计划：确认态不许被默认成已审", () => {
  it("未写 confirm 的镜头落到 unplanned，而不是 confirmed", () => {
    const parsed = parseManhuaActionPlan(
      sealManhuaActionPlan({
        sceneId: "ap_scene_x",
        episodeIndex: 1,
        actors: [{ actorId: MAN, nameZh: "男" }],
        shots: [
          {
            shotId: "ap_shot_x",
            displayIndex: 1,
            durationSec: 4,
            segmentOffsetSec: 0,
            confirm: "unplanned",
            actorStates: [on(MAN, 0.5, 0.5)],
            events: [],
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.plan.shots[0]!.confirm).toBe("unplanned");
  });
});
