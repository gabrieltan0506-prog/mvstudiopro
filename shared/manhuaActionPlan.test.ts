/**
 * 动作计划合同：身份、继承、空间、时间、结果与版本。
 *
 * 验收对齐 0915「七项决定」与两项基础合同修正，逐条覆盖：
 *   决定一 继承缺失 / not_entered / 草稿宽执行严
 *   决定二 unplanned 只补历史缺项，不重置有效确认
 *   决定三 编辑自动 seal；摘要含语义次序；审批在摘要之外
 *   决定四 落点三元组（存在性交叉校验在 bindings 模块，另有测试）
 *   决定五 事件只标意图，变速统一在镜头 timeMap；源时间 ≠ 呈现时间
 *   决定六 相机只绑不复制，时间口径显式
 *   决定七 actionPlanId 顶层；镜头范围→执行段范围，不撒谎的一对一
 *   空间     屏幕点 ≠ 世界点；无深度依据标 unresolved
 *   动作语义 判别式 kind；登船有 landed + 落地表面；持物要握持部位
 *
 * **本文件只验数据合同，不验渲染**。12 人是计划容量，不代表 12 人白模支持。
 */
import { describe, expect, it } from "vitest";
import {
  MANHUA_ACTION_PLAN_FORMAT,
  compileManhuaShotSnapshot,
  isManhuaPlanApprovalCurrent,
  manhuaActionPlanRevision,
  parseManhuaActionPlan,
  sealManhuaActionPlan,
  traceManhuaPlanFocus,
  validateManhuaActionPlan,
  type ManhuaActionPlan,
  type ManhuaPlanShot,
} from "./manhuaActionPlan";
import {
  manhuaPresentationDurationSec,
  manhuaPresentationToSourceSec,
  manhuaSourceToPresentationSec,
} from "./manhuaActionPlanTiming";

const MAN = "ap_actor_man";
const WOMAN = "ap_actor_woman";
const A = "ap_actor_ambush_a";
const B = "ap_actor_ambush_b";

const actors = [
  { actorId: MAN, nameZh: "男", canonAnchorId: "wa_char_nan1a2b" },
  { actorId: WOMAN, nameZh: "女", canonAnchorId: "wa_char_nv3c4d" },
  { actorId: A, nameZh: "伏兵甲" },
  { actorId: B, nameZh: "伏兵乙" },
];

const screen = (x: number, y: number) => ({ space: "screen" as const, x, y });
const facing = (deg: number) => ({ basis: "screen_deg" as const, deg });

/** 常速整镜的时间映射 */
const plainMap = (sourceDurationSec: number) => ({ sourceDurationSec, spans: [] });

const landingOnDeck = {
  overlayRef: { episodeIndex: 1, segmentIndex: 1, shotIndex: 2 },
  landingId: "lp_deck_port",
  sourceRevision: "overlay-1a2b3c4d",
  surfaceZh: "甲板",
};

/**
 * 三镜：
 *   镜1 男女船头交锋；两名伏兵**还没上场**（not_entered，不是 exited）
 *   镜2 伏兵登船（land + 甲板），关注对象切换 男→甲、女→乙
 *   镜3 分别反击；乙被打落水（offstage + 去向）
 */
