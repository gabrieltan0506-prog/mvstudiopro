/**
 * 知识卡进度（2026-09-08 用户要求第 7 条）：一条进度条贯穿
 * 上传 → 转换 → 读原稿/挑参考页 → 提炼 → 出图 i/n；终态只显示「成功」或「失败 · 停在 xx%」。
 * 纯展示组件；百分比由父级按阶段折算，本组件不猜测。
 */
export type KnowledgeCardProgressState = {
  status: "idle" | "running" | "succeeded" | "failed";
  /** 0–100；running/failed 时为当前进度，succeeded 固定 100 */
  percent: number;
  /** 阶段短语，如「读原稿 12/276 页」「出图 2/5 页」 */
  label?: string;
  error?: string;
};

export function KnowledgeCardProgress({ state }: { state: KnowledgeCardProgressState }) {
  if (state.status === "idle") return null;
  const percent = Math.max(0, Math.min(100, Math.round(Number.isFinite(state.percent) ? state.percent : 0)));
  const failed = state.status === "failed";
  const succeeded = state.status === "succeeded";
  const shown = succeeded ? 100 : percent;
  const headline = failed ? `失败 · 停在 ${shown}%` : succeeded ? "成功 · 100%" : `${shown}%`;
  const color = failed ? "text-red-300" : succeeded ? "text-emerald-300" : "text-violet-100";
  const fill = failed ? "bg-red-400" : succeeded ? "bg-emerald-400" : "bg-violet-400";
  return (
    <div className="mt-3 space-y-1.5 text-sm" aria-label="知识卡进度">
      <p role={failed ? "alert" : "status"} className={`flex flex-wrap items-center gap-2 ${color}`}>
        <span className="font-semibold tabular-nums">{headline}</span>
        {state.label && !succeeded ? <span className="text-xs opacity-80">{state.label}</span> : null}
      </p>
      <div
        role="progressbar"
        aria-label="知识卡进度条"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown}
        aria-valuetext={headline}
        className="h-1.5 overflow-hidden rounded-full bg-white/10"
      >
        <div className={`h-full rounded-full transition-[width] duration-300 ${fill}`} style={{ width: `${shown}%` }} />
      </div>
      {failed && state.error ? <p className="text-xs text-red-300/85">{state.error}</p> : null}
    </div>
  );
}

/** 出图阶段占进度条的 60–100%；提炼任务的后台百分比（0–98）折算到 0–60%。 */
export function knowledgeCardProgressFromDistill(distillPercent: number): number {
  const p = Math.max(0, Math.min(100, Number(distillPercent) || 0));
  return Math.round((p / 100) * 60);
}
export function knowledgeCardProgressFromRender(done: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 60;
  return Math.round(60 + 40 * Math.max(0, Math.min(1, done / total)));
}
