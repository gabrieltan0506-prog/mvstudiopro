import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  ChevronLeft, Crown, RefreshCw, FileText, Clock, CheckCircle,
  XCircle, Loader2, Book, Sparkles, FileDown, Pencil, Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import ReportRenderer from "@/components/ReportRenderer";
import ReportEditor from "@/components/ReportEditor";
import { toast } from "sonner";
import { TemplateStripBanner, type PdfStyleKey } from "@/components/TemplatePicker";
import { optimizePdfSnapshotHtml } from "@/lib/pdfHtmlOptimize";

/** 作品庫閱讀模式：PDF 只克隆此容器（封面 + 正文），避免整頁 document 帶入 Toast / #root 等污染 */
const MYREPORTS_PDF_SNAPSHOT_ROOT_ID = "myreports-pdf-root";

/** HTML 快照 ≤ 此字節時走同步 downloadAnalysisPdf；更大或失敗則改走 GCS 隊列。 */
const MY_REPORTS_PDF_SYNC_HTML_MAX_BYTES = 6 * 1024 * 1024;

/** 注入快照 HTML：對抗 Sonner 等 portal 殘留與列印分頁異常（優先於 app 內其它 CSS） */
function injectPdfSnapshotSanitizeIntoHead(html: string): string {
  const strip = `<style id="mvs-pdf-snapshot-sanitize">
/* 強制摘掉各版 Sonner / Toast 與 notifications 區塊（含 fixed 在每頁重複繪製） */
[data-sonner-toaster],[data-sonner-toast],[data-sonner-toaster] li,
ol[data-sonner-toaster],section[aria-label*="tific" i],section[aria-label*="通知" i],
[class*="sonner-toast"],.toaster.group,.toaster{display:none!important;visibility:hidden!important;
height:0!important;width:0!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important;}
@media print{
html,body{margin:0!important;padding:0!important;}
#myreports-pdf-root{margin:0!important;padding:0!important;max-width:none!important;}
figure:not(.cover-page),img,.echart-mount{page-break-inside:avoid!important;break-inside:avoid!important;}
.cover-page,.cover-page.cover-image-only{page-break-before:auto!important;break-before:auto!important;page-break-after:auto!important;break-after:auto!important;page-break-inside:avoid!important;break-inside:avoid!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;margin:0!important;padding:0!important;border:none!important;background-color:#fff!important;width:100%!important;height:262mm!important;max-height:262mm!important;min-height:0!important;overflow:hidden!important;}
.cover-page img,.cover-page.cover-image-only img{position:static!important;display:block!important;flex-shrink:0!important;page-break-inside:auto!important;break-inside:auto!important;max-width:100%!important;max-height:100%!important;width:auto!important;height:auto!important;object-fit:contain!important;aspect-ratio:auto!important;margin:0!important;padding:0!important;transform:none!important;border:none!important;box-shadow:none!important;border-radius:0!important;outline:none!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
#myreports-pdf-root:has(> figure.cover-page) > [data-report-surface]{page-break-before:always!important;break-before:page!important;}
@page{margin:0;size:A4 portrait;}
[data-report-surface]{padding:4mm 6mm!important;border-radius:0!important;box-shadow:none!important;border:none!important;width:100%!important;max-width:none!important;box-sizing:border-box!important;}
[data-report-surface]>[data-pdf-accent-bar]{margin:-4mm -6mm 3mm!important;border-radius:0!important;}
}
</style>`;
  if (html.includes("</head>")) return html.replace("</head>", `${strip}</head>`);
  return `${strip}${html}`;
}

/** 給封面圖補齊列印用內在尺寸（html 裡 9:16 的 aspect-ratio 在 Chromium page.pdf 下偶發不繪圖） */
function stampCoverImgPrintDimensions(
  img: HTMLImageElement,
  liveCoverImg: HTMLImageElement | null,
  width?: number,
  height?: number,
): void {
  let w = width !== undefined && width > 0 ? width : 0;
  let h = height !== undefined && height > 0 ? height : 0;
  if (!w || !h) {
    if (
      liveCoverImg &&
      liveCoverImg.naturalWidth > 0 &&
      liveCoverImg.naturalHeight > 0
    ) {
      w = liveCoverImg.naturalWidth;
      h = liveCoverImg.naturalHeight;
    }
  }
  if (!w || !h) {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      w = img.naturalWidth;
      h = img.naturalHeight;
    }
  }
  if (w > 0 && h > 0) {
    img.setAttribute("width", String(w));
    img.setAttribute("height", String(h));
  }
}

