import { useState } from "react";
import type { ManhuaPilotReviewState } from "@shared/manhuaPilotReview";

export type ManhuaPilotPanelState = Partial<ManhuaPilotReviewState> & {
  status: ManhuaPilotReviewState["status"];
  reviewKey?: string;
  busy?: boolean;
  error?: string;
};

/** 只播放审批回执里的源片；与旁边当前选中段/版本没有关联。 */
export function ManhuaPilotReviewPanel({
  state,
  onReview,
  onRefresh,
}: {
  state: ManhuaPilotPanelState;
  onReview?: (decision: "approve" | "reject", taskId: string) => Promise<void>;
  onRefresh?: () => void;
}) {
  const [loadedUrl, setLoadedUrl] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [actionError, setActionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const outputUrl = /^https:\/\//i.test(state.outputUrl || "")
    ? state.outputUrl!
    : "";
  const busy = Boolean(state.busy || submitting);
  const canApprove = Boolean(
    state.status === "generated" &&
      state.taskId &&
      outputUrl &&
      loadedUrl === outputUrl &&
      !mediaError &&
      !state.error &&
      !actionError &&
      !busy
  );
  const decide = async (decision: "approve" | "reject") => {
    if (
      !state.taskId ||
      !onReview ||
      busy ||
      actionError ||
      state.error ||
      (decision === "approve" && !canApprove)
    )
      return;
    setSubmitting(true);
    setActionError("");
    try {
      await onReview(decision, state.taskId);
    } catch {
      setActionError("审核结果尚未确认，请刷新状态；不会自动重新出片");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-label="首段试片审核"
      className="mb-2 rounded-lg border border-amber-300/25 bg-amber-500/[0.06] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-amber-50">
            首段 10 秒质检门
          </h3>
          <p className="mt-1 text-[11px] text-slate-300">
            本次只审下方试片，批准后解锁本集当前生成档。
          </p>
          {state.taskId ? (
            <p className="mt-1 break-all font-mono text-[10px] text-slate-400">
              任务：{state.taskId}
            </p>
          ) : null}
        </div>
        {onRefresh ? (
          <button
            type="button"
            data-pilot-action="refresh"
            disabled={busy}
            onClick={onRefresh}
            className="rounded border border-white/20 px-2 py-1 text-[11px] text-slate-200 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
          >
            刷新审核状态
          </button>
        ) : null}
      </div>
      {outputUrl ? (
        <video
          key={`${state.taskId}:${outputUrl}`}
          src={outputUrl}
          controls
          playsInline
          preload="metadata"
          aria-label="本次待审核的十秒试片"
          className="mt-3 max-h-72 w-full rounded bg-[#10171f]"
          onLoadedData={() => {
            setLoadedUrl(outputUrl);
            setMediaError("");
          }}
          onError={() => {
            setLoadedUrl("");
            setMediaError(
              "试片暂时无法播放，请刷新审核状态后重试；不需要重新生成"
            );
          }}
        />
      ) : (
        <p className="mt-3 text-[11px] text-slate-300" role="status">
          {state.status === "submitting"
            ? "试片任务处理中，恢复原任务不会再次提交生成。"
            : state.status === "reconcile_manual"
              ? "原试片提交结果需要人工核对，已暂停再次生成；请联系管理员核对原任务。"
              : state.status === "failed"
                ? "原试片任务已失败，请核对失败信息后再决定是否重试。"
                : state.busy
                  ? "正在核对当前项目的审核记录…"
                  : state.error
                    ? "原审核记录尚未确认，暂不提交新的试片。"
                    : "尚无可审试片，请先生成第 1 段的前 10 秒。"}
        </p>
      )}
      {state.error || mediaError || actionError ? (
        <p role="alert" className="mt-2 text-[11px] text-red-200">
          {state.error || mediaError || actionError}
        </p>
      ) : null}
      {state.status === "generated" && onReview ? (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            data-pilot-action="reject"
            disabled={
              busy || !state.taskId || Boolean(state.error || actionError)
            }
            onClick={() => void decide("reject")}
            className="rounded border border-white/20 px-3 py-2 text-xs text-slate-200 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
          >
            退回调整
          </button>
          <button
            type="button"
            data-pilot-action="approve"
            disabled={!canApprove}
            onClick={() => void decide("approve")}
            className="rounded border border-cyan-300/40 bg-cyan-500/20 px-3 py-2 text-xs font-semibold text-cyan-50 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
          >
            {busy ? "正在保存审核…" : "质量达标，解锁"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
