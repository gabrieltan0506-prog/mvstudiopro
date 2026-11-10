import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { trpc } from "@/lib/trpc";
import { CREDIT_COSTS } from "@shared/plans";
import { COLOR_GRADE_LUT_GROUPS } from "@shared/colorGrade";
import { RangeTrack } from "./RangeTrack";

/** 与服务端 GradeSegment 同形：可直接喂 concat grade.segments。 */
export type MontageGradeSegment = {
  startSec: number;
  endSec: number;
  lutId?: string;
  exposure?: number;
  contrast?: number;
  gamma?: number;
  gamma_r?: number;
  gamma_g?: number;
  gamma_b?: number;
  saturation?: number;
  color_temperature?: number;
  color_balance?: Record<string, { r: number; g: number; b: number } | undefined>;
  curves?: Record<string, string | undefined>;
  /** 进本段那个接点的意图（服务端按建议的接点就近对上）；套用时随分段进草稿。 */
  junctionIntent?: "intended" | "unwanted";
};

/** 顾问代用户发起调色建议：带上用户原话；仍走本组件同一调用与费用确认，结果只列建议、须用户点「套用到草稿」。 */
export type MontageGradeAdviceTrigger = (userRequestZh: string, signal?: AbortSignal) => Promise<{ arcZh: string; segmentCount: number }>;

/** 单价与服务端扣费同一常量（shared/plans CREDIT_COSTS.montageGradeAdvice）。 */
export const MONTAGE_GRADE_ADVICE_PRICE = CREDIT_COSTS.montageGradeAdvice;
/** 每次调色建议的扣费口径（管理员不扣），读同一常量，与服务端计费一致。 */
export const MONTAGE_GRADE_ADVICE_COST_ZH = `每次 ${MONTAGE_GRADE_ADVICE_PRICE} 积分（管理员不扣）`;

/** 用户调色要求放在最前（服务端 storyZh 上限 8000 字，截断只丢剧情尾部）。 */
export function montageGradeAdviceStory(storyZh: string | undefined, userRequestZh?: string): string {
  const request = userRequestZh?.trim();
  return [request ? `用户调色要求：${request}` : "", storyZh?.trim() ?? ""].filter(Boolean).join("\n").slice(0, 8000);
}

export type MontageGradeAdviceProps = {
  /** 成片 gs://（本人目录下的 mp4/mov/webm）。 */
  videoGsUri: string;
  durationSec: number;
  aspect?: "9:16" | "16:9" | "1:1";
  /** 可选剧情/情绪时间线文本（成片绝对秒）。 */
  storyZh?: string;
  /** 可选素材拼接接点秒位。 */
  seamSecs?: number[];
  /** 可选已知转场（atSec = 转场中点，成片绝对秒）；未知不传。 */
  transitions?: Array<{ atSec: number; durationSec: number }>;
  /** 「套用到草稿」回调；只回传 segments，不自动提交。返回 false = 没套用成功（按钮不显示「已套用」）。 */
  onApply: (segments: MontageGradeSegment[]) => boolean | void;
  /** supervisor/debug 下才显示引擎名（前台零技术泄漏）。 */
  debugMode?: boolean;
  disabled?: boolean;
  /** 挂载期间填入命令式触发（顾问 gradeAdvice 用），卸载清空。 */
  triggerRef?: MutableRefObject<MontageGradeAdviceTrigger | null>;
};

const fmt = (n: number) => n.toFixed(1);
const LUT_LABEL = new Map(COLOR_GRADE_LUT_GROUPS.flatMap(g => g.presets.map(p => [p.id, p.label] as const)));
const INTENT_ZH = { intended: "剧情需要", unwanted: "不该跳" } as const;
/** 一段建议的参数摘要：预设用中文名，其余只列改动项。 */
export function montageAdviceParamsZh(s: MontageGradeSegment): string {
  const out: string[] = [];
  if (s.lutId) out.push(LUT_LABEL.get(s.lutId) ?? "预设");
  if (s.exposure !== undefined) out.push(`曝光 ${s.exposure}`);
  if (s.contrast !== undefined) out.push(`对比 ${s.contrast}`);
  if (s.saturation !== undefined) out.push(`饱和 ${s.saturation}`);
  if (s.color_temperature !== undefined) out.push(`色温 ${s.color_temperature}K`);
  if (s.gamma !== undefined) out.push(`伽马 ${s.gamma}`);
  if (s.color_balance) out.push("色彩平衡");
  if (s.curves) out.push("曲线");
  return out.join("、") || "保持原样";
}

