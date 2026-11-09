import { useState, type MutableRefObject } from "react";
import { MontageGradeAdvice, type MontageGradeAdviceTrigger } from "./MontageGradeAdvice";
import {
  MONTAGE_CROSSFADE_RANGE,
  MONTAGE_GRADE_SLIDERS,
  MONTAGE_LUT_GROUPS,
  MONTAGE_SEGMENT_MAX,
  addMontageSegment,
  applyMontageSegmentsDraft,
  checkMontageSegments,
  patchMontageGradeAll,
  patchMontageSegment,
  readMontageJunctionCheck,
  removeMontageSegment,
  setMontageAutoMatch,
  setMontageCrossfade,
  type ColorCorrection,
  type MontageGrade,
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

/** 成片接点色彩检查（只读）：读后期 concat 结果的 gradeSegmentCheck；读不到不渲染。 */
export function VideoGradeJunctionChecks({ results }: { results: VideoGradeJunctionResult[] | undefined }) {
  const checks = (results ?? []).flatMap(j => {
    const check = readMontageJunctionCheck(j.output);
    return check ? [{ ...j, check }] : [];
  });
  if (!checks.length) return null;
  return (
    <section aria-label="接点检查结果" className="space-y-1 rounded border border-white/15 p-2 text-xs">
      <strong>成片接点色彩检查</strong>
      {checks.map(j => (
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
  );
}

/**
 * 视频调色面板（受控，可复用）：20 个预设分组下拉、饱和/色温/对比滑杆、还原、分段调色、段间渐变、
 * 自动修正接点、AI 调色建议（仅有 gs:// 成片时）与接点检查结果。草稿类型与校验全部沿用 montageFinish。
 */
export function VideoGradePanel(props: VideoGradePanelProps) {
  const [localError, setLocalError] = useState("");
  const grade = props.value;
  const locked = Boolean(props.disabled);
  const { outputSec } = props;
  const gradeAll: ColorCorrection = grade?.all ?? {};
  const segments = grade?.segments ?? [];
  const segmentProblem = checkMontageSegments(segments, outputSec, grade?.crossfadeSec ?? 0);
  const sliderKeys = Object.keys(MONTAGE_GRADE_SLIDERS) as MontageSliderKey[];
  const advisorExtras = [
    ...Object.keys(gradeAll).filter(k => k !== "lutId" && !sliderKeys.includes(k as MontageSliderKey)),
    ...(grade?.clips ? [`逐段${grade.clips.length}项`] : []),
    ...(grade?.referenceClipIndex != null ? [`代表镜头第${grade.referenceClipIndex + 1}段`] : []),
  ];
  const setGrade = (patch: Partial<ColorCorrection>) => props.onChange(patchMontageGradeAll(grade, patch));
  const setSegGrade = (next: MontageGrade | undefined) => props.onChange(next);
  const reportError = (message: string) => {
    if (props.onError) props.onError(message);
    else setLocalError(message);
  };
  return (
    <div className="space-y-2" data-testid="video-grade-panel">
      <label className="block">
        调色预设
        <select
          aria-label="调色预设"
          disabled={locked}
          value={gradeAll.lutId ?? ""}
          onChange={e => setGrade({ lutId: e.target.value || undefined })}
          className="ml-2 rounded bg-slate-900 p-1"
        >
          <LutOptions />
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
      {advisorExtras.length > 0 && <p className="text-white/60">顾问另设：{advisorExtras.join("、")}</p>}
      <button
        type="button"
        disabled={locked || !grade}
        onClick={() => props.onChange(undefined)}
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
            disabled={locked || outputSec < 0.2 || segments.length >= MONTAGE_SEGMENT_MAX || Boolean(grade?.clips || grade?.referenceClipIndex != null)}
            onClick={() => setSegGrade(addMontageSegment(grade, outputSec))}
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
                  if (Number.isFinite(x) && x >= min && x <= max) setSegGrade(patchMontageSegment(grade, i, { [key]: Math.round(x * 10) / 10 }));
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
                <button type="button" aria-label={`删除第${n}段`} disabled={locked} onClick={() => setSegGrade(removeMontageSegment(grade, i))} className="underline disabled:opacity-40">
                  删除
                </button>
              </div>
              <select
                aria-label={`第${n}段调色预设`}
                disabled={locked}
                value={seg.lutId ?? ""}
                onChange={e => setSegGrade(patchMontageSegment(grade, i, { lutId: e.target.value || undefined }))}
                className="rounded bg-slate-900 p-1"
              >
                <LutOptions />
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
                      onChange={e => setSegGrade(patchMontageSegment(grade, i, { [key]: Number(e.target.value) }))}
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
        {props.adviceVideoGsUri?.startsWith("gs://") && (
          <MontageGradeAdvice
            videoGsUri={props.adviceVideoGsUri}
            durationSec={outputSec}
            aspect={props.adviceAspect}
            storyZh={props.storyZh}
            seamSecs={props.seamSecs}
            disabled={locked}
            debugMode={props.debugMode}
            triggerRef={props.adviceTriggerRef}
            onApply={segs => {
              try {
                setSegGrade(applyMontageSegmentsDraft(grade, segs, outputSec));
                setLocalError("");
              } catch (e) {
                reportError(e instanceof Error ? e.message : String(e));
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
            value={grade?.crossfadeSec ?? 0}
            onChange={e => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= MONTAGE_CROSSFADE_RANGE.min && v <= MONTAGE_CROSSFADE_RANGE.max) setSegGrade(setMontageCrossfade(grade, v));
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
            checked={Boolean(grade?.autoMatchJunctions)}
            onChange={e => setSegGrade(setMontageAutoMatch(grade, e.target.checked))}
            className="mr-1 align-middle"
          />
          自动修正接点（接点前后色差超标时自动拉齐）
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
