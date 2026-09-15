/**
 * 执行准备：四人船战 → 统一执行包；每一层失败都带 stage 与原始 issues。
 * 不验渲染；用共享夹具，不另造第二份船战。
 */
import { describe, expect, it } from "vitest";
import { A, B, buildBoatFight } from "@shared/manhuaActionPlanBoatFightFixture";
import type { ManhuaActionPlanBindingContext } from "@shared/manhuaActionPlanBindings";
import { sealManhuaActionPlan } from "@shared/manhuaActionPlan";
import { defaultManhuaPrevisCapability } from "@shared/manhuaActionPlanSplit";
import { buildManhuaActionPlanBindingContext } from "../../client/src/lib/manhuaActionPlanAdapter";
import {
  checkManhuaAudioRanges,
  manhuaBindingRevision,
  prepareManhuaActionExecution,
} from "./manhuaActionPlanPrepare";

const world = (x: number, y: number, z: number) => ({ space: "world" as const, x, y, z, unit: "m" as const, axis: "z_up" as const });
const landing = (landingId: string, actorId: string, x: number): ManhuaActionPlanBindingContext["landings"][number] => ({
  landingId,
  overlayRef: { episodeIndex: 1, segmentIndex: 1, shotIndex: 3 },
  sourceRevision: "overlay-1a2b3c4d",
  point: world(x, 0, 1.1),
  boundActorId: actorId,
  surfaceRef: "surf_deck_main",
  surfaceZh: "甲板",
});
const previsCam = (n: number, endSec: number): ManhuaActionPlanBindingContext["cameras"][number] => ({
  source: "previs_cameras",
  sourceShotRef: `previs-${n}`,
  sourceRevision: "pv-1",
  coverage: { startSec: 0, endSec },
  coverageBasis: "source",
  sampling: { kind: "discrete", fps: 24 },
  timedSamplesAvailable: true,
});

/** 执行口径能过的上下文：世界落点 + 三镜 previs 相机各自覆盖整镜 */
const goodContext = (): ManhuaActionPlanBindingContext => ({
  landings: [landing("lp_deck_port", A, 2.5), landing("lp_deck_stbd", B, -2.5)],
  cameras: [previsCam(1, 6), previsCam(2, 6), previsCam(3, 8)],
});

const approvedBoatFight = () => {
  const plan = buildBoatFight({ withSourceBindings: true });
  return sealManhuaActionPlan({ ...plan, approval: { approvedRevision: plan.planRevision, approvedAtIso: "2026-09-15T21:00:00+08:00" } });
};