/** 快照專用：把封面 <img> 換成 data URL，避免 pdf-worker setContent 後遠端圖失敗 → 高度 0 + page-break 空白首頁 */
async function embedMyReportsCoverImageInPdfFragment(
  fragment: HTMLElement,
  liveCoverImg: HTMLImageElement | null,
): Promise<void> {
  const img = fragment.querySelector("figure.cover-page img");
  if (!(img instanceof HTMLImageElement) || !img.src) return;
  const raw = img.currentSrc || img.src;
  if (raw.startsWith("data:")) {
    stampCoverImgPrintDimensions(img, liveCoverImg);
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw, window.location.href);
  } catch {
    return;
  }
  const sameOrigin = parsed.origin === window.location.origin;
  try {
    const res = await fetch(raw, {
      mode: "cors",
      credentials: sameOrigin ? "include" : "omit",
      cache: "force-cache",
    });
    if (!res.ok) return;
    const blob = await res.blob();
    if (!blob || blob.size === 0) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("readAsDataURL failed"));
      fr.readAsDataURL(blob);
    });
    img.src = dataUrl;
    img.removeAttribute("srcset");
    stampCoverImgPrintDimensions(img, liveCoverImg);
    return;
  } catch (e) {
    console.warn("[MyReports] 封面 fetch 转 data URL 失败，尝试 canvas 内嵌", e);
  }

  if (
    liveCoverImg &&
    liveCoverImg.naturalWidth > 0 &&
    liveCoverImg.naturalHeight > 0
  ) {
    try {
      const c = document.createElement("canvas");
      c.width = liveCoverImg.naturalWidth;
      c.height = liveCoverImg.naturalHeight;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(liveCoverImg, 0, 0);
      img.src = c.toDataURL("image/jpeg", 0.92);
      img.removeAttribute("srcset");
      stampCoverImgPrintDimensions(img, liveCoverImg, c.width, c.height);
    } catch (e2) {
      console.warn("[MyReports] 封面 canvas 内嵌失败（可能跨域污染）", e2);
    }
  }
}