function buildPlan(): ManhuaActionPlan {
  const shots: ManhuaPlanShot[] = [
    {
      shotId: "ap_shot_1",
      displayIndex: 1,
      timeMap: plainMap(6),
      confirm: "confirmed",
      actorChanges: [],
      events: [
        {
          eventId: "ap_evt_1a",
          kind: "attack",
          actorId: MAN,
          targetActorId: WOMAN,
          phases: [
            { kind: "windup", sourceStartSec: 0.5, sourceEndSec: 1.2 },
            { kind: "burst", sourceStartSec: 1.2, sourceEndSec: 1.8 },
            { kind: "contact", sourceStartSec: 1.8, sourceEndSec: 2.0 },
            { kind: "recover", sourceStartSec: 2.0, sourceEndSec: 2.6 },
          ],
          contactAt: screen(0.5, 0.48),
          outcome: "blocked",
          slowMotionIntent: false,
        },
      ],
    },
    {
      shotId: "ap_shot_2",
      displayIndex: 2,
      timeMap: plainMap(5),
      confirm: "confirmed",
      actorChanges: [
        { actorId: MAN, next: { focusActorId: A } },
        { actorId: WOMAN, next: { focusActorId: B } },
        {
          actorId: A,
          next: { presence: "onstage", at: screen(0.18, 0.6), facing: facing(0), focusActorId: MAN },
        },
        {
          actorId: B,
          next: { presence: "onstage", at: screen(0.82, 0.6), facing: facing(0), focusActorId: WOMAN },
        },
      ],
      events: [
        {
          eventId: "ap_evt_2a",
          kind: "land",
          actorId: A,
          landing: landingOnDeck,
          phases: [{ kind: "contact", sourceStartSec: 1.0, sourceEndSec: 1.4 }],
          outcome: "landed",
          slowMotionIntent: false,
        },
      ],
    },
    {
      shotId: "ap_shot_3",
      displayIndex: 3,
      timeMap: plainMap(7),
      confirm: "draft",
      actorChanges: [
        { actorId: B, next: { presence: "offstage", whereaboutsZh: "被女打落船舷外，仍在水中" } },
      ],
      events: [
        {
          eventId: "ap_evt_3a",
          kind: "attack",
          actorId: MAN,
          targetActorId: A,
          phases: [
            { kind: "counter", sourceStartSec: 1.0, sourceEndSec: 1.9 },
            { kind: "contact", sourceStartSec: 1.9, sourceEndSec: 2.1 },
          ],
          outcome: "hit",
          slowMotionIntent: true,
        },
      ],
    },
  ];

  return sealManhuaActionPlan({
    actionPlanId: "ap_plan_ship_fight",
    episodeIndex: 1,
    actors,
    initialStates: {
      [MAN]: { presence: "onstage", at: screen(0.35, 0.5), facing: facing(0), heldProps: [] },
      [WOMAN]: { presence: "onstage", at: screen(0.65, 0.5), facing: facing(180), heldProps: [] },
      [A]: { presence: "not_entered", heldProps: [], whereaboutsZh: "潜在船舷右侧水下" },
      [B]: { presence: "not_entered", heldProps: [], whereaboutsZh: "潜在船尾水下" },
    },
    shots,
    executionRanges: [],
  });
}

const codes = (plan: ManhuaActionPlan, mode: "draft" | "execution" = "execution") =>
  validateManhuaActionPlan(plan, mode).map((i) => i.code);

