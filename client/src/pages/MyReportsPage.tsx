import { useState } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, Crown, RefreshCw, FileText, Clock, CheckCircle, XCircle, Loader2, Download } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function MyReportsPage() {
  const [, navigate] = useLocation();
  const [selectedReport, setSelectedReport] = useState<{ title: string; markdown: string } | null>(null);

  const { data, isLoading, refetch, isFetching } = trpc.deepResearch.myReports.useQuery(undefined, {
    refetchInterval: (data) => {
      // 如果有 processing 中的任务，每 30 秒自动刷新
      const hasProcessing = data?.state?.data?.reports?.some((r: any) => r.status === "processing");
      return hasProcessing ? 30000 : false;
    },
  });

  const reports = data?.reports ?? [];

  if (selectedReport) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#050300 0%,#0a0600 40%,#0e0800 100%)", fontFamily: "'Inter',sans-serif" }}>
        {/* 顶部导航 */}
        <div style={{ borderBottom: "1px solid rgba(180,130,0,0.20)", background: "rgba(5,3,0,0.95)", backdropFilter: "blur(14px)", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 50 }}>
          <button onClick={() => setSelectedReport(null)} style={{ color: "rgba(245,200,80,0.6)", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            <ChevronLeft size={16} />返回研报列表
          </button>
          <span style={{ color: "rgba(245,200,80,0.2)" }}>/</span>
          <span style={{ color: "rgba(245,200,80,0.85)", fontSize: 13, fontWeight: 700, maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedReport.title}</span>
          <button
            onClick={() => {
              const blob = new Blob([selectedReport.markdown], { type: "text/markdown;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `战报-${selectedReport.title.slice(0, 30)}.md`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, background: "rgba(180,130,0,0.12)", border: "1px solid rgba(180,130,0,0.3)", color: "#f5c842", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
          >
            <Download size={13} />下载 Markdown
          </button>
        </div>

        <div style={{ maxWidth: 900, margin: "0 auto", padding: "36px 24px 80px" }}>
          <ReportRenderer markdown={selectedReport.markdown} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#050300 0%,#0a0600 40%,#0e0800 100%)", fontFamily: "'Inter',sans-serif", position: "relative", overflow: "hidden" }}>
      {/* 背景光晕 */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "10%", right: "10%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle,rgba(180,130,0,0.10) 0%,transparent 65%)", filter: "blur(80px)" }} />
        <div style={{ position: "absolute", bottom: "15%", left: "5%", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle,rgba(120,80,0,0.08) 0%,transparent 65%)", filter: "blur(60px)" }} />
      </div>

      {/* 顶部导航 */}
      <div style={{ borderBottom: "1px solid rgba(180,130,0,0.20)", background: "rgba(5,3,0,0.95)", backdropFilter: "blur(14px)", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 50 }}>
        <button onClick={() => navigate("/")} style={{ color: "rgba(245,200,80,0.5)", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          <ChevronLeft size={16} />首页
        </button>
        <span style={{ color: "rgba(245,200,80,0.2)" }}>/</span>
        <span style={{ color: "rgba(245,200,80,0.85)", fontSize: 13, fontWeight: 700 }}>我的战报中心</span>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, background: "rgba(180,130,0,0.10)", border: "1px solid rgba(180,130,0,0.25)", color: isFetching ? "rgba(245,200,80,0.3)" : "rgba(245,200,80,0.7)", fontSize: 12, fontWeight: 700, cursor: isFetching ? "not-allowed" : "pointer" }}
        >
          <RefreshCw size={13} style={{ animation: isFetching ? "spin 1s linear infinite" : "none" }} />刷新
        </button>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px 80px", position: "relative", zIndex: 2 }}>

        {/* 标题 */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 32 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: "linear-gradient(135deg,#c8a000,#8a6200)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 24px rgba(200,160,0,0.30)", flexShrink: 0 }}>
            <Crown size={22} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 900, background: "linear-gradient(90deg,#f5c842,#c8a000)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: 0 }}>
              我的战报中心
            </h1>
            <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, margin: "4px 0 0" }}>AI 上帝视角 · 全景行业战报归档</p>
          </div>
          <button
            onClick={() => navigate("/god-view")}
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, padding: "10px 20px", borderRadius: 10, background: "linear-gradient(135deg,#c8a000,#8a6200)", border: "none", color: "#050300", fontWeight: 900, fontSize: 13, cursor: "pointer", boxShadow: "0 0 16px rgba(200,160,0,0.25)", flexShrink: 0 }}
          >
            <Crown size={14} />发起新研报
          </button>
        </div>

        {/* 加载中 */}
        {isLoading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "80px 0", color: "rgba(245,200,80,0.5)" }}>
            <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: 14 }}>加载研报列表…</span>
          </div>
        )}

        {/* 空列表 */}
        {!isLoading && reports.length === 0 && (
          <div style={{ textAlign: "center", padding: "80px 24px" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
            <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 15, marginBottom: 24 }}>暂无战报记录</p>
            <button
              onClick={() => navigate("/god-view")}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 28px", borderRadius: 12, background: "linear-gradient(135deg,#c8a000,#8a6200)", border: "none", color: "#050300", fontWeight: 900, fontSize: 14, cursor: "pointer" }}
            >
              <Crown size={15} />立即发起首份战报
            </button>
          </div>
        )}

        {/* 研报列表 */}
        {!isLoading && reports.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {reports.map((report: any) => (
              <ReportCard key={report.id} report={report} onRead={() => setSelectedReport({ title: report.title, markdown: report.reportMarkdown })} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
      `}</style>
    </div>
  );
}

function ReportCard({ report, onRead }: { report: any; onRead: () => void }) {
  const statusMap: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string; border: string }> = {
    processing: {
      icon: <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />,
      label: "算力推演中…",
      color: "#fbbf24",
      bg: "rgba(251,191,36,0.08)",
      border: "rgba(251,191,36,0.25)",
    },
    completed: {
      icon: <CheckCircle size={14} />,
      label: "已完成",
      color: "#4ade80",
      bg: "rgba(74,222,128,0.08)",
      border: "rgba(74,222,128,0.25)",
    },
    failed: {
      icon: <XCircle size={14} />,
      label: "生成失败",
      color: "#f87171",
      bg: "rgba(248,113,113,0.08)",
      border: "rgba(248,113,113,0.25)",
    },
  };

  const s = statusMap[report.status] ?? statusMap.processing;

  return (
    <div style={{ background: "rgba(180,130,0,0.04)", border: "1px solid rgba(180,130,0,0.18)", borderRadius: 16, padding: "20px 22px", transition: "border-color 0.2s, box-shadow 0.2s" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(180,130,0,0.35)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 0 24px rgba(180,130,0,0.10)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(180,130,0,0.18)"; (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        {/* 文件图标 */}
        <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(180,130,0,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <FileText size={18} color="rgba(245,200,80,0.6)" />
        </div>

        {/* 主体信息 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: "rgba(255,255,255,0.88)", margin: "0 0 6px", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
            {report.title}
          </h3>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {/* 状态标签 */}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: s.color, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 99, padding: "3px 10px" }}>
              {s.icon}{s.label}
            </span>
            {/* 时间 */}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "rgba(255,255,255,0.28)" }}>
              <Clock size={11} />{new Date(report.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
            {/* 积分 */}
            {report.creditsUsed > 0 && (
              <span style={{ fontSize: 11, color: "rgba(245,200,80,0.4)" }}>{report.creditsUsed.toLocaleString()} 点</span>
            )}
          </div>
          {/* 进度提示 */}
          {report.progress && report.status !== "completed" && (
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: "8px 0 0", lineHeight: 1.5 }}>{report.progress}</p>
          )}
          {/* 失败原因 */}
          {report.error && report.status === "failed" && (
            <p style={{ fontSize: 12, color: "rgba(248,113,113,0.6)", margin: "6px 0 0" }}>原因：{report.error}</p>
          )}
        </div>

        {/* 操作按钮 */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
          {report.status === "completed" && report.reportMarkdown && (
            <button
              onClick={onRead}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 18px", borderRadius: 10, background: "linear-gradient(135deg,rgba(200,160,0,0.25),rgba(138,98,0,0.20))", border: "1px solid rgba(180,130,0,0.45)", color: "#f5c842", fontWeight: 800, fontSize: 13, cursor: "pointer", transition: "all 0.2s", boxShadow: "0 0 12px rgba(180,130,0,0.15)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg,#c8a000,#8a6200)"; (e.currentTarget as HTMLElement).style.color = "#050300"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg,rgba(200,160,0,0.25),rgba(138,98,0,0.20))"; (e.currentTarget as HTMLElement).style.color = "#f5c842"; }}
            >
              <FileText size={14} />阅读战报
            </button>
          )}
          {report.status === "processing" && (
            <span style={{ fontSize: 12, color: "rgba(251,191,36,0.5)", fontStyle: "italic" }}>约 15-30 分钟</span>
          )}
          {report.status === "failed" && (
            <span style={{ fontSize: 11, color: "rgba(248,113,113,0.5)" }}>积分已退回</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Markdown 渲染器（与 GodViewPage 共用同一套逻辑） */
function ReportRenderer({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  return (
    <div style={{ color: "rgba(255,255,255,0.82)", fontSize: 14, lineHeight: 1.9 }}>
      {lines.map((line, i) => {
        if (line.startsWith("# ")) return <h1 key={i} style={{ fontSize: 22, fontWeight: 900, color: "#f5c842", margin: "28px 0 12px", borderBottom: "1px solid rgba(180,130,0,0.25)", paddingBottom: 8 }}>{line.slice(2)}</h1>;
        if (line.startsWith("## ")) return <h2 key={i} style={{ fontSize: 17, fontWeight: 800, color: "#d4a840", margin: "24px 0 10px", borderLeft: "3px solid #c8a000", paddingLeft: 12 }}>{line.slice(3)}</h2>;
        if (line.startsWith("### ")) return <h3 key={i} style={{ fontSize: 15, fontWeight: 700, color: "#c09030", margin: "18px 0 8px" }}>{line.slice(4)}</h3>;
        if (line.startsWith("- ") || line.startsWith("* ")) return <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}><span style={{ color: "#c8a000", flexShrink: 0 }}>•</span><span>{renderInline(line.slice(2))}</span></div>;
        if (/^\d+\.\s/.test(line)) return <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}><span style={{ color: "#c8a000", minWidth: 20 }}>{line.match(/^\d+/)?.[0]}.</span><span>{renderInline(line.replace(/^\d+\.\s/, ""))}</span></div>;
        if (line.startsWith("> ")) return <blockquote key={i} style={{ borderLeft: "3px solid #8a6200", paddingLeft: 14, color: "rgba(245,200,80,0.65)", margin: "10px 0", fontStyle: "italic" }}>{renderInline(line.slice(2))}</blockquote>;
        if (line.startsWith("---") || line.startsWith("===")) return <hr key={i} style={{ border: "none", borderTop: "1px solid rgba(180,130,0,0.2)", margin: "20px 0" }} />;
        if (!line.trim()) return <div key={i} style={{ height: 8 }} />;
        return <p key={i} style={{ margin: "4px 0" }}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} style={{ color: "#ffd060" }}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} style={{ background: "rgba(180,130,0,0.15)", padding: "1px 6px", borderRadius: 4, color: "#ffc842", fontSize: 12 }}>{part.slice(1, -1)}</code>;
    return part;
  });
}
