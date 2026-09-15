/**
 * 动作计划编辑（PR-2，纯函数）：时间轴 UI 只调这里，不自己拼 schema。
 *
 * 口径：
 *   - 每次修改都经 sealManhuaActionPlan 重算 planRevision → 旧审批自动失效（决定三），
 *     不需要 UI 记得去清审批。
 *   - 事件对创作者只暴露「起手 / 接触 / 卸力」三段秒数 + 慢看意图；不填骨名、不写 JSON。
 *   - 落点只能从绑定上下文里**已存在的**落点挑（overlayRef+landingId+sourceRevision 三元组），
 *     UI 不造落点、不从中文名造 surfaceRef。
 *   - 生成源镜的 shotId 稳定：`ap_shot_e{ep}_s{seg}_t{idx}`；重排只改 displayIndex。
 */
import {
  compileManhuaShotSnapshot,
  isManhuaPlanApprovalCurrent,
  sealManhuaActionPlan,
  validateManhuaActionPlan,
  type ManhuaActionEvent,
  type ManhuaActionPlan,
  type ManhuaActionPlanIssue,
  type ManhuaLandingBinding,
  type ManhuaPlanActorState,
  type ManhuaPlanShot,
} from "@shared/manhuaActionPlan";
import {
  areManhuaPlanBindingReferencesStillValid,
  hasBlockingManhuaBindingIssues,
  validateManhuaActionPlanBindings,
  type ManhuaActionPlanBindingContext,
  type ManhuaBindingIssue,
  type ManhuaResolvedLanding,
} from "@shared/manhuaActionPlanBindings";
import { manhuaPresentationDurationSec, validateManhuaShotTimeMap, type ManhuaTimeMapIssue } from "@shared/manhuaActionPlanTiming";

export type ManhuaActionPlanSourceShot = { index: number; durationSec: number; actionZh?: string };
export type ManhuaActionPlanActorInput = { id: string; label: string; canonAnchorId?: string };

export const manhuaActionPlanShotId = (episodeIndex: number, segmentIndex: number, shotIndex: number): string =>
  `ap_shot_e${episodeIndex}_s${segmentIndex}_t${shotIndex}`;

/** 从段落分镜建计划骨架：一源镜一计划镜，全员 not_entered，由创作者逐镜标入场 */
export function createManhuaActionPlanFromSegment(input: {
  episodeIndex: number;
  segmentIndex: number;
  shots: ManhuaActionPlanSourceShot[];
  actors: ManhuaActionPlanActorInput[];
  sourceRevision?: string;
}): ManhuaActionPlan {
  const ep = Math.max(1, Math.floor(input.episodeIndex) || 1);
  const seg = Math.max(1, Math.floor(input.segmentIndex) || 1);
  const shots: ManhuaPlanShot[] = input.shots
    .filter((s) => Number.isFinite(s.durationSec) && s.durationSec > 0)
    .slice(0, 120)
    .map((s, i) => ({
      shotId: manhuaActionPlanShotId(ep, seg, s.index),
      displayIndex: i + 1,
      sourceBinding: {
        episodeIndex: ep,
        segmentIndex: seg,
        sourceShotIndex: s.index,
        ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
      },
      timeMap: { sourceDurationSec: Math.min(120, s.durationSec), spans: [] },
      confirm: "draft",
      actorChanges: [],
      events: [],
    }));
  if (!shots.length) throw new Error("本段没有可编排的分镜（时长为 0）");
  const actors = input.actors.slice(0, 12).map((a) => ({
    actorId: a.id,
    nameZh: a.label.trim() || a.id,
    ...(a.canonAnchorId ? { canonAnchorId: a.canonAnchorId } : {}),
  }));
  if (!actors.length) throw new Error("本段没有已锁定的角色，先在资产区锁角色");
  return sealManhuaActionPlan({
    actionPlanId: `ap_plan_e${ep}_s${seg}`,
    episodeIndex: ep,
    actors,
    initialStates: {},
    shots,
    executionRanges: [],
  });
}

function reseal(plan: ManhuaActionPlan, patch: (draft: ManhuaActionPlan) => ManhuaActionPlan): ManhuaActionPlan {
  const next = patch(structuredClone(plan));
  // approval 原样带着；planRevision 变了它自然失效
  return sealManhuaActionPlan({ ...next, approval: plan.approval });
}

