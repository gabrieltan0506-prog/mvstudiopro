import React, { useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, Crown, Sparkles, Bug } from "lucide-react";
import { toast } from "sonner";
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
  /** 是否可见 Debug Panel 切换按钮（默认看 localStorage 里的 supervisor key） */
  showDebugToggle?: boolean;
}

const SUPERVISOR_KEY = "mvs-supervisor-access";
function hasSupervisorAccess(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(SUPERVISOR_KEY) === "1") return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("supervisor") === "1") return true;
  } catch {}
  return false;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "排队中",
  planning: "规划中",
  awaiting_plan_approval: "等待审批计划",
  running: "深潜中",
  awaiting_review: "待审核",
  completed: "已完成",
  failed: "失败",
};

/**
 * 通用 Agent 任务监控器
 * - 轮询 trpc.agent.getJob
 * - 顶部状态徽章 + 真信号进度条（基于 progress 字符串里的百分比 / fallback 心跳估算）
 * - 计划审核阶段 UI（调 deepResearch.approvePlan）
 * - 完成时展示报告（ReportRenderer）
 * - Debug Panel（DEEP RESEARCH DEBUG TERMINAL，supervisor 可见）：
 *   PHASE / JOB_ID / CREATED_AT / ELAPSED / CREDITS / ATTEMPT / PID / DB_REC /
 *   心跳新鲜度 / progress 多行日志 / error / errorDetail / 上传文件清单
 */