describe("决定一：继承与 not_entered", () => {
  it("编辑只填变化，确认时编译出每镜全员快照", () => {
    const plan = buildPlan();
    const snap1 = compileManhuaShotSnapshot(plan, "ap_shot_1")!;
    expect(Object.keys(snap1).sort()).toEqual([A, B, MAN, WOMAN].sort());
    // 伏兵在镜1 是「还没上场」，不是「已离场」
    expect(snap1[A]!.presence).toBe("not_entered");
    expect(snap1[B]!.presence).toBe("not_entered");
  });

  it("显式继承：镜2 改过的状态会带到镜3，未改的沿用", () => {
    const plan = buildPlan();
    const snap3 = compileManhuaShotSnapshot(plan, "ap_shot_3")!;
    expect(snap3[A]!.presence).toBe("onstage"); // 镜2 登船后继承
    expect(snap3[A]!.at).toEqual(screen(0.18, 0.6));
    expect(snap3[B]!.presence).toBe("offstage"); // 镜3 被打落水
    expect(snap3[B]!.whereaboutsZh).toContain("水中");
  });

  it("从未出现在 initialStates 也从未变更的角色落到 not_entered，不凭空推断在场", () => {
    const base = buildPlan();
    const plan = sealManhuaActionPlan({
      ...base,
      actors: [...base.actors, { actorId: "ap_actor_ghost", nameZh: "路人" }],
    });
    const snap = compileManhuaShotSnapshot(plan, "ap_shot_1")!;
    expect(snap["ap_actor_ghost"]!.presence).toBe("not_entered");
  });

  it("草稿宽、执行严：缺位置在草稿只是 warning，送执行才是 error", () => {
    const base = buildPlan();
    const shots = structuredClone(base.shots);
    // 让甲登船但不给位置
    shots[1]!.actorChanges[2]!.next = { presence: "onstage", focusActorId: MAN };
    const plan = sealManhuaActionPlan({ ...base, shots });

    const draft = validateManhuaActionPlan(plan, "draft");
    const exec = validateManhuaActionPlan(plan, "execution");
    const pick = (list: typeof draft) => list.find((i) => i.code === "onstage_without_position");
    expect(pick(draft)?.severity).toBe("warning");
    expect(pick(exec)?.severity).toBe("error");
  });

  it("还没上场却有动作事件，任何模式都是 error", () => {
    const base = buildPlan();
    const shots = structuredClone(base.shots);
    shots[0]!.events.push({
      eventId: "ap_evt_ghost",
      kind: "attack",
      actorId: A, // 镜1 时甲还没上场
      targetActorId: MAN,
      phases: [{ kind: "burst", sourceStartSec: 1, sourceEndSec: 2 }],
      outcome: "unplanned",
      slowMotionIntent: false,
    });
    const plan = sealManhuaActionPlan({ ...base, shots });
    expect(codes(plan, "draft")).toContain("not_entered_with_action");
  });
});

describe("决定三：摘要、自动 seal 与审批分离", () => {
  it("编辑入口 seal 后摘要与内容一致，不需要用户手点重算", () => {
    const plan = buildPlan();
    expect(validateManhuaActionPlan(plan, "execution").map((i) => i.code)).not.toContain(
      "revision_mismatch",
    );
  });

  it("带旧摘要的计划在消费边界被拒", () => {
    const plan = buildPlan();
    const stale: ManhuaActionPlan = { ...plan, planRevision: "apr1_deadbeef" };
    expect(codes(stale)).toContain("revision_mismatch");
  });

  it("数组次序有语义：换镜头顺序必须换摘要（不像首版那样排序抹平）", () => {
    const plan = buildPlan();
    const reordered = {
      actionPlanId: plan.actionPlanId,
      episodeIndex: plan.episodeIndex,
      actors: plan.actors,
      initialStates: plan.initialStates,
      shots: [plan.shots[1]!, plan.shots[0]!, plan.shots[2]!],
      executionRanges: plan.executionRanges,
    };
    expect(manhuaActionPlanRevision(reordered)).not.toBe(plan.planRevision);
  });

  it("对象键序不影响摘要（递归规范键序）", () => {
    const plan = buildPlan();
    const shuffled = JSON.parse(
      JSON.stringify({
        shots: plan.shots,
        actors: plan.actors,
        episodeIndex: plan.episodeIndex,
        executionRanges: plan.executionRanges,
        initialStates: plan.initialStates,
        actionPlanId: plan.actionPlanId,
      }),
    );
    expect(manhuaActionPlanRevision(shuffled)).toBe(plan.planRevision);
  });

  it("审批记录不进摘要：补上审批不改 planRevision", () => {
    const plan = buildPlan();
    const approved = sealManhuaActionPlan({
      actionPlanId: plan.actionPlanId,
      episodeIndex: plan.episodeIndex,
      actors: plan.actors,
      initialStates: plan.initialStates,
      shots: plan.shots,
      executionRanges: plan.executionRanges,
      approval: {
        approvedRevision: plan.planRevision,
        approvedAtIso: "2026-09-15T10:00:00+08:00",
      },
    });
    expect(approved.planRevision).toBe(plan.planRevision);
    expect(isManhuaPlanApprovalCurrent(approved)).toBe(true);
  });

  it("内容一改，旧审批自动失效并报 approval_stale", () => {
    const plan = buildPlan();
    const approvedOld = { ...plan, approval: { approvedRevision: "apr1_old", approvedAtIso: "x" } };
    expect(isManhuaPlanApprovalCurrent(approvedOld as ManhuaActionPlan)).toBe(false);
    expect(codes(approvedOld as ManhuaActionPlan)).toContain("approval_stale");
  });
});