describe("prepareManhuaActionExecution · 四人船战", () => {
  it("全链通过：拆成 ≥4 镜，每镜全员快照四人齐、落点带世界坐标、相机已解析、approvalCurrent=true", () => {
    const plan = approvedBoatFight();
    const r = prepareManhuaActionExecution({ plan, context: goodContext() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ex = r.execution;
    expect(ex.actionPlanId).toBe("ap_boat_fight");
    expect(ex.planRevision).toBe(plan.planRevision);
    expect(ex.approvalCurrent).toBe(true);
    expect(ex.shots.length).toBeGreaterThanOrEqual(4);
    for (const s of ex.shots) {
      expect(Object.keys(s.actors).sort()).toEqual([A, B, "ap_actor_man", "ap_actor_woman"].sort());
      expect(s.presentationDurationSec).toBeGreaterThan(0);
      expect(s.resolvedCamera?.source).toBe("previs_cameras");
    }
    const landShot = ex.shots.find((s) => s.events.some((e) => e.kind === "land"))!;
    expect(landShot.landings.map((l) => l.landingId).sort()).toEqual(["lp_deck_port", "lp_deck_stbd"]);
    expect(landShot.landings.every((l) => l.point.space === "world")).toBe(true);
    // 画外角色去向可追：出水镜里男女 offstage 带 whereabouts 或仍在场
    const water = ex.shots.find((s) => s.kind === "water_emerge")!;
    expect(water.onstageActorIds.sort()).toEqual([A, B].sort());
    expect(water.offstage.length).toBe(2);
  });

  it("approval 不是总门禁：未审批的计划只要证据齐全仍可准备，approvalCurrent=false 如实带回", () => {
    const r = prepareManhuaActionExecution({ plan: buildBoatFight({ withSourceBindings: true }), context: goodContext() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.execution.approvalCurrent).toBe(false);
  });

  it("导演板只有屏幕点 → 适配器如实给 screen → 执行期被 landing_world_point_required 拦在 bindings 层", () => {
    const ctx = buildManhuaActionPlanBindingContext({
      overlays: [
        {
          format: "manhua_board_motion_overlay_v1",
          episodeIndex: 1, segmentIndex: 1, shotIndex: 3, imageSpace: "normalized", sourceRevision: "overlay-1a2b3c4d",
          baseAspectRatio: "16:9", actorRoutes: [], cameraPath: null, axis: null, userAdjusted: false, needsReview: false,
          landingPoints: [
            { landingId: "lp_deck_port", kind: "land", at: { x: 0.6, y: 0.6 }, entityIds: [A] },
            { landingId: "lp_deck_stbd", kind: "land", at: { x: 0.4, y: 0.6 }, entityIds: [B] },
          ],
        } as never,
      ],
      surfaces: [{ surfaceRef: "surf_deck_main", nameZh: "甲板", episodeIndex: 1 }],
      previs: [1, 2, 3].map((n) => ({ sourceShotRef: `previs-${n}`, sourceRevision: "pv-1", durationSec: n === 3 ? 8 : 6, cameras: [{ startSec: 0, endSec: n === 3 ? 8 : 6 }] })),
    });
    const r = prepareManhuaActionExecution({ plan: approvedBoatFight(), context: ctx });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe("bindings");
    expect(r.bindingIssues.map((i) => i.code)).toContain("landing_world_point_required");
    expect(r.splitIssues).toEqual([]);
  });

  it("相机只有 overlay 路径（无秒数）→ camera_evidence_missing / timed_samples 拦下，不自证覆盖", () => {
    const ctx = goodContext();
    ctx.cameras = ctx.cameras.map((c) => ({ source: "previs_cameras", sourceShotRef: c.sourceShotRef, sourceRevision: c.sourceRevision, timedSamplesAvailable: false }));
    const r = prepareManhuaActionExecution({ plan: approvedBoatFight(), context: ctx });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("bindings");
      expect(r.bindingIssues.some((i) => i.code.startsWith("camera_"))).toBe(true);
    }
  });

  it("出水人数超过能力表 → capability 层失败，带 too_many_actors_for_shot，不产出执行包", () => {
    // 3 人出水仍在默认上限内 → 用更严的能力表逼出（与拆镜器测试同口径）
    const base = buildBoatFight({ withSourceBindings: true, extraEmerge: true });
    const plan = sealManhuaActionPlan({ ...base, approval: { approvedRevision: base.planRevision, approvedAtIso: "2026-09-15T21:00:00+08:00" } });
    const capability = { ...defaultManhuaPrevisCapability(), waterMaxActors: 2 };
    expect(prepareManhuaActionExecution({ plan, context: goodContext() }).ok).toBe(true);
    const r = prepareManhuaActionExecution({ plan, context: goodContext(), capability });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("capability");
      expect(r.splitIssues.map((i) => i.code)).toContain("too_many_actors_for_shot");
    }
  });

  it("对白超出镜头呈现时长 → audio 层失败；范围合法则通过", () => {
    const plan = approvedBoatFight();
    const bad = prepareManhuaActionExecution({
      plan, context: goodContext(),
      audioCues: [{ cueId: "cue_1", shotId: "ap_shot_1", kind: "dialogue", startSec: 4, endSec: 7.5 }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.stage).toBe("audio");
      expect(bad.audioIssues[0]?.code).toBe("audio_cue_out_of_shot");
    }
    const good = prepareManhuaActionExecution({
      plan, context: goodContext(),
      audioCues: [{ cueId: "cue_1", shotId: "ap_shot_1", kind: "dialogue", startSec: 4, endSec: 6 }],
    });
    expect(good.ok).toBe(true);
    expect(checkManhuaAudioRanges(plan, [{ cueId: "x", shotId: "nope", kind: "sfx", startSec: 0, endSec: 1 }])[0]?.code).toBe("audio_cue_shot_missing");
    expect(checkManhuaAudioRanges(plan, [{ cueId: "y", shotId: "ap_shot_1", kind: "sfx", startSec: 2, endSec: 2 }])[0]?.code).toBe("audio_cue_invalid_range");
  });

  it("结构不合法 → schema 层；缺来源绑定 → plan/bindings 执行口径失败", () => {
    const junk = prepareManhuaActionExecution({ plan: { format: "nope" }, context: goodContext() });
    expect(junk.ok).toBe(false);
    if (!junk.ok) expect(junk.stage).toBe("schema");
    const noBinding = prepareManhuaActionExecution({ plan: buildBoatFight(), context: goodContext() });
    expect(noBinding.ok).toBe(false);
    if (!noBinding.ok) expect(["plan", "bindings"]).toContain(noBinding.stage);
  });

  it("bindingRevision 键序无关，落点/相机任一变化即变", () => {
    const a = goodContext();
    const rev = manhuaBindingRevision(a);
    const reordered: ManhuaActionPlanBindingContext = { cameras: [...a.cameras].reverse(), landings: [...a.landings].reverse() };
    // 数组顺序是内容的一部分（镜头顺序有意义），只保证对象键序无关
    const keyShuffled = JSON.parse(JSON.stringify({ cameras: a.cameras, landings: a.landings })) as ManhuaActionPlanBindingContext;
    expect(manhuaBindingRevision(keyShuffled)).toBe(rev);
    expect(manhuaBindingRevision(reordered)).not.toBe(rev);
    const moved = goodContext();
    moved.landings[0]!.point = world(9, 0, 1.1);
    expect(manhuaBindingRevision(moved)).not.toBe(rev);
    const camChanged = goodContext();
    camChanged.cameras[0]!.sourceRevision = "pv-2";
    expect(manhuaBindingRevision(camChanged)).not.toBe(rev);
  });
});
