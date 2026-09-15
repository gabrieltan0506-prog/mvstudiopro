/**
 * 拆镜器：四人船战 → 白模能力允许的可执行镜头；**不静默减少人物**。
 * 不验渲染；能力上限从 manhuaPrevis 导出常量读。
 */
import { describe, expect, it } from "vitest";
import { sealManhuaActionPlan, type ManhuaActionPlan, type ManhuaPlanShot } from "./manhuaActionPlan";
import { PREVIS_WATER_MAX_ACTORS, PREVIS_WATER_MAX_SEC } from "./manhuaPrevis";
import {
  defaultManhuaPrevisCapability,
  splitManhuaActionPlanForPrevis,
  type ManhuaExecutableShot,
} from "./manhuaActionPlanSplit";

const MAN = "ap_actor_man", WOMAN = "ap_actor_woman", A = "ap_actor_ambush_a", B = "ap_actor_ambush_b";
const actors = [
  { actorId: MAN, nameZh: "男", canonAnchorId: "wa_char_nan1a2b" },
  { actorId: WOMAN, nameZh: "女", canonAnchorId: "wa_char_nv3c4d" },
  { actorId: A, nameZh: "伏兵甲" },
  { actorId: B, nameZh: "伏兵乙" },
];
const screen = (x: number, y: number) => ({ space: "screen" as const, x, y });
const facing = (deg: number) => ({ basis: "screen_deg" as const, deg });
const plainMap = (sourceDurationSec: number) => ({ sourceDurationSec, spans: [] });
const sword = { propAnchorId: "wa_prop_sword", socket: "right_hand" as const };
const landing = (shotIndex: number, landingId: string) => ({
  overlayRef: { episodeIndex: 1, segmentIndex: 1, shotIndex },
  landingId, sourceRevision: "overlay-1a2b3c4d", surfaceRef: "surf_deck_main", surfaceZh: "甲板",
});
const phases = (a: number, b: number) => [
  { kind: "windup" as const, sourceStartSec: a, sourceEndSec: a + (b - a) / 3 },
  { kind: "contact" as const, sourceStartSec: a + (b - a) / 3, sourceEndSec: a + (2 * (b - a)) / 3 },
  { kind: "recover" as const, sourceStartSec: a + (2 * (b - a)) / 3, sourceEndSec: b },
];

/**
 * 四人船战：
 *   镜1 男女交锋（伏兵 not_entered）
 *   镜2 两伏兵出水（0–4s），男女在场观望
 *   镜3 伏兵登船落甲板 + 男→甲、女→乙 交锋
 */
