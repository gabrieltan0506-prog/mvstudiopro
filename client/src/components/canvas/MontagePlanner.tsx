import { importWorkflowVideoSource } from "@/lib/videoUpscaleApi";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { maskMediaProviderDetails } from "@/lib/maskMediaUrls";
import { manhuaVfxMediaIdentity } from "@/lib/manhuaVfxWorkflow";
import { MontageGradeAdvice } from "./MontageGradeAdvice";
import {
  parseMontagePlan,
  remapMontageSubtitles,
  type MontagePlan,
} from "@shared/montagePlan";
import type { ManhuaCreativeAdvisorContext } from "@shared/manhuaCreativeAdvisor";
import type { AdvisorEditControl, AdvisorEditRegistration } from "@/lib/manhuaAdvisorWorkflowControl";
import {
  MONTAGE_FINISH_ADVISOR_HELP,
  MONTAGE_GRADE_SLIDERS,
  MONTAGE_LUT_GROUPS,
  MONTAGE_TRANSITION_LABELS,
  MONTAGE_TRANSITION_RANGE,
  MONTAGE_CROSSFADE_RANGE,
  addMontageSegment,
  applyAdvisorMontageFinish,
  applyMontageSegmentsDraft,
  checkMontageSegments,
  montageFinishParams,
  montageOutputSec,
  montageTransitionBlockReason,
  patchMontageGradeAll,
  patchMontageSegment,
  readMontageFinish,
  readMontageFinishes,
  montageFinishKey,
  readMontageJunctionCheck,
  removeMontageSegment,
  setMontageAutoMatch,
  setMontageCrossfade,
  type ColorCorrection,
  type MontageGrade,
  type MontageFinish,
  type MontageSliderKey,
  type MontageTransitionKind,
} from "@/lib/montageFinish";

type Props = {
  clips: Array<{ id: string; url: string; label: string }>;
  context?: ManhuaCreativeAdvisorContext;
  story: string;
  storage: Storage;
  storageKey: string;
  busy: boolean;
  beforeSubmit?: () => Promise<void>;
  onSourceChange?: (id: string) => void;
  /** 顾问剪辑控件：episode=方案序号，shotIndex=切点序号（均从1起）；只改草稿，不提交合成。 */
  onAdvisorEditControl?: AdvisorEditRegistration;
  onSubmit: (
    params: {
      clips: string[];
      trims: Array<{ startSec: number; endSec: number }>;
      width: number;
      height: number;
      fps: number;
      subtitleSrt?: string;
      transition?: { kind: "fade" | "dissolve" | "wipeleft"; durationSec: number };
      grade?: MontageGrade;
    },
    title: string
  ) => Promise<unknown>;
  /** 已完成的拼接任务结果（含 gradeSegmentCheck 接点检查），只读展示；同名方案的成片供调色建议分析。 */
  concatResults?: Array<{ jobId: string; title?: string; output: unknown }>;
};
type Saved = {
  sourceId: string;
  sourceIdentity: string;
  analysisSourceUri?: string;
  target: number;
  aspect: "9:16" | "16:9";
  answer: string;
  /** 采用时可选的调色与转场：每个剪辑方案各存一份（键见 montageFinishKey）；只存草稿，点采用才随合成提交 */
  finishes?: Record<string, MontageFinish>;
  /** 旧版全方案共用的一份草稿：仅保留可读，不再套用到任何方案 */
  finish?: MontageFinish;
  pending?: Parameters<
    ReturnType<
      typeof trpc.mvAnalysis.askPlatformSkillQa.useMutation
    >["mutateAsync"]
  >[0];
};

const transitionOverlap = (f: MontageFinish) => (f.transition && f.transition.kind !== "none" ? f.transition.durationSec : 0);

