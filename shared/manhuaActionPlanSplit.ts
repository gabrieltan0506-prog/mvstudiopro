/**
 * 执行拆镜器（0915 审查第 4 点）：把 1–12 人的动作计划拆成**白模能力允许**的可执行镜头。
 *
 * 铁律：
 *   1. **不能静默减少人物。** 每个可执行镜头里，计划中的每个角色要么在场（onstage），
 *      要么画外并写明去向（offstage/not_entered/exited）。拆不开就报 issue，不产出半套执行包。
 *   2. 能力上限从 shared/manhuaPrevis.ts 的导出常量读，不在这里重抄数字。
 *   3. 只按已验能力拆：出水镜（≤N 人、≤M 秒、只拍出水者、禁叠持械/接触）、
 *      交锋镜（受总预算 24fps×人数×秒约束）。互斥能力同镜且同时段无法分开 → 拒绝。
 *   4. `issues` 非空时 `shots` 必须为空。
 *
 * 本模块是纯函数，不碰 Blender、不碰服务端；输出给 manhuaActionPlanPrepare 组执行包。
 */

import {
  compileManhuaShotSnapshot,
  type ManhuaActionEvent,
  type ManhuaActionPlan,
  type ManhuaPlanActorState,
  type ManhuaPlanShot,
} from "./manhuaActionPlan";
import { manhuaPresentationDurationSec, type ManhuaShotTimeMap } from "./manhuaActionPlanTiming";
import {
  PREVIS_BUDGET_FPS,
  PREVIS_RENDER_UNIT_BUDGET,
  PREVIS_WATER_MAX_ACTORS,
  PREVIS_WATER_MAX_SEC,
} from "./manhuaPrevis";

/** 白模能力表。默认值全部来自 manhuaPrevis 导出；测试可注入更严/更松的表做反证 */
export type ManhuaPrevisCapability = {
  renderUnitBudget: number;
  budgetFps: number;
  waterMaxActors: number;
  waterMaxSec: number;
};

export function defaultManhuaPrevisCapability(): ManhuaPrevisCapability {
  return {
    renderUnitBudget: PREVIS_RENDER_UNIT_BUDGET,
    budgetFps: PREVIS_BUDGET_FPS,
    waterMaxActors: PREVIS_WATER_MAX_ACTORS,
    waterMaxSec: PREVIS_WATER_MAX_SEC,
  };
}

export type ManhuaExecutableShotKind = "water_emerge" | "engagement" | "transition";

export type ManhuaExecutableShot = {
  /** 沿用计划 shotId；一镜拆多段用 `${shotId}#n` */
  executableShotId: string;
  sourceShotId: string;
  kind: ManhuaExecutableShotKind;
  /** 本可执行镜头覆盖的**源时间**区间（秒） */
  sourceSpan: { startSec: number; endSec: number };
  /** 沿用整镜 timeMap（变速统一在镜头层，决定五） */
  timeMap: ManhuaShotTimeMap;
  /** 在场角色 */
  onstageActorIds: string[];
  /** 画外角色：全员去向必须可追 */
  offstage: Array<{ actorId: string; presence: ManhuaPlanActorState["presence"]; whereaboutsZh: string }>;
  /** 只含本镜能力允许、且属于本时段的事件 */
  events: ManhuaActionEvent[];
};

export type ManhuaSplitIssueCode =
  | "shot_state_unavailable"
  | "cannot_split_without_dropping_actor"
  | "capability_conflict_in_single_shot"
  | "water_shot_too_long"
  | "too_many_actors_for_shot"
  | "actor_state_discontinuity";

export type ManhuaSplitIssue = {
  code: ManhuaSplitIssueCode;
  shotId?: string;
  actorId?: string;
  messageZh: string;
};

export type ManhuaSplitResult = { shots: ManhuaExecutableShot[]; issues: ManhuaSplitIssue[] };

/* ────────────────────────── 内部工具 ────────────────────────── */

function eventSpan(ev: ManhuaActionEvent): { startSec: number; endSec: number } {
  const starts = ev.phases.map((p) => p.sourceStartSec);
  const ends = ev.phases.map((p) => p.sourceEndSec);
  return { startSec: Math.min(...starts), endSec: Math.max(...ends) };
}

function eventParticipants(ev: ManhuaActionEvent): string[] {
  const ids = [ev.actorId];
  if (ev.kind === "attack") ids.push(ev.targetActorId);
  if (ev.kind === "evade") ids.push(ev.threatActorId);
  if (ev.kind === "disengage" && ev.fromActorId) ids.push(ev.fromActorId);
  if (ev.kind === "observe" && ev.subjectActorId) ids.push(ev.subjectActorId);
  return Array.from(new Set(ids));
}

function hasHandHeldProp(state: ManhuaPlanActorState): boolean {
  return state.heldProps.some((p) => p.socket === "right_hand" || p.socket === "left_hand" || p.socket === "both_hands");
}