function withShot(plan: ManhuaActionPlan, shotId: string, fn: (shot: ManhuaPlanShot) => void): ManhuaActionPlan {
  return reseal(plan, (draft) => {
    const shot = draft.shots.find((s) => s.shotId === shotId);
    if (!shot) throw new Error(`镜头 ${shotId} 不在计划中`);
    fn(shot);
    return draft;
  });
}

/** 创作者视角的事件草稿：三段秒数，不写 phases 数组 */
export type ManhuaActionEventDraft = {
  kind: ManhuaActionEvent["kind"];
  actorId: string;
  /** attack 的对手 / evade 的威胁 / observe 的对象 / disengage 的脱离对象 */
  counterpartActorId?: string;
  /** 源时间起点（秒） */
  startSec: number;
  windupSec: number;
  contactSec: number;
  recoverSec: number;
  slowMotionIntent?: boolean;
  noteZh?: string;
  landing?: ManhuaLandingBinding;
};

const round = (n: number) => Math.round(n * 1000) / 1000;

export function manhuaActionEventFromDraft(eventId: string, d: ManhuaActionEventDraft): ManhuaActionEvent {
  const s = Math.max(0, d.startSec);
  const w = Math.max(0, d.windupSec);
  const c = Math.max(0, d.contactSec);
  const r = Math.max(0, d.recoverSec);
  if (w + c + r <= 0) throw new Error("起手/接触/卸力至少一段要有时长");
  const phases: ManhuaActionEvent["phases"] = [];
  if (w > 0) phases.push({ kind: "windup", sourceStartSec: round(s), sourceEndSec: round(s + w) });
  if (c > 0) phases.push({ kind: "contact", sourceStartSec: round(s + w), sourceEndSec: round(s + w + c) });
  if (r > 0) phases.push({ kind: "recover", sourceStartSec: round(s + w + c), sourceEndSec: round(s + w + c + r) });
  const base = {
    eventId,
    actorId: d.actorId,
    phases,
    slowMotionIntent: Boolean(d.slowMotionIntent),
    ...(d.noteZh?.trim() ? { noteZh: d.noteZh.trim() } : {}),
  };
  switch (d.kind) {
    case "attack":
      if (!d.counterpartActorId) throw new Error("出招要指定对手");
      return { ...base, kind: "attack", targetActorId: d.counterpartActorId, outcome: "unplanned", ...(d.landing ? { landing: d.landing } : {}) };
    case "evade":
      if (!d.counterpartActorId) throw new Error("闪避要指定威胁来源");
      return { ...base, kind: "evade", threatActorId: d.counterpartActorId, outcome: "unplanned" };
    case "emerge":
      return { ...base, kind: "emerge", outcome: "unplanned", ...(d.landing ? { landing: d.landing } : {}) };
    case "land":
      if (!d.landing) throw new Error("登船/落地要先在导演板上挑一个落点");
      return { ...base, kind: "land", landing: d.landing, outcome: "unplanned" };
    case "disengage":
      return { ...base, kind: "disengage", outcome: "unplanned", ...(d.counterpartActorId ? { fromActorId: d.counterpartActorId } : {}) };
    case "observe":
      return { ...base, kind: "observe", outcome: "observed", ...(d.counterpartActorId ? { subjectActorId: d.counterpartActorId } : {}) };
  }
}

