/**
 * 动作节奏时间轴（PR-2）：面向创作者的起手 / 接触 / 卸力编排。
 *
 * - 只调 manhuaActionPlanEditor 的纯函数；不自己拼 schema、不要求填骨名或 JSON。
 * - 同镜正常交锋（常速）与指定腾空慢看（timeMap 慢段）分开：慢看是镜头层的 timeMap，不是事件。
 * - 落点只能从导演板已解析的落点里挑；没有就提示去导演板标，不造。
 * - 撤销/重做在本组件内（UX 四问：可撤销）；每步都经 onChange 交给 OmniCanvas 唯一状态源。
 * - 任何修改都让旧审批失效（planRevision 变）；状态条如实显示「审批已失效」。
 */
import { useCallback, useMemo, useState } from "react";
import type { ManhuaActionEvent, ManhuaActionPlan, ManhuaPlanShot } from "@shared/manhuaActionPlan";
import type { ManhuaActionPlanBindingContext } from "@shared/manhuaActionPlanBindings";
import { manhuaPresentationDurationSec } from "@shared/manhuaActionPlanTiming";
import {
  addManhuaActionEvent,
  approveManhuaActionPlan,
  createManhuaActionPlanFromSegment,
  manhuaLandingOptionsForShot,
  removeManhuaActionEvent,
  setManhuaActionEventOutcome,
  setManhuaActorPresence,
  setManhuaShotConfirm,
  setManhuaShotSlowSpan,
  summarizeManhuaActionPlanReadiness,
  type ManhuaActionEventDraft,
  type ManhuaActionPlanActorInput,
  type ManhuaActionPlanSourceShot,
} from "@/lib/manhuaActionPlanEditor";

type Props = {
  episodeIndex: number;
  segmentIndex: number;
  plan: ManhuaActionPlan | null;
  sourceShots: ManhuaActionPlanSourceShot[];
  actors: ManhuaActionPlanActorInput[];
  bindingContext: ManhuaActionPlanBindingContext | null;
  disabled?: boolean;
  onChange: (plan: ManhuaActionPlan | null) => void;
};

const KIND_ZH: Record<ManhuaActionEvent["kind"], string> = {
  attack: "出招",
  evade: "闪避",
  emerge: "出水",
  land: "登船/落地",
  disengage: "脱离",
  observe: "观望",
};
const OUTCOMES: Record<ManhuaActionEvent["kind"], string[]> = {
  attack: ["unplanned", "hit", "blocked", "evaded"],
  evade: ["unplanned", "evaded", "partial", "failed"],
  emerge: ["unplanned", "emerged"],
  land: ["unplanned", "landed", "missed"],
  disengage: ["unplanned", "disengaged"],
  observe: ["observed"],
};
const OUTCOME_ZH: Record<string, string> = {
  unplanned: "未定",
  hit: "命中",
  blocked: "被挡",
  evaded: "被闪",
  partial: "半闪",
  failed: "闪失败",
  emerged: "已出水",
  landed: "已落",
  missed: "落空",
  disengaged: "已脱离",
  observed: "观望",
};
const NEEDS_COUNTERPART: ManhuaActionEvent["kind"][] = ["attack", "evade"];
const CAN_LAND: ManhuaActionEvent["kind"][] = ["attack", "emerge", "land"];

const field = "rounded border border-white/20 bg-[#141a24] px-1.5 py-1 text-xs text-white min-w-0";
const btn = "rounded border border-cyan-300/30 px-2 py-1 text-xs text-cyan-50 disabled:opacity-40";
const btnWarn = "rounded border border-amber-300/40 px-2 py-1 text-xs text-amber-50 disabled:opacity-40";

