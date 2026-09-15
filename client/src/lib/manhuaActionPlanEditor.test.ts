import { describe, expect, it } from "vitest";
import { isManhuaPlanApprovalCurrent } from "@shared/manhuaActionPlan";
import type { ManhuaActionPlanBindingContext } from "@shared/manhuaActionPlanBindings";
import {
  addManhuaActionEvent,
  approveManhuaActionPlan,
  createManhuaActionPlanFromSegment,
  manhuaActionEventFromDraft,
  manhuaLandingOptionsForShot,
  removeManhuaActionEvent,
  setManhuaActorPresence,
  setManhuaShotSlowSpan,
  summarizeManhuaActionPlanReadiness,
} from "./manhuaActionPlanEditor";

const shots = [
  { index: 1, durationSec: 6, actionZh: "男女交锋" },
  { index: 2, durationSec: 6, actionZh: "伏兵出水" },
  { index: 3, durationSec: 8, actionZh: "登船混战" },
];
const actors = [
  { id: "c_man", label: "男" },
  { id: "c_woman", label: "女" },
  { id: "c_a", label: "伏兵甲" },
  { id: "c_b", label: "伏兵乙" },
];
const base = () => createManhuaActionPlanFromSegment({ episodeIndex: 1, segmentIndex: 2, shots, actors });

const ctx: ManhuaActionPlanBindingContext = {
  landings: [
    {
      landingId: "lp_port",
      overlayRef: { episodeIndex: 1, segmentIndex: 2, shotIndex: 3 },
      sourceRevision: "ov-1",
      point: { space: "screen", x: 0.6, y: 0.6 },
      boundActorId: "c_a",
      surfaceRef: "surf_deck",
      surfaceZh: "甲板",
    },
    {
      landingId: "lp_other_shot",
      overlayRef: { episodeIndex: 1, segmentIndex: 2, shotIndex: 1 },
      sourceRevision: "ov-1",
      point: { space: "screen", x: 0.1, y: 0.1 },
    },
  ],
  cameras: [],
};

