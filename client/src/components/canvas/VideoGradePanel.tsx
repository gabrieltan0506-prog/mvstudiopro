import { useRef, useState, type MutableRefObject } from "react";
import { MontageGradeAdvice, type MontageGradeAdviceTrigger } from "./MontageGradeAdvice";
import { RangeTrack, type RangeTrackMarker } from "./RangeTrack";
import {
  MONTAGE_CROSSFADE_RANGE,
  MONTAGE_GRADE_SLIDERS,
  MONTAGE_JUNCTION_KIND_ORDER,
  MONTAGE_LUT_GROUPS,
  MONTAGE_SEGMENT_MAX,
  addMontageSegment,
  applyMontageSegmentsDraft,
  checkMontageSegments,
  describeMontageJunction,
  patchMontageGradeAll,
  patchMontageSegment,
  readMontageJunctionCheck,
  removeMontageSegment,
  setMontageAutoMatch,
  setMontageCrossfade,
  type ColorCorrection,
  type MontageGrade,
  type MontageGradeSegment,
  type MontageJunctionKind,
  type MontageSliderKey,
} from "@/lib/montageFinish";

export type VideoGradeJunctionResult = { jobId: string; title?: string; output: unknown };

export type VideoGradePanelProps = {
  /** 调色草稿（受控）；undefined = 原片色彩。 */
  value: MontageGrade | undefined;
  /** 每次改动回传整份新草稿；回到中性/还原时为 undefined。只改草稿，不提交。 */
  onChange: (next: MontageGrade | undefined) => void;
  /** 成片秒数（分段编辑、分段校验与调色建议用）。 */
  outputSec: number;
  disabled?: boolean;
  /** 已出成片的 gs://；拿得到才显示「AI 调色建议」。 */
  adviceVideoGsUri?: string;
  adviceAspect?: "9:16" | "16:9" | "1:1";
  storyZh?: string;
  /** 素材拼接接点秒位（单片无接点可不传）。 */
  seamSecs?: number[];
  /** 已知转场（atSec = 转场中点，成片绝对秒）；未知不传。 */
  transitions?: Array<{ atSec: number; durationSec: number }>;
  /** 套用建议失败等错误；不传则在面板内显示。 */
  onError?: (message: string) => void;
  /** 后期任务结果（含 gradeSegmentCheck）；传入即在面板末尾展示接点检查。 */
  junctionResults?: VideoGradeJunctionResult[];
  debugMode?: boolean;
  /** 顾问 gradeAdvice 触发口：转给 MontageGradeAdvice.triggerRef（同一调用与费用确认）。 */
  adviceTriggerRef?: MutableRefObject<MontageGradeAdviceTrigger | null>;
};

function LutOptions() {
  return (
    <>
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
    </>
  );
}

const SLIDER_KEYS = Object.keys(MONTAGE_GRADE_SLIDERS) as MontageSliderKey[];
const INTENT_ZH = { intended: "剧情需要", unwanted: "不该跳" } as const;

/** 分段草稿 → 时间轴标记：每个接点（第2段起的起点）标出已知意图。 */
export function montageIntentMarkers(segments: ReadonlyArray<Pick<MontageGradeSegment, "startSec" | "junctionIntent">>): RangeTrackMarker[] {
  return segments.flatMap((s, i) => (i > 0 && s.junctionIntent ? [{ sec: s.startSec, label: INTENT_ZH[s.junctionIntent], tone: s.junctionIntent === "unwanted" ? ("warn" as const) : ("ok" as const) }] : []));
}

/** 一行一个滑杆：名称与数值同一行、滑杆独占一行，窄屏不挤。 */
function GradeSlider(props: { sliderKey: MontageSliderKey; ariaLabel: string; value: number | undefined; disabled: boolean; hint?: string; onChange: (v: number) => void }) {
  const r = MONTAGE_GRADE_SLIDERS[props.sliderKey];
  const value = props.value ?? r.neutral;
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span>{r.label}</span>
        <span className="tabular-nums text-white/70">
          {props.sliderKey === "color_temperature" ? `${value}K${props.hint ?? ""}` : value.toFixed(2)}
        </span>
      </span>
      <input
        aria-label={props.ariaLabel}
        type="range"
        min={r.min}
        max={r.max}
        step={r.step}
        disabled={props.disabled}
        value={value}
        onChange={e => props.onChange(Number(e.target.value))}
        className="block w-full"
      />
    </label>
  );
}

