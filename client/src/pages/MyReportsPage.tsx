import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  ChevronLeft, Crown, RefreshCw, FileText, Clock, CheckCircle,
  XCircle, Loader2, Download, Book, Sparkles, FileDown, Pencil, Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import ReportRenderer from "@/components/ReportRenderer";
import ReportEditor from "@/components/ReportEditor";
import { toast } from "sonner";
import { TemplateStripBanner, type PdfStyleKey } from "@/components/TemplatePicker";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Report {
  id: number;
  title: string;
  lighthouseTitle?: string;
  topic: string;
  status: string;
  progress?: string;
  reportMarkdown?: string | null;
  draftMarkdown?: string | null;
  draftReadyAt?: string | null;
  publishedAt?: string | null;
  error?: string | null;
  jobId?: string | null;
  productType?: string | null;
  creditsUsed: number;
  createdAt: string;
  coverUrl?: string | null;
  summary?: string | null;
  duration?: string | null;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MyReportsPage() {
  const [, navigate] = useLocation();
  const [selectedReport, setSelectedReport] = useState<{ id?: number; title: string; markdown: string } | null>(null);
  const [editingReport, setEditingReport] = useState<Report | null>(null);
  const [isExportingBlackGold, setIsExportingBlackGold] = useState(false);
  // 阅读模式 / 全局兜底用的 pdfStyle（默认 spring-mint）
  const [pdfStyle, setPdfStyle] = useState<PdfStyleKey>("spring-mint");
  // 每张卡片独立保存的封面模板选择（reportId → PdfStyleKey）。
  // 用户点选后立即生效到「下载富图文 PDF」+ 阅读模式。
  const [selectedStyle, setSelectedStyle] = useState<Record<number, PdfStyleKey>>({});
  const styleOf = useCallback((reportId: number): PdfStyleKey => {
    return selectedStyle[reportId] || "spring-mint";
  }, [selectedStyle]);
  const setStyleOf = useCallback((reportId: number, next: PdfStyleKey) => {
    setSelectedStyle((prev) => ({ ...prev, [reportId]: next }));
  }, []);
  // 一键下载（卡片级）：当前正在导出哪一份的 ID
  const [downloadingCardId, setDownloadingCardId] = useState<number | null>(null);
  // 取消任务（卡片级）：当前正在请求取消哪一份的 jobId（防止重复点击）
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  // 软删除（卡片级）：当前正在请求删除哪一份的 reportId
  const [deletingReportId, setDeletingReportId] = useState<number | null>(null);

  const exportBlackGoldPdfMutation = trpc.deepResearch.exportBlackGoldPdf.useMutation({
    // 2026-05-01 用户决策：PDF 切到 Cloud Run pdf-worker，server 端 base64 编码 → 客户端 atob → Blob 触发本地下载，不上 GCS
    onSuccess: (result) => {
      setIsExportingBlackGold(false);
      setDownloadingCardId(null);
      const b64 = result?.pdfBase64;
      if (!b64) {
        toast.error("PDF 生成失败：服务端未返回 PDF 数据");
        return;
      }
      try {
        const bytes = atob(b64);
        const buf = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
        const blob = new Blob([buf], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.filename || "report.pdf";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        toast.success(`PDF 下载已开始（${result.filename || "report.pdf"}）`);
      } catch (e: any) {
        toast.error("PDF 下载触发失败：" + (e?.message || "未知错误"));
      }
    },
    onError: (err) => {
      setIsExportingBlackGold(false);
      setDownloadingCardId(null);
      toast.error("PDF 生成失败：" + err.message);
    },
  });

  // ── HTML 交互版导出（PDF 之外的第二条下载路径） ─────────────────────────
  // 用户决策："直接讓用戶下載 PDF 跟 HTML 的選項就好，除非檔案很大，超過 10 MB，
  // 在採用壓縮成 zip 下載。"
  // - 后端返 dataUrl: data:text/html;base64,... 或 data:application/zip;base64,...
  // - 前端用 <a download> 触发本地下载（无需 GCS 签名链接）
  const [htmlDownloadingCardId, setHtmlDownloadingCardId] = useState<number | null>(null);
  const exportInteractiveHtmlMutation = trpc.creations.exportInteractiveHtml.useMutation({
    onSuccess: (result) => {
      setHtmlDownloadingCardId(null);
      try {
        const a = document.createElement("a");
        a.href = result.dataUrl;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        const sizeMb = (result.sizeBytes / 1024 / 1024).toFixed(2);
        if (result.kind === "zip") {
          toast.success(`HTML 交互版已下载（${sizeMb} MB → 自动压缩为 zip）`);
        } else {
          toast.success(`HTML 交互版已下载（${sizeMb} MB · 含交互图表）`);
        }
      } catch (e: any) {
        toast.error("HTML 已生成但触发下载失败：" + (e?.message || "未知错误"));
      }
    },
    onError: (err) => {
      setHtmlDownloadingCardId(null);
      toast.error("HTML 交互版导出失败：" + err.message);
    },
  });

  const handleDownloadHtmlFromCard = useCallback((report: Report) => {
    if (htmlDownloadingCardId) return;
    setHtmlDownloadingCardId(report.id);
    toast.info("正在生成 HTML 交互版（≤10 MB 直接下载，>10 MB 自动压缩 zip）…");
    exportInteractiveHtmlMutation.mutate({
      creationId: report.id,
      pdfStyle: styleOf(report.id),
    });
    // styleOf 在下面才声明，但 React closure 顺序无影响（runtime read）
  }, [exportInteractiveHtmlMutation, htmlDownloadingCardId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 软删除：失败 / 已弃置作品的清理入口（仅状态改 deleted，可恢复）
  const softDeleteMutation = trpc.creations.softDelete.useMutation({
    onSuccess: () => {
      setDeletingReportId(null);
      toast.success("作品已移入回收站（如需恢复请联系客服）");
      refetch();
    },
    onError: (err) => {
      setDeletingReportId(null);
      toast.error("删除失败：" + err.message);
    },
  });

  const handleSoftDelete = useCallback((report: Report) => {
    if (deletingReportId) return;
    const ok = window.confirm(
      `确定要删除「${report.lighthouseTitle || report.title}」吗？\n\n` +
        `删除后会从作品库隐藏（软删除，可由客服恢复）。\n` +
        `失败任务的积分若未返还，请通过「联系客服」处理。`,
    );
    if (!ok) return;
    setDeletingReportId(report.id);
    softDeleteMutation.mutate({ reportId: report.id });
  }, [deletingReportId, softDeleteMutation]);

  const { data, isLoading, refetch, isFetching } = trpc.deepResearch.myReports.useQuery(undefined, {
    refetchInterval: (data) => {
      const hasProcessing = data?.state?.data?.reports?.some((r: any) => r.status === "processing");
      return hasProcessing ? 30000 : false;
    },
  });

  // 取消正在跑的研报任务（status=processing）。
  // ⚠️ 商业护栏（防恶意刷算力）：用户主动取消的任务**按规则不退还积分**。
  //    系统故障 / 部署中断 / 进程崩溃才会幂等返还。
  const cancelJobMutation = trpc.deepResearch.cancelJob.useMutation({
    onSuccess: (result) => {
      setCancellingJobId(null);
      toast.success(result?.message || "任务已取消（按规则不退还积分）");
      refetch();
    },
    onError: (err) => {
      setCancellingJobId(null);
      toast.error("取消失败：" + err.message);
    },
  });

  const handleCancelJob = useCallback((report: Report) => {
    if (!report.jobId) {
      toast.error("该报告缺少 jobId，无法取消");
      return;
    }
    if (cancellingJobId) return; // 防止并发取消
    const ok = window.confirm(
      `确定要取消任务「${report.lighthouseTitle || report.title}」吗？\n\n` +
        `⚠️ 重要：用户主动取消的任务不退还积分。\n` +
        `   此规则用于防止恶意消耗算力，请谨慎操作。\n\n` +
        `如因系统故障 / 部署中断导致任务失败，\n` +
        `积分会自动幂等返还到您的账户。\n\n` +
        `确认主动取消？（不退还积分）`,
    );
    if (!ok) return;
    setCancellingJobId(report.jobId);
    cancelJobMutation.mutate({ jobId: report.jobId });
  }, [cancelJobMutation, cancellingJobId]);

  const reports = (data?.reports ?? []) as Report[];

  // 卡片级一键下载：直接调用 exportBlackGoldPdf（容器内 Puppeteer 渲染 +
  // 5 套封面模板生效）。旧的 mvAnalysis 隐藏 DOM 抓取路径已下线。
  const handleDownloadFromCard = useCallback((report: Report) => {
    const md = report.reportMarkdown || report.draftMarkdown || "";
    if (!md) { toast.error("内容尚未生成"); return; }
    setDownloadingCardId(report.id);
    setIsExportingBlackGold(true);
    exportBlackGoldPdfMutation.mutate({
      reportId: report.id,
      style: styleOf(report.id),
    });
  }, [exportBlackGoldPdfMutation, styleOf]);

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

  // ─── 编辑模式（草稿审核工作台） ─────────────────────────────────────────────
  if (editingReport) {
    const initialMd = editingReport.draftMarkdown || editingReport.reportMarkdown || "";
    return (
      <ReportEditor
        recordId={editingReport.id}
        initialMarkdown={initialMd}
        title={editingReport.lighthouseTitle || editingReport.title}
        status={editingReport.status as any}
        onClose={() => { setEditingReport(null); refetch(); }}
        onAfterPublish={() => { refetch(); }}
      />
    );
  }

  // 阅读模式打开时同步 pdfStyle 到该 report 的 selectedStyle
  // （切换不同 report 进出阅读模式会自动应用各自保存的封面色板）
  useEffect(() => {
    if (selectedReport?.id) {
      const current = styleOf(selectedReport.id);
      if (current !== pdfStyle) setPdfStyle(current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReport?.id]);

  // 阅读模式更换 pdfStyle 时同步保存到 selectedStyle map
  useEffect(() => {
    if (selectedReport?.id) {
      setStyleOf(selectedReport.id, pdfStyle);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfStyle]);

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
          {/* 用户决策（2026-05-01）：全息预览只负责"看"，下载入口统一走战略作品快照库的卡片 */}
        </div>

        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px 80px" }}>
          {/* 醒目大尺寸封面选择栏：5 套封面横铺，一眼可见，选定立即套用 */}
          <TemplateStripBanner value={pdfStyle} onChange={setPdfStyle} variant="online" />

          <ReportRenderer markdown={selectedReport.markdown} pdfStyle={pdfStyle} />
        </div>
      </div>
    );
  }

  // ─── 研报库主页 ────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        minHeight: "100vh",
        // 与 god-view 同款：卡布奇诺深焙渐变（奶泡米色 → 焦糖核心 → 深拿铁底）
        background: `
          radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,247,224,0.85) 0%, transparent 60%),
          radial-gradient(ellipse 70% 50% at 100% 100%, rgba(74,54,33,0.20) 0%, transparent 65%),
          linear-gradient(180deg,
            #ede1c5 0%,
            #ddc59c 22%,
            #c9a878 48%,
            #b08c5a 72%,
            #8e6c45 92%,
            #7a5e3f 100%
          )
        `,
        fontFamily: "'PingFang SC','HarmonyOS Sans','Source Han Sans',Inter,sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "-15%", left: "50%", transform: "translateX(-50%)", width: 1100, height: 700, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,247,224,0.55) 0%,transparent 70%)", filter: "blur(70px)" }} />
        <div style={{ position: "absolute", top: "10%", right: "8%", width: 540, height: 540, borderRadius: "50%", background: "radial-gradient(circle,rgba(216,162,58,0.32) 0%,rgba(168,118,27,0.18) 35%,transparent 70%)", filter: "blur(85px)" }} />
        <div style={{ position: "absolute", bottom: "12%", left: "5%", width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle,rgba(74,54,33,0.38) 0%,rgba(122,84,16,0.20) 35%,transparent 70%)", filter: "blur(75px)" }} />
        {/* 微噪点（咖啡粉颗粒质感） */}
        <div style={{ position: "absolute", inset: 0, opacity: 0.25, mixBlendMode: "overlay", backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.30  0 0 0 0 0.20  0 0 0 0 0.10  0 0 0 0.45 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")" }} />
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
          <>
            {/* 待审核草稿优先排在最前面 */}
            {reports.some((r) => r.status === "awaiting_review") && (
              <div style={{ marginBottom: 24, padding: "14px 18px", borderRadius: 14, background: "linear-gradient(135deg,rgba(217,119,6,0.10),rgba(168,118,27,0.08))", border: "1px dashed rgba(217,119,6,0.50)", display: "flex", alignItems: "center", gap: 12 }}>
                <Pencil size={18} color="#d97706" />
                <div style={{ fontSize: 13, color: "#3d2c14", fontWeight: 700, lineHeight: 1.65 }}>
                  您有 <strong style={{ color: "#d97706" }}>{reports.filter((r) => r.status === "awaiting_review").length}</strong> 份草稿待主编审核 ·
                  请在出刊前完成增删素材、AI 助手润色与最终核校。
                  <span style={{ marginLeft: 8, fontSize: 11.5, color: "rgba(61,44,20,0.65)", fontWeight: 600 }}>（出刊后才会进入正式作品库，可下载无水印 PDF）</span>
                </div>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 24 }}>
              {[...reports]
                .sort((a, b) => {
                  const order: Record<string, number> = { awaiting_review: 0, processing: 1, completed: 2, failed: 3 };
                  return (order[a.status] ?? 9) - (order[b.status] ?? 9);
                })
                .map((report) => (
                  <ReportCoverCard
                    key={report.id}
                    report={report}
                    isDownloading={downloadingCardId === report.id}
                    isHtmlDownloading={htmlDownloadingCardId === report.id}
                    isCancelling={!!report.jobId && cancellingJobId === report.jobId}
                    isDeleting={deletingReportId === report.id}
                    pdfStyle={styleOf(report.id)}
                    onPdfStyleChange={(next) => setStyleOf(report.id, next)}
                    onRead={() => {
                      const md = report.reportMarkdown || report.draftMarkdown || "";
                      if (!md) { toast.error("内容尚未生成"); return; }
                      setSelectedReport({ id: report.id, title: report.lighthouseTitle || report.title, markdown: md });
                    }}
                    onEdit={() => setEditingReport(report)}
                    onDownload={() => handleDownloadFromCard(report)}
                    onDownloadHtml={() => handleDownloadHtmlFromCard(report)}
                    onCancel={() => handleCancelJob(report)}
                    onSoftDelete={() => handleSoftDelete(report)}
                  />
                ))}
            </div>
          </>
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

function ReportCoverCard({
  report, onRead, onEdit, onDownload, onDownloadHtml, onCancel, onSoftDelete,
  isDownloading, isHtmlDownloading, isCancelling, isDeleting,
  pdfStyle, onPdfStyleChange,
}: {
  report: Report;
  onRead: () => void;
  onEdit: () => void;
  onDownload: () => void;
  onDownloadHtml: () => void;
  onCancel: () => void;
  onSoftDelete: () => void;
  isDownloading?: boolean;
  isHtmlDownloading?: boolean;
  isCancelling?: boolean;
  isDeleting?: boolean;
  pdfStyle: PdfStyleKey;
  onPdfStyleChange: (next: PdfStyleKey) => void;
}) {
  const statusMap: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    processing:        { icon: <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />, label: "推演中…", color: "#d97706" },
    awaiting_review:   { icon: <Pencil size={11} />,        label: "待审核",   color: "#d97706" },
    completed:         { icon: <CheckCircle size={11} />,   label: "已出刊",   color: "#16a34a" },
    failed:            { icon: <XCircle size={11} />,       label: "生成失败", color: "#dc2626" },
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

        {/* 已出刊：模板选择 + 阅览 / 下载 PDF / 下载 HTML 交互版 / 修订 */}
        {report.status === "completed" && report.reportMarkdown && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* 5 套封面模板紧凑选择条：用户挑封面 → 立即套用到下载 */}
            <CompactStyleSwatches value={pdfStyle} onChange={onPdfStyleChange} />
            <button
              onClick={onDownload}
              disabled={isDownloading}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 0", borderRadius: 10, background: isDownloading ? "rgba(168,118,27,0.30)" : "linear-gradient(135deg,#a8761b,#7a5410)", border: "1px solid rgba(168,118,27,0.65)", color: "#fff7df", fontWeight: 900, fontSize: 12.5, cursor: isDownloading ? "not-allowed" : "pointer", transition: "all 0.2s", boxShadow: isDownloading ? "none" : "0 4px 14px rgba(168,118,27,0.35)" }}
              onMouseEnter={(e) => { if (!isDownloading) (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "none"; }}
              title="使用所选封面模板生成 PDF（72 小时签名链接 · 静态图表）"
            >
              {isDownloading ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
              {isDownloading ? "正在生成 PDF…" : "📥 下载 PDF（静态版）"}
            </button>
            {/* HTML 交互版：内联 echarts，浏览器里可 hover / 切 legend / 缩放 */}
            <button
              onClick={onDownloadHtml}
              disabled={isHtmlDownloading}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "10px 0",
                borderRadius: 10,
                background: isHtmlDownloading
                  ? "rgba(37,99,235,0.20)"
                  : "linear-gradient(135deg,#1e3a8a,#2563eb)",
                border: "1px solid rgba(37,99,235,0.55)",
                color: "#f0f9ff",
                fontWeight: 900,
                fontSize: 12.5,
                cursor: isHtmlDownloading ? "not-allowed" : "pointer",
                transition: "all 0.2s",
                boxShadow: isHtmlDownloading ? "none" : "0 4px 14px rgba(37,99,235,0.30)",
              }}
              onMouseEnter={(e) => { if (!isHtmlDownloading) (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "none"; }}
              title="下载交互版 HTML（含 echarts，可 hover / 切 legend）；≤10 MB 直下载，>10 MB 自动压缩 zip"
            >
              {isHtmlDownloading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {isHtmlDownloading ? "正在打包 HTML…" : "🌐 下载 HTML（交互版）"}
            </button>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={onRead}
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "8px 0", borderRadius: 8, background: "rgba(168,118,27,0.10)", border: "1px solid rgba(168,118,27,0.30)", color: "#7a5410", fontWeight: 800, fontSize: 11.5, cursor: "pointer" }}
              >
                <FileText size={11} />全息阅览
              </button>
              <button
                onClick={onEdit}
                title="重新修订"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 12px", borderRadius: 8, background: "rgba(168,118,27,0.10)", border: "1px solid rgba(168,118,27,0.30)", color: "#7a5410", fontWeight: 800, fontSize: 11, cursor: "pointer" }}
              >
                <Pencil size={11} />
              </button>
            </div>
          </div>
        )}

        {/* 待审核草稿：审核工作台 + 快速预览 + 草稿 PDF */}
        {report.status === "awaiting_review" && (report.draftMarkdown || report.reportMarkdown) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              onClick={onEdit}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 0", borderRadius: 10, background: "linear-gradient(135deg,#d97706,#b45309)", border: "1px solid rgba(217,119,6,0.65)", color: "#fff7df", fontWeight: 900, fontSize: 12, cursor: "pointer", transition: "all 0.2s", boxShadow: "0 4px 12px rgba(217,119,6,0.30)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "none"; }}
            >
              <Pencil size={12} />进入审核工作台
            </button>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => onRead()}
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "8px 0", borderRadius: 8, background: "rgba(122,84,16,0.06)", border: "1px solid rgba(122,84,16,0.20)", color: "#7a5410", fontWeight: 700, fontSize: 11, cursor: "pointer" }}
              >
                <FileText size={11} />快速预览
              </button>
              <button
                onClick={onDownload}
                disabled={isDownloading}
                title="下载草稿 PDF（请在阅览中确认水印提示）"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 12px", borderRadius: 8, background: "rgba(217,119,6,0.10)", border: "1px solid rgba(217,119,6,0.30)", color: "#d97706", fontWeight: 800, fontSize: 11, cursor: isDownloading ? "not-allowed" : "pointer" }}
              >
                {isDownloading ? <Loader2 size={11} className="animate-spin" /> : <FileDown size={11} />}
              </button>
            </div>
          </div>
        )}

        {report.status === "processing" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch" }}>
            <div style={{ fontSize: 11, color: "#d97706", textAlign: "center", padding: "4px 0 0", fontStyle: "italic" }}>
              约 15-30 分钟，完成后自动更新
            </div>
            {report.jobId && (
              <button
                onClick={onCancel}
                disabled={isCancelling}
                title="主动取消任务（不退还积分，防止算力恶意消耗）"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "8px 0",
                  borderRadius: 9,
                  background: isCancelling ? "rgba(220,38,38,0.30)" : "rgba(220,38,38,0.10)",
                  border: "1px solid rgba(220,38,38,0.40)",
                  color: isCancelling ? "rgba(220,38,38,0.60)" : "#dc2626",
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: isCancelling ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                }}
              >
                {isCancelling ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />}
                {isCancelling ? "取消中…" : "✕ 取消任务（不退还积分）"}
              </button>
            )}
          </div>
        )}
        {report.status === "failed" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, color: "#dc2626", textAlign: "center", padding: "4px 0" }}>积分已返还到您的账户</div>
            <button
              onClick={onSoftDelete}
              disabled={isDeleting}
              title="软删除：从作品库隐藏，但记录保留可恢复"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "8px 0",
                borderRadius: 9,
                background: isDeleting ? "rgba(120,120,120,0.15)" : "rgba(220,38,38,0.06)",
                border: "1px solid rgba(220,38,38,0.30)",
                color: isDeleting ? "rgba(120,120,120,0.7)" : "#dc2626",
                fontSize: 11.5,
                fontWeight: 800,
                cursor: isDeleting ? "not-allowed" : "pointer",
                transition: "all 0.2s",
              }}
            >
              {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
              {isDeleting ? "删除中…" : "✕ 删除此作品"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// 紧凑版 5 套封面模板色块选择（240px 卡片下方专用）
function CompactStyleSwatches({
  value,
  onChange,
}: {
  value: PdfStyleKey;
  onChange: (next: PdfStyleKey) => void;
}) {
  const swatches: Array<{ key: PdfStyleKey; label: string; primary: string; accent: string }> = [
    { key: "spring-mint",     label: "春日薄荷",   primary: "#10B981", accent: "#FB7185" },
    { key: "neon-tech",       label: "霓虹科技",   primary: "#7C3AED", accent: "#06B6D4" },
    { key: "sunset-coral",    label: "日落珊瑚",   primary: "#8B5CF6", accent: "#FB923C" },
    { key: "ocean-fresh",     label: "海蓝清爽",   primary: "#2563EB", accent: "#FACC15" },
    { key: "business-bright", label: "高端商务亮", primary: "#1F3A5F", accent: "#C9A858" },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 6px", borderRadius: 8, background: "rgba(168,118,27,0.04)", border: "1px solid rgba(168,118,27,0.16)" }} title="选择 PDF 封面模板">
      <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(122,84,16,0.65)", letterSpacing: "0.04em", marginRight: 2, flexShrink: 0 }}>封面</span>
      {swatches.map((s) => {
        const selected = s.key === value;
        return (
          <button
            key={s.key}
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(s.key); }}
            title={s.label}
            style={{
              flex: 1,
              minWidth: 0,
              height: 22,
              borderRadius: 5,
              border: selected ? `2px solid ${s.accent}` : "1px solid rgba(168,118,27,0.30)",
              background: `linear-gradient(135deg, ${s.primary} 0%, ${s.primary} 55%, ${s.accent} 100%)`,
              cursor: "pointer",
              padding: 0,
              boxShadow: selected ? `0 0 0 2px ${s.accent}40` : "none",
              transition: "all 0.15s",
            }}
          />
        );
      })}
    </div>
  );
}