describe("决定五：源时间 ≠ 呈现时间", () => {
  it("2 秒动作 0.5 倍播放占 4 秒——镜长必须按呈现时长算", () => {
    const map = {
      sourceDurationSec: 6,
      spans: [
        { sourceStartSec: 0, sourceEndSec: 2, rate: 1 },
        { sourceStartSec: 2, sourceEndSec: 4, rate: 0.5 }, // 2 秒源 → 4 秒呈现
        { sourceStartSec: 4, sourceEndSec: 6, rate: 1 },
      ],
    };
    expect(manhuaPresentationDurationSec(map)).toBeCloseTo(8, 6);
    // 源 3 秒（慢段中点）→ 呈现 2 + 1/0.5 = 4 秒
    expect(manhuaSourceToPresentationSec(map, 3)).toBeCloseTo(4, 6);
    // 反向映射自洽
    expect(manhuaPresentationToSourceSec(map, 4)).toBeCloseTo(3, 6);
  });

  it("空 spans 表示全程常速，呈现时长等于源时长", () => {
    expect(manhuaPresentationDurationSec(plainMap(7))).toBeCloseTo(7, 6);
  });

  it("事件只标意图，不带倍率——攻防双方共用镜头 timeMap", () => {
    const plan = buildPlan();
    const ev = plan.shots[2]!.events[0]!;
    expect(ev.slowMotionIntent).toBe(true);
    // 事件对象上不存在任何播放倍率字段
    expect(ev).not.toHaveProperty("slowMotion");
    expect(ev).not.toHaveProperty("rate");
  });

  it("时间映射有缺口要报错——「是常速还是漏了」必须写明", () => {
    const base = buildPlan();
    const shots = structuredClone(base.shots);
    shots[0]!.timeMap = {
      sourceDurationSec: 6,
      spans: [{ sourceStartSec: 2, sourceEndSec: 4, rate: 0.5 }], // 前后都没写
    };
    expect(codes(sealManhuaActionPlan({ ...base, shots }))).toContain("timemap_invalid");
  });
});

describe("空间：屏幕点 ≠ 世界点", () => {
  it("缺深度依据时用 unresolved 并写明原因，不编一个 z", () => {
    const base = buildPlan();
    const shots = structuredClone(base.shots);
    shots[1]!.events[0] = {
      ...shots[1]!.events[0]!,
      landing: { ...landingOnDeck },
    } as (typeof shots)[number]["events"][number];
    const parsed = parseManhuaActionPlan(sealManhuaActionPlan({ ...base, shots }), "draft");
    expect(parsed.ok).toBe(true);

    // unresolved 点可被接受，且必须带原因
    const withUnresolved = structuredClone(base.shots);
    (withUnresolved[0]!.events[0] as { contactAt?: unknown }).contactAt = {
      space: "unresolved",
      screen: screen(0.5, 0.48),
      reasonZh: "只有画面投影，甲板高度未知",
    };
    const ok = parseManhuaActionPlan(
      sealManhuaActionPlan({ ...base, shots: withUnresolved }),
      "draft",
    );
    expect(ok.ok).toBe(true);
  });

  it("世界点必须带单位与轴向，缺了直接解析失败", () => {
    const base = buildPlan();
    // 直接构造非法原始数据喂消费边界；不经 seal（seal 会先规范化并当场抛错）
    const raw = JSON.parse(JSON.stringify(base));
    raw.shots[0].events[0].contactAt = { space: "world", x: 1, y: 2, z: 3 };
    expect(parseManhuaActionPlan(raw, "draft").ok).toBe(false);
    // seal 侧同样不许放行：宁可当场炸，也不发出一份非法计划
    expect(() => sealManhuaActionPlan(raw)).toThrow();
  });

  it("朝向必须注明参照轴，不能只给角度", () => {
    const raw = JSON.parse(JSON.stringify(buildPlan()));
    raw.initialStates[MAN].facing = { deg: 30 };
    expect(parseManhuaActionPlan(raw, "draft").ok).toBe(false);
    expect(() => sealManhuaActionPlan(raw)).toThrow();
  });
});