export function addManhuaActionEvent(plan: ManhuaActionPlan, shotId: string, draft: ManhuaActionEventDraft, eventId?: string): ManhuaActionPlan {
  const id = eventId ?? `ap_evt_${shotId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const event = manhuaActionEventFromDraft(id, draft);
  return withShot(plan, shotId, (shot) => {
    const end = event.phases[event.phases.length - 1]!.sourceEndSec;
    if (end > shot.timeMap.sourceDurationSec + 1e-6) {
      throw new Error(`事件结束于 ${end}s，超过本镜源时长 ${shot.timeMap.sourceDurationSec}s`);
    }
    shot.events = [...shot.events, event];
  });
}

export function removeManhuaActionEvent(plan: ManhuaActionPlan, shotId: string, eventId: string): ManhuaActionPlan {
  return withShot(plan, shotId, (shot) => {
    shot.events = shot.events.filter((e) => e.eventId !== eventId);
  });
}

export function setManhuaActionEventOutcome(
  plan: ManhuaActionPlan,
  shotId: string,
  eventId: string,
  outcome: string,
): ManhuaActionPlan {
  return withShot(plan, shotId, (shot) => {
    shot.events = shot.events.map((e) => (e.eventId === eventId ? ({ ...e, outcome } as ManhuaActionEvent) : e));
  });
}

/** 角色入场/去向：只写变化（决定一），首镜基线写 initialStates */
export function setManhuaActorPresence(
  plan: ManhuaActionPlan,
  shotId: string,
  actorId: string,
  next: Partial<Pick<ManhuaPlanActorState, "presence" | "at" | "whereaboutsZh" | "focusActorId">>,
): ManhuaActionPlan {
  return reseal(plan, (draft) => {
    const idx = draft.shots.findIndex((s) => s.shotId === shotId);
    if (idx < 0) throw new Error(`镜头 ${shotId} 不在计划中`);
    const patch: Record<string, unknown> = {};
    if (next.presence !== undefined) patch.presence = next.presence;
    if (next.at !== undefined) patch.at = next.at;
    if (next.whereaboutsZh !== undefined) patch.whereaboutsZh = next.whereaboutsZh || null;
    if (next.focusActorId !== undefined) patch.focusActorId = next.focusActorId || null;
    if (idx === 0) {
      const prev = draft.initialStates[actorId] ?? { presence: "not_entered", heldProps: [] };
      const merged: ManhuaPlanActorState = { ...prev };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete (merged as Record<string, unknown>)[k];
        else (merged as Record<string, unknown>)[k] = v;
      }
      draft.initialStates = { ...draft.initialStates, [actorId]: merged };
      return draft;
    }
    const shot = draft.shots[idx]!;
    const existing = shot.actorChanges.find((c) => c.actorId === actorId);
    if (existing) existing.next = { ...existing.next, ...patch };
    else shot.actorChanges = [...shot.actorChanges, { actorId, next: patch }];
    return draft;
  });
}

/** 慢看段：整镜 timeMap 只允许一条慢段 + 其余常速（首版口径，决定五） */
export function setManhuaShotSlowSpan(
  plan: ManhuaActionPlan,
  shotId: string,
  span: { sourceStartSec: number; sourceEndSec: number; rate: number } | null,
): ManhuaActionPlan {
  return withShot(plan, shotId, (shot) => {
    const total = shot.timeMap.sourceDurationSec;
    if (!span) {
      shot.timeMap = { sourceDurationSec: total, spans: [] };
      return;
    }
    const a = Math.max(0, Math.min(total, span.sourceStartSec));
    const b = Math.max(a, Math.min(total, span.sourceEndSec));
    const rate = Math.min(8, Math.max(0.05, span.rate));
    const spans: ManhuaPlanShot["timeMap"]["spans"] = [];
    if (a > 1e-6) spans.push({ sourceStartSec: 0, sourceEndSec: round(a), rate: 1 });
    if (b > a + 1e-6) spans.push({ sourceStartSec: round(a), sourceEndSec: round(b), rate });
    if (total > b + 1e-6) spans.push({ sourceStartSec: round(b), sourceEndSec: total, rate: 1 });
    const timeMap = { sourceDurationSec: total, spans };
    const issues = validateManhuaShotTimeMap(timeMap);
    if (issues.length) throw new Error(issues.map((i) => i.messageZh).join("；"));
    shot.timeMap = timeMap;
  });
}

export function setManhuaShotConfirm(plan: ManhuaActionPlan, shotId: string, confirm: ManhuaPlanShot["confirm"]): ManhuaActionPlan {
  return withShot(plan, shotId, (shot) => {
    shot.confirm = confirm;
  });
}

export function approveManhuaActionPlan(plan: ManhuaActionPlan, approvedAtIso: string, approvedByZh?: string): ManhuaActionPlan {
  return sealManhuaActionPlan({
    ...plan,
    approval: { approvedRevision: plan.planRevision, approvedAtIso, ...(approvedByZh ? { approvedByZh } : {}) },
  });
}

export function clearManhuaActionPlanApproval(plan: ManhuaActionPlan): ManhuaActionPlan {
  const { approval: _drop, ...rest } = plan;
  return sealManhuaActionPlan(rest);
}

/** 把上下文里属于某镜的落点挑出来给 UI 做下拉；转成计划侧的 landing 绑定三元组 */
export function manhuaLandingOptionsForShot(
  shot: ManhuaPlanShot,
  context: ManhuaActionPlanBindingContext | null | undefined,
): Array<{ landing: ManhuaLandingBinding; resolved: ManhuaResolvedLanding }> {
  if (!context || !shot.sourceBinding) return [];
  const sb = shot.sourceBinding;
  return context.landings
    .filter(
      (l) =>
        l.overlayRef.episodeIndex === sb.episodeIndex &&
        (sb.segmentIndex == null || l.overlayRef.segmentIndex === sb.segmentIndex) &&
        (sb.sourceShotIndex == null || l.overlayRef.shotIndex === sb.sourceShotIndex),
    )
    .map((resolved) => ({
      resolved,
      landing: {
        overlayRef: resolved.overlayRef,
        landingId: resolved.landingId,
        sourceRevision: resolved.sourceRevision,
        ...(resolved.surfaceRef ? { surfaceRef: resolved.surfaceRef } : {}),
        ...(resolved.surfaceZh ? { surfaceZh: resolved.surfaceZh } : {}),
      },
    }));
}

export type ManhuaActionPlanReadiness = {
  approvalCurrent: boolean;
  /** 落点/相机引用是否仍与确认时一致（引用对不上 → 旧确认失效） */
  referencesValid: boolean;
  /** 草稿口径的计划问题（warning 也列出，给创作者看还缺什么） */
  planIssues: ManhuaActionPlanIssue[];
  /** 执行口径的绑定问题 */
  bindingIssues: ManhuaBindingIssue[];
  timeMapIssues: Array<{ shotId: string; issue: ManhuaTimeMapIssue }>;
  /** 没有任何事件、也没人在场的镜头：合同允许，但交白模没意义，这里如实拦 */
  emptyShotIds: string[];
  /** 还没点「已确认」的镜头：确认所见 = 实际提交，未确认不执行 */
  unconfirmedShotIds: string[];
  executionBlocked: boolean;
  presentationTotalSec: number;
};

export function summarizeManhuaActionPlanReadiness(
  plan: ManhuaActionPlan,
  context: ManhuaActionPlanBindingContext | null | undefined,
): ManhuaActionPlanReadiness {
  const ctx = context ?? { landings: [], cameras: [] };
  const planIssuesExec = validateManhuaActionPlan(plan, "execution");
  const bindingIssues = validateManhuaActionPlanBindings(plan, ctx, "execution");
  const timeMapIssues = plan.shots.flatMap((s) => validateManhuaShotTimeMap(s.timeMap).map((issue) => ({ shotId: s.shotId, issue })));
  const emptyShotIds = plan.shots
    .filter((s) => {
      if (s.events.length) return false;
      const snapshot = compileManhuaShotSnapshot(plan, s.shotId) ?? {};
      return !Object.values(snapshot).some((st) => st.presence === "onstage");
    })
    .map((s) => s.shotId);
  const unconfirmedShotIds = plan.shots.filter((s) => s.confirm !== "confirmed").map((s) => s.shotId);
  return {
    approvalCurrent: isManhuaPlanApprovalCurrent(plan),
    referencesValid: areManhuaPlanBindingReferencesStillValid(plan, ctx),
    planIssues: planIssuesExec,
    bindingIssues,
    timeMapIssues,
    emptyShotIds,
    unconfirmedShotIds,
    executionBlocked:
      planIssuesExec.some((i) => i.severity === "error") ||
      hasBlockingManhuaBindingIssues(bindingIssues) ||
      timeMapIssues.length > 0 ||
      emptyShotIds.length > 0 ||
      unconfirmedShotIds.length > 0,
    presentationTotalSec: plan.shots.reduce((acc, s) => acc + manhuaPresentationDurationSec(s.timeMap), 0),
  };
}
