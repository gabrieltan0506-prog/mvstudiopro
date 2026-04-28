import { useCallback, useState } from "react";
import { useLocation } from "wouter";
import {
  ChevronLeft, Crown, RefreshCw, FileText, Clock, CheckCircle,
  XCircle, Loader2, Download, Book, Sparkles, FileDown,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import ReportRenderer from "@/components/ReportRenderer";
import { toast } from "sonner";

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
  const [isExporting, setIsExporting] = useState(false);

  const { data, isLoading, refetch, isFetching } = trpc.deepResearch.myReports.useQuery(undefined, {
    refetchInterval: (data) => {
      const hasProcessing = data?.state?.data?.reports?.some((r: any) => r.status === "processing");
      return hasProcessing ? 30000 : false;
    },
  });

  const reports = (data?.reports ?? []) as Report[];

  // GCS pdf-worker（与 MVAnalysis 共用同一个端点）
  const downloadPdfMutation = trpc.mvAnalysis.downloadAnalysisPdf.useMutation({
    onSuccess: (result) => {
      setIsExporting(false);
      if (!result.pdfBase64) {
        toast.error("PDF 生成成功但内容为空，请重试");
        return;
      }
      try {
        const bytes = Uint8Array.from(atob(result.pdfBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        const safeTitle = (selectedReport?.title || "战略战报").replace(/[\\/:*?"<>|]/g, "");
        a.download = `战略战报-${safeTitle.slice(0, 25)}-${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        toast.success("富图文 PDF 已开始下载");
      } catch {
        toast.error("PDF 下载时出错，请重试");
      }
    },
    onError: (err) => {
      setIsExporting(false);
      toast.error(err.message || "PDF 导出失败");
    },
  });

  const handleDownloadPdf = useCallback(() => {
    // 克隆当前页面 DOM，剥离不必要内容，发送到 GCS pdf-worker
    const clone = document.documentElement.cloneNode(true) as HTMLElement;

    clone.querySelectorAll("script").forEach((n) => n.remove());
    clone.querySelectorAll("video, audio, iframe").forEach((n) => n.remove());
    clone.querySelectorAll('[class*="print:hidden"]').forEach((n) => n.remove());
    clone.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") || "";
      if (src.startsWith("data:") && src.length > 51200) img.removeAttribute("src");
    });
    clone.querySelectorAll("[src]").forEach((el) => {
      const src = el.getAttribute("src") || "";
      if (src.startsWith("blob:")) el.removeAttribute("src");
    });
    // 关键：所有标记 data-pdf-exclude 的元素都不出现在 PDF 中
    clone.querySelectorAll('input, textarea, [data-pdf-exclude="true"]').forEach((n) => n.remove());

    const base = document.createElement("base");
    base.href = window.location.origin + "/";
    clone.querySelector("head")?.prepend(base);

    const htmlContent = "<!DOCTYPE html>" + clone.outerHTML;
    setIsExporting(true);
    downloadPdfMutation.mutate({ html: htmlContent });
  }, [downloadPdfMutation]);

  const handleDownloadMd = () => {
    if (!selectedReport) return;
    const blob = new Blob([selectedReport.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `战报-${selectedReport.title.slice(0, 30)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── 阅读模式（含 PDF 导出按钮，按钮自身在 PDF 中会被剥离） ──────────────────
  if (selectedReport) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#f5e9d7 0%,#ede0c9 30%,#e8d8be 70%,#dfcaa9 100%)", fontFamily: "'PingFang SC','HarmonyOS Sans','Source Han Sans',Inter,sans-serif" }}>
        <div data-pdf-exclude="true" style={{ borderBottom: "1px solid rgba(122,84,16,0.20)", background: "rgba(255,250,240,0.92)", backdropFilter: "blur(14px)", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 50, boxShadow: "0 1px 0 rgba(122,84,16,0.05)" }}>
          <button onClick={() => setSelectedReport(null)} style={{ color: "#7a5410", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 700 }}>
            <ChevronLeft size={16} />返回作品快照库
          </button>
          <span style={{ color: "rgba(122,84,16,0.4)" }}>/</span>
          <span style={{ color: "#3d2c14", fontSize: 13, fontWeight: 800, maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedReport.title}</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={handleDownloadPdf}
              disabled={isExporting}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 18px", borderRadius: 10, background: isExporting ? "rgba(122,84,16,0.15)" : "linear-gradient(135deg,#a8761b,#7a5410)", border: "1px solid rgba(168,118,27,0.65)", color: isExporting ? "rgba(61,44,20,0.5)" : "#fff7df", fontSize: 12, fontWeight: 800, cursor: isExporting ? "not-allowed" : "pointer", boxShadow: isExporting ? "none" : "0 4px 14px rgba(168,118,27,0.30)", transition: "all 0.2s" }}
            >
              {isExporting ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
              {isExporting ? "正在生成 PDF…" : "下载富图文 PDF"}
            </button>
            <button
              onClick={handleDownloadMd}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, background: "rgba(168,118,27,0.10)", border: "1px solid rgba(168,118,27,0.30)", color: "#7a5410", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              title="下载纯文本 Markdown"
            >
              <Download size={13} />Markdown
            </button>
          </div>
        </div>

        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px 80px" }}>
          <ReportRenderer markdown={selectedReport.markdown} />
        </div>
      </div>
    );
  }

  // ─── 研报库主页 ────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#f5e9d7 0%,#ede0c9 35%,#e8d8be 70%,#dfcaa9 100%)", fontFamily: "'PingFang SC','HarmonyOS Sans','Source Han Sans',Inter,sans-serif", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "10%", right: "10%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle,rgba(168,118,27,0.18) 0%,transparent 65%)", filter: "blur(80px)" }} />
        <div style={{ position: "absolute", bottom: "15%", left: "5%", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle,rgba(122,84,16,0.12) 0%,transparent 65%)", filter: "blur(60px)" }} />
      </div>

      <div style={{ borderBottom: "1px solid rgba(122,84,16,0.20)", background: "rgba(255,250,240,0.90)", backdropFilter: "blur(14px)", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 50, boxShadow: "0 1px 0 rgba(122,84,16,0.05)" }}>
        <button onClick={() => navigate("/")} style={{ color: "#7a5410", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 700 }}>
          <ChevronLeft size={16} />首页
        </button>
        <span style={{ color: "rgba(122,84,16,0.4)" }}>/</span>
        <span style={{ color: "#3d2c14", fontSize: 13, fontWeight: 800 }}>战略作品快照库</span>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: "rgba(168,118,27,0.12)", border: "1px solid rgba(168,118,27,0.30)", color: isFetching ? "rgba(122,84,16,0.5)" : "#7a5410", fontSize: 12, fontWeight: 700, cursor: isFetching ? "not-allowed" : "pointer" }}
        >
          <RefreshCw size={13} style={{ animation: isFetching ? "spin 1s linear infinite" : "none" }} />刷新
        </button>
      </div>

      <div style={{ maxWidth: 1600, margin: "0 auto", padding: "40px 24px 80px", position: "relative", zIndex: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 36 }}>
          <div style={{ width: 50, height: 50, borderRadius: 14, background: "linear-gradient(135deg,#a8761b,#7a5410)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 20px rgba(122,84,16,0.30)", flexShrink: 0 }}>
            <Crown size={22} color="#fff7df" />
          </div>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: "#3d2c14", margin: 0, letterSpacing: "0.01em" }}>
              战略作品快照库
            </h1>
            <p style={{ color: "rgba(61,44,20,0.55)", fontSize: 12, margin: "4px 0 0", fontWeight: 600 }}>AI 上帝视角 · 全景行业战报 · 历史数据资产</p>
          </div>
          <button
            onClick={() => navigate("/god-view")}
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, padding: "11px 22px", borderRadius: 10, background: "linear-gradient(135deg,#a8761b,#7a5410)", border: "none", color: "#fff7df", fontWeight: 900, fontSize: 13, cursor: "pointer", boxShadow: "0 6px 20px rgba(168,118,27,0.30)", flexShrink: 0 }}
          >
            <Sparkles size={14} />发起新战报
          </button>
        </div>

        {isLoading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "80px 0", color: "#7a5410" }}>
            <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>加载作品库…</span>
          </div>
        )}

        {!isLoading && reports.length === 0 && (
          <div style={{ textAlign: "center", padding: "80px 24px" }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>📭</div>
            <p style={{ color: "rgba(61,44,20,0.55)", fontSize: 15, marginBottom: 24, fontWeight: 600 }}>作品库还是空的，发起第一份战报吧</p>
            <button
              onClick={() => navigate("/god-view")}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 28px", borderRadius: 12, background: "linear-gradient(135deg,#a8761b,#7a5410)", border: "none", color: "#fff7df", fontWeight: 900, fontSize: 14, cursor: "pointer", boxShadow: "0 6px 20px rgba(168,118,27,0.30)" }}
            >
              <Crown size={15} />立即发起首份战报
            </button>
          </div>
        )}

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
    processing: { icon: <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />, label: "推演中…", color: "#d97706" },
    completed:  { icon: <CheckCircle size={11} />, label: "已完成", color: "#16a34a" },
    failed:     { icon: <XCircle size={11} />,     label: "生成失败", color: "#dc2626" },
  };
  const s = statusMap[report.status] ?? statusMap.processing;

  const displayTitle = report.lighthouseTitle || report.title;

  return (
    <div
      style={{
        background: "linear-gradient(180deg,#fffaf0 0%,#f5ecda 100%)",
        border: "1px solid rgba(168,118,27,0.30)",
        borderRadius: 18,
        overflow: "hidden",
        transition: "border-color 0.25s, box-shadow 0.25s, transform 0.25s",
        cursor: "default",
        boxShadow: "0 4px 18px rgba(122,84,16,0.08)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "rgba(168,118,27,0.65)";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 32px rgba(168,118,27,0.22)";
        (e.currentTarget as HTMLElement).style.transform = "translateY(-3px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "rgba(168,118,27,0.30)";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 18px rgba(122,84,16,0.08)";
        (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
      }}
    >
      <div style={{ position: "relative", width: "100%", paddingTop: "133.33%", background: "linear-gradient(160deg,#3d2c14 0%,#1c1407 100%)", overflow: "hidden" }}>
        {report.coverUrl ? (
          <img
            src={report.coverUrl}
            alt={displayTitle}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.92, transition: "opacity 0.3s, transform 0.5s" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLImageElement).style.transform = "scale(1.05)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLImageElement).style.transform = "scale(1)"; }}
          />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(216,162,58,0.20)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {report.status === "processing"
                ? <Loader2 size={24} color="rgba(255,247,223,0.7)" style={{ animation: "spin 1s linear infinite" }} />
                : <Book size={24} color="rgba(255,247,223,0.6)" />
              }
            </div>
            {report.status === "processing" && (
              <div style={{ fontSize: 11, color: "rgba(255,247,223,0.7)", textAlign: "center", padding: "0 16px" }}>
                {report.progress?.slice(-30) || "推演中…"}
              </div>
            )}
          </div>
        )}

        <div style={{ position: "absolute", top: 10, left: 10, display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: "#fff", background: s.color, borderRadius: 99, padding: "3px 10px" }}>
          {s.icon}{s.label}
        </div>

        {report.duration && (
          <div style={{ position: "absolute", top: 10, right: 10, fontSize: 10, color: "#fff7df", background: "rgba(28,20,7,0.75)", borderRadius: 6, padding: "2px 7px", backdropFilter: "blur(4px)" }}>
            ⏱ {report.duration}m
          </div>
        )}

        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 80, background: "linear-gradient(to top, rgba(28,20,7,0.85) 0%, transparent 100%)" }} />
      </div>

      <div style={{ padding: "14px 16px 16px" }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: "#3d2c14", margin: "0 0 8px", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {displayTitle}
        </h3>

        {report.summary && (
          <p style={{ fontSize: 11, color: "rgba(61,44,20,0.65)", margin: "0 0 10px", lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {report.summary}
          </p>
        )}

        {report.error && report.status === "failed" && (
          <p style={{ fontSize: 11, color: "#dc2626", margin: "0 0 10px" }}>原因：{report.error.slice(0, 60)}</p>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "rgba(61,44,20,0.45)", fontWeight: 600 }}>
            <Clock size={10} />
            {new Date(report.createdAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}
          </span>
          {report.creditsUsed > 0 && (
            <span style={{ fontSize: 10, color: "#7a5410", fontWeight: 700 }}>{report.creditsUsed.toLocaleString()} 点</span>
          )}
        </div>

        {report.status === "completed" && report.reportMarkdown && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onRead}
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "10px 0", borderRadius: 10, background: "linear-gradient(135deg,#a8761b,#7a5410)", border: "none", color: "#fff7df", fontWeight: 800, fontSize: 12, cursor: "pointer", transition: "all 0.2s", boxShadow: "0 4px 12px rgba(168,118,27,0.25)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "none"; }}
            >
              <FileText size={12} />全息阅览
            </button>
          </div>
        )}

        {report.status === "processing" && (
          <div style={{ fontSize: 11, color: "#d97706", textAlign: "center", padding: "8px 0", fontStyle: "italic" }}>
            约 15-30 分钟，完成后自动更新
          </div>
        )}
        {report.status === "failed" && (
          <div style={{ fontSize: 11, color: "#dc2626", textAlign: "center", padding: "6px 0" }}>积分已退回</div>
        )}
      </div>
    </div>
  );
}