/** 原片→完整音画顾问→可审方案→既有后期队列；保存到所属项目的原存储适配器。 */
export function MontagePlanner(props: Props) {
  const [initial] = useState(() => {
    try {
      const value = JSON.parse(
        props.storage.getItem(props.storageKey) || "null"
      ) as Saved | null;
      if (
        value !== null &&
        (typeof value !== "object" ||
          Array.isArray(value) ||
          typeof value.sourceId !== "string" ||
          typeof value.sourceIdentity !== "string" ||
          typeof value.answer !== "string" ||
          !Number.isFinite(value.target) ||
          !["9:16", "16:9"].includes(value.aspect) ||
          readMontageFinish(value.finish) === null ||
          readMontageFinishes(value.finishes) === null ||
          (value.pending &&
            (typeof value.pending.requestId !== "string" ||
              !value.pending.manhuaContext?.subtitleReview)))
      )
        throw new Error("草稿格式错误");
      return { value, error: "" };
    } catch {
      return {
        value: null,
        error: "剪辑方案草稿无法读取，原记录保留，请先恢复项目",
      };
    }
  });
  const [saved, setSaved] = useState<Saved>(
    initial.value || {
      sourceId: "",
      sourceIdentity: "",
      target: 30,
      aspect: "9:16",
      answer: "",
    }
  );
  const [error, setError] = useState(initial.error);
  const [working, setWorking] = useState(false),
    [paid, setPaid] = useState(false);
  const gate = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const live = useRef(saved);
  live.current = saved;
  const advisor = trpc.mvAnalysis.askPlatformSkillQa.useMutation({
    retry: false,
  });
  const quota = trpc.mvAnalysis.getManhuaAdvisorQuota.useQuery(
    props.context?.projectId
      ? { projectId: props.context.projectId }
      : undefined,
    { enabled: Boolean(props.context), retry: false }
  );
  const source = props.clips.find(c => c.id === saved.sourceId);
  const stale = Boolean(
    source && saved.sourceIdentity !== manhuaVfxMediaIdentity(source.url)
  );
  const locked = props.busy || working || Boolean(initial.error);
  const save = (value: Saved) => {
    if (!mounted.current) throw new Error("原工作区已关闭，原请求保留供恢复");
    props.storage.setItem(props.storageKey, JSON.stringify(value));
    live.current = value;
    setSaved(value);
  };
  function update(value: Partial<Saved>) {
    try {
      save({ ...live.current, ...value });
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  let plan: MontagePlan | undefined,
    parseError = "";
  if (saved.answer)
    try {
      plan = parseMontagePlan(saved.answer);
    } catch {
      parseError =
        "方案格式或时间码未通过校验，请核对报告后修正，不能提交剪辑。";
    }
  const [finishPlanRaw, setFinishPlan] = useState(0);
  const finishPlan = plan && finishPlanRaw < plan.plans.length ? finishPlanRaw : 0;
  const finishKeyOf = (i: number) => (plan?.plans[i] ? montageFinishKey(i, plan.plans[i].title) : "");
  const finishOf = (i: number): MontageFinish => live.current.finishes?.[finishKeyOf(i)] ?? {};
  const finish = saved.finishes?.[finishKeyOf(finishPlan)] ?? {};
  const setFinish = (i: number, next: MontageFinish) => ({ finishes: { ...(live.current.finishes ?? {}), [finishKeyOf(i)]: next } });
  const gradeAll: ColorCorrection = finish.grade?.all ?? {};
  const transition = finish.transition ?? { kind: "none" as MontageTransitionKind, durationSec: MONTAGE_TRANSITION_RANGE.default };
  const setGrade = (patch: Partial<ColorCorrection>) =>
    update(setFinish(finishPlan, { ...finish, grade: patchMontageGradeAll(finish.grade, patch) }));
  const setSegGrade = (grade: MontageGrade | undefined) => update(setFinish(finishPlan, { ...finish, grade }));
  const activeCuts = plan?.plans[finishPlan]?.cuts ?? [];
  const activeSubtitled = Boolean(plan && activeCuts.length && remapMontageSubtitles(plan.sourceSrt, activeCuts));
  const outputSec = montageOutputSec(activeCuts, finish, activeSubtitled);
  const segments = finish.grade?.segments ?? [];
  const segmentProblem = checkMontageSegments(segments, outputSec, finish.grade?.crossfadeSec ?? 0);
  const activeTitle = plan?.plans[finishPlan]?.title;
  const adviceVideo = (props.concatResults ?? [])
    .filter(r => r.title === activeTitle)
    .map(r => (r.output && typeof r.output === "object" ? (r.output as { gcsUri?: unknown }).gcsUri : undefined))
    .find((u): u is string => typeof u === "string" && u.startsWith("gs://"));
  const seamSecs = activeCuts.slice(0, -1).reduce<number[]>((acc, c, k) => {
    const overlap = outputSec < activeCuts.reduce((n, x) => n + x.endSec - x.startSec, 0) - 1e-6 ? transitionOverlap(finish) : 0;
    acc.push(Math.round(((acc[k - 1] ?? 0) + c.endSec - c.startSec - overlap) * 10) / 10);
    return acc;
  }, []);
  const junctionChecks = (props.concatResults ?? []).flatMap(j => {
    const check = readMontageJunctionCheck(j.output);
    return check ? [{ ...j, check }] : [];
  });
  const sliderKeys = Object.keys(MONTAGE_GRADE_SLIDERS) as MontageSliderKey[];
  const advisorExtras = [
    ...Object.keys(gradeAll).filter(k => k !== "lutId" && !sliderKeys.includes(k as MontageSliderKey)),
    ...(finish.grade?.clips ? [`逐段${finish.grade.clips.length}项`] : []),
    ...(finish.grade?.referenceClipIndex != null ? [`代表镜头第${finish.grade.referenceClipIndex + 1}段`] : []),
  ];
  const blockReasons = plan?.plans.map(p => montageTransitionBlockReason(p.cuts.length, Boolean(remapMontageSubtitles(plan!.sourceSrt, p.cuts)))) ?? [];
  const transitionLocked = Boolean(blockReasons[finishPlan]);
  const advisorEditControl = useRef<AdvisorEditControl | null>(null);
  advisorEditControl.current = async (action, signal) => {
    signal.throwIfAborted();
    const selected = plan?.plans[action.episode - 1];
    if (!plan || !selected) throw new Error("请先选定有效剪辑方案再读取切点");
    const subtitled = Boolean(remapMontageSubtitles(plan.sourceSrt, selected.cuts));
    if (action.operation === "inspect") return JSON.stringify({ plan: action.episode, title: selected.title, cuts: selected.cuts.map((c, i) => ({ shotIndex: i + 1, startSec: c.startSec, endSec: c.endSec })), sourceDurationSec: plan.sourceDurationSec, busy: locked || Boolean(saved.pending) || stale,
      finish: finishOf(action.episode - 1), outputSec: montageOutputSec(selected.cuts, finishOf(action.episode - 1), subtitled), lutOptions: MONTAGE_LUT_GROUPS, transitionBlocked: montageTransitionBlockReason(selected.cuts.length, subtitled) || undefined, finishHelp: MONTAGE_FINISH_ADVISOR_HELP });
    if (locked || saved.pending || stale) throw new Error("剪辑方案正在处理或原片已变化，未改动");
    // 调色/转场：按方案各存一份；逐段调色项数写入时即核对本方案切点数。
    const finishAction = action as unknown as { operation: string; transition?: unknown; transitionSettings?: unknown; grade?: unknown };
    if (finishAction.operation === "transition" || finishAction.operation === "grade") {
      const next = applyAdvisorMontageFinish(finishOf(action.episode - 1), finishAction, selected.cuts.length);
      const blocked = next.transition && next.transition.kind !== "none" ? montageTransitionBlockReason(selected.cuts.length, subtitled) : "";
      if (blocked) throw new Error(`${blocked}，未改动`);
      // 分段/逐段与采用时同一套校验，不通过不写草稿
      montageFinishParams(next, selected.cuts.length, subtitled, montageOutputSec(selected.cuts, next, subtitled));
      if (!window.confirm("确认将顾问的调色/转场建议填入剪辑方案草稿？此步不合成，仍需手动采用。")) throw new Error("用户未确认调色或转场改动");
      signal.throwIfAborted();
      save({ ...live.current, ...setFinish(action.episode - 1, next) });
      setError("");
      return JSON.stringify({ status: "saved", plan: action.episode, operation: finishAction.operation, finish: next, note: "已写入草稿，尚未合成" });
    }
    const cuts = [...selected.cuts];
    if (action.operation === "reorder") {
      if (!action.order || action.order.length !== cuts.length || new Set(action.order).size !== cuts.length || action.order.some(n => n < 1 || n > cuts.length)) throw new Error("顺序必须包含本方案全部切点且不得重复");
      cuts.splice(0, cuts.length, ...action.order.map(n => selected.cuts[n - 1]));
    } else if (action.operation === "trim") {
      const i = (action.shotIndex ?? 0) - 1, tenth = (v: number) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9;
      if (!cuts[i] || action.inSec == null || action.outSec == null || !tenth(action.inSec) || !tenth(action.outSec)) throw new Error("切点进出点须为一位小数秒，且切点须存在");
      cuts[i] = { ...cuts[i], startSec: action.inSec, endSec: action.outSec };
    } else throw new Error("不支持的剪辑操作，未改动");
    const next = JSON.stringify({ ...plan, plans: plan.plans.map((p, i) => (i === action.episode - 1 ? { ...p, cuts } : p)) });
    try { parseMontagePlan(next); } catch { throw new Error("改动后切点未通过方案校验（须在原片内、按原片时间递增且不重叠），未改动"); }
    if (!window.confirm("确认将本次剪辑建议保存到当前方案草稿？原片保留，仍需手动采用。")) throw new Error("用户未确认剪辑改动");
    signal.throwIfAborted();
    save({ ...live.current, answer: next });
    setError("");
    return JSON.stringify({ status: "saved", plan: action.episode, operation: action.operation });
  };
  useEffect(() => {
    const register = props.onAdvisorEditControl;
    register?.((action, signal) => {
      if (!advisorEditControl.current) throw new Error("剪辑方案尚未就绪");
      return advisorEditControl.current(action, signal);
    });
    return () => register?.(null);
  }, [props.onAdvisorEditControl]);
  async function ask(confirmPaid = false) {
    if (
      !props.context ||
      !source ||
      gate.current ||
      locked ||
      stale ||
      !Number.isInteger(saved.target) ||
      saved.target < 5 ||
      saved.target > 300
    )
      return;
    gate.current = true;
    setWorking(true);
    setError("");
    try {
      const videoUri =
        saved.pending?.manhuaContext?.subtitleReview?.videoUri ??
        (source.url.startsWith("https://d2h7xmz5gqybh9.cloudfront.net/")
          ? await importWorkflowVideoSource(source.url)
          : source.url);
      if (!mounted.current) return;
      const request = saved.pending ?? {
        requestId: crypto.randomUUID(),
        question: "完整观看原片，提出情绪、揭示时机与音乐变化驱动的剪辑方案",
        rawQuestion: "成片剪辑方案",
        manhuaContext: {
          ...props.context,
          bgmMix: undefined,
          filmReview: undefined,
          previsEdit: undefined,
          worldTarget: undefined,
          studio3d: undefined,
          subtitleReview: {
            videoUri,
            dialogue:
              props.story || "无已确认对白；仅据真实音画分析，不生成字幕。",
            montageTargetSec: saved.target,
          },
        },
      };
      save({ ...saved, pending: request });
      await props.beforeSubmit?.();
      if (!mounted.current) return;
      const result = await advisor.mutateAsync({
        ...request,
        ...(confirmPaid
          ? { confirmPaid: true, confirmedCredits: quota.data?.price }
          : {}),
      });
      if (!mounted.current) return;
      parseMontagePlan(result.answer);
      save({
        ...live.current,
        answer: result.answer,
        analysisSourceUri: videoUri,
        pending: undefined,
      });
      setPaid(false);
      await props.beforeSubmit?.();
    } catch (e) {
      if (!mounted.current) return;
      const message = e instanceof Error ? e.message : String(e);
      setError(maskMediaProviderDetails(message));
      // 已明确拒绝的输入可修改；网络/超时结果不明时保留原编号恢复，不能自动重投。
      const code = (e as { data?: { code?: string } })?.data?.code;
      if (
        !message.includes("REFUND_PENDING") &&
        (message.includes("ADVISOR_OPERATION_FAILED") ||
          ["BAD_REQUEST", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(
            code || ""
          ))
      )
        save({ ...live.current, pending: undefined });
      if (/PAYMENT_REQUIRED|免费.*用完|请确认后重试/.test(message))
        setPaid(true);
    } finally {
      gate.current = false;
      setWorking(false);
    }
  }
  async function render(index: number) {
    if (gate.current || locked || !plan || !source || stale) return;
    gate.current = true;
    setWorking(true);
    setError("");
    try {
      const selected = plan.plans[index];
      const subtitleSrt = remapMontageSubtitles(plan.sourceSrt, selected.cuts);
      const chosen = finishOf(index);
      const finishParams = montageFinishParams(chosen, selected.cuts.length, Boolean(subtitleSrt), montageOutputSec(selected.cuts, chosen, Boolean(subtitleSrt)));
      const [width, height] =
        saved.aspect === "9:16" ? [720, 1280] : [1280, 720];
      await props.onSubmit(
        {
          clips: selected.cuts.map(() => saved.analysisSourceUri || source.url),
          trims: selected.cuts.map(c => ({
            startSec: c.startSec,
            endSec: c.endSec,
          })),
          width,
          height,
          fps: 30,
          ...(subtitleSrt ? { subtitleSrt } : {}),
          ...finishParams,
        },
        selected.title
      );
    } catch (e) {
      setError(
        maskMediaProviderDetails(e instanceof Error ? e.message : String(e))
      );
    } finally {
      gate.current = false;
      setWorking(false);
    }
  }
  return (
    <section
      className="my-3 space-y-3 rounded-xl border border-cyan-300/20 p-3"
      aria-label="剪辑方案工坊"
    >
      <h3 className="text-sm font-semibold">预告与短片 · 剪辑方案</h3>
      <p className="text-xs text-white/60">
        完整音画顾问根据原片提出候选；先审时间码和理由，再生成。保留原声与必要停顿，不自动避让音乐。竖横画幅等比补边。
      </p>
      <label className="block text-xs">
        原片
        <select
          aria-label="剪辑方案原片"
          disabled={locked || Boolean(saved.pending)}
          value={saved.sourceId}
          onChange={e => {
            const c = props.clips.find(c => c.id === e.target.value);
            update({
              sourceId: e.target.value,
              sourceIdentity: c ? manhuaVfxMediaIdentity(c.url) : "",
              answer: "",
              analysisSourceUri: undefined,
            });
            props.onSourceChange?.(e.target.value);
          }}
          className="ml-2 max-w-full rounded bg-slate-900 p-2"
        >
          <option value="">选择本项目成片</option>
          {props.clips.map(c => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        目标秒数{" "}
        <input
          aria-label="剪辑目标秒数"
          type="number"
          min={5}
          max={300}
          disabled={locked || Boolean(saved.pending)}
          value={saved.target}
          onChange={e => update({ target: Number(e.target.value), answer: "" })}
          className="w-16 rounded bg-slate-900 p-1"
        />
      </label>
      <select
        aria-label="短片画幅"
        disabled={locked}
        value={saved.aspect}
        onChange={e => update({ aspect: e.target.value as Saved["aspect"] })}
        className="ml-2 rounded bg-slate-900 p-1"
      >
        <option value="9:16">竖屏9:16</option>
        <option value="16:9">横屏16:9</option>
      </select>
      {stale && <p role="alert">原片版本已变化，请重新选择素材并分析。</p>}
      <div>
        <button
          type="button"
          disabled={
            locked ||
            !source ||
            !props.context ||
            stale ||
            !Number.isInteger(saved.target) ||
            saved.target < 5 ||
            saved.target > 300
          }
          onClick={() => void ask()}
          className="rounded border px-3 py-2 text-xs disabled:opacity-40"
        >
          {working
            ? "处理中…"
            : saved.pending
              ? "恢复原咨询"
              : "分析原片并提出方案"}
        </button>
        <span className="ml-2 text-xs text-white/60">
          沿用创作顾问配额；付费时另确认。剪辑不调用生成模型，使用现有转码资源。
        </span>
      </div>
      {paid && (
        <button
          type="button"
          disabled={locked || !quota.data}
          onClick={() => void ask(true)}
          className="text-xs underline"
        >
          确认按顾问报价 {quota.data?.price} 积分咨询
        </button>
      )}
      <details>
        <summary className="cursor-pointer text-xs">
          导入或修正已核对的方案
        </summary>
        <p className="text-xs text-white/60">
          仅导入与所选原片对应的完整方案JSON；不是自动读片结果。
        </p>
        <textarea
          aria-label="剪辑方案JSON"
          disabled={locked || Boolean(saved.pending) || !source}
          value={saved.answer}
          onChange={e => update({ answer: e.target.value })}
          className="mt-2 h-32 w-full rounded bg-slate-900 p-2 text-xs"
        />
      </details>
      {(error || parseError) && (
        <p role="alert" className="text-xs text-red-300">
          {error || parseError}
        </p>
      )}
      {plan && (
        <>
          <p className="whitespace-pre-wrap text-xs">{plan.summary}</p>
          {plan.uncertainties.length > 0 && (
            <p className="text-xs text-amber-200">
              需人工核对：{plan.uncertainties.join("；")}
            </p>
          )}
          <fieldset className="space-y-2 rounded border border-white/15 p-2 text-xs" aria-label="调色与转场">
            <legend className="px-1">调色与转场（可选，每个方案各存一份，采用时随该版合成）</legend>
            {plan.plans.length > 1 && (
              <label className="block">
                设置方案
                <select
                  aria-label="调色转场所属方案"
                  disabled={locked}
                  value={finishPlan}
                  onChange={e => setFinishPlan(Number(e.target.value))}
                  className="ml-2 rounded bg-slate-900 p-1"
                >
                  {plan.plans.map((p, i) => (
                    <option key={i} value={i}>
                      {i + 1}. {p.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              调色预设
              <select
                aria-label="调色预设"
                disabled={locked}
                value={gradeAll.lutId ?? ""}
                onChange={e => setGrade({ lutId: e.target.value || undefined })}
                className="ml-2 rounded bg-slate-900 p-1"
              >
                <option value="">不套用预设</option>
                {MONTAGE_LUT_GROUPS.map(g => (
                  <optgroup key={g.label} label={g.label}>
                    {g.presets.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="ml-2 text-white/60">强度选「轻 / 标准」两档</span>
            </label>
            {sliderKeys.map(key => {
              const r = MONTAGE_GRADE_SLIDERS[key];
              const value = gradeAll[key] ?? r.neutral;
              return (
                <label key={key} className="block">
                  {r.label} {key === "color_temperature" ? `${value}K（低暖高冷）` : value.toFixed(2)}
                  <input
                    aria-label={r.label}
                    type="range"
                    min={r.min}
                    max={r.max}
                    step={r.step}
                    disabled={locked}
                    value={value}
                    onChange={e => setGrade({ [key]: Number(e.target.value) })}
                    className="ml-2 align-middle"
                  />
                </label>
              );
            })}
            {advisorExtras.length > 0 && (
              <p className="text-white/60">顾问另设：{advisorExtras.join("、")}</p>
            )}
            <button
              type="button"
              disabled={locked || !finish.grade}
              onClick={() => update(setFinish(finishPlan, { ...finish, grade: undefined }))}
              className="text-xs underline disabled:opacity-40"
            >
              还原原片色彩
            </button>
            <div className="space-y-1 rounded border border-white/10 p-2" aria-label="分段调色">
              <div>
                分段调色（成片约{outputSec.toFixed(1)}秒，不分段即全片统一）
                <button
                  type="button"
                  aria-label="添加调色分段"
                  disabled={locked || outputSec < 0.2 || segments.length >= 24 || Boolean(finish.grade?.clips || finish.grade?.referenceClipIndex != null)}
                  onClick={() => setSegGrade(addMontageSegment(finish.grade, outputSec))}
                  className="ml-2 underline disabled:opacity-40"
                >
                  添加分段
                </button>
              </div>
              {segments.map((seg, i) => {
                const n = i + 1;
                const num = (key: "startSec" | "endSec", label: string, min: number, max: number, v: number) => (
                  <label className="mr-2">
                    {label}
                    <input
                      aria-label={`第${n}段${label}`}
                      type="number"
                      min={min}
                      max={max}
                      step={0.1}
                      disabled={locked}
                      value={v}
                      onChange={e => {
                        const x = Number(e.target.value);
                        if (Number.isFinite(x) && x >= min && x <= max) setSegGrade(patchMontageSegment(finish.grade, i, { [key]: Math.round(x * 10) / 10 }));
                      }}
                      className="ml-1 w-16 rounded bg-slate-900 p-1"
                    />
                  </label>
                );
                return (
                  <div key={i} className="space-y-1 border-t border-white/10 pt-1">
                    <div>
                      第{n}段 {num("startSec", "开始秒", 0, outputSec, seg.startSec)}
                      {num("endSec", "结束秒", 0, outputSec, seg.endSec)}
                      <button type="button" aria-label={`删除第${n}段`} disabled={locked} onClick={() => setSegGrade(removeMontageSegment(finish.grade, i))} className="underline disabled:opacity-40">
                        删除
                      </button>
                    </div>
                    <select
                      aria-label={`第${n}段调色预设`}
                      disabled={locked}
                      value={seg.lutId ?? ""}
                      onChange={e => setSegGrade(patchMontageSegment(finish.grade, i, { lutId: e.target.value || undefined }))}
                      className="rounded bg-slate-900 p-1"
                    >
                      <option value="">不套用预设</option>
                      {MONTAGE_LUT_GROUPS.map(g => (
                        <optgroup key={g.label} label={g.label}>
                          {g.presets.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {sliderKeys.map(key => {
                      const r = MONTAGE_GRADE_SLIDERS[key];
                      const value = seg[key] ?? r.neutral;
                      return (
                        <label key={key} className="block">
                          {r.label} {key === "color_temperature" ? `${value}K` : value.toFixed(2)}
                          <input
                            aria-label={`第${n}段${r.label}`}
                            type="range"
                            min={r.min}
                            max={r.max}
                            step={r.step}
                            disabled={locked}
                            value={value}
                            onChange={e => setSegGrade(patchMontageSegment(finish.grade, i, { [key]: Number(e.target.value) }))}
                            className="ml-2 align-middle"
                          />
                        </label>
                      );
                    })}
                  </div>
                );
              })}
              {segments.length > 0 && segmentProblem && (
                <p aria-label="分段校验" className="text-amber-200">
                  {segmentProblem}，采用前请修正
                </p>
              )}
              {adviceVideo && (
                <MontageGradeAdvice
                  videoGsUri={adviceVideo}
                  durationSec={outputSec}
                  aspect={saved.aspect}
                  storyZh={props.story}
                  seamSecs={seamSecs}
                  disabled={locked}
                  onApply={segs => {
                    try {
                      setSegGrade(applyMontageSegmentsDraft(finish.grade, segs, outputSec));
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                />
              )}
              <label className="block">
                段间过渡秒数
                <input
                  aria-label="段间过渡秒数"
                  type="number"
                  min={MONTAGE_CROSSFADE_RANGE.min}
                  max={MONTAGE_CROSSFADE_RANGE.max}
                  step={MONTAGE_CROSSFADE_RANGE.step}
                  disabled={locked || segments.length < 2}
                  value={finish.grade?.crossfadeSec ?? 0}
                  onChange={e => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= MONTAGE_CROSSFADE_RANGE.min && v <= MONTAGE_CROSSFADE_RANGE.max) setSegGrade(setMontageCrossfade(finish.grade, v));
                  }}
                  className="ml-2 w-16 rounded bg-slate-900 p-1"
                />
                秒（0 为硬切）
              </label>
              <label className="block">
                <input
                  aria-label="自动修正接点"
                  type="checkbox"
                  disabled={locked || segments.length < 2}
                  checked={Boolean(finish.grade?.autoMatchJunctions)}
                  onChange={e => setSegGrade(setMontageAutoMatch(finish.grade, e.target.checked))}
                  className="mr-1 align-middle"
                />
                自动修正接点（接点前后色差超标时自动拉齐）
              </label>
            </div>
            <label className="block">
              镜头转场
              <select
                aria-label="镜头转场"
                disabled={locked || transitionLocked}
                value={transitionLocked ? "none" : transition.kind}
                onChange={e => update(setFinish(finishPlan, { ...finish, transition: { ...transition, kind: e.target.value as MontageTransitionKind } }))}
                className="ml-2 rounded bg-slate-900 p-1"
              >
                {(Object.keys(MONTAGE_TRANSITION_LABELS) as MontageTransitionKind[]).map(k => (
                  <option key={k} value={k}>
                    {MONTAGE_TRANSITION_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              转场时长
              <input
                aria-label="转场时长"
                type="number"
                min={MONTAGE_TRANSITION_RANGE.min}
                max={MONTAGE_TRANSITION_RANGE.max}
                step={MONTAGE_TRANSITION_RANGE.step}
                disabled={locked || transitionLocked || transition.kind === "none"}
                value={transition.durationSec}
                onChange={e => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= MONTAGE_TRANSITION_RANGE.min && v <= MONTAGE_TRANSITION_RANGE.max)
                    update(setFinish(finishPlan, { ...finish, transition: { ...transition, durationSec: Math.round(v * 10) / 10 } }));
                }}
                className="ml-2 w-16 rounded bg-slate-900 p-1"
              />
              秒
            </label>
            {transitionLocked && <p className="text-amber-200">{blockReasons[finishPlan]}</p>}
            {!transitionLocked && transition.kind !== "none" && (
              <p className="text-white/60">重叠转场会让成片略短于方案时长。</p>
            )}
          </fieldset>
          {plan.plans.map((p, i) => (
            <article
              key={i}
              className="space-y-2 rounded border border-white/15 p-2"
            >
              <strong className="text-sm">
                {p.title} ·{" "}
                {p.cuts
                  .reduce((n, c) => n + c.endSec - c.startSec, 0)
                  .toFixed(1)}
                秒
              </strong>
              <p className="text-xs">{p.rationale}</p>
              <ol className="space-y-1 text-xs">
                {p.cuts.map((c, j) => (
                  <li key={j}>
                    {c.startSec.toFixed(2)}–{c.endSec.toFixed(2)}秒：{c.reason}
                    <br />
                    依据：{c.evidence}
                  </li>
                ))}
              </ol>
              <p className="text-xs text-white/60">
                输出{saved.aspect}，保留原声；
                {plan.sourceSrt
                  ? "对白字幕按完整句同步重排"
                  : "没有可用对白字幕，不添加字幕"}
                。原片保留，结果回到本项目后期任务。
              </p>
              {(saved.finishes?.[finishKeyOf(i)]?.transition?.kind ?? "none") !== "none" && blockReasons[i] && (
                <p className="text-xs text-amber-200">{blockReasons[i]}，本版不加转场。</p>
              )}
              <button
                type="button"
                disabled={locked || stale || !source || Boolean(saved.pending)}
                onClick={() => void render(i)}
                className="rounded border px-3 py-2 text-xs disabled:opacity-40"
              >
                采用并生成此版
              </button>
            </article>
          ))}
          {junctionChecks.length > 0 && (
            <section aria-label="接点检查结果" className="space-y-1 rounded border border-white/15 p-2 text-xs">
              <strong>成片接点色彩检查</strong>
              {junctionChecks.map(j => (
                <div key={j.jobId}>
                  <p>
                    {j.title || "成片"}：{j.check.pass ? "全部接点达标" : "有接点未达标"}
                  </p>
                  <ul>
                    {j.check.junctions.map((x, k) => (
                      <li key={k} aria-label={`接点${k + 1}`}>
                        {x.atSec.toFixed(1)}秒 · 亮度差{x.delta.YAVG} · 蓝色差{x.delta.UAVG} · 红色差{x.delta.VAVG} · 饱和差{x.delta.SATAVG} ·{" "}
                        {x.pass ? "达标" : "未达标"}
                        {x.autoCorrected ? " · 已自动修正" : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
          <details>
            <summary className="text-xs">参考结构与差异化创作方向</summary>
            {plan.creativeDirections.map((d, i) => (
              <article key={i} className="my-2 text-xs">
                <strong>{d.title}</strong>
                <p>参考依据：{d.evidence}</p>
                <p>新的表达：{d.difference}</p>
              </article>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