export default function AgentJobMonitor({
  jobId,
  onCompleted,
  onFailed,
  showReport = true,
  showDebugToggle,
}: AgentJobMonitorProps) {
  const [planFeedback, setPlanFeedback] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const isSupervisor = showDebugToggle ?? hasSupervisorAccess();

  const jobQuery = trpc.agent.getJob.useQuery(
    { jobId },
    {
      refetchInterval: (q) => {
        const s = q.state.data?.status;
        if (s === "completed" || s === "failed") return false;
        if (s === "awaiting_plan_approval") return 30_000;
        return 8_000;
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
    const creditsUsed = jobQuery.data?.creditsUsed;
    if (s === "completed") onCompleted?.();
    if (s === "failed") {
      onFailed?.();
      if (typeof creditsUsed === "number" && creditsUsed > 0) {
        toast.message("任务未成功完成，已扣积分已退还至账户余额。当前算力资源可能紧张，请稍后再试。", { duration: 6500 });
      } else {
        toast.error("任务未成功完成，请稍后再试。", { duration: 5000 });
      }
    }
  }, [jobQuery.data?.status, jobQuery.data?.creditsUsed, onCompleted, onFailed]);

  if (jobQuery.isLoading || !jobQuery.data) {
    return (
      <div style={{ padding: 20, color: "rgba(160,140,90,0.7)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
        <Loader2 size={14} className="animate-spin" /> 正在加载任务状态…
      </div>
    );
  }

  const job = jobQuery.data as any;
  const status: string = job.status;

  // ── 进度推算 ───────────────────────────────────────────────────────────
  // 优先解析 progress 字符串里的百分比；否则基于 createdAt → 90 分钟上限估算
  const pctMatch = (job.progress || "").match(/(\d+(?:\.\d+)?)\s*%/);
  const realPct = pctMatch ? Math.min(100, parseFloat(pctMatch[1])) : null;
  const createdMs = job.createdAt ? new Date(job.createdAt).getTime() : Date.now();
  const elapsedMs = Date.now() - createdMs;
  const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const fallbackPct = status === "completed" ? 100 : status === "failed" ? 100 : Math.min(95, (elapsedMs / (90 * 60 * 1000)) * 100);
  const progressPct = realPct ?? fallbackPct;
  const elapsedLabel = elapsedSec >= 60 ? `${Math.floor(elapsedSec / 60)} 分 ${elapsedSec % 60} 秒` : `${elapsedSec} 秒`;

  // 心跳新鲜度
  const heartbeatMs = job.lastHeartbeatAt ? new Date(job.lastHeartbeatAt).getTime() : null;
  const heartbeatSec = heartbeatMs ? Math.max(0, Math.floor((Date.now() - heartbeatMs) / 1000)) : null;
  const heartbeatFresh = heartbeatSec === null ? true : heartbeatSec < 90;

  // ── 状态徽章颜色 ───────────────────────────────────────────────────────
  const badgeColor =
    status === "completed" ? { bg: "rgba(22,163,74,0.15)", border: "rgba(22,163,74,0.45)", color: "#86efac" }
    : status === "failed" ? { bg: "rgba(220,38,38,0.15)", border: "rgba(220,38,38,0.45)", color: "#fca5a5" }
    : status === "awaiting_plan_approval" ? { bg: "rgba(168,118,27,0.18)", border: "rgba(168,118,27,0.55)", color: "#d6a861" }
    : { bg: "rgba(0,180,255,0.12)", border: "rgba(0,180,255,0.40)", color: "#7dd3fc" };

  const statusLabel = STATUS_LABEL[status] ?? status;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── 顶部状态卡 + 进度条 + 心跳 ─────────────────────────────────── */}
      <div style={{ padding: "20px 24px", background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.20)", borderRadius: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ padding: "4px 14px", borderRadius: 999, fontSize: 12, fontWeight: 800, background: badgeColor.bg, border: `1px solid ${badgeColor.border}`, color: badgeColor.color }}>
            {statusLabel}
          </span>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "rgba(168,118,27,0.55)" }}>
            jobId: {String(job.jobId || "").slice(0, 18)}…
          </span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(168,118,27,0.65)", fontFamily: "monospace" }}>
            已运行 {elapsedLabel} ·{" "}
            <span style={{ color: heartbeatFresh ? "rgba(22,163,74,0.85)" : "rgba(239,68,68,0.85)" }}>
              {heartbeatSec === null ? "等待首次心跳" : `心跳 ${heartbeatSec}s 前`}
            </span>
          </span>
          {isSupervisor && (
            <button
              onClick={() => setShowDebug((v) => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", fontSize: 11, fontWeight: 700, background: "rgba(168,118,27,0.10)", border: "1px solid rgba(168,118,27,0.30)", borderRadius: 999, color: "#d6a861", cursor: "pointer", fontFamily: "monospace" }}
            >
              <Bug size={11} /> {showDebug ? "隐藏 Debug" : "Debug 终端"}
            </button>
          )}
        </div>
        {typeof job.creditsUsed === "number" && job.creditsUsed > 0 && (
          <p style={{ margin: "0 0 12px", fontSize: 12, color: "rgba(245,200,100,0.95)", fontWeight: 700, lineHeight: 1.5 }}>
            本次任务已扣除 <span style={{ color: "#f5c842" }}>{job.creditsUsed}</span> 点积分
            <span style={{ fontWeight: 600, color: "rgba(160,140,90,0.85)" }}>（以账户积分记录为准）</span>
          </p>
        )}

        {/* 进度文本（live backend signal） */}
        <p style={{ margin: 0, fontSize: 13, color: "rgba(245,235,210,0.85)", lineHeight: 1.7 }}>
          {job.progress || "—"}
        </p>

        {/* 进度条 + 百分比 */}
        {status !== "awaiting_plan_approval" && status !== "awaiting_review" && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(168,118,27,0.55)", fontFamily: "monospace" }}>
                {realPct !== null ? "REAL PROGRESS" : "ELAPSED EST"}
              </span>
              <span style={{ fontSize: 13, fontWeight: 900, color: "#d6a861", fontFamily: "monospace" }}>
                {progressPct.toFixed(1)}%
              </span>
            </div>
            <div style={{ height: 4, background: "rgba(168,118,27,0.12)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progressPct}%`, background: status === "failed" ? "linear-gradient(90deg,#7a1d1d,#ef4444)" : "linear-gradient(90deg,#7a5410,#c8a000,#f5c842)", borderRadius: 2, transition: "width 1s linear", boxShadow: "0 0 8px rgba(200,160,0,0.45)" }} />
            </div>
          </div>
        )}

        {status === "failed" && job.error && (
          <p style={{ margin: "10px 0 0", fontSize: 13, color: "#fca5a5", lineHeight: 1.7 }}>
            {job.error}
          </p>
        )}
      </div>

      {/* ── Debug 终端（仅 supervisor 可见）──────────────────────────────── */}
      {isSupervisor && showDebug && (
        <div style={{ background: "#000", border: "1px solid rgba(0,255,70,0.25)", borderRadius: 12, padding: "18px 20px", fontFamily: "monospace", fontSize: 11, color: "#00ff46", lineHeight: 1.7 }}>
          <p style={{ color: "rgba(0,255,70,0.45)", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 12 }}>▶ DEEP RESEARCH DEBUG TERMINAL</p>

          {/* 基础字段 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {[
              { k: "STATUS", v: status },
              { k: "JOB_ID", v: String(job.jobId || "—") },
              { k: "CREATED_AT", v: job.createdAt ? new Date(job.createdAt).toLocaleTimeString("zh-CN") : "—" },
              { k: "ELAPSED", v: elapsedLabel },
              { k: "CREDITS", v: job.creditsUsed != null ? `${job.creditsUsed} 点` : "—" },
              { k: "ATTEMPT", v: job.attemptCount != null ? `#${job.attemptCount}` : "—" },
              { k: "PID", v: job.pid != null ? String(job.pid) : "—" },
              { k: "DB_REC", v: job.dbRecordId != null ? `#${job.dbRecordId}` : "—" },
              { k: "HEARTBEAT", v: heartbeatSec == null ? "—" : `${heartbeatSec}s ago` },
            ].map(({ k, v }) => (
              <div key={k} style={{ background: "rgba(0,255,70,0.05)", border: "1px solid rgba(0,255,70,0.12)", borderRadius: 6, padding: "4px 10px", minWidth: 100 }}>
                <p style={{ color: "rgba(0,255,70,0.35)", fontSize: 9, margin: "0 0 2px", fontWeight: 700 }}>{k}</p>
                <p style={{ color: "#00ff46", fontSize: 11, margin: 0, wordBreak: "break-all" }}>{v}</p>
              </div>
            ))}
          </div>

          {/* 上传文件清单（确认有没有传到后端） */}
          {Array.isArray(job.supplementaryFiles) && job.supplementaryFiles.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ color: "rgba(0,255,70,0.4)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 6 }}>UPLOADED FILES ({job.supplementaryFiles.length})</p>
              <div style={{ background: "rgba(0,255,70,0.04)", border: "1px solid rgba(0,255,70,0.12)", borderRadius: 8, padding: "8px 12px" }}>
                {job.supplementaryFiles.map((f: any, i: number) => (
                  <div key={i} style={{ color: "rgba(0,255,70,0.85)", marginBottom: 2, wordBreak: "break-all" }}>
                    [{f.type}] {f.name} <span style={{ color: "rgba(0,255,70,0.45)" }}>({f.mimeType})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* progress 日志（多行） */}
          {job.progress && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ color: "rgba(0,255,70,0.4)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 6 }}>PROGRESS LOG</p>
              <div style={{ background: "rgba(0,255,70,0.04)", border: "1px solid rgba(0,255,70,0.12)", borderRadius: 8, padding: "10px 14px", maxHeight: 220, overflowY: "auto" }}>
                {String(job.progress).split("\n").map((line, i) => (
                  <div key={i} style={{ color: line.includes("❌") || line.includes("失败") ? "#ff7070" : line.includes("✅") || line.includes("完成") ? "#00ff46" : line.includes("⏳") || line.includes("进行") ? "#00b4ff" : "rgba(0,255,70,0.75)", marginBottom: 2, wordBreak: "break-all" }}>
                    {line || <span style={{ opacity: 0.2 }}>—</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 错误 */}
          {job.error && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ color: "rgba(255,80,80,0.6)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 6 }}>ERROR</p>
              <div style={{ background: "rgba(255,50,50,0.06)", border: "1px solid rgba(255,50,50,0.2)", borderRadius: 8, padding: "10px 14px", color: "#ff7070", wordBreak: "break-all" }}>
                {job.error}
              </div>
            </div>
          )}

          {/* errorDetail（含原始 API 响应、stage、stack） */}
          {job.errorDetail && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ color: "rgba(255,80,80,0.6)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 6 }}>ERROR DETAIL · RAW API RESPONSE</p>
              <pre style={{ fontSize: 10, color: "#ffb0b0", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 320, overflowY: "auto", margin: 0, lineHeight: 1.6, background: "rgba(255,50,50,0.04)", border: "1px solid rgba(255,50,50,0.18)", borderRadius: 8, padding: "10px 12px" }}>
                {job.errorDetail}
              </pre>
            </div>
          )}

          {jobQuery.error && (
            <p style={{ color: "#ff7070", fontSize: 10, marginTop: 8 }}>轮询错误：{jobQuery.error.message}</p>
          )}
        </div>
      )}

      {/* ── 计划审核 UI ───────────────────────────────────────────────── */}
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
          <div style={{ background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.25)", borderRadius: 10, padding: "14px 18px", marginBottom: 14, maxHeight: 320, overflow: "auto" }}>
            <pre style={{ margin: 0, fontFamily: "'Source Han Serif SC', Georgia, serif", fontSize: 13, lineHeight: 1.85, color: "rgba(245,235,210,0.92)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{job.planText}</pre>
          </div>
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

      {/* ── 完成报告 ─────────────────────────────────────────────────── */}
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
        <div style={{ padding: "16px 20px", background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 12, display: "flex", alignItems: "flex-start", gap: 10 }}>
          <AlertCircle size={16} color="#fca5a5" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ color: "rgba(245,235,210,0.88)", fontSize: 13, lineHeight: 1.65 }}>
            <p style={{ margin: 0 }}>
              {typeof job.creditsUsed === "number" && job.creditsUsed > 0
                ? "若积分未立即显示，请稍后刷新账户；退回一般会在数秒内完成。"
                : "请检查网络后重试。"}
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "rgba(160,140,90,0.75)" }}>
              技术细节见下方 Debug 终端（管理员模式）。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
