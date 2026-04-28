import { useState } from "react";
import { useLocation } from "wouter";
import {
  ChevronLeft, Crown, RefreshCw, FileText, Clock, CheckCircle,
  XCircle, Loader2, Download, Book, Sparkles,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Report {
  id: number;
  title: string;
  lighthouseTitle?: string;
  topic: string;
  status: string;
  progress?: string;
  reportMarkdown?: string | null;
  error?: string | null;
  jobId?: string | null;
  creditsUsed: number;
  createdAt: string;
  coverUrl?: string | null;
  summary?: string | null;
  duration?: string | null;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MyReportsPage() {
  const [, navigate] = useLocation();
  const [selectedReport, setSelectedReport] = useState<{ title: string; markdown: string } | null>(null);

  const { data, isLoading, refetch, isFetching } = trpc.deepResearch.myReports.useQuery(undefined, {
    refetchInterval: (data) => {
      const hasProcessing = data?.state?.data?.reports?.some((r: any) => r.status === "processing");
      return hasProcessing ? 30000 : false;
    },
  });

  const reports = (data?.reports ?? []) as Report[];

  // ─── 阅读模式 ──────────────────────────────────────────────────────────────
  if (selectedReport) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#050300 0%,#0a0600 40%,#0e0800 100%)", fontFamily: "'Inter',sans-serif" }}>
        <div style={{ borderBottom: "1px solid rgba(180,130,0,0.20)", background: "rgba(5,3,0,0.95)", backdropFilter: "blur(14px)", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 50 }}>
          <button onClick={() => setSelectedReport(null)} style={{ color: "rgba(245,200,80,0.6)", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            <ChevronLeft size={16} />返回研报库
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

  // ─── 研报库主页 ────────────────────────────────────────────────────────────
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
        <span style={{ color: "rgba(245,200,80,0.85)", fontSize: 13, fontWeight: 700 }}>💎 战略智库 · 作品库</span>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, background: "rgba(180,130,0,0.10)", border: "1px solid rgba(180,130,0,0.25)", color: isFetching ? "rgba(245,200,80,0.3)" : "rgba(245,200,80,0.7)", fontSize: 12, fontWeight: 700, cursor: isFetching ? "not-allowed" : "pointer" }}
        >
          <RefreshCw size={13} style={{ animation: isFetching ? "spin 1s linear infinite" : "none" }} />刷新
        </button>
      </div>

      <div style={{ maxWidth: 1600, margin: "0 auto", padding: "40px 24px 80px", position: "relative", zIndex: 2 }}>
        {/* 标题区 */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 36 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg,#c8a000,#8a6200)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 24px rgba(200,160,0,0.30)", flexShrink: 0 }}>
            <Crown size={22} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 900, background: "linear-gradient(90deg,#f5c842,#c8a000)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: 0 }}>
              战略作品快照库
            </h1>
            <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, margin: "4px 0 0" }}>AI 上帝视角 · 全景行业战报 · 历史数据资产</p>
          </div>
          <button
            onClick={() => navigate("/god-view")}
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, padding: "10px 20px", borderRadius: 10, background: "linear-gradient(135deg,#c8a000,#8a6200)", border: "none", color: "#050300", fontWeight: 900, fontSize: 13, cursor: "pointer", boxShadow: "0 0 16px rgba(200,160,0,0.25)", flexShrink: 0 }}
          >
            <Sparkles size={14} />发起新战报
          </button>
        </div>

        {/* 加载中 */}
        {isLoading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "80px 0", color: "rgba(245,200,80,0.5)" }}>
            <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: 14 }}>加载作品库…</span>
          </div>
        )}

        {/* 空列表 */}
        {!isLoading && reports.length === 0 && (
          <div style={{ textAlign: "center", padding: "80px 24px" }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>📭</div>
            <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 15, marginBottom: 24 }}>作品库还是空的，发起第一份战报吧</p>
            <button
              onClick={() => navigate("/god-view")}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 28px", borderRadius: 12, background: "linear-gradient(135deg,#c8a000,#8a6200)", border: "none", color: "#050300", fontWeight: 900, fontSize: 14, cursor: "pointer" }}
            >
              <Crown size={15} />立即发起首份战报
            </button>
          </div>
        )}

        {/* 4 列封面网格 */}
        {!isLoading && reports.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 24 }}>
            {reports.map((report) => (
              <ReportCoverCard
                key={report.id}
                report={report}
                onRead={() => setSelectedReport({ title: report.lighthouseTitle || report.title, markdown: report.reportMarkdown! })}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
        @keyframes shimmer { 0%{background-position:-200% 0}100%{background-position:200% 0} }
      `}</style>
    </div>
  );
}

// ─── 封面卡片组件 ──────────────────────────────────────────────────────────────

function ReportCoverCard({ report, onRead }: { report: Report; onRead: () => void }) {
  const statusMap: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    processing: { icon: <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />, label: "推演中…", color: "#fbbf24" },
    completed:  { icon: <CheckCircle size={11} />, label: "已完成", color: "#4ade80" },
    failed:     { icon: <XCircle size={11} />,     label: "生成失败", color: "#f87171" },
  };
  const s = statusMap[report.status] ?? statusMap.processing;

  const displayTitle = report.lighthouseTitle || report.title;

  return (
    <div
      style={{
        background: "#0a0700",
        border: "1px solid rgba(180,130,0,0.22)",
        borderRadius: 18,
        overflow: "hidden",
        transition: "border-color 0.25s, box-shadow 0.25s, transform 0.25s",
        cursor: "default",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "rgba(200,160,0,0.55)";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 0 32px rgba(180,130,0,0.18)";
        (e.currentTarget as HTMLElement).style.transform = "translateY(-3px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "rgba(180,130,0,0.22)";
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
        (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
      }}
    >
      {/* 封面图 3:4 */}
      <div style={{ position: "relative", width: "100%", paddingTop: "133.33%", background: "linear-gradient(160deg,#1a1000 0%,#0a0700 100%)", overflow: "hidden" }}>
        {report.coverUrl ? (
          <img
            src={report.coverUrl}
            alt={displayTitle}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.85, transition: "opacity 0.3s, transform 0.5s" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLImageElement).style.transform = "scale(1.05)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLImageElement).style.transform = "scale(1)"; }}
          />
        ) : (
          /* 无封面时的占位符 */
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(180,130,0,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {report.status === "processing"
                ? <Loader2 size={24} color="rgba(245,200,80,0.4)" style={{ animation: "spin 1s linear infinite" }} />
                : <Book size={24} color="rgba(245,200,80,0.3)" />
              }
            </div>
            {report.status === "processing" && (
              <div style={{ fontSize: 11, color: "rgba(245,200,80,0.4)", textAlign: "center", padding: "0 16px" }}>
                {report.progress?.slice(-30) || "推演中…"}
              </div>
            )}
          </div>
        )}

        {/* 覆盖层：状态标签 */}
        <div style={{ position: "absolute", top: 10, left: 10, display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: s.color, background: "rgba(0,0,0,0.80)", border: `1px solid ${s.color}40`, borderRadius: 99, padding: "3px 8px", backdropFilter: "blur(4px)" }}>
          {s.icon}{s.label}
        </div>

        {/* 覆盖层：耗时 */}
        {report.duration && (
          <div style={{ position: "absolute", top: 10, right: 10, fontSize: 10, color: "rgba(245,200,80,0.65)", background: "rgba(0,0,0,0.70)", borderRadius: 6, padding: "2px 7px", backdropFilter: "blur(4px)" }}>
            ⏱ {report.duration}m
          </div>
        )}

        {/* 底部渐变遮罩 */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 80, background: "linear-gradient(to top, rgba(10,7,0,0.95) 0%, transparent 100%)" }} />
      </div>

      {/* 文字区 */}
      <div style={{ padding: "14px 16px 16px" }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: "rgba(255,255,255,0.88)", margin: "0 0 8px", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {displayTitle}
        </h3>

        {report.summary && (
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.40)", margin: "0 0 10px", lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {report.summary}
          </p>
        )}

        {report.error && report.status === "failed" && (
          <p style={{ fontSize: 11, color: "rgba(248,113,113,0.65)", margin: "0 0 10px" }}>原因：{report.error.slice(0, 60)}</p>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
            <Clock size={10} />
            {new Date(report.createdAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}
          </span>
          {report.creditsUsed > 0 && (
            <span style={{ fontSize: 10, color: "rgba(245,200,80,0.35)" }}>{report.creditsUsed.toLocaleString()} 点</span>
          )}
        </div>

        {/* 操作按钮 */}
        {report.status === "completed" && report.reportMarkdown && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onRead}
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 0", borderRadius: 10, background: "linear-gradient(135deg,rgba(200,160,0,0.25),rgba(138,98,0,0.20))", border: "1px solid rgba(180,130,0,0.45)", color: "#f5c842", fontWeight: 800, fontSize: 12, cursor: "pointer", transition: "all 0.2s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg,#c8a000,#8a6200)"; (e.currentTarget as HTMLElement).style.color = "#050300"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg,rgba(200,160,0,0.25),rgba(138,98,0,0.20))"; (e.currentTarget as HTMLElement).style.color = "#f5c842"; }}
            >
              <FileText size={12} />全息阅览
            </button>
            <button
              onClick={() => {
                const blob = new Blob([report.reportMarkdown!], { type: "text/markdown;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `战报-${displayTitle.slice(0, 25)}.md`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, borderRadius: 10, background: "rgba(180,130,0,0.08)", border: "1px solid rgba(180,130,0,0.25)", color: "rgba(245,200,80,0.5)", cursor: "pointer", transition: "all 0.2s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(180,130,0,0.20)"; (e.currentTarget as HTMLElement).style.color = "#f5c842"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(180,130,0,0.08)"; (e.currentTarget as HTMLElement).style.color = "rgba(245,200,80,0.5)"; }}
              title="下载 Markdown"
            >
              <Download size={13} />
            </button>
          </div>
        )}

        {report.status === "processing" && (
          <div style={{ fontSize: 11, color: "rgba(251,191,36,0.45)", textAlign: "center", padding: "8px 0", fontStyle: "italic" }}>
            约 15-30 分钟，完成后自动更新
          </div>
        )}
        {report.status === "failed" && (
          <div style={{ fontSize: 11, color: "rgba(248,113,113,0.45)", textAlign: "center", padding: "6px 0" }}>积分已退回</div>
        )}
      </div>
    </div>
  );
}

// ─── Markdown 渲染器 ──────────────────────────────────────────────────────────

function ReportRenderer({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  return (
    <div style={{ color: "rgba(255,255,255,0.82)", fontSize: 14, lineHeight: 1.9 }}>
      {lines.map((line, i) => {
        if (line.startsWith("# "))  return <h1 key={i} style={{ fontSize: 22, fontWeight: 900, color: "#f5c842", margin: "28px 0 12px", borderBottom: "1px solid rgba(180,130,0,0.25)", paddingBottom: 8 }}>{line.slice(2)}</h1>;
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
