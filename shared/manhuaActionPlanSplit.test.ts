/**
 * 拆镜器：四人船战 → 白模能力允许的可执行镜头；**不静默减少人物**。
 * 不验渲染；能力上限从 manhuaPrevis 导出常量读。
 */
import { describe, expect, it } from "vitest";
import { sealManhuaActionPlan, type ManhuaActionPlan } from "./manhuaActionPlan";
import { A, B, MAN, WOMAN, buildBoatFight, phases } from "./manhuaActionPlanBoatFightFixture";
import { PREVIS_WATER_MAX_ACTORS, PREVIS_WATER_MAX_SEC } from "./manhuaPrevis";
import {
  defaultManhuaPrevisCapability,
  splitManhuaActionPlanForPrevis,
  type ManhuaExecutableShot,
} from "./manhuaActionPlanSplit";

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
