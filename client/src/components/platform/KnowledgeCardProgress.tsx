import { sanitizePlatformUserMessage } from "@/lib/platformUserFacingCopy";
/**
 * 知识卡进度（2026-09-08 用户要求第 7 条）：一条进度条贯穿
 * 上传 → 转换 → 读原稿/挑参考页 → 提炼 → 出图 i/n；终态只显示「成功」或「失败 · 停在 xx%」。
 * 纯展示组件；百分比由父级按阶段折算，本组件不猜测。
 */
export type KnowledgeCardProgressState = {
  /**
   * stopped＝用户中途终止（复审 P2）：不许冒用 succeeded。
   * 冒用的后果是子组件把进度强拉到 100%、还把「已停止」说明藏掉——
   * 实测 7 页批次停在 4 页，界面却显示「成功 · 100%」，另外 3 页的补出入口还开着。
   */
  status: "idle" | "running" | "succeeded" | "stopped" | "failed";
  /** 0–100；running/stopped/failed 时为当前真实进度，succeeded 固定 100 */
  percent: number;
  /** 阶段短语，如「读原稿 12/276 页」「出图 2/5 页」 */
  label?: string;
  /** 当前阶段实际计数，独立于总体阶段权重。 */
  stageDone?: number;
  stageTotal?: number;
  error?: string;
  successLabel?: string;
};

export function KnowledgeCardProgress({
  state,
  onCancel,
  cancelBusy,
}: {
  state: KnowledgeCardProgressState;
  /** 传了才显示「终止」按钮（只在后台读档任务在跑时可停；出图阶段不给停） */
  onCancel?: () => void;
  cancelBusy?: boolean;
}) {
  if (state.status === "idle") return null;
  const percent = Math.max(0, Math.min(100, Math.round(Number.isFinite(state.percent) ? state.percent : 0)));
  const stageTotal = state.stageTotal;
  const stageDone = state.stageDone;
  const counted = Number.isFinite(stageTotal) && Number(stageTotal) > 0 && Number.isFinite(stageDone) && Number(stageDone) >= 0;
  const stagePercent = counted ? Math.round(Math.min(1, Number(stageDone) / Number(stageTotal)) * 1000) / 10 : undefined;
  const failed = state.status === "failed";
  const succeeded = state.status === "succeeded";
  const stopped = state.status === "stopped";
  // 只有真的全部完成才显示 100%；停止状态如实显示停在哪
  const shown = succeeded ? 100 : percent;
  const headline = failed
    ? `失败 · 停在 ${shown}%`
    : succeeded
      ? `${state.successLabel || "成功"} · 100%`
      : stopped
        ? `已停止 · ${shown}%`
        : `${shown}%`;
  const color = failed
    ? "text-red-300"
    : succeeded
      ? "text-emerald-300"
      : stopped
        ? "text-amber-200"
        : "text-violet-100";
  const fill = failed
    ? "bg-red-400"
    : succeeded
      ? "bg-emerald-400"
      : stopped
        ? "bg-amber-400"
        : "bg-violet-400";
  return (
    <div className="mt-3 space-y-1.5 text-sm" aria-label="知识卡进度">
      <p role={failed ? "alert" : "status"} className={`flex flex-wrap items-center gap-2 ${color}`}>
        <span className="grid min-w-0 flex-1 grid-cols-2 gap-4">
          <span className="min-w-0"><span className="block text-xs opacity-70">总体完成度</span><span className="font-semibold tabular-nums">{headline}</span></span>
          <span className="min-w-0 break-words"><span className="block text-xs opacity-70">当前阶段</span><span className="block text-xs">{sanitizePlatformUserMessage(state.label || (succeeded ? "本步已结束" : "正在处理…"), "正在处理…")}</span><span className="block text-xs tabular-nums">{counted ? `${stageDone}/${stageTotal} · ${stagePercent}%` : "暂无阶段计数"}</span></span>
        </span>
        {onCancel && state.status === "running" ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelBusy}
            title="停止本次任务；读档中途停不计费，出图停了按已出页计费"
            className="ml-auto rounded-md border border-red-400/35 px-2 py-0.5 text-[11px] font-semibold text-red-200 transition hover:border-red-400/70 hover:bg-red-400/10 disabled:opacity-50"
          >
            {cancelBusy ? "正在停止…" : "终止"}
          </button>
        ) : null}
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
      {failed && state.error ? <p className="text-xs text-red-300/85">{sanitizePlatformUserMessage(state.error)}</p> : null}
      {stopped && state.error ? <p className="text-xs text-amber-200/85">{sanitizePlatformUserMessage(state.error)}</p> : null}
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

/** 老任务会保留上一阶段计数；按阶段选字段，避免统稿误显参考页已完成。 */
export function knowledgeCardStageCounts(out: {
  distillStage?: string; distillPhase?: string;
  distillStageDone?: number; distillStageTotal?: number;
  distillDoneChunks?: number; distillTotalChunks?: number;
}): Pick<KnowledgeCardProgressState, "stageDone" | "stageTotal"> {
  const stage = out.distillStage || out.distillPhase;
  if (stage === "refining" || stage === "finishing") return {};
  if (["converting", "reading", "selecting", "rendering", "deriving", "merging", "verifying", "revising"].includes(stage || ""))
    return { stageDone: out.distillStageDone, stageTotal: out.distillStageTotal };
  return { stageDone: out.distillDoneChunks, stageTotal: out.distillTotalChunks };
}