/** 一个时段里，预算允许的最大在场人数（与 previsCapacityIssueZh 同一公式） */
function maxActorsForSpan(cap: ManhuaPrevisCapability, spanSec: number): number {
  return Math.max(1, Math.floor(cap.renderUnitBudget / (cap.budgetFps * Math.max(spanSec, 1 / cap.budgetFps))));
}

function offstageEntry(
  actorId: string,
  state: ManhuaPlanActorState,
  reasonZh?: string,
): { actorId: string; presence: ManhuaPlanActorState["presence"]; whereaboutsZh: string } {
  const where = state.whereaboutsZh || reasonZh || "";
  return { actorId, presence: state.presence, whereaboutsZh: where };
}

/**
 * 全员覆盖检查：计划里每个角色在本可执行镜头里必须**要么在场、要么画外带去向**。
 * 这是「不能静默减少人物」的执行点；删掉它，四人船战少一人也能过——测试用变异钉住。
 */
function coverageIssues(
  plan: ManhuaActionPlan,
  shot: ManhuaExecutableShot,
): ManhuaSplitIssue[] {
  const issues: ManhuaSplitIssue[] = [];
  const onstage = new Set(shot.onstageActorIds);
  const off = new Map(shot.offstage.map((o) => [o.actorId, o]));
  for (const actor of plan.actors) {
    if (onstage.has(actor.actorId)) continue;
    const o = off.get(actor.actorId);
    if (!o) {
      issues.push({
        code: "cannot_split_without_dropping_actor",
        shotId: shot.sourceShotId,
        actorId: actor.actorId,
        messageZh: `拆镜后「${actor.nameZh}」在 ${shot.executableShotId} 里既不在场也没有去向，不能静默丢人`,
      });
      continue;
    }
    // not_entered / exited 可以没有去向文字；offstage 必须有
    if (o.presence === "offstage" && !o.whereaboutsZh.trim()) {
      issues.push({
        code: "cannot_split_without_dropping_actor",
        shotId: shot.sourceShotId,
        actorId: actor.actorId,
        messageZh: `「${actor.nameZh}」在 ${shot.executableShotId} 画外但没写去向`,
      });
    }
  }
  return issues;
}

/* ────────────────────────── 主流程 ────────────────────────── */