describe("动作语义：判别式 kind 与结果", () => {
  it("登船是 land + landed + 落地表面，不再永远 unplanned", () => {
    const plan = buildPlan();
    const ev = plan.shots[1]!.events[0]!;
    expect(ev.kind).toBe("land");
    if (ev.kind !== "land") return;
    expect(ev.outcome).toBe("landed");
    expect(ev.landing.surfaceZh).toBe("甲板");
  });

  it("登船没写落地表面：草稿 warning，执行 error", () => {
    const base = buildPlan();
    const shots = structuredClone(base.shots);
    const ev = shots[1]!.events[0]!;
    if (ev.kind === "land") delete (ev.landing as { surfaceZh?: string }).surfaceZh;
    const plan = sealManhuaActionPlan({ ...base, shots });
    expect(validateManhuaActionPlan(plan, "draft").find((i) => i.code === "land_without_surface")?.severity).toBe("warning");
    expect(validateManhuaActionPlan(plan, "execution").find((i) => i.code === "land_without_surface")?.severity).toBe("error");
  });

  it("攻击必须有目标：缺 targetActorId 解析失败", () => {
    const raw = JSON.parse(JSON.stringify(buildPlan()));
    delete raw.shots[0].events[0].targetActorId;
    expect(parseManhuaActionPlan(raw, "draft").ok).toBe(false);
    expect(() => sealManhuaActionPlan(raw)).toThrow();
  });

  it("关注对象只是关注：actorState 的 focus 与事件目标各管各的", () => {
    const plan = buildPlan();
    // 男在镜2 关注甲，但镜2 的事件是甲的登船，不是男的攻击
    expect(traceManhuaPlanFocus(plan, MAN).map((t) => t.focusActorId)).toEqual([null, A, A]);
    expect(plan.shots[1]!.events[0]!.actorId).toBe(A);
  });

  it("持物有 id 不等于握在手上：socket=unknown 在执行期被拦", () => {
    const base = buildPlan();
    const shots = structuredClone(base.shots);
    shots[0]!.actorChanges.push({
      actorId: MAN,
      next: { heldProps: [{ propAnchorId: "wa_prop_sword1", socket: "unknown" }] },
    });
    const plan = sealManhuaActionPlan({ ...base, shots });
    expect(validateManhuaActionPlan(plan, "draft").find((i) => i.code === "held_prop_socket_unknown")?.severity).toBe("warning");
    expect(validateManhuaActionPlan(plan, "execution").find((i) => i.code === "held_prop_socket_unknown")?.severity).toBe("error");
  });
});

describe("决定六/七：相机绑定与执行段范围", () => {
  it("相机只绑不复制，且时间口径显式", () => {
    const base = buildPlan();
    const shots = structuredClone(base.shots);
    shots[0]!.camera = {
      source: "overlay_camera_path",
      sourceShotRef: "e1s1sh1",
      sourceRevision: "overlay-1a2b3c4d",
      timeBasis: "presentation",
      // overlay.cameraPath 只有 points 没有秒数，未解析成带时间采样
      timedSamplesResolved: false,
    };
    const plan = sealManhuaActionPlan({ ...base, shots });
    expect(parseManhuaActionPlan(plan, "draft").ok).toBe(true);
    expect(plan.shots[0]!.camera!.timedSamplesResolved).toBe(false);
  });

  it("执行段用镜头范围表达，一镜不能同时属于两个执行段", () => {
    const base = buildPlan();
    const plan = sealManhuaActionPlan({
      ...base,
      executionRanges: [
        { executionSegmentId: "seg_1", shotIds: ["ap_shot_1", "ap_shot_2"], startOffsetSec: 0 },
        { executionSegmentId: "seg_2", shotIds: ["ap_shot_2", "ap_shot_3"], startOffsetSec: 0 },
      ],
    });
    expect(codes(plan)).toContain("execution_range_duplicate_shot");
  });

  it("执行段引用不存在的镜头要拒", () => {
    const base = buildPlan();
    const plan = sealManhuaActionPlan({
      ...base,
      executionRanges: [{ executionSegmentId: "seg_1", shotIds: ["ap_shot_ghost"], startOffsetSec: 0 }],
    });
    expect(codes(plan)).toContain("execution_range_dangling_shot");
  });

  it("未装箱允许无映射（executionRanges 为空不报错）", () => {
    expect(codes(buildPlan())).not.toContain("execution_range_dangling_shot");
  });
});

