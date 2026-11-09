import { useState } from "react";
import { trpc } from "@/lib/trpc";

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
  const run = async () => {
    setError(null);
    try {
      await advise.mutateAsync({
        requestId: crypto.randomUUID(),
        videoGsUri: props.videoGsUri,
        durationSec: props.durationSec,
        ...(props.aspect ? { aspect: props.aspect } : {}),
        ...(props.storyZh?.trim() ? { storyZh: props.storyZh.trim() } : {}),
        ...(props.seamSecs?.length ? { seamSecs: props.seamSecs } : {}),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "调色建议暂不可用，请稍后重试");
    }
  };
  return (
    <div className="space-y-2" data-testid="montage-grade-advice">
      <button
        type="button"
        className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
        disabled={props.disabled || advise.isPending || !props.videoGsUri || !(props.durationSec > 0)}
        onClick={run}
      >
        {advise.isPending ? "正在分析成片…" : props.debugMode ? "AI 调色建议（Gemini 3.8 Flash）" : "AI 调色建议"}
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