const counterpartOf = (e: ManhuaActionEvent): string | undefined => {
  switch (e.kind) {
    case "attack":
      return e.targetActorId;
    case "evade":
      return e.threatActorId;
    case "observe":
      return e.subjectActorId;
    case "disengage":
      return e.fromActorId;
    default:
      return undefined;
  }
};
const phaseSec = (e: ManhuaActionEvent, kind: "windup" | "contact" | "recover") => {
  const p = e.phases.find((x) => x.kind === kind);
  return p ? (p.sourceEndSec - p.sourceStartSec).toFixed(2) : "—";
};

export function ManhuaActionTimeline(props: Props) {
  const { plan, disabled, onChange } = props;
  const [past, setPast] = useState<ManhuaActionPlan[]>([]);
  const [future, setFuture] = useState<ManhuaActionPlan[]>([]);
  const [error, setError] = useState<string | null>(null);

  const commit = useCallback(
    (fn: () => ManhuaActionPlan | null) => {
      try {
        const next = fn();
        setPast((p) => (plan ? [...p.slice(-29), plan] : p));
        setFuture([]);
        setError(null);
        onChange(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [onChange, plan],
  );
  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast((p) => p.slice(0, -1));
    if (plan) setFuture((f) => [plan, ...f]);
    onChange(prev);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((f) => f.slice(1));
    if (plan) setPast((p) => [...p, plan]);
    onChange(next);
  };

  const readiness = useMemo(() => (plan ? summarizeManhuaActionPlanReadiness(plan, props.bindingContext) : null), [plan, props.bindingContext]);
  const actorLabel = useMemo(() => {
    const m = new Map(props.actors.map((a) => [a.id, a.label] as const));
    return (id: string) => plan?.actors.find((a) => a.actorId === id)?.nameZh ?? m.get(id) ?? id;
  }, [plan, props.actors]);

  if (!plan) {
    return (
      <section className="w-full rounded-xl border border-cyan-300/25 bg-[#0c121d] p-3" data-manhua-action-timeline>
        <p className="mb-2 text-xs text-cyan-100">第 {props.episodeIndex} 集 · 第 {props.segmentIndex} 段 · 动作节奏：未编排</p>
        <button
          type="button"
          className={btn}
          disabled={disabled || !props.sourceShots.length || !props.actors.length}
          onClick={() =>
            commit(() =>
              createManhuaActionPlanFromSegment({
                episodeIndex: props.episodeIndex,
                segmentIndex: props.segmentIndex,
                shots: props.sourceShots,
                actors: props.actors,
              }),
            )
          }
        >
          按本段分镜建动作骨架
        </button>
        {!props.sourceShots.length ? <p className="mt-1 text-[11px] text-amber-100">本段还没有分镜，先确认分段剧本。</p> : null}
        {!props.actors.length ? <p className="mt-1 text-[11px] text-amber-100">本段还没有锁定角色。</p> : null}
        {error ? <p className="mt-1 text-[11px] text-red-200">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="w-full rounded-xl border border-cyan-300/25 bg-[#0c121d] p-3 text-white" data-manhua-action-timeline>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-cyan-100">第 {plan.episodeIndex} 集 · 动作节奏</span>
        <span className="rounded bg-white/10 px-1.5 py-0.5">呈现合计 {readiness!.presentationTotalSec.toFixed(1)}s</span>
        <span className={`rounded px-1.5 py-0.5 ${readiness!.approvalCurrent ? "bg-emerald-500/25" : plan.approval ? "bg-amber-500/25" : "bg-white/10"}`} data-approval-state={readiness!.approvalCurrent ? "current" : plan.approval ? "stale" : "none"}>
          {readiness!.approvalCurrent ? "审批有效" : plan.approval ? "审批已失效（内容改过）" : "未审批"}
        </span>
        <span className={`rounded px-1.5 py-0.5 ${readiness!.referencesValid ? "bg-white/10" : "bg-red-500/25"}`}>
          {readiness!.referencesValid ? "落点/相机引用一致" : "导演板落点或相机已变，需重确认"}
        </span>
        <span className={`rounded px-1.5 py-0.5 ${readiness!.executionBlocked ? "bg-amber-500/25" : "bg-emerald-500/25"}`} data-execution-state={readiness!.executionBlocked ? "blocked" : "ready"}>
          {readiness!.executionBlocked ? `执行前还缺 ${readiness!.planIssues.filter((i) => i.severity === "error").length + readiness!.bindingIssues.filter((i) => i.severity === "error").length + readiness!.timeMapIssues.length + readiness!.emptyShotIds.length + readiness!.unconfirmedShotIds.length} 项` : "可交白模执行"}
        </span>
        <span className="ml-auto flex gap-1">
          <button type="button" className={btn} disabled={disabled || !past.length} onClick={undo}>撤销</button>
          <button type="button" className={btn} disabled={disabled || !future.length} onClick={redo}>重做</button>
          <button type="button" className={btn} disabled={disabled || readiness!.approvalCurrent} onClick={() => commit(() => approveManhuaActionPlan(plan, new Date().toISOString()))}>审批本版</button>
          <button type="button" className={btnWarn} disabled={disabled} onClick={() => { if (window.confirm("删除本段动作计划？可撤销。")) commit(() => null); }}>删除计划</button>
        </span>
      </div>
      {error ? <p className="mb-2 text-[11px] text-red-200">{error}</p> : null}
      {readiness!.executionBlocked ? (
        <details className="mb-2 text-[11px] text-amber-100">
          <summary>还缺什么（执行口径）</summary>
          <ul className="ml-4 list-disc">
            {readiness!.planIssues.filter((i) => i.severity === "error").map((i, n) => <li key={`p${n}`}>{i.messageZh}</li>)}
            {readiness!.bindingIssues.filter((i) => i.severity === "error").map((i, n) => <li key={`b${n}`}>{i.messageZh}</li>)}
            {readiness!.timeMapIssues.map((t, n) => <li key={`t${n}`}>{t.shotId}：{t.issue.messageZh}</li>)}
            {readiness!.emptyShotIds.length ? <li>空镜（无事件且无人在场）：{readiness!.emptyShotIds.length} 个</li> : null}
            {readiness!.unconfirmedShotIds.length ? <li>未点「已确认」的镜头：{readiness!.unconfirmedShotIds.length} 个</li> : null}
          </ul>
        </details>
      ) : null}
      <div className="flex flex-col gap-2">
        {plan.shots.map((shot) => (
          <ShotCard
            key={shot.shotId}
            plan={plan}
            shot={shot}
            actors={plan.actors.map((a) => ({ id: a.actorId, label: a.nameZh }))}
            actorLabel={actorLabel}
            bindingContext={props.bindingContext}
            disabled={Boolean(disabled)}
            commit={commit}
          />
        ))}
      </div>
    </section>
  );
}

function ShotCard(props: {
  plan: ManhuaActionPlan;
  shot: ManhuaPlanShot;
  actors: Array<{ id: string; label: string }>;
  actorLabel: (id: string) => string;
  bindingContext: ManhuaActionPlanBindingContext | null;
  disabled: boolean;
  commit: (fn: () => ManhuaActionPlan | null) => void;
}) {
  const { plan, shot, actors, actorLabel, disabled, commit } = props;
  const landingOptions = useMemo(() => manhuaLandingOptionsForShot(shot, props.bindingContext), [shot, props.bindingContext]);
  const [draft, setDraft] = useState<ManhuaActionEventDraft>({
    kind: "attack",
    actorId: actors[0]?.id ?? "",
    counterpartActorId: actors[1]?.id,
    startSec: 0,
    windupSec: 0.4,
    contactSec: 0.3,
    recoverSec: 0.5,
    slowMotionIntent: false,
  });
  const [landingIdx, setLandingIdx] = useState(0);
  const slow = shot.timeMap.spans.find((s) => s.rate !== 1);
  const [slowDraft, setSlowDraft] = useState({ start: slow?.sourceStartSec ?? 0, end: slow?.sourceEndSec ?? 0, rate: slow?.rate ?? 0.5 });
  const presentation = manhuaPresentationDurationSec(shot.timeMap);
  const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  return (
    <div className="rounded-lg border border-white/15 bg-[#101723] p-2" data-shot-id={shot.shotId}>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">镜 {shot.displayIndex}</span>
        <span className="text-white/70">源 {shot.timeMap.sourceDurationSec}s → 呈现 {presentation.toFixed(2)}s</span>
        <select className={field} value={shot.confirm} disabled={disabled} onChange={(e) => commit(() => setManhuaShotConfirm(plan, shot.shotId, e.target.value as ManhuaPlanShot["confirm"]))}>
          <option value="unplanned">未编排</option>
          <option value="draft">草稿</option>
          <option value="confirmed">已确认</option>
        </select>
      </div>

      {/* 入场 / 去向：只写变化 */}
      <div className="mb-1 flex flex-wrap gap-1 text-[11px]">
        {actors.map((a) => (
          <label key={a.id} className="flex items-center gap-1 rounded bg-white/5 px-1">
            <span>{a.label}</span>
            <select
              className={field}
              disabled={disabled}
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                commit(() =>
                  setManhuaActorPresence(plan, shot.shotId, a.id, v === "onstage" ? { presence: "onstage" } : v === "offstage" ? { presence: "offstage", whereaboutsZh: "画外（待写去向）" } : { presence: "not_entered" }),
                );
                e.target.value = "";
              }}
            >
              <option value="">入场…</option>
              <option value="onstage">在场</option>
              <option value="offstage">画外</option>
              <option value="not_entered">未入场</option>
            </select>
          </label>
        ))}
      </div>

      {/* 事件列表 */}
      {shot.events.length ? (
        <ul className="mb-1 flex flex-col gap-1 text-[11px]">
          {shot.events.map((e) => (
            <li key={e.eventId} className="flex flex-wrap items-center gap-2 rounded bg-white/5 px-1.5 py-0.5" data-event-id={e.eventId}>
              <span className="rounded bg-cyan-500/20 px-1">{KIND_ZH[e.kind]}</span>
              <span>{actorLabel(e.actorId)}{counterpartOf(e) ? ` → ${actorLabel(counterpartOf(e)!)}` : ""}</span>
              <span className="text-white/70">起手 {phaseSec(e, "windup")} · 接触 {phaseSec(e, "contact")} · 卸力 {phaseSec(e, "recover")}</span>
              {e.slowMotionIntent ? <span className="rounded bg-violet-500/25 px-1">慢看</span> : null}
              {"landing" in e && e.landing ? <span className="text-white/60">落点 {e.landing.landingId}{e.landing.surfaceZh ? `（${e.landing.surfaceZh}）` : ""}</span> : null}
              <select className={field} value={e.outcome} disabled={disabled} onChange={(ev) => commit(() => setManhuaActionEventOutcome(plan, shot.shotId, e.eventId, ev.target.value))}>
                {OUTCOMES[e.kind].map((o) => <option key={o} value={o}>{OUTCOME_ZH[o] ?? o}</option>)}
              </select>
              <button type="button" className={btnWarn} disabled={disabled} onClick={() => commit(() => removeManhuaActionEvent(plan, shot.shotId, e.eventId))}>删</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-1 text-[11px] text-white/50">本镜还没有动作事件。</p>
      )}

      {/* 加事件 */}
      <div className="mb-1 flex flex-wrap items-center gap-1 text-[11px]" data-add-event>
        <select className={field} value={draft.kind} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as ManhuaActionEvent["kind"] }))}>
          {(Object.keys(KIND_ZH) as ManhuaActionEvent["kind"][]).map((k) => <option key={k} value={k}>{KIND_ZH[k]}</option>)}
        </select>
        <select className={field} value={draft.actorId} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, actorId: e.target.value }))}>
          {actors.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        {NEEDS_COUNTERPART.includes(draft.kind) || draft.kind === "observe" || draft.kind === "disengage" ? (
          <select className={field} value={draft.counterpartActorId ?? ""} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, counterpartActorId: e.target.value || undefined }))}>
            <option value="">{NEEDS_COUNTERPART.includes(draft.kind) ? "对手…" : "对象（可空）"}</option>
            {actors.filter((a) => a.id !== draft.actorId).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        ) : null}
        <label>起 <input className={`${field} w-14`} type="number" step="0.1" min={0} value={draft.startSec} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, startSec: num(e.target.value) }))} /></label>
        <label>起手 <input className={`${field} w-14`} type="number" step="0.1" min={0} value={draft.windupSec} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, windupSec: num(e.target.value) }))} /></label>
        <label>接触 <input className={`${field} w-14`} type="number" step="0.1" min={0} value={draft.contactSec} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, contactSec: num(e.target.value) }))} /></label>
        <label>卸力 <input className={`${field} w-14`} type="number" step="0.1" min={0} value={draft.recoverSec} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, recoverSec: num(e.target.value) }))} /></label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={Boolean(draft.slowMotionIntent)} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, slowMotionIntent: e.target.checked }))} />慢看</label>
        {CAN_LAND.includes(draft.kind) ? (
          landingOptions.length ? (
            <select className={field} value={landingIdx} disabled={disabled} onChange={(e) => setLandingIdx(Number(e.target.value))}>
              {landingOptions.map((o, i) => <option key={o.landing.landingId} value={i}>落点 {o.landing.landingId}{o.landing.surfaceZh ? `（${o.landing.surfaceZh}）` : ""}{o.resolved.point.space !== "world" ? " · 仅2D" : ""}</option>)}
            </select>
          ) : (
            <span className="text-amber-100">{draft.kind === "land" ? "本镜导演板还没有落点，先去导演板标落点" : "无落点（可不绑）"}</span>
          )
        ) : null}
        <button
          type="button"
          className={btn}
          disabled={disabled || !draft.actorId}
          onClick={() =>
            commit(() =>
              addManhuaActionEvent(plan, shot.shotId, {
                ...draft,
                landing: CAN_LAND.includes(draft.kind) ? landingOptions[landingIdx]?.landing : undefined,
              }),
            )
          }
        >
          加事件
        </button>
      </div>

      {/* 慢看段：镜头层 timeMap，与常速交锋分开 */}
      <div className="flex flex-wrap items-center gap-1 text-[11px]" data-slow-span>
        <span className="text-white/70">腾空慢看段（源秒）</span>
        <input className={`${field} w-14`} type="number" step="0.1" min={0} max={shot.timeMap.sourceDurationSec} value={slowDraft.start} disabled={disabled} onChange={(e) => setSlowDraft((s) => ({ ...s, start: num(e.target.value) }))} />
        <span>→</span>
        <input className={`${field} w-14`} type="number" step="0.1" min={0} max={shot.timeMap.sourceDurationSec} value={slowDraft.end} disabled={disabled} onChange={(e) => setSlowDraft((s) => ({ ...s, end: num(e.target.value) }))} />
        <span>速率</span>
        <input className={`${field} w-14`} type="number" step="0.05" min={0.05} max={8} value={slowDraft.rate} disabled={disabled} onChange={(e) => setSlowDraft((s) => ({ ...s, rate: num(e.target.value) || 0.5 }))} />
        <button type="button" className={btn} disabled={disabled || slowDraft.end <= slowDraft.start} onClick={() => commit(() => setManhuaShotSlowSpan(plan, shot.shotId, { sourceStartSec: slowDraft.start, sourceEndSec: slowDraft.end, rate: slowDraft.rate }))}>设慢看</button>
        {slow ? <button type="button" className={btnWarn} disabled={disabled} onClick={() => commit(() => setManhuaShotSlowSpan(plan, shot.shotId, null))}>清慢看</button> : null}
        {slow ? <span className="text-white/60">当前 {slow.sourceStartSec}–{slow.sourceEndSec}s ×{slow.rate}</span> : null}
      </div>
    </div>
  );
}