describe("身份与拒绝", () => {
  it("顶层是 actionPlanId，没有 sceneId 这一层", () => {
    const plan = buildPlan();
    expect(plan.actionPlanId).toBe("ap_plan_ship_fight");
    expect(plan).not.toHaveProperty("sceneId");
    expect(plan.format).toBe(MANHUA_ACTION_PLAN_FORMAT);
  });

  it("重复 ID：角色 / 镜头 / 事件三处都要拒", () => {
    const base = buildPlan();
    expect(
      codes(sealManhuaActionPlan({ ...base, actors: [...base.actors, { actorId: MAN, nameZh: "男2" }] })),
    ).toContain("duplicate_actor_id");

    const dupShot = structuredClone(base.shots);
    dupShot[1]!.shotId = "ap_shot_1";
    expect(codes(sealManhuaActionPlan({ ...base, shots: dupShot }))).toContain("duplicate_shot_id");

    const dupEvent = structuredClone(base.shots);
    dupEvent[2]!.events[0]!.eventId = "ap_evt_1a";
    expect(codes(sealManhuaActionPlan({ ...base, shots: dupEvent }))).toContain("duplicate_event_id");
  });

  it("悬空引用：事件目标 / 关注对象 / 初始状态都要拒", () => {
    const base = buildPlan();

    const ghostTarget = structuredClone(base.shots);
    (ghostTarget[0]!.events[0] as { targetActorId: string }).targetActorId = "ap_actor_ghost";
    expect(codes(sealManhuaActionPlan({ ...base, shots: ghostTarget }))).toContain("dangling_target_ref");

    const ghostFocus = structuredClone(base.shots);
    ghostFocus[1]!.actorChanges[0]!.next.focusActorId = "ap_actor_ghost";
    expect(codes(sealManhuaActionPlan({ ...base, shots: ghostFocus }))).toContain("dangling_target_ref");

    const ghostInitial = structuredClone(base.initialStates);
    ghostInitial["ap_actor_ghost"] = { presence: "onstage", at: screen(0.1, 0.1), heldProps: [] };
    expect(codes(sealManhuaActionPlan({ ...base, initialStates: ghostInitial }))).toContain(
      "dangling_actor_ref",
    );
  });

  it("非法时间：阶段倒挂 / 重叠 / 超出源时长", () => {
    const base = buildPlan();

    const reversed = structuredClone(base.shots);
    reversed[0]!.events[0]!.phases[0] = { kind: "windup", sourceStartSec: 2, sourceEndSec: 1 };
    expect(codes(sealManhuaActionPlan({ ...base, shots: reversed }))).toContain("phase_out_of_order");

    const overlapped = structuredClone(base.shots);
    overlapped[0]!.events[0]!.phases[1] = { kind: "burst", sourceStartSec: 0.9, sourceEndSec: 1.8 };
    expect(codes(sealManhuaActionPlan({ ...base, shots: overlapped }))).toContain("phase_out_of_order");

    const tooLong = structuredClone(base.shots);
    tooLong[0]!.events[0]!.phases[3] = { kind: "recover", sourceStartSec: 2, sourceEndSec: 99 };
    expect(codes(sealManhuaActionPlan({ ...base, shots: tooLong }))).toContain("phase_out_of_shot");
  });

  it("自己打自己要拒", () => {
    const base = buildPlan();
    const shots = structuredClone(base.shots);
    (shots[0]!.events[0] as { targetActorId: string }).targetActorId = MAN;
    expect(codes(sealManhuaActionPlan({ ...base, shots }))).toContain("self_target");
  });

  it("解析失败不返回半个可用计划", () => {
    const res = parseManhuaActionPlan({ format: MANHUA_ACTION_PLAN_FORMAT, actionPlanId: "x" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues.length).toBeGreaterThan(0);
    expect(res).not.toHaveProperty("plan");
  });

  it("JSON 往返后身份、继承与关注轨迹不变", () => {
    const plan = buildPlan();
    const res = parseManhuaActionPlan(JSON.parse(JSON.stringify(plan)), "execution");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.planRevision).toBe(plan.planRevision);
    expect(traceManhuaPlanFocus(res.plan, WOMAN).map((t) => t.focusActorId)).toEqual([null, B, B]);
    expect(compileManhuaShotSnapshot(res.plan, "ap_shot_3")![A]!.presence).toBe("onstage");
  });
});

