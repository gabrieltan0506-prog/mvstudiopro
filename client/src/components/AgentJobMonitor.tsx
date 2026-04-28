import React, { useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, Crown, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import ReportRenderer from "@/components/ReportRenderer";

interface AgentJobMonitorProps {
  jobId: string;
  /** 完成时的回调（可用于刷新列表） */
  onCompleted?: () => void;
  /** 失败时的回调 */
  onFailed?: () => void;
  /** 是否在底部展示完整报告（默认 true） */
  showReport?: boolean;
}

/**
 * 通用 Agent 任务监控器
 * - 轮询 trpc.agent.getJob
 * - 状态徽章 + 进度文本 + 心跳信息
 * - 计划审核阶段 UI（调 deepResearch.approvePlan）
 * - 完成时展示报告（ReportRenderer）
 */
export default function AgentJobMonitor({ jobId, onCompleted, onFailed, showReport = true }: AgentJobMonitorProps) {
  const [planFeedback, setPlanFeedback] = useState("");

  const jobQuery = trpc.agent.getJob.useQuery(
    { jobId },
    {
      refetchInterval: (q) => {
        const s = q.state.data?.status;
        if (s === "completed" || s === "failed") return false;
        if (s === "awaiting_plan_approval") return 30_000;
        return 15_000;
      },
      retry: false,
    },
  );

  const approvePlanMutation = trpc.deepResearch.approvePlan.useMutation({
    onSuccess: () => {
      setPlanFeedback("");
      void jobQuery.refetch();
    },
    onError: (e) => alert("批准计划失败：" + e.message),
  });

  React.useEffect(() => {
    const s = jobQuery.data?.status;
    if (s === "completed") onCompleted?.();
    if (s === "failed") onFailed?.();
  }, [jobQuery.data?.status]);

  if (jobQuery.isLoading || !jobQuery.data) {
    return (
      <div style={{ padding: 20, color: "rgba(160,140,90,0.7)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
        <Loader2 size={14} className="animate-spin" /> 正在加载任务状态…
      </div>
    );
  }

  const job = jobQuery.data;
  const status = job.status;

  // ── 状态徽章颜色
  const badgeColor =
    status === "completed" ? { bg: "rgba(22,163,74,0.15)", border: "rgba(22,163,74,0.45)", color: "#86efac" }
    : status === "failed" ? { bg: "rgba(220,38,38,0.15)", border: "rgba(220,38,38,0.45)", color: "#fca5a5" }
    : status === "awaiting_plan_approval" ? { bg: "rgba(168,118,27,0.18)", border: "rgba(168,118,27,0.55)", color: "#d6a861" }
    : { bg: "rgba(0,180,255,0.12)", border: "rgba(0,180,255,0.40)", color: "#7dd3fc" };

  const statusLabel = {
    pending: "排队中",
    planning: "规划中",
    awaiting_plan_approval: "等待审批计划",
    running: "深潜中",
    awaiting_review: "待审核",
    completed: "已完成",
    failed: "失败",
  }[status] ?? status;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 状态徽章 + 进度 */}
      <div style={{ padding: "16px 20px", background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.20)", borderRadius: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ padding: "4px 14px", borderRadius: 999, fontSize: 12, fontWeight: 800, background: badgeColor.bg, border: `1px solid ${badgeColor.border}`, color: badgeColor.color }}>
            {statusLabel}
          </span>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "rgba(168,118,27,0.55)" }}>jobId: {job.jobId.slice(0, 18)}…</span>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "rgba(245,235,210,0.85)", lineHeight: 1.7 }}>
          {job.progress || "—"}
        </p>
        {status === "failed" && job.error && (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "#fca5a5", lineHeight: 1.6 }}>
            ❌ {job.error}
          </p>
        )}
      </div>

      {/* 计划审核 UI */}
      {status === "awaiting_plan_approval" && job.planText && (
        <div style={{ padding: "20px 24px", background: "linear-gradient(135deg, rgba(168,118,27,0.10), rgba(122,84,16,0.06))", border: "1px solid rgba(168,118,27,0.40)", borderRadius: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <Sparkles size={18} color="#d6a861" />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: "#d6a861", letterSpacing: "0.04em" }}>
              研究计划已生成 · 请审核后批准开始深潜
            </h3>
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 12, color: "rgba(160,140,90,0.85)", lineHeight: 1.7 }}>
            Agent 已制定本次深潜的计划方向。可直接批准（按计划执行），也可补充意见后批准（Agent 会按反馈调整方向）。
          </p>
          {/* 计划文本 */}
          <div style={{ background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.25)", borderRadius: 10, padding: "14px 18px", marginBottom: 14, maxHeight: 320, overflow: "auto" }}>
            <pre style={{ margin: 0, fontFamily: "'Source Han Serif SC', Georgia, serif", fontSize: 13, lineHeight: 1.85, color: "rgba(245,235,210,0.92)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{job.planText}</pre>
          </div>
          {/* 反馈框 */}
          <textarea
            value={planFeedback}
            onChange={(e) => setPlanFeedback(e.target.value)}
            placeholder="（可选）补充意见或调整方向..."
            style={{ width: "100%", minHeight: 70, padding: "10px 12px", borderRadius: 10, background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.25)", color: "rgba(245,235,210,0.92)", fontSize: 13, lineHeight: 1.6, resize: "vertical", outline: "none", marginBottom: 12, fontFamily: "inherit", boxSizing: "border-box" }}
          />
          <button
            onClick={() => approvePlanMutation.mutate({ jobId, feedback: planFeedback.trim() || undefined })}
            disabled={approvePlanMutation.isPending}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 22px", borderRadius: 10, background: "linear-gradient(135deg,#a8761b,#7a5410)", border: "1px solid rgba(168,118,27,0.55)", color: "#fff7df", fontWeight: 900, fontSize: 13, cursor: approvePlanMutation.isPending ? "not-allowed" : "pointer", opacity: approvePlanMutation.isPending ? 0.6 : 1 }}
          >
            {approvePlanMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Crown size={14} />}
            {planFeedback.trim() ? "按反馈调整后开始深潜" : "批准计划 · 开始深潜"}
          </button>
        </div>
      )}

      {/* 完成报告 */}
      {status === "completed" && job.reportMarkdown && showReport && (
        <div style={{ padding: "20px 24px", background: "rgba(22,163,74,0.06)", border: "1px solid rgba(22,163,74,0.25)", borderRadius: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <CheckCircle2 size={18} color="#86efac" />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: "#86efac" }}>战报已生成</h3>
          </div>
          <div style={{ background: "rgba(0,0,0,0.20)", border: "1px solid rgba(168,118,27,0.20)", borderRadius: 10, padding: "16px 18px", maxHeight: 700, overflow: "auto" }}>
            <ReportRenderer markdown={job.reportMarkdown} />
          </div>
        </div>
      )}

      {status === "failed" && (
        <div style={{ padding: "16px 20px", background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <AlertCircle size={16} color="#fca5a5" />
          <span style={{ color: "#fca5a5", fontSize: 13 }}>任务失败，积分已退回。请检查输入或稍后重试。</span>
        </div>
      )}
    </div>
  );
}
