/**
 * 主编战略情报工作台
 * 仅 supervisor（mvs-supervisor-access）可访问
 * 查看所有用户研报、采纳优质情报并发放 300 点奖励
 */
import { useState } from "react";
import { useLocation } from "wouter";
import {
  ChevronLeft, Crown, Shield, CheckCircle, XCircle, Loader2,
  FileText, Clock, Star, AlertTriangle, Eye,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

const SUPERVISOR_KEY = "mvs-supervisor-access";

export default function SupervisorDeepResearchPage() {
  const [, navigate] = useLocation();
  const [selectedReport, setSelectedReport] = useState<{ title: string; markdown: string } | null>(null);
  const [rewardingId, setRewardingId] = useState<number | null>(null);
  const [rewardedIds, setRewardedIds] = useState<Set<number>>(new Set());

  const isSupervisor = typeof window !== "undefined" && !!localStorage.getItem(SUPERVISOR_KEY);

  const { data, isLoading, refetch } = trpc.deepResearch.supervisorListAll.useQuery(undefined, {
    enabled: isSupervisor,
  });

  const rewardMutation = trpc.deepResearch.supervisorReward.useMutation({
    onSuccess: (_data, variables) => {
      setRewardedIds((prev) => new Set(prev).add(variables.reportId));
      alert(`✅ 已向用户 #${variables.userId} 发放 ${variables.credits} 点奖励！`);
    },
    onError: (err) => alert(`❌ 发放失败：${err.message}`),
    onSettled: () => setRewardingId(null),
  });

  // 权限拦截
  if (!isSupervisor) {
    return (
      <div style={{ minHeight: "100vh", background: "#050300", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
        <AlertTriangle size={40} color="#f87171" />
        <p style={{ color: "#f87171", fontSize: 16, fontWeight: 700 }}>无访问权限</p>
        <button onClick={() => navigate("/")} style={{ color: "rgba(245,200,80,0.6)", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}>返回首页</button>
      </div>
    );
  }

  const reports = data?.reports ?? [];
  const completed = reports.filter((r) => r.status === "completed");
  const processing = reports.filter((r) => r.status === "processing");

  // ─── 阅读模式 ──────────────────────────────────────────────────────────────
  if (selectedReport) {
    return (
      <div style={{ minHeight: "100vh", background: "#050300", fontFamily: "'Inter',sans-serif" }}>
        <div style={{ borderBottom: "1px solid rgba(180,130,0,0.20)", background: "rgba(5,3,0,0.97)", backdropFilter: "blur(14px)", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 50 }}>
          <button onClick={() => setSelectedReport(null)} style={{ color: "rgba(245,200,80,0.6)", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            <ChevronLeft size={16} />返回工作台
          </button>
          <span style={{ color: "rgba(245,200,80,0.2)" }}>/</span>
          <span style={{ color: "rgba(245,200,80,0.85)", fontSize: 13, fontWeight: 700, maxWidth: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedReport.title}</span>
        </div>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px 80px", color: "rgba(255,255,255,0.82)", fontSize: 14, lineHeight: 1.9 }}>
          {selectedReport.markdown.split("\n").map((line, i) => {
            if (line.startsWith("# "))  return <h1 key={i} style={{ fontSize: 22, fontWeight: 900, color: "#f5c842", margin: "28px 0 12px", borderBottom: "1px solid rgba(180,130,0,0.25)", paddingBottom: 8 }}>{line.slice(2)}</h1>;
            if (line.startsWith("## ")) return <h2 key={i} style={{ fontSize: 17, fontWeight: 800, color: "#d4a840", margin: "24px 0 10px", borderLeft: "3px solid #c8a000", paddingLeft: 12 }}>{line.slice(3)}</h2>;
            if (line.startsWith("### ")) return <h3 key={i} style={{ fontSize: 15, fontWeight: 700, color: "#c09030", margin: "18px 0 8px" }}>{line.slice(4)}</h3>;
            if (line.startsWith("- ") || line.startsWith("* ")) return <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}><span style={{ color: "#c8a000" }}>•</span><span>{line.slice(2)}</span></div>;
            if (!line.trim()) return <div key={i} style={{ height: 8 }} />;
            return <p key={i} style={{ margin: "4px 0" }}>{line}</p>;
          })}
        </div>
      </div>
    );
  }

  // ─── 工作台主页 ────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#050300", fontFamily: "'Inter',sans-serif" }}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      {/* 顶部导航 */}
      <div style={{ borderBottom: "1px solid rgba(180,130,0,0.20)", background: "rgba(5,3,0,0.97)", backdropFilter: "blur(14px)", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 50 }}>
        <button onClick={() => navigate("/")} style={{ color: "rgba(245,200,80,0.5)", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          <ChevronLeft size={16} />首页
        </button>
        <span style={{ color: "rgba(245,200,80,0.2)" }}>/</span>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Shield size={14} color="rgba(245,200,80,0.7)" />
          <span style={{ color: "rgba(245,200,80,0.85)", fontSize: 13, fontWeight: 700 }}>主编战略情报工作台</span>
        </div>
        <button
          onClick={() => refetch()}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, background: "rgba(180,130,0,0.10)", border: "1px solid rgba(180,130,0,0.25)", color: "rgba(245,200,80,0.7)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
        >
          刷新
        </button>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "36px 24px 80px" }}>
        {/* 标题 */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 36 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: "linear-gradient(135deg,#c8a000,#8a6200)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 24px rgba(200,160,0,0.30)" }}>
            <Crown size={22} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 900, background: "linear-gradient(90deg,#f5c842,#c8a000)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: 0 }}>
              主编工作台
            </h1>
            <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, margin: "4px 0 0" }}>
              采纳情报 · 发放 300 点奖励 · 共 {reports.length} 份研报
              {processing.length > 0 && <span style={{ color: "#fbbf24" }}> · {processing.length} 份推演中</span>}
            </p>
          </div>
        </div>

        {/* 统计条 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
          {[
            { label: "全部研报", value: reports.length, color: "#f5c842" },
            { label: "已完成", value: completed.length, color: "#4ade80" },
            { label: "推演中", value: processing.length, color: "#fbbf24" },
          ].map((item) => (
            <div key={item.label} style={{ background: "rgba(180,130,0,0.05)", border: "1px solid rgba(180,130,0,0.18)", borderRadius: 14, padding: "16px 20px" }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: item.color }}>{item.value}</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>{item.label}</div>
            </div>
          ))}
        </div>

        {isLoading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "80px 0", color: "rgba(245,200,80,0.5)" }}>
            <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
            <span>加载所有研报…</span>
          </div>
        )}

        {/* 研报列表 */}
        {!isLoading && reports.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {reports.map((report) => {
              const isCompleted = report.status === "completed";
              const isRewarded = rewardedIds.has(report.id);
              const isRewarding = rewardingId === report.id;

              return (
                <div
                  key={report.id}
                  style={{ background: "rgba(180,130,0,0.03)", border: "1px solid rgba(180,130,0,0.18)", borderRadius: 16, padding: "20px 22px" }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                    {/* 封面缩略图 */}
                    <div style={{ width: 56, height: 75, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: "rgba(180,130,0,0.10)", border: "1px solid rgba(180,130,0,0.20)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {report.coverUrl ? (
                        <img src={report.coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <FileText size={18} color="rgba(245,200,80,0.4)" />
                      )}
                    </div>

                    {/* 主体信息 */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.30)", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 6, padding: "2px 7px" }}>
                          用户 #{report.userId}
                        </span>
                        <span style={{ fontSize: 10, color: isCompleted ? "#4ade80" : report.status === "failed" ? "#f87171" : "#fbbf24" }}>
                          {isCompleted ? "✓ 已完成" : report.status === "failed" ? "✗ 失败" : "⏳ 推演中"}
                        </span>
                        {report.duration && <span style={{ fontSize: 10, color: "rgba(245,200,80,0.4)" }}>⏱ {report.duration}m</span>}
                        {isRewarded && (
                          <span style={{ fontSize: 10, color: "#4ade80", fontWeight: 700 }}>🎖 已奖励 300 点</span>
                        )}
                      </div>
                      <h3 style={{ fontSize: 15, fontWeight: 800, color: "rgba(255,255,255,0.88)", margin: "0 0 6px", lineHeight: 1.4 }}>
                        {report.lighthouseTitle || report.title}
                      </h3>
                      {report.summary && (
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: "0 0 8px", lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {report.summary}
                        </p>
                      )}
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
                        <Clock size={10} />
                        {new Date(report.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>

                    {/* 操作按钮 */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
                      {isCompleted && report.reportMarkdown && (
                        <button
                          onClick={() => setSelectedReport({ title: report.lighthouseTitle || report.title, markdown: report.reportMarkdown! })}
                          style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 9, background: "rgba(180,130,0,0.10)", border: "1px solid rgba(180,130,0,0.28)", color: "rgba(245,200,80,0.65)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                        >
                          <Eye size={13} />阅读
                        </button>
                      )}
                      {isCompleted && !isRewarded && (
                        <button
                          disabled={isRewarding}
                          onClick={() => {
                            if (!confirm(`确认采纳用户 #${report.userId} 的情报「${(report.lighthouseTitle || report.title).slice(0, 20)}」，并发放 300 点奖励？`)) return;
                            setRewardingId(report.id);
                            rewardMutation.mutate({ userId: report.userId, reportId: report.id, credits: 300 });
                          }}
                          style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 16px", borderRadius: 9, background: isRewarding ? "rgba(74,222,128,0.05)" : "linear-gradient(135deg,rgba(74,222,128,0.15),rgba(34,197,94,0.10))", border: "1px solid rgba(74,222,128,0.35)", color: isRewarding ? "rgba(74,222,128,0.35)" : "#4ade80", fontSize: 12, fontWeight: 800, cursor: isRewarding ? "not-allowed" : "pointer" }}
                        >
                          {isRewarding ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Star size={13} />}
                          {isRewarding ? "发放中…" : "采纳 · 奖励 300 点"}
                        </button>
                      )}
                      {isRewarded && (
                        <span style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 9, background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.20)", color: "rgba(74,222,128,0.5)", fontSize: 12, fontWeight: 700 }}>
                          <CheckCircle size={13} />已采纳
                        </span>
                      )}
                      {report.status === "failed" && (
                        <span style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 9, background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.20)", color: "rgba(248,113,113,0.5)", fontSize: 12 }}>
                          <XCircle size={13} />失败
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!isLoading && reports.length === 0 && (
          <div style={{ textAlign: "center", padding: "80px 0", color: "rgba(255,255,255,0.25)", fontSize: 14 }}>
            暂无研报记录
          </div>
        )}
      </div>
    </div>
  );
}