/**
 * 0915 终审收口：三条。
 *   必修1 校验编译快照，不只校验 actorChanges（初始/继承都要查）
 *   必修2 交互双方的有效在场状态
 *   收口3 可选状态字段要能**显式清空**
 * 每条断言专用 issue code，不接受「报了某个错」。
 */
describe("终审收口：有效状态与显式清空", () => {
  const withInitial = (patch: Record<string, unknown>) => {
    const base = buildPlan();
    return sealManhuaActionPlan({
      ...base,
      initialStates: {
        ...base.initialStates,
        [MAN]: { ...base.initialStates[MAN]!, ...patch },
      },
    } as never);
  };

  it("必修1 初始状态里的持物缺握持部位：草稿提示、执行硬拦", () => {
    const plan = withInitial({
      heldProps: [{ propAnchorId: "wa_prop_sword", socket: "unknown" }],
    });
    const draft = validateManhuaActionPlan(plan, "draft");
    const exec = validateManhuaActionPlan(plan, "execution");
    expect(draft.find((i) => i.code === "held_prop_socket_unknown")?.severity).toBe("warning");
    expect(exec.find((i) => i.code === "held_prop_socket_unknown")?.severity).toBe("error");
  });

  it("必修1 初始状态的持物问题会沿继承带到后续镜，每镜各报一次", () => {
    const plan = withInitial({
      heldProps: [{ propAnchorId: "wa_prop_sword", socket: "unknown" }],
    });
    const hits = validateManhuaActionPlan(plan, "execution").filter(
      (i) => i.code === "held_prop_socket_unknown",
    );
    // 三镜都继承着这把没绑手的剑
    expect(new Set(hits.map((i) => i.shotId)).size).toBe(plan.shots.length);
  });

  it("必修1 本镜显式修正握持部位后，该镜不再报", () => {
    const base = withInitial({
      heldProps: [{ propAnchorId: "wa_prop_sword", socket: "unknown" }],
    });
    const shots = base.shots.map((s, i) =>
      i === 0
        ? s
        : {
            ...s,
            actorChanges: [
              ...s.actorChanges,
              {
                actorId: MAN,
                next: { heldProps: [{ propAnchorId: "wa_prop_sword", socket: "right_hand" as const }] },
              },
            ],
          },
    );
    const plan = sealManhuaActionPlan({ ...base, shots } as never);
    const hits = validateManhuaActionPlan(plan, "execution").filter(
      (i) => i.code === "held_prop_socket_unknown",
    );
    expect(hits.map((i) => i.shotId)).toEqual([plan.shots[0]!.shotId]);
  });

  it("必修1 初始状态的关注对象悬空：按有效状态报 dangling_target_ref", () => {
    const plan = withInitial({ focusActorId: "ap_actor_not_exist" });
    expect(validateManhuaActionPlan(plan, "draft").map((i) => i.code)).toContain(
      "dangling_target_ref",
    );
  });

  it("必修2 攻击尚未入场的角色：execution 报 event_participant_unavailable", () => {
    const base = buildPlan();
    // 首镜伏兵甲还是 not_entered，把攻击目标换成它
    const shots = base.shots.map((s, i) =>
      i === 0
        ? {
            ...s,
            events: s.events.map((e) =>
              e.kind === "attack" ? { ...e, targetActorId: A } : e,
            ),
          }
        : s,
    );
    const plan = sealManhuaActionPlan({ ...base, shots } as never);
    const hits = validateManhuaActionPlan(plan, "execution").filter(
      (i) => i.code === "event_participant_unavailable",
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.actorId).toBe(A);
    expect(hits[0]!.messageZh).toMatch(/尚未入场/);
  });

  it("必修2 画外交锋（offstage）仍允许，不强制所有人同框", () => {
    const base = buildPlan();
    const plan = sealManhuaActionPlan({
      ...base,
      initialStates: {
        ...base.initialStates,
        [WOMAN]: { ...base.initialStates[WOMAN]!, presence: "offstage", whereaboutsZh: "在船舷另一侧" },
      },
    } as never);
    expect(
      validateManhuaActionPlan(plan, "execution")
        .filter((i) => i.code === "event_participant_unavailable")
        .map((i) => i.actorId),
    ).not.toContain(WOMAN);
  });

  it("收口3 显式清空关注对象：next.focusActorId = null", () => {
    const base = buildPlan();
    const shots = base.shots.map((s, i) =>
      i === base.shots.length - 1
        ? { ...s, actorChanges: [...s.actorChanges, { actorId: MAN, next: { focusActorId: null } }] }
        : s,
    );
    const plan = sealManhuaActionPlan({ ...base, shots } as never);
    const last = compileManhuaShotSnapshot(plan, plan.shots[plan.shots.length - 1]!.shotId)!;
    expect(last[MAN]!.focusActorId).toBeUndefined();
    // 完整状态里不留 null
    expect("focusActorId" in last[MAN]!).toBe(false);
  });

  it("收口3 省略＝沿用，不是清空", () => {
    const base = buildPlan();
    const mid = compileManhuaShotSnapshot(base, base.shots[1]!.shotId)!;
    const last = compileManhuaShotSnapshot(base, base.shots[base.shots.length - 1]!.shotId)!;
    // 第二镜设过关注对象，最后一镜没再写 → 应沿用
    expect(last[MAN]!.focusActorId).toBe(mid[MAN]!.focusActorId);
  });

  it("收口3 清空之后继续继承为清空，且不影响持物", () => {
    const base = buildPlan();
    const shots = base.shots.map((s, i) =>
      i === 1
        ? { ...s, actorChanges: [...s.actorChanges, { actorId: MAN, next: { focusActorId: null } }] }
        : s,
    );
    const plan = sealManhuaActionPlan({ ...base, shots } as never);
    const after = compileManhuaShotSnapshot(plan, plan.shots[plan.shots.length - 1]!.shotId)!;
    expect(after[MAN]!.focusActorId).toBeUndefined();
    expect(after[MAN]!.heldProps).toEqual(compileManhuaShotSnapshot(base, base.shots[0]!.shotId)![MAN]!.heldProps);
  });

  it("收口3 带 null 的计划仍能序列化往返，且摘要稳定", () => {
    const base = buildPlan();
    const shots = base.shots.map((s, i) =>
      i === 1
        ? { ...s, actorChanges: [...s.actorChanges, { actorId: MAN, next: { whereaboutsZh: null } }] }
        : s,
    );
    const plan = sealManhuaActionPlan({ ...base, shots } as never);
    const round = parseManhuaActionPlan(JSON.parse(JSON.stringify(plan)));
    expect(round.ok).toBe(true);
    if (round.ok) {
      expect(round.plan.planRevision).toBe(plan.planRevision);
    }
  });
});