export function splitManhuaActionPlanForPrevis(
  plan: ManhuaActionPlan,
  capability: ManhuaPrevisCapability = defaultManhuaPrevisCapability(),
): ManhuaSplitResult {
  const issues: ManhuaSplitIssue[] = [];
  const out: ManhuaExecutableShot[] = [];
  let prevSnapshot: Record<string, ManhuaPlanActorState> | null = null;

  for (const shot of plan.shots) {
    const snapshot = compileManhuaShotSnapshot(plan, shot.shotId);
    if (!snapshot) {
      issues.push({ code: "shot_state_unavailable", shotId: shot.shotId, messageZh: `镜头 ${shot.shotId} 的全员状态编译不出来` });
      continue;
    }
    // 连续性：上一镜末状态即本镜初状态（快照按累计变化编译，天然连续）；
    // 这里只核「已离场的人不能在本镜突然在场且没有入场变化」
    if (prevSnapshot) {
      for (const actor of plan.actors) {
        const before = prevSnapshot[actor.actorId];
        const now = snapshot[actor.actorId];
        if (!before || !now) continue;
        if (before.presence === "exited" && now.presence === "onstage") {
          const reenters = shot.actorChanges.some((c) => c.actorId === actor.actorId && c.next.presence === "onstage");
          if (!reenters) {
            issues.push({ code: "actor_state_discontinuity", shotId: shot.shotId, actorId: actor.actorId, messageZh: `「${actor.nameZh}」上一镜已离场，本镜却在场且没有入场变化` });
          }
        }
      }
    }
    prevSnapshot = snapshot;

    const onstageIds = plan.actors.map((a) => a.actorId).filter((id) => snapshot[id]?.presence === "onstage");
    const offstageAll = plan.actors
      .filter((a) => snapshot[a.actorId]?.presence !== "onstage")
      .map((a) => offstageEntry(a.actorId, snapshot[a.actorId]!));

    const emergeEvents = shot.events.filter((e) => e.kind === "emerge");
    const otherEvents = shot.events.filter((e) => e.kind !== "emerge");
    const emergingIds = Array.from(new Set(emergeEvents.map((e) => e.actorId)));
    const presentationSec = manhuaPresentationDurationSec(shot.timeMap);

    if (emergeEvents.length === 0) {
      // 交锋 / 过渡镜：受总预算约束
      const maxActors = maxActorsForSpan(capability, presentationSec);
      if (onstageIds.length > maxActors) {
        issues.push({ code: "too_many_actors_for_shot", shotId: shot.shotId, messageZh: `镜头 ${shot.shotId}：${onstageIds.length} 人 × ${presentationSec.toFixed(1)} 秒超出白模预算，最多 ${maxActors} 人` });
        continue;
      }
      const kind: ManhuaExecutableShotKind = otherEvents.some((e) => e.kind === "attack" || e.kind === "evade" || e.kind === "land") ? "engagement" : "transition";
      const ex: ManhuaExecutableShot = {
        executableShotId: shot.shotId,
        sourceShotId: shot.shotId,
        kind,
        sourceSpan: { startSec: 0, endSec: shot.timeMap.sourceDurationSec },
        timeMap: shot.timeMap,
        onstageActorIds: onstageIds,
        offstage: offstageAll,
        events: otherEvents,
      };
      const cov = coverageIssues(plan, ex);
      if (cov.length) issues.push(...cov);
      else out.push(ex);
      continue;
    }

    // ── 含出水的镜头：出水镜只拍出水者；其余人若同时段有接触/持械 → 拆到另一段 ──
    const waterSpan = emergeEvents.map(eventSpan).reduce(
      (acc, s) => ({ startSec: Math.min(acc.startSec, s.startSec), endSec: Math.max(acc.endSec, s.endSec) }),
      { startSec: Number.POSITIVE_INFINITY, endSec: 0 },
    );
    const waterSec = waterSpan.endSec - waterSpan.startSec;
    if (emergingIds.length > capability.waterMaxActors) {
      issues.push({ code: "too_many_actors_for_shot", shotId: shot.shotId, messageZh: `镜头 ${shot.shotId}：${emergingIds.length} 人同时出水，白模最多 ${capability.waterMaxActors} 人` });
      continue;
    }
    if (waterSec > capability.waterMaxSec) {
      issues.push({ code: "water_shot_too_long", shotId: shot.shotId, messageZh: `镜头 ${shot.shotId}：出水段 ${waterSec.toFixed(1)} 秒超过白模上限 ${capability.waterMaxSec} 秒` });
      continue;
    }
    // 出水者本人在出水时段不能持械/被打（previs 互斥）
    for (const id of emergingIds) {
      const st = snapshot[id]!;
      // 只有产生受力的事件算接触：attack / evade / land。observe 只表达关注，disengage 是停手，都不互斥
      const contactSameTime = otherEvents.some((e) => {
        if (e.kind !== "attack" && e.kind !== "evade" && e.kind !== "land") return false;
        if (!eventParticipants(e).includes(id)) return false;
        const s = eventSpan(e);
        return s.startSec < waterSpan.endSec && s.endSec > waterSpan.startSec;
      });
      if (hasHandHeldProp(st) || contactSameTime) {
        issues.push({ code: "capability_conflict_in_single_shot", shotId: shot.shotId, actorId: id, messageZh: `镜头 ${shot.shotId}：出水者在出水时段持械或参与接触，白模出水不能与持械/接触同镜同时段` });
      }
    }
    if (issues.some((i) => i.shotId === shot.shotId)) continue;

    // 出水段：只拍出水者；其余在场者**标画外并写明去向**，不丢
    const waterShot: ManhuaExecutableShot = {
      executableShotId: `${shot.shotId}#1`,
      sourceShotId: shot.shotId,
      kind: "water_emerge",
      sourceSpan: waterSpan,
      timeMap: shot.timeMap,
      onstageActorIds: emergingIds,
      offstage: [
        ...offstageAll,
        ...onstageIds
          .filter((id) => !emergingIds.includes(id))
          .map((id) => ({ actorId: id, presence: "offstage" as const, whereaboutsZh: `出水镜不入画，仍在原位（${snapshot[id]!.whereaboutsZh || "同镜另一段拍"}）` })),
      ],
      events: emergeEvents,
    };
    // 其余事件段：出水者已上场（作为在场者），拍剩余时段的接触/落地
    const restEvents = otherEvents;
    const restSpan = { startSec: 0, endSec: shot.timeMap.sourceDurationSec };
    const restShot: ManhuaExecutableShot | null = restEvents.length
      ? {
          executableShotId: `${shot.shotId}#2`,
          sourceShotId: shot.shotId,
          kind: restEvents.some((e) => e.kind === "attack" || e.kind === "evade" || e.kind === "land") ? "engagement" : "transition",
          sourceSpan: restSpan,
          timeMap: shot.timeMap,
          onstageActorIds: onstageIds,
          offstage: offstageAll,
          events: restEvents,
        }
      : null;
    if (restShot) {
      const maxActors = maxActorsForSpan(capability, presentationSec);
      if (restShot.onstageActorIds.length > maxActors) {
        issues.push({ code: "too_many_actors_for_shot", shotId: shot.shotId, messageZh: `镜头 ${shot.shotId} 交锋段：${restShot.onstageActorIds.length} 人超出白模预算，最多 ${maxActors} 人` });
        continue;
      }
    }
    const pieces = restShot ? [waterShot, restShot] : [waterShot];
    const cov = pieces.flatMap((p) => coverageIssues(plan, p));
    if (cov.length) issues.push(...cov);
    else out.push(...pieces);
  }

  return issues.length ? { shots: [], issues } : { shots: out, issues: [] };
}
