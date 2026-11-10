import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { trpc } from "@/lib/trpc";
import { CREDIT_COSTS } from "@shared/plans";

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
  /** 「套用到草稿」回调；只回传 segments，不自动提交。 */
  onApply: (segments: MontageGradeSegment[]) => void;
  /** supervisor/debug 下才显示引擎名（前台零技术泄漏）。 */
  debugMode?: boolean;
  disabled?: boolean;
  /** 挂载期间填入命令式触发（顾问 gradeAdvice 用），卸载清空。 */
  triggerRef?: MutableRefObject<MontageGradeAdviceTrigger | null>;
};

const fmt = (n: number) => n.toFixed(1);
function paramsZh(s: MontageGradeSegment): string {
  const out: string[] = [];
  if (s.exposure !== undefined) out.push(`曝光 ${s.exposure}`);
  if (s.contrast !== undefined) out.push(`对比 ${s.contrast}`);
  if (s.saturation !== undefined) out.push(`饱和 ${s.saturation}`);
  if (s.color_temperature !== undefined) out.push(`色温 ${s.color_temperature}K`);
  if (s.gamma !== undefined) out.push(`伽马 ${s.gamma}`);
  if (s.color_balance) out.push("色彩平衡");
  if (s.curves) out.push("曲线");
  return out.join(" · ") || "—";
}

export function MontageGradeAdvice(props: MontageGradeAdviceProps) {
  const advise = trpc.canvasMusicMv.adviseMontageGrade.useMutation();
  const [error, setError] = useState<string | null>(null);
  const data = advise.data;
  const run = async (userRequestZh?: string) => {
    setError(null);
    const storyZh = montageGradeAdviceStory(props.storyZh, userRequestZh);
    try {
      return await advise.mutateAsync({
        requestId: crypto.randomUUID(),
        videoGsUri: props.videoGsUri,
        durationSec: props.durationSec,
        ...(props.aspect ? { aspect: props.aspect } : {}),
        ...(storyZh ? { storyZh } : {}),
        ...(props.seamSecs?.length ? { seamSecs: props.seamSecs } : {}),
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

  return (
    <div className="space-y-2" data-testid="montage-grade-advice">
      <button
        type="button"
        className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
        disabled={props.disabled || advise.isPending || !props.videoGsUri || !(props.durationSec > 0)}
        onClick={() => void run().catch(() => {})}
      >
        {advise.isPending ? "正在分析成片…" : `AI 调色建议 · ${MONTAGE_GRADE_ADVICE_PRICE} 积分${props.debugMode ? "（Gemini 3.8 Flash）" : ""}`}
      </button>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {data && (
        <div className="space-y-2 text-sm">
          <p>{data.advice.arcZh}</p>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr><th>区间</th><th>预设</th><th>参数</th><th>理由</th></tr>
            </thead>
            <tbody>
              {data.advice.grades.map((g, i) => (
                <tr key={i} className="border-t align-top">
                  <td className="whitespace-nowrap pr-2">{fmt(data.segments[i]!.startSec)}–{fmt(data.segments[i]!.endSec)}s</td>
                  <td className="pr-2">{g.correction.lutId ?? "—"}</td>
                  <td className="pr-2">{paramsZh(data.segments[i]!)}</td>
                  <td>{g.reasonZh}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.advice.seams.filter(s => s.jump).map((s, i) => (
            <p key={i}>接点 {fmt(s.atSec)}s：{s.fixZh}</p>
          ))}
          {props.debugMode && <p className="text-xs opacity-60">{data.usedBy.channel} · {data.usedBy.model}{data.usedBy.failuresZh.length ? ` · ${data.usedBy.failuresZh.join("；")}` : ""}</p>}
          <button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => props.onApply(data.segments as MontageGradeSegment[])}>
            套用到草稿
          </button>
        </div>
      )}
    </div>
  );
}