/** 快照裡封面必須已是 data URL，否則 worker 側遠端 URL 常載入失敗 → 幽靈換頁留白 */
function dropCoverFromPdfFragmentUnlessEmbedded(fragment: HTMLElement): void {
  const fig = fragment.querySelector("figure.cover-page");
  if (!fig) return;
  const img = fig.querySelector("img");
  const ok =
    img instanceof HTMLImageElement &&
    /^data:image\/(png|jpeg|jpg|webp|gif|bmp);base64,/i.test(img.src) &&
    img.src.length > 256;
  if (!ok) {
    fig.remove();
  }
}

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
  // PDF 下载状态机（PR pdf-v2-platformpage-mode）：
  //   "idle"    无下载请求
  //   "ensuring-cover" 正在 on-demand 补封面（thumbnailUrl=NULL 时）
  //   "rendering"  已进入阅读模式，等 React + recharts 把 SVG 画完
  //   "snapshotting" 正在 cloneNode 抓 DOM 并 POST 到 pdf-worker
  // 用 ref 而非 state 主要给 useEffect 的 setTimeout 回调读，避免 stale closure。
  type DownloadStage = "idle" | "ensuring-cover" | "rendering" | "snapshotting" | "sync_pdf" | "pdf_queued";
  const [downloadingCardId, setDownloadingCardId] = useState<number | null>(null);
  const [downloadStage, setDownloadStage] = useState<DownloadStage>("idle");
  const downloadStageRef = useRef<DownloadStage>("idle");
  // 卡片点击进 reading mode + 自动触发 PDF 时，用此 flag 区分"用户主动阅读"和
  // "下载流程在后台借阅读模式渲染"。完成后自动退出阅读模式，让用户体感跟旧版一致。
  const autoExitReadingAfterDownloadRef = useRef<boolean>(false);
  /** 供 PDF mutation onError 读取（避免 React state 闭包滞后） */
  const pdfRunReportIdRef = useRef<number | null>(null);
  // 取消任务（卡片级）：当前正在请求取消哪一份的 jobId（防止重复点击）
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  // 软删除（卡片级）：当前正在请求删除哪一份的 reportId
  const [deletingReportId, setDeletingReportId] = useState<number | null>(null);

  const pdfAsyncHandledRef = useRef(false);
  const pdfAsyncTitleRef = useRef<string>("");
  /** 異步 pdf_export 任務 id（GCS 快照 → worker → 簽名下載） */
  const [asyncPdfJobId, setAsyncPdfJobId] = useState<string | null>(null);

  const resetPdfDownloadUi = useCallback(() => {
    setDownloadStage("idle");
    downloadStageRef.current = "idle";
    setDownloadingCardId(null);
    pdfRunReportIdRef.current = null;
    const autoExit = autoExitReadingAfterDownloadRef.current;
    autoExitReadingAfterDownloadRef.current = false;
    if (autoExit) setSelectedReport(null);
  }, []);

  // ── 下载 PDF：快照 HTML → 若体积 ≤6MB 则同步 downloadAnalysisPdf（与 HTML 一样立刻触发下载）；
  //    否则（或同步失败）走 GCS + queuePdfFromHtml → 轮询 getPdfExportJob → 签名链下载
  const getPdfHtmlSnapshotUploadUrlMutation = trpc.mvAnalysis.getPdfHtmlSnapshotUploadUrl.useMutation();
  const queuePdfFromHtmlMutation = trpc.mvAnalysis.queuePdfFromHtml.useMutation();
  const downloadAnalysisPdfMutation = trpc.mvAnalysis.downloadAnalysisPdf.useMutation();

  const pdfExportPollQuery = trpc.mvAnalysis.getPdfExportJob.useQuery(
    { jobId: asyncPdfJobId! },
    {
      enabled: !!asyncPdfJobId,
      refetchInterval: (query) => {
        const st = query.state.data?.status;
        if (st === "succeeded" || st === "failed") return false;
        return 3000;
      },
      retry: false,
    },
  );

  useEffect(() => {
    if (!asyncPdfJobId || !pdfExportPollQuery.data) return;

    if (pdfExportPollQuery.data.status === "failed") {
      const msg = pdfExportPollQuery.data.error || "PDF 任務失敗";
      toast.error(msg, { duration: 20_000 });
      setAsyncPdfJobId(null);
      pdfAsyncHandledRef.current = false;
      resetPdfDownloadUi();
      return;
    }

    if (pdfExportPollQuery.data.status !== "succeeded" || pdfAsyncHandledRef.current) return;
    pdfAsyncHandledRef.current = true;

    const out = pdfExportPollQuery.data.output;
    const url =
      out && typeof out === "object" && out !== null && "downloadUrl" in out && typeof (out as { downloadUrl?: unknown }).downloadUrl === "string"
        ? (out as { downloadUrl: string }).downloadUrl
        : null;
    if (!url) {
      toast.error("PDF 已完成但未返回下載鏈接");
      setAsyncPdfJobId(null);
      pdfAsyncHandledRef.current = false;
      resetPdfDownloadUi();
      return;
    }

    const doFetch = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`GET PDF ${res.status}`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const fileNameTitle = (pdfAsyncTitleRef.current || "战略情报报告").replace(/[\\/:*?"<>|]/g, "·").slice(0, 80);
        a.href = blobUrl;
        a.download = `${fileNameTitle}.pdf`;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 15_000);
        toast.success(`PDF 下载已开始（${fileNameTitle}.pdf）`);
      } catch (e: any) {
        toast.error("PDF 已生成但下載失敗：" + (e?.message || "未知錯誤"));
        window.open(url, "_blank", "noopener");
      } finally {
        setAsyncPdfJobId(null);
        pdfAsyncHandledRef.current = false;
        resetPdfDownloadUi();
      }
    };
    void doFetch();
  }, [asyncPdfJobId, pdfExportPollQuery.data, resetPdfDownloadUi]);

  // 客户端 DOM 快照前先确保 thumbnailUrl 已落地（NULL 就 on-demand 补一张）。
  const ensureCoverMutation = trpc.creations.ensureCover.useMutation();

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
        // 历史问题：原本直接 a.href = dataUrl (13 MB+ base64 data: URL)，Safari
        // 会静默丢内容（含封面），Chrome 旧版也不稳。
        // 修复：解 base64 → Blob → URL.createObjectURL（跟 PlatformPage 同套机制）。
        const commaIdx = result.dataUrl.indexOf(",");
        const base64 = commaIdx > 0 ? result.dataUrl.slice(commaIdx + 1) : result.dataUrl;
        const headerMatch = result.dataUrl.match(/^data:([^;]+)/);
        const mime = headerMatch ? headerMatch[1] : (result.kind === "zip" ? "application/zip" : "text/html");
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
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

  // 阅读模式内 stage=rendering 时由 effect 调用；与 PlatformPage 同源快照逻辑。
  const captureAndUploadSnapshot = useCallback(async () => {
    setDownloadStage("snapshotting");
    downloadStageRef.current = "snapshotting";
    pdfAsyncTitleRef.current = selectedReport?.title || "战略情报报告";
    try {
      if (typeof document !== "undefined" && (document as any).fonts?.ready) {
        await (document as any).fonts.ready;
      }
      await new Promise((r) => setTimeout(r, 2800));

      // 關閉並移出 DOM：Sonner 為 fixed，不處理會被採進 PDF 且在 Chromium 每頁重複繪製
      toast.dismiss();
      await new Promise((r) => setTimeout(r, 400));

      // 精準快照：只克隆報告容器（封面 + ReportRenderer），不採 documentElement → 不會帶入 Sonner / React root / 導航等
      const pdfRoot = document.getElementById(MYREPORTS_PDF_SNAPSHOT_ROOT_ID);
      if (!pdfRoot) {
        throw new Error("找不到 PDF 快照容器（myreports-pdf-root），请重进阅读模式后再试");
      }

      // 封面若未 decode 完成，快照裡 naturalHeight=0 → pdf-worker 得到空白首頁 + page-break-after 仍生效
      const coverImg = pdfRoot.querySelector("figure.cover-page img");
      if (coverImg instanceof HTMLImageElement) {
        if (!coverImg.complete || coverImg.naturalWidth === 0) {
          await new Promise<void>((resolve) => {
            let finished = false;
            const finish = () => {
              if (finished) return;
              finished = true;
              window.clearTimeout(timeoutId);
              coverImg.removeEventListener("load", finish);
              coverImg.removeEventListener("error", finish);
              resolve();
            };
            const timeoutId = window.setTimeout(finish, 8_000);
            coverImg.addEventListener("load", finish);
            coverImg.addEventListener("error", finish);
          });
        }
        try {
          await coverImg.decode();
        } catch (e) {
          console.warn("[MyReports] 封面图 decode 失败，将降级交由 PDF Worker 处理", e);
        }
      }
      const fragment = pdfRoot.cloneNode(true) as HTMLElement;
      fragment.querySelectorAll("script").forEach((n) => n.remove());
      fragment.querySelectorAll('[data-pdf-exclude="true"]').forEach((n) => n.remove());
      fragment.querySelectorAll("button").forEach((n) => n.remove());
      fragment
        .querySelectorAll("[data-sonner-toaster], [data-sonner-toast], .toaster.group")
        .forEach((n) => n.remove());
      fragment.querySelectorAll("[class*='sonner']").forEach((n) => n.remove());

      const liveCoverImg = pdfRoot.querySelector("figure.cover-page img");
      const coverLoadFailed = liveCoverImg instanceof HTMLImageElement && liveCoverImg.naturalWidth === 0;
      if (coverLoadFailed) {
        fragment.querySelector("figure.cover-page")?.remove();
      } else {
        await embedMyReportsCoverImageInPdfFragment(
          fragment,
          liveCoverImg instanceof HTMLImageElement ? liveCoverImg : null,
        );
        dropCoverFromPdfFragmentUnlessEmbedded(fragment);
      }

      const headEl = document.head.cloneNode(true) as HTMLHeadElement;
      headEl.querySelectorAll("script").forEach((n) => n.remove());
      const baseEl = document.createElement("base");
      baseEl.href = window.location.origin + "/";
      headEl.insertBefore(baseEl, headEl.firstChild);

      let html = `<!DOCTYPE html><html lang="zh-CN">${headEl.outerHTML}<body>${fragment.outerHTML}</body></html>`;
      html = optimizePdfSnapshotHtml(html);
      html = injectPdfSnapshotSanitizeIntoHead(html);

      const htmlBytes = new TextEncoder().encode(html).length;

      const runSyncPdfDownload = async () => {
        setDownloadStage("sync_pdf");
        downloadStageRef.current = "sync_pdf";
        toast.info("正在生成 PDF（通常 1～3 分钟），请保持本页打开…", { duration: 10_000 });
        const result = await downloadAnalysisPdfMutation.mutateAsync({
          html,
          token: "myreports-direct=1",
        });
        if (!result.pdfBase64) {
          throw new Error("PDF 内容为空");
        }
        const bytes = Uint8Array.from(atob(result.pdfBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const fileNameTitle = (pdfAsyncTitleRef.current || "战略情报报告").replace(/[\\/:*?"<>|]/g, "·").slice(0, 80);
        a.href = blobUrl;
        a.download = `${fileNameTitle}.pdf`;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 15_000);
        toast.success(`PDF 已下载（${fileNameTitle}.pdf）`);
      };

      if (htmlBytes <= MY_REPORTS_PDF_SYNC_HTML_MAX_BYTES) {
        try {
          await runSyncPdfDownload();
          resetPdfDownloadUi();
          return;
        } catch (syncErr: unknown) {
          const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
          console.warn("[MyReports] 同步 PDF 失败，改走云端队列：", msg);
          toast.message("同步生成受阻，已自动改为云端队列（完成后仍会下载）", { duration: 12_000 });
        }
      }

      const uploadMeta = await getPdfHtmlSnapshotUploadUrlMutation.mutateAsync();
      const putHeaders: Record<string, string> = {
        "Content-Type": "text/html; charset=utf-8",
        ...(uploadMeta.requiredHeaders || {}),
      };
      const putRes = await fetch(uploadMeta.uploadUrl, {
        method: "PUT",
        headers: putHeaders,
        body: html,
      });
      if (!putRes.ok) {
        const t = await putRes.text().catch(() => "");
        throw new Error(`GCS 上传 HTML 失败 ${putRes.status}: ${t.slice(0, 200)}`);
      }

      const { jobId } = await queuePdfFromHtmlMutation.mutateAsync({
        htmlGcsUri: uploadMeta.gcsUri,
        token: "myreports-async=1",
      });
      try {
        localStorage.setItem("mvs-godview-pdf-export-job-id", jobId);
      } catch {
        /* ignore */
      }
      pdfAsyncHandledRef.current = false;
      setAsyncPdfJobId(jobId);
      setDownloadStage("pdf_queued");
      downloadStageRef.current = "pdf_queued";
      toast.message(
        "PDF 已加入云端队列，完成后将自动下载（可离开本页）。Supervisor 可在 God View DEBUG 查看异步步骤。",
        { duration: 12_000 },
      );
    } catch (e: any) {
      setDownloadStage("idle");
      downloadStageRef.current = "idle";
      setDownloadingCardId(null);
      pdfRunReportIdRef.current = null;
      autoExitReadingAfterDownloadRef.current = false;
      toast.error("PDF 快照失败：" + (e?.message || "未知错误"));
    }
  }, [
    downloadAnalysisPdfMutation,
    getPdfHtmlSnapshotUploadUrlMutation,
    queuePdfFromHtmlMutation,
    resetPdfDownloadUi,
    selectedReport?.title,
  ]);

  // 进入阅读模式后，effect 检测到 stage="rendering" + selectedReport 挂载完成，
  // 自动触发快照。用 selectedReport.id 作 dependency，进/出阅读模式都会触发。
  useEffect(() => {
    if (downloadStage !== "rendering") return;
    if (!selectedReport?.id) return;
    // 给 React 一个完整 paint cycle 后再开抓 DOM。
    const t = setTimeout(() => {
      void captureAndUploadSnapshot();
    }, 80);
    return () => clearTimeout(t);
  }, [downloadStage, selectedReport?.id, captureAndUploadSnapshot]);

  const handleDownloadFromCard = useCallback(async (report: Report) => {
    const md = report.reportMarkdown || report.draftMarkdown || "";
    if (!md) { toast.error("内容尚未生成"); return; }
    if (downloadStageRef.current !== "idle") {
      toast.info("已有 PDF 正在生成，请稍候");
      return;
    }
    setDownloadingCardId(report.id);
    pdfRunReportIdRef.current = report.id;
    toast.info("正在准备 PDF：一般报告约 1～3 分钟自动下载；若体积很大将自动改走云端队列。", { duration: 10_000 });
    autoExitReadingAfterDownloadRef.current = true;

    // 0) thumbnailUrl=NULL 时先 on-demand 补一张 9:16 纯封面，避免 PDF 缺封面
    if (!report.coverUrl) {
      setDownloadStage("ensuring-cover");
      downloadStageRef.current = "ensuring-cover";
      toast.info("封面尚未生成，正在补一张 9:16 杂志封面…");
      try {
        await ensureCoverMutation.mutateAsync({ creationId: report.id });
        // 后端写回 DB 后这里 refetch 一次，让 reading mode 拿到最新 coverUrl
        await refetch();
      } catch (e: any) {
        // 封面补生失败不阻塞下载流程：报告主体 + recharts 仍能成像
        console.warn("[MyReports] ensureCover 失败，PDF 将无封面继续生成：", e?.message);
      }
    }

    // 1) 进阅读模式（按 selectedStyle 渲染）
    setPdfStyle(styleOf(report.id));
    setSelectedReport({
      id: report.id,
      title: report.lighthouseTitle || report.title,
      markdown: md,
    });

    // 2) 切到 rendering 阶段，等 useEffect 触发 captureAndUploadSnapshot
    setDownloadStage("rendering");
    downloadStageRef.current = "rendering";
  }, [ensureCoverMutation, refetch, styleOf]);

  const handleDownloadFromReadingMode = useCallback(async () => {
    if (!selectedReport?.id) {
      toast.error("阅读模式未就绪");
      return;
    }
    if (downloadStageRef.current !== "idle") {
      toast.info("PDF 正在生成，请稍候");
      return;
    }
    const reportId = selectedReport.id;
    autoExitReadingAfterDownloadRef.current = false;
    setDownloadingCardId(reportId);
    pdfRunReportIdRef.current = reportId;
    toast.info("正在准备 PDF：一般报告约 1～3 分钟自动下载；若体积很大将自动改走云端队列。", { duration: 10_000 });

    // 阅读模式里没法直接读 reports 行的 coverUrl（用户可能已经被 ReportCoverCard
    // 卸载了）；ensureCover 是幂等的，已存在直接 NOOP，不会重复扣 nano banana 配额。
    setDownloadStage("ensuring-cover");
    downloadStageRef.current = "ensuring-cover";
    try {
      await ensureCoverMutation.mutateAsync({ creationId: reportId });
      await refetch();
    } catch (e: any) {
      console.warn("[MyReports] ensureCover 失败，PDF 将无封面继续生成：", e?.message);
    }

    setDownloadStage("rendering");
    downloadStageRef.current = "rendering";
  }, [ensureCoverMutation, refetch, selectedReport?.id]);

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

  // ─── 阅读模式（PDF 导出按钮 + 5 套模板色板 + 9:16 封面 hero） ───────────────
  // 客户端 DOM 快照模式（与 PlatformPage 同套路）：
  //   - 顶部 chrome / 模板色板都标 data-pdf-exclude="true"，不会出现在 PDF
  //   - 封面 hero（recharts 还没渲染好之前用作 PDF 第一屏）由本组件生成，会被快照
  //   - 下载按钮触发 → useEffect 进入 rendering → 抓 DOM → POST → blob 下载
  if (selectedReport) {
    const matchingReport = reports.find((r) => r.id === selectedReport.id);
    const coverImageUrl = matchingReport?.coverUrl || null;
    const isBusy = downloadStage !== "idle";
    return (
      <div
        data-pdf-reading-shell="true"
        style={{ minHeight: "100vh", background: "linear-gradient(180deg,#f5e9d7 0%,#ede0c9 30%,#e8d8be 70%,#dfcaa9 100%)", fontFamily: "'PingFang SC','HarmonyOS Sans','Source Han Sans',Inter,sans-serif" }}
      >
        <div data-pdf-exclude="true" style={{ borderBottom: "1px solid rgba(122,84,16,0.20)", background: "rgba(255,250,240,0.92)", backdropFilter: "blur(14px)", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 50, boxShadow: "0 1px 0 rgba(122,84,16,0.05)" }}>
          <button onClick={() => setSelectedReport(null)} style={{ color: "#7a5410", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 700 }}>
            <ChevronLeft size={16} />返回作品快照库
          </button>
          <span style={{ color: "rgba(122,84,16,0.4)" }}>/</span>
          <span style={{ color: "#3d2c14", fontSize: 13, fontWeight: 800, maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedReport.title}</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={handleDownloadMd}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, background: "rgba(168,118,27,0.10)", border: "1px solid rgba(168,118,27,0.30)", color: "#7a5410", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
              title="下载原始 Markdown"
            >
              <FileText size={12} />Markdown
            </button>
            <button
              onClick={() => void handleDownloadFromReadingMode()}
              disabled={isBusy}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 8,
                background: isBusy
                  ? "rgba(168,118,27,0.30)"
                  : "linear-gradient(135deg,#a8761b,#7a5410)",
                border: "1px solid rgba(168,118,27,0.65)",
                color: "#fff7df",
                fontWeight: 800,
                fontSize: 12,
                cursor: isBusy ? "not-allowed" : "pointer",
                boxShadow: isBusy ? "none" : "0 3px 10px rgba(168,118,27,0.30)",
              }}
              title="一般 1～3 分钟内自动下载；超大报告自动改走云端队列，完成后也会自动下载"
            >
              {isBusy ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
              {downloadStage === "ensuring-cover" ? "生成封面…" :
               downloadStage === "rendering"      ? "等待渲染…" :
               downloadStage === "snapshotting"   ? "上传快照…" :
               downloadStage === "sync_pdf"       ? "生成 PDF…" :
               downloadStage === "pdf_queued"     ? "云端排队中…" :
                                                    "下载 PDF"}
            </button>
          </div>
        </div>

        <div
          id={MYREPORTS_PDF_SNAPSHOT_ROOT_ID}
          data-report-root
          data-myreports-read-layout
          style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px 80px" }}
        >
          {/* PDF 第一屏：9:16 封面 hero（有 coverUrl 才渲染）。
              `.cover-page.cover-image-only` 类与 ReportRenderer 的 @media print
              规则配合 → puppeteer 渲染 PDF 时封面强制独占首页，不会跟正文挤一页。 */}
          {coverImageUrl && (
            <figure className="cover-page cover-image-only" style={{ margin: "0 0 28px", padding: 0, textAlign: "center" }}>
              <img
                src={coverImageUrl}
                alt={selectedReport.title}
                loading="eager"
                decoding="async"
                style={{
                  display: "block",
                  margin: "0 auto",
                  width: "100%",
                  maxWidth: 720,
                  aspectRatio: "9 / 16",
                  objectFit: "cover",
                  borderRadius: 16,
                  border: "1px solid rgba(122,84,16,0.25)",
                  boxShadow: "0 12px 36px rgba(74,54,33,0.18)",
                }}
              />
            </figure>
          )}

          {/* 5 套封面色板：data-pdf-exclude 让快照剔除（PDF 里不需要这条工具栏） */}
          <div data-pdf-exclude="true">
            <TemplateStripBanner value={pdfStyle} onChange={setPdfStyle} variant="online" />
          </div>

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
                    onDownload={() => void handleDownloadFromCard(report)}
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
              title="进入阅览后生成 PDF：一般自动下载；超大报告会走云端队列"
            >
              {isDownloading ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
              {isDownloading ? "正在生成 PDF…" : "📥 下载 PDF"}
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