describe("manhuaActionPlanEditor", () => {
  it("按段建骨架：一源镜一计划镜、shotId 稳定、sourceBinding 全、全员 not_entered", () => {
    const plan = base();
    expect(plan.shots.map((s) => s.shotId)).toEqual(["ap_shot_e1_s2_t1", "ap_shot_e1_s2_t2", "ap_shot_e1_s2_t3"]);
    expect(plan.shots[2]!.sourceBinding).toEqual({ episodeIndex: 1, segmentIndex: 2, sourceShotIndex: 3 });
    expect(plan.shots[2]!.timeMap).toEqual({ sourceDurationSec: 8, spans: [] });
    expect(plan.actors.map((a) => a.actorId)).toEqual(actors.map((a) => a.id));
    expect(plan.initialStates).toEqual({});
    expect(() => createManhuaActionPlanFromSegment({ episodeIndex: 1, segmentIndex: 1, shots: [], actors })).toThrow();
    expect(() => createManhuaActionPlanFromSegment({ episodeIndex: 1, segmentIndex: 1, shots, actors: [] })).toThrow();
  });

  it("三段秒数 → phases（起手/接触/卸力），零长段省略；超镜长报错", () => {
    const e = manhuaActionEventFromDraft("ev1", { kind: "attack", actorId: "c_man", counterpartActorId: "c_woman", startSec: 1, windupSec: 0.4, contactSec: 0.2, recoverSec: 0.6 });
    expect(e.kind).toBe("attack");
    expect(e.phases).toEqual([
      { kind: "windup", sourceStartSec: 1, sourceEndSec: 1.4 },
      { kind: "contact", sourceStartSec: 1.4, sourceEndSec: 1.6 },
      { kind: "recover", sourceStartSec: 1.6, sourceEndSec: 2.2 },
    ]);
    const noWindup = manhuaActionEventFromDraft("ev2", { kind: "observe", actorId: "c_man", startSec: 0, windupSec: 0, contactSec: 0, recoverSec: 2 });
    expect(noWindup.phases.map((p) => p.kind)).toEqual(["recover"]);
    expect(() => manhuaActionEventFromDraft("x", { kind: "attack", actorId: "c_man", startSec: 0, windupSec: 1, contactSec: 0, recoverSec: 0 })).toThrow("对手");
    expect(() => manhuaActionEventFromDraft("x", { kind: "land", actorId: "c_a", startSec: 0, windupSec: 1, contactSec: 0, recoverSec: 0 })).toThrow("落点");
    expect(() => addManhuaActionEvent(base(), "ap_shot_e1_s2_t1", { kind: "observe", actorId: "c_man", startSec: 5, windupSec: 0, contactSec: 0, recoverSec: 2 })).toThrow("超过本镜源时长");
  });

  it("每次修改都重算 planRevision → 已审批自动失效；删事件后再审批又有效", () => {
    let plan = approveManhuaActionPlan(base(), "2026-09-15T21:00:00+08:00");
    expect(isManhuaPlanApprovalCurrent(plan)).toBe(true);
    plan = addManhuaActionEvent(plan, "ap_shot_e1_s2_t1", { kind: "attack", actorId: "c_man", counterpartActorId: "c_woman", startSec: 0, windupSec: 0.5, contactSec: 0.3, recoverSec: 0.5 }, "ev_fixed");
    expect(isManhuaPlanApprovalCurrent(plan)).toBe(false);
    expect(plan.approval?.approvedRevision).toBeDefined();
    plan = removeManhuaActionEvent(plan, "ap_shot_e1_s2_t1", "ev_fixed");
    expect(plan.shots[0]!.events).toEqual([]);
    plan = approveManhuaActionPlan(plan, "2026-09-15T21:05:00+08:00");
    expect(isManhuaPlanApprovalCurrent(plan)).toBe(true);
  });

  it("入场只写变化：首镜进 initialStates，后镜进 actorChanges；null 清空", () => {
    let plan = setManhuaActorPresence(base(), "ap_shot_e1_s2_t1", "c_man", { presence: "onstage", at: { space: "screen", x: 0.3, y: 0.7 } });
    expect(plan.initialStates.c_man).toMatchObject({ presence: "onstage", at: { space: "screen", x: 0.3, y: 0.7 } });
    expect(plan.shots[0]!.actorChanges).toEqual([]);
    plan = setManhuaActorPresence(plan, "ap_shot_e1_s2_t2", "c_a", { presence: "onstage" });
    plan = setManhuaActorPresence(plan, "ap_shot_e1_s2_t2", "c_a", { whereaboutsZh: "" });
    expect(plan.shots[1]!.actorChanges).toEqual([{ actorId: "c_a", next: { presence: "onstage", whereaboutsZh: null } }]);
  });

  it("慢看段：一条慢段 + 两侧常速，覆盖整镜；呈现时长随之变长；清掉恢复常速", () => {
    let plan = setManhuaShotSlowSpan(base(), "ap_shot_e1_s2_t3", { sourceStartSec: 2, sourceEndSec: 3, rate: 0.5 });
    expect(plan.shots[2]!.timeMap.spans).toEqual([
      { sourceStartSec: 0, sourceEndSec: 2, rate: 1 },
      { sourceStartSec: 2, sourceEndSec: 3, rate: 0.5 },
      { sourceStartSec: 3, sourceEndSec: 8, rate: 1 },
    ]);
    expect(summarizeManhuaActionPlanReadiness(plan, ctx).presentationTotalSec).toBeCloseTo(6 + 6 + 9, 6);
    plan = setManhuaShotSlowSpan(plan, "ap_shot_e1_s2_t3", null);
    expect(plan.shots[2]!.timeMap.spans).toEqual([]);
  });

  it("落点下拉只列本镜（sourceBinding 匹配）的已解析落点，三元组原样带走，不造 surfaceRef", () => {
    const plan = base();
    const opts = manhuaLandingOptionsForShot(plan.shots[2]!, ctx);
    expect(opts.map((o) => o.landing.landingId)).toEqual(["lp_port"]);
    expect(opts[0]!.landing).toEqual({ overlayRef: { episodeIndex: 1, segmentIndex: 2, shotIndex: 3 }, landingId: "lp_port", sourceRevision: "ov-1", surfaceRef: "surf_deck", surfaceZh: "甲板" });
    expect(manhuaLandingOptionsForShot(plan.shots[1]!, ctx)).toEqual([]);
    expect(manhuaLandingOptionsForShot(plan.shots[2]!, null)).toEqual([]);
  });

  it("就绪摘要：骨架期执行阻断（缺相机/在场无位置等）；引用一致性与审批分开报", () => {
    const plan = base();
    const r = summarizeManhuaActionPlanReadiness(plan, ctx);
    expect(r.approvalCurrent).toBe(false);
    expect(r.referencesValid).toBe(true);
    expect(r.executionBlocked).toBe(true);
    expect(r.emptyShotIds).toEqual(["ap_shot_e1_s2_t1", "ap_shot_e1_s2_t2", "ap_shot_e1_s2_t3"]);
    expect(r.unconfirmedShotIds).toHaveLength(3);
    const withLand = addManhuaActionEvent(plan, "ap_shot_e1_s2_t3", { kind: "land", actorId: "c_a", startSec: 0, windupSec: 0.5, contactSec: 0.2, recoverSec: 0.3, landing: manhuaLandingOptionsForShot(plan.shots[2]!, ctx)[0]!.landing });
    const moved: ManhuaActionPlanBindingContext = { ...ctx, landings: [{ ...ctx.landings[0]!, sourceRevision: "ov-2" }, ctx.landings[1]!] };
    expect(summarizeManhuaActionPlanReadiness(withLand, ctx).referencesValid).toBe(true);
    expect(summarizeManhuaActionPlanReadiness(withLand, moved).referencesValid).toBe(false);
    // 2D 落点在执行口径下被拦（不冒充 world）
    expect(summarizeManhuaActionPlanReadiness(withLand, ctx).bindingIssues.map((i) => i.code)).toContain("landing_world_point_required");
  });
});