/** 转场生效时每个接点都是一段转场：接点秒位（seamSecs）= 转场起点，中点 = 起点 + 时长/2；无转场返回 undefined（不传）。 */
export function montageGradeTransitions(seamSecs: number[], transitionSec: number): Array<{ atSec: number; durationSec: number }> | undefined {
  if (!(transitionSec > 0) || !seamSecs.length) return undefined;
  return seamSecs.map(s => ({ atSec: Math.round((s + transitionSec / 2) * 100) / 100, durationSec: transitionSec }));
}

/** 结果第 j 段对应模型原始 grades 的下标：边界吸附可能把过短的段并掉，segments 会比 grades 少。 */
export function montageGradeSegmentGradeIndexes(segmentCount: number, gradeCount: number, mergedGradeIndexes: number[] = []): number[] {
  const all = Array.from({ length: gradeCount }, (_, i) => i);
  if (segmentCount === gradeCount) return all;
  const kept = all.filter(i => !mergedGradeIndexes.includes(i));
  return kept.length === segmentCount ? kept : all.slice(0, segmentCount);
}

export function MontageGradeAdvice(props: MontageGradeAdviceProps) {
  const advise = trpc.canvasMusicMv.adviseMontageGrade.useMutation();
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const data = advise.data;
  const run = async (userRequestZh?: string) => {
    setError(null);
    setApplied(false);
    const storyZh = montageGradeAdviceStory(props.storyZh, userRequestZh);
    try {
      return await advise.mutateAsync({
        requestId: crypto.randomUUID(),
        videoGsUri: props.videoGsUri,
        durationSec: props.durationSec,
        ...(props.aspect ? { aspect: props.aspect } : {}),
        ...(storyZh ? { storyZh } : {}),
        ...(props.seamSecs?.length ? { seamSecs: props.seamSecs } : {}),
        ...(props.transitions?.length ? { transitions: props.transitions } : {}),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "调色建议暂不可用，请稍后重试";
      setError(message);
      throw new Error(message);
    }
  };
  const trigger: MontageGradeAdviceTrigger = async (userRequestZh, signal) => {
    signal?.throwIfAborted();
    if (props.disabled || advise.isPending || !props.videoGsUri || !(props.durationSec > 0)) throw new Error("调色建议暂不可用：请先合成本方案成片，且不在处理中");
    if (!userRequestZh.trim()) throw new Error("缺少用户的调色要求");
    if (!window.confirm(`按你的要求「${userRequestZh.trim()}」生成调色建议，${MONTAGE_GRADE_ADVICE_COST_ZH}。结果只列出建议，需点「套用到草稿」并采用后才生效。确认？`))
      throw new Error("用户未确认调色建议费用");
    signal?.throwIfAborted();
    const result = await run(userRequestZh);
    return { arcZh: result.advice.arcZh, segmentCount: result.segments.length };
  };
  const latest = useRef(trigger);
  latest.current = trigger;
  useEffect(() => {
    const ref = props.triggerRef;
    if (!ref) return;
    ref.current = (userRequestZh, signal) => latest.current(userRequestZh, signal);
    return () => {
      ref.current = null;
    };
  }, [props.triggerRef]);

  const segs = (data?.segments ?? []) as MontageGradeSegment[];
  // 接点：分段自带的意图（第2段起的起点）+ 建议里点名会跳、但没对上分段起点的接点。
  const intentMarkers = segs.flatMap((s, i) =>
    i > 0 && s.junctionIntent ? [{ sec: s.startSec, label: INTENT_ZH[s.junctionIntent], tone: s.junctionIntent === "unwanted" ? ("warn" as const) : ("ok" as const) }] : []
  );
  /** 每段理由取自未被吸附并掉的模型原始段。 */
  const reasons = montageGradeSegmentGradeIndexes(segs.length, data?.advice.grades.length ?? 0, data?.snap?.mergedGradeIndexes).map(gi => data?.advice.grades[gi]?.reasonZh);
  const jumps = (data?.advice.seams ?? []).filter(s => s.jump);
  const markers = [
    ...intentMarkers,
    ...jumps
      .filter(s => !intentMarkers.some(m => Math.abs(m.sec - s.atSec) <= 0.6))
      .map(s => ({ sec: s.atSec, label: INTENT_ZH[s.intent], tone: s.intent === "unwanted" ? ("warn" as const) : ("ok" as const) })),
  ];

  return (
    <div className="space-y-2" data-testid="montage-grade-advice">
      <button
        type="button"
        className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
        disabled={props.disabled || advise.isPending || !props.videoGsUri || !(props.durationSec > 0)}
        onClick={() => void run().catch(() => {})}
      >
        {advise.isPending ? "正在分析成片…" : `AI 调色建议 · ${MONTAGE_GRADE_ADVICE_PRICE} 积分`}
      </button>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {data && (
        <div className="space-y-1.5 rounded border border-white/10 p-2" data-grade-advice-result>
          <p className="line-clamp-2" title={data.advice.arcZh}>
            建议分 {segs.length} 段：{data.advice.arcZh}
          </p>
          {segs.length > 0 && (
            <div role="group" aria-label="建议分段时间轴">
              {/* 只读：隐藏分界滑块 */}
              <RangeTrack
                className="[&_[data-range-track-handle]]:hidden"
                formatValue={sec => `${fmt(sec)}秒`}
                segments={segs.map((s, i) => ({ startSec: s.startSec, endSec: s.endSec, label: String(i + 1) }))}
                markers={markers}
              />
            </div>
          )}
          <ol className="space-y-0.5 text-xs">
            {segs.map((s, i) => (
              <li key={i} aria-label={`建议第${i + 1}段`} className="flex flex-wrap gap-x-2">
                <span className="tabular-nums text-white/60">
                  {i + 1}. {fmt(s.startSec)}–{fmt(s.endSec)}秒
                </span>
                <span>{montageAdviceParamsZh(s)}</span>
                {reasons[i] && (
                  <span className="min-w-0 basis-full truncate text-white/60" title={reasons[i]}>
                    {reasons[i]}
                  </span>
                )}
              </li>
            ))}
          </ol>
          {jumps.length > 0 && (
            <ul className="space-y-0.5 text-xs">
              {jumps.map((s, i) => (
                <li key={i} aria-label={`建议接点${i + 1}`} className="flex flex-wrap gap-x-2">
                  <span className={`tabular-nums ${s.intent === "unwanted" ? "text-amber-200" : "text-sky-200"}`}>
                    {fmt(s.atSec)}秒 {INTENT_ZH[s.intent]}
                  </span>
                  {s.intent === "unwanted" ? (
                    <span className="min-w-0 basis-full truncate text-white/60" title={s.fixZh}>
                      {s.fixZh}
                    </span>
                  ) : (
                    <span className="text-white/60">保留这处转变</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {props.debugMode && <p className="text-xs text-white/50">{data.usedBy.channel} · {data.usedBy.model}{data.usedBy.failuresZh.length ? ` · ${data.usedBy.failuresZh.join("；")}` : ""}</p>}
          <button
            type="button"
            className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
            disabled={props.disabled}
            onClick={() => {
              if (props.onApply(segs) !== false) setApplied(true);
            }}
          >
            {applied ? "已套用到草稿（可再点重新套用）" : "套用到草稿"}
          </button>
        </div>
      )}
    </div>
  );
}