const JUNCTION_TONE: Record<MontageJunctionKind, string> = {
  fix: "border-red-400/70 bg-red-500/10",
  unmarked: "border-amber-300/60 bg-amber-400/5",
  story: "border-sky-300/40",
  pass: "border-white/10",
};
const JUNCTION_TAG: Record<MontageJunctionKind, string> = {
  fix: "text-red-300",
  unmarked: "text-amber-200",
  story: "text-sky-200",
  pass: "text-white/60",
};

/**
 * 成片接点色彩检查（只读）：读后期 concat 结果的 gradeSegmentCheck；读不到不渲染。
 * 全部达标只占一行（可展开看数值）；未达标的按「不该跳且未修平 → 未标注 → 剧情需要」排在前面，各带一句怎么办。
 */
export function VideoGradeJunctionChecks({ results }: { results: VideoGradeJunctionResult[] | undefined }) {
  const checks = (results ?? []).flatMap(j => {
    const check = readMontageJunctionCheck(j.output);
    return check ? [{ ...j, check }] : [];
  });
  if (!checks.length) return null;
  return (
    <section aria-label="接点检查结果" className="space-y-2 rounded border border-white/15 p-2 text-xs">
      {checks.map(j => {
        const rows = j.check.junctions.map((x, k) => ({ x, k, view: describeMontageJunction(x, k + 2) }));
        const passed = rows.filter(r => r.view.kind === "pass");
        const open = rows.filter(r => r.view.kind !== "pass").sort((a, b) => MONTAGE_JUNCTION_KIND_ORDER.indexOf(a.view.kind) - MONTAGE_JUNCTION_KIND_ORDER.indexOf(b.view.kind) || a.k - b.k);
        const mustFix = open.filter(r => r.view.kind === "fix").length;
        const name = j.title || "成片";
        const passLine = (r: (typeof rows)[number]) => (
          <li key={r.k} aria-label={`接点${r.k + 1}`} data-junction-kind="pass">
            {r.x.atSec.toFixed(1)}秒 · 亮度差{r.x.delta.YAVG} · 蓝色差{r.x.delta.UAVG} · 红色差{r.x.delta.VAVG} · 饱和差{r.x.delta.SATAVG} · {r.view.labelZh}
          </li>
        );
        if (!open.length)
          return (
            <details key={j.jobId}>
              <summary className="cursor-pointer">
                接点色彩检查 · {name}：全部接点达标（{rows.length} 个）
              </summary>
              <ul className="mt-1 space-y-0.5 text-white/60">{passed.map(passLine)}</ul>
            </details>
          );
        return (
          <div key={j.jobId} className="space-y-1.5">
            <p>
              <strong>接点色彩检查 · {name}：有接点未达标</strong>
              <span className="ml-1 text-white/70">
                {mustFix ? `${mustFix} 处不该跳、还没修平` : `${open.length} 处色彩有跳变`}
              </span>
            </p>
            <ul className="space-y-1.5">
              {open.map(r => (
                <li key={r.k} aria-label={`接点${r.k + 1}`} data-junction-kind={r.view.kind} className={`rounded border p-2 ${JUNCTION_TONE[r.view.kind]}`}>
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <strong className="text-sm tabular-nums">{r.x.atSec.toFixed(1)}秒</strong>
                    <span className={`font-medium ${JUNCTION_TAG[r.view.kind]}`}>{r.view.labelZh}</span>
                  </p>
                  {r.view.overZh.length > 0 && <p className="tabular-nums">{r.view.overZh.join("；")}</p>}
                  <p className="text-white/70">{r.view.adviceZh}</p>
                </li>
              ))}
            </ul>
            {passed.length > 0 && (
              <details>
                <summary className="cursor-pointer text-white/60">其余 {passed.length} 个接点达标</summary>
                <ul className="mt-1 space-y-0.5 text-white/60">{passed.map(passLine)}</ul>
              </details>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * 视频调色面板（受控，可复用）：20 个预设分组下拉、饱和/色温/对比滑杆、还原、分段调色（时间轴区间条 + 数字输入）、段间渐变、
 * 自动修正接点、AI 调色建议（仅有 gs:// 成片时）与接点检查结果。草稿类型与校验全部沿用 montageFinish。
 */
export function VideoGradePanel(props: VideoGradePanelProps) {
  const [localError, setLocalError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const grade = props.value;
  const locked = Boolean(props.disabled);
  const { outputSec } = props;
  const gradeAll: ColorCorrection = grade?.all ?? {};
  const segments = grade?.segments ?? [];
  const segmentProblem = checkMontageSegments(segments, outputSec, grade?.crossfadeSec ?? 0);
  const advisorExtras = [
    ...Object.keys(gradeAll).filter(k => k !== "lutId" && !SLIDER_KEYS.includes(k as MontageSliderKey)),
    ...(grade?.clips ? [`逐段${grade.clips.length}项`] : []),
    ...(grade?.referenceClipIndex != null ? [`代表镜头第${grade.referenceClipIndex + 1}段`] : []),
  ];
  const setGrade = (patch: Partial<ColorCorrection>) => props.onChange(patchMontageGradeAll(grade, patch));
  const setSegGrade = (next: MontageGrade | undefined) => props.onChange(next);
  const reportError = (message: string) => {
    if (props.onError) props.onError(message);
    else setLocalError(message);
  };
  const tenth = (v: number) => Math.round(v * 10) / 10;
  return (
    <div ref={rootRef} className="space-y-2" data-testid="video-grade-panel">
      <label className="block">
        <span className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span>调色预设</span>
          <span className="text-xs text-white/60">每种风格有「轻 / 标准」两档</span>
        </span>
        <select
          aria-label="调色预设"
          disabled={locked}
          value={gradeAll.lutId ?? ""}
          onChange={e => setGrade({ lutId: e.target.value || undefined })}
          className="mt-0.5 block w-full max-w-xs rounded bg-slate-900 p-1"
        >
          <LutOptions />
        </select>
      </label>
      {SLIDER_KEYS.map(key => (
        <GradeSlider key={key} sliderKey={key} ariaLabel={MONTAGE_GRADE_SLIDERS[key].label} value={gradeAll[key]} hint="（低暖高冷）" disabled={locked} onChange={v => setGrade({ [key]: v })} />
      ))}
      {advisorExtras.length > 0 && <p className="text-white/60">顾问另设：{advisorExtras.join("、")}</p>}
      <button
        type="button"
        disabled={locked || !grade}
        onClick={() => props.onChange(undefined)}
        className="text-xs underline disabled:opacity-40"
      >
        还原原片色彩
      </button>
      <div className="space-y-2 rounded border border-white/10 p-2" aria-label="分段调色">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span>分段调色（成片约{outputSec.toFixed(1)}秒，不分段即全片统一）</span>
          <button
            type="button"
            aria-label="添加调色分段"
            disabled={locked || outputSec < 0.2 || segments.length >= MONTAGE_SEGMENT_MAX || Boolean(grade?.clips || grade?.referenceClipIndex != null)}
            onClick={() => setSegGrade(addMontageSegment(grade, outputSec))}
            className="underline disabled:opacity-40"
          >
            添加分段
          </button>
        </div>
        {segments.length > 0 && (
          <div role="group" aria-label="分段时间轴">
            <RangeTrack
              disabled={locked}
              step={0.1}
              minSegmentSec={0.1}
              formatValue={sec => `${sec.toFixed(1)}秒`}
              segments={segments.map((seg, i) => ({ startSec: seg.startSec, endSec: seg.endSec, label: String(i + 1) }))}
              boundaryAriaLabel={i => `第${i + 1}段与第${i + 2}段的分界`}
              markers={montageIntentMarkers(segments)}
              onBoundaryChange={(i, sec) => setSegGrade(patchMontageSegment(grade, i, { endSec: sec }))}
              onSegmentSelect={i => rootRef.current?.querySelector<HTMLElement>(`[aria-label="第${i + 1}段调色预设"]`)?.focus()}
            />
          </div>
        )}
        {segments.length > 0 && segmentProblem && (
          <p aria-label="分段校验" className="text-amber-200">
            {segmentProblem}，采用前请修正
          </p>
        )}
        {props.adviceVideoGsUri?.startsWith("gs://") && (
          <MontageGradeAdvice
            videoGsUri={props.adviceVideoGsUri}
            durationSec={outputSec}
            aspect={props.adviceAspect}
            storyZh={props.storyZh}
            seamSecs={props.seamSecs}
            transitions={props.transitions}
            disabled={locked}
            debugMode={props.debugMode}
            triggerRef={props.adviceTriggerRef}
            onApply={segs => {
              try {
                setSegGrade(applyMontageSegmentsDraft(grade, segs, outputSec));
                setLocalError("");
                return true;
              } catch (e) {
                reportError(e instanceof Error ? e.message : String(e));
                return false;
              }
            }}
          />
        )}
        {segments.map((seg, i) => {
          const n = i + 1;
          const num = (key: "startSec" | "endSec", label: string, min: number, max: number, v: number) => (
            <label className="flex items-center gap-1">
              {label}
              <input
                aria-label={`第${n}段${label}`}
                type="number"
                inputMode="decimal"
                min={min}
                max={max}
                step={0.1}
                disabled={locked}
                value={v}
                onChange={e => {
                  const x = Number(e.target.value);
                  if (Number.isFinite(x) && x >= min && x <= max) setSegGrade(patchMontageSegment(grade, i, { [key]: Math.round(x * 10) / 10 }));
                }}
                className="w-16 rounded bg-slate-900 p-1 tabular-nums"
              />
            </label>
          );
          return (
            <div key={i} className="space-y-1 border-t border-white/10 pt-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <strong>第{n}段</strong>
                {i > 0 && seg.junctionIntent && (
                  <span className={seg.junctionIntent === "unwanted" ? "text-xs text-amber-200" : "text-xs text-sky-200"}>进入本段：{INTENT_ZH[seg.junctionIntent]}</span>
                )}
                <button type="button" aria-label={`删除第${n}段`} disabled={locked} onClick={() => setSegGrade(removeMontageSegment(grade, i))} className="ml-auto underline disabled:opacity-40">
                  删除
                </button>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {num("startSec", "开始秒", 0, outputSec, seg.startSec)}
                {num("endSec", "结束秒", 0, outputSec, seg.endSec)}
              </div>
              <select
                aria-label={`第${n}段调色预设`}
                disabled={locked}
                value={seg.lutId ?? ""}
                onChange={e => setSegGrade(patchMontageSegment(grade, i, { lutId: e.target.value || undefined }))}
                className="block w-full max-w-xs rounded bg-slate-900 p-1"
              >
                <LutOptions />
              </select>
              {SLIDER_KEYS.map(key => (
                <GradeSlider
                  key={key}
                  sliderKey={key}
                  ariaLabel={`第${n}段${MONTAGE_GRADE_SLIDERS[key].label}`}
                  value={seg[key]}
                  disabled={locked}
                  onChange={v => setSegGrade(patchMontageSegment(grade, i, { [key]: v }))}
                />
              ))}
            </div>
          );
        })}
        <label className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/10 pt-2">
          段间过渡秒数
          <input
            aria-label="段间过渡秒数"
            type="number"
            inputMode="decimal"
            min={MONTAGE_CROSSFADE_RANGE.min}
            max={MONTAGE_CROSSFADE_RANGE.max}
            step={MONTAGE_CROSSFADE_RANGE.step}
            disabled={locked || segments.length < 2}
            value={grade?.crossfadeSec ?? 0}
            onChange={e => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= MONTAGE_CROSSFADE_RANGE.min && v <= MONTAGE_CROSSFADE_RANGE.max) setSegGrade(setMontageCrossfade(grade, v));
            }}
            className="w-16 rounded bg-slate-900 p-1 tabular-nums"
          />
          <span className="text-white/60">秒（0 为硬切）</span>
        </label>
        <label className="flex items-start gap-1.5">
          <input
            aria-label="自动修正接点"
            type="checkbox"
            disabled={locked || segments.length < 2}
            checked={Boolean(grade?.autoMatchJunctions)}
            onChange={e => setSegGrade(setMontageAutoMatch(grade, e.target.checked))}
            className="mt-0.5 shrink-0"
          />
          <span>自动修正接点（接点前后色差超标时自动拉齐）</span>
        </label>
      </div>
      {!props.onError && localError && (
        <p role="alert" className="text-xs text-red-300">
          {localError}
        </p>
      )}
      {props.junctionResults && <VideoGradeJunctionChecks results={props.junctionResults} />}
    </div>
  );
}