function buildBoatFight(over?: { shot2DurationSec?: number; emergeEnd?: number; extraEmerge?: boolean }): ManhuaActionPlan {
  const emergeEnd = over?.emergeEnd ?? 4;
  const shots: ManhuaPlanShot[] = [
    {
      shotId: "ap_shot_1", displayIndex: 1, timeMap: plainMap(6), confirm: "confirmed", actorChanges: [],
      events: [
        { eventId: "ap_evt_1a", kind: "attack", actorId: MAN, targetActorId: WOMAN, phases: phases(0, 2), outcome: "blocked", slowMotionIntent: false },
        { eventId: "ap_evt_1b", kind: "attack", actorId: WOMAN, targetActorId: MAN, phases: phases(2, 4), outcome: "blocked", slowMotionIntent: false },
      ],
    },
    {
      shotId: "ap_shot_2", displayIndex: 2, timeMap: plainMap(over?.shot2DurationSec ?? 6), confirm: "confirmed",
      actorChanges: [
        { actorId: A, next: { presence: "onstage", at: screen(0.8, 0.9), facing: facing(180), heldProps: [] } },
        { actorId: B, next: { presence: "onstage", at: screen(0.85, 0.9), facing: facing(180), heldProps: [] } },
        { actorId: MAN, next: { heldProps: [] } },
        { actorId: WOMAN, next: { heldProps: [] } },
      ],
      events: [
        { eventId: "ap_evt_2a", kind: "emerge", actorId: A, phases: phases(0, emergeEnd), outcome: "emerged", slowMotionIntent: true },
        { eventId: "ap_evt_2b", kind: "emerge", actorId: B, phases: phases(0.5, emergeEnd), outcome: "emerged", slowMotionIntent: true },
        ...(over?.extraEmerge ? [{ eventId: "ap_evt_2c", kind: "emerge" as const, actorId: MAN, phases: phases(0, emergeEnd), outcome: "emerged" as const, slowMotionIntent: false }] : []),
        { eventId: "ap_evt_2o", kind: "observe", actorId: MAN, subjectActorId: A, phases: phases(1, 5), outcome: "observed", slowMotionIntent: false },
      ],
    },
    {
      shotId: "ap_shot_3", displayIndex: 3, timeMap: plainMap(8), confirm: "confirmed",
      actorChanges: [
        { actorId: A, next: { at: screen(0.6, 0.6), heldProps: [sword], focusActorId: MAN } },
        { actorId: B, next: { at: screen(0.4, 0.6), heldProps: [sword], focusActorId: WOMAN } },
        { actorId: MAN, next: { heldProps: [sword], focusActorId: A } },
        { actorId: WOMAN, next: { heldProps: [sword], focusActorId: B } },
      ],
      events: [
        { eventId: "ap_evt_3l1", kind: "land", actorId: A, landing: landing(3, "lp_deck_port"), phases: phases(0, 1), outcome: "landed", slowMotionIntent: false },
        { eventId: "ap_evt_3l2", kind: "land", actorId: B, landing: landing(3, "lp_deck_stbd"), phases: phases(0, 1), outcome: "landed", slowMotionIntent: false },
        { eventId: "ap_evt_3a", kind: "attack", actorId: MAN, targetActorId: A, phases: phases(1, 4), outcome: "blocked", slowMotionIntent: false },
        { eventId: "ap_evt_3b", kind: "attack", actorId: WOMAN, targetActorId: B, phases: phases(2, 5), outcome: "blocked", slowMotionIntent: false },
      ],
    },
  ];
  return sealManhuaActionPlan({
    actionPlanId: "ap_boat_fight",
    episodeIndex: 1,
    actors,
    initialStates: {
      [MAN]: { presence: "onstage", at: screen(0.3, 0.7), facing: facing(0), heldProps: [sword] },
      [WOMAN]: { presence: "onstage", at: screen(0.7, 0.7), facing: facing(180), heldProps: [sword] },
      [A]: { presence: "not_entered", heldProps: [], whereaboutsZh: "水下埋伏" },
      [B]: { presence: "not_entered", heldProps: [], whereaboutsZh: "水下埋伏" },
    },
    shots,
    executionRanges: [],
  });
}

function everyoneAccounted(plan: ManhuaActionPlan, shot: ManhuaExecutableShot): boolean {
  return plan.actors.every((a) => shot.onstageActorIds.includes(a.actorId) || shot.offstage.some((o) => o.actorId === a.actorId && (o.presence !== "offstage" || o.whereaboutsZh.trim())));
}

