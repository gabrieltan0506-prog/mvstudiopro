
type ProgressTime = string | number | Date | null;
export interface KnowledgeCardReadingProgressProps {
  progress: { done: number; total: number; stage?: string; updatedAt?: ProgressTime; heartbeatAt?: ProgressTime };
  jobStatus?: string;
  phase?: string;
  error?: string;
  successLabel?: string;
  locale?: string;
}
export function KnowledgeCardReadingProgress({ progress, phase, jobStatus, error, successLabel }: KnowledgeCardReadingProgressProps) {
  const done = Number.isFinite(progress.done) ? Math.max(0, Math.floor(progress.done)) : 0;
  const total = Number.isFinite(progress.total) ? Math.max(0, Math.floor(progress.total)) : 0;
  const failed = jobStatus === "failed" || phase === "failed" || Boolean(error);
  const cancelled = jobStatus === "cancelled";
  const succeeded = !failed && !cancelled && (["completed", "succeeded"].includes(jobStatus || "") || phase === "ready");
  const percent = succeeded ? 100 : total > 0 ? Math.min(100, Math.floor(done / total * 100)) : undefined;
  const label = failed ? "处理失败" : cancelled ? "已停止" : succeeded ? (successLabel || (phase === "ready" ? "读取成功" : "处理成功")) : "处理中";
  const color = failed ? "text-red-300" : succeeded ? "text-emerald-300" : "text-violet-100";
  const fill = failed ? "bg-red-400" : succeeded ? "bg-emerald-400" : "bg-violet-400";
  return <div className="space-y-2 text-sm" aria-label="材料读取进展">
    <p role={failed ? "alert" : "status"} className={color} title={failed ? error : undefined}>
      {label}{percent == null ? " · 确认总量中" : ` · ${failed || cancelled ? "停在" : ""}${percent}%`}
      {total > 0 && `（${done}/${total}）`}
    </p>
    <div role="progressbar" aria-label="材料读取进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
      aria-valuetext={`${label}${percent == null ? "，总量待确认" : `，${percent}%`}`}
      className="h-1.5 overflow-hidden rounded-full bg-white/10">
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${percent ?? 0}%` }} />
    </div>

  </div>;
}