describe("拆镜器：四人船战", () => {
  it("拆成 ≥4 个可执行镜头：交锋 / 出水（只拍出水者，男女画外带去向）/ 剩余段 / 四人两组交锋；每镜全员可追", () => {
    const plan = buildBoatFight();
    const { shots, issues } = splitManhuaActionPlanForPrevis(plan);
    expect(issues).toEqual([]);
    expect(shots.length).toBeGreaterThanOrEqual(4);
    const water = shots.find((s) => s.kind === "water_emerge")!;
    expect(water.onstageActorIds.sort()).toEqual([A, B].sort());
    expect(water.onstageActorIds.length).toBeLessThanOrEqual(PREVIS_WATER_MAX_ACTORS);
    expect(water.sourceSpan.endSec - water.sourceSpan.startSec).toBeLessThanOrEqual(PREVIS_WATER_MAX_SEC);
    // 男女没有被丢：画外且写了去向
    const man = water.offstage.find((o) => o.actorId === MAN)!;
    expect(man.presence).toBe("offstage");
    expect(man.whereaboutsZh).toMatch(/不入画/);
    // 出水镜只含 emerge 事件
    expect(water.events.every((e) => e.kind === "emerge")).toBe(true);
    // 四人交锋镜：四人同在，两组各自对手
    const fight = shots.find((s) => s.sourceShotId === "ap_shot_3")!;
    expect(fight.kind).toBe("engagement");
    expect(fight.onstageActorIds).toHaveLength(4);
    expect(fight.events.filter((e) => e.kind === "attack").map((e) => (e.kind === "attack" ? `${e.actorId}>${e.targetActorId}` : ""))).toEqual([`${MAN}>${A}`, `${WOMAN}>${B}`]);
    for (const s of shots) expect(everyoneAccounted(plan, s)).toBe(true);
  });

  it("出水人数超过白模上限 → too_many_actors_for_shot，且不产出任何镜头（不静默减人）", () => {
    const plan = buildBoatFight({ extraEmerge: true }); // 3 人出水仍在上限内 → 用更严的能力表逼出
    const cap = { ...defaultManhuaPrevisCapability(), waterMaxActors: 2 };
    const { shots, issues } = splitManhuaActionPlanForPrevis(plan, cap);
    expect(issues.map((i) => i.code)).toContain("too_many_actors_for_shot");
    expect(shots).toEqual([]);
  });

  it("出水段超过 8 秒 → water_shot_too_long", () => {
    const plan = buildBoatFight({ shot2DurationSec: 12, emergeEnd: 10 });
    const { shots, issues } = splitManhuaActionPlanForPrevis(plan);
    expect(issues.map((i) => i.code)).toContain("water_shot_too_long");
    expect(shots).toEqual([]);
  });

  it("出水者同时段被攻击/持械 → capability_conflict_in_single_shot（出水不能与持械/接触同镜同时段）", () => {
    const base = buildBoatFight();
    const shot2 = base.shots[1]!;
    const conflicting = sealManhuaActionPlan({
      ...base,
      shots: base.shots.map((s) => (s.shotId !== "ap_shot_2" ? s : {
        ...shot2,
        events: [...shot2.events, { eventId: "ap_evt_2x", kind: "attack", actorId: MAN, targetActorId: A, phases: phases(1, 3), outcome: "unplanned", slowMotionIntent: false }],
      })),
    });
    const { shots, issues } = splitManhuaActionPlanForPrevis(conflicting);
    expect(issues.map((i) => i.code)).toContain("capability_conflict_in_single_shot");
    expect(shots).toEqual([]);
  });

  it("交锋镜超预算（人数 × 秒 × 24 > 2700）→ too_many_actors_for_shot", () => {
    const plan = buildBoatFight();
    const cap = { ...defaultManhuaPrevisCapability(), renderUnitBudget: 24 * 8 * 3 }; // 8 秒只允许 3 人
    const { shots, issues } = splitManhuaActionPlanForPrevis(plan, cap);
    expect(issues.some((i) => i.code === "too_many_actors_for_shot" && i.shotId === "ap_shot_3")).toBe(true);
    expect(shots).toEqual([]);
  });

  it("上限常量来自 manhuaPrevis 导出，默认能力表与之一致", () => {
    const cap = defaultManhuaPrevisCapability();
    expect(cap.waterMaxActors).toBe(PREVIS_WATER_MAX_ACTORS);
    expect(cap.waterMaxSec).toBe(PREVIS_WATER_MAX_SEC);
  });
});
