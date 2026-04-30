import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, Loader2, Crown, Sparkles, RotateCcw, Mic, MicOff, Bug, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { TrendingHotspotsWidget } from "@/components/TrendingHotspotsWidget";
import { TemplatePicker, type PdfStyleKey } from "@/components/TemplatePicker";
import IpProfileModal, { readIpProfile, isIpProfileReady, type IpProfile } from "@/components/IpProfileModal";
import { useIsMobile } from "@/hooks/useMobile";

const SUPERVISOR_KEY = "mvs-supervisor-access";

// ── 定價配置（與後端 billingService.ts 保持同步）──────────────────────────────
type ProductType = "magazine_single" | "magazine_sub" | "personalized" | "enterprise_flagship";

const PRODUCT_FIRST_KEYS: Record<ProductType, string> = {
  magazine_single:     "mvs-magazine-first-used",
  magazine_sub:        "mvs-magsub-first-used",
  personalized:        "mvs-personalized-first-used",
  enterprise_flagship: "mvs-enterprise-flagship-first-used",
};

const PRODUCTS: Array<{
  id: ProductType;
  label: string;
  price: number;
  firstPrice?: number;
  tag?: string;
  desc: string;
  color: string;
  /** 是否需要 IP 基因（企业 B 端定制款必须） */
  requiresIpProfile?: boolean;
}> = [
  { id: "magazine_single",     label: "战略半月刊",        price: 800,  firstPrice: 720,  tag: "首购九折",  desc: "当月赛道趋势报告 · 单期购买",                color: "#a78bfa" },
  { id: "magazine_sub",        label: "半年订阅 (12期)",   price: 6000, firstPrice: 5400, tag: "首购九折",  desc: "6 个月持续情报陪伴 · 尊贵长线战略",          color: "#34d399" },
  { id: "personalized",        label: "尊享季度私人订制",   price: 3000, firstPrice: 2700, tag: "首购九折",  desc: "与历史快照对比 · 哈佛医师级二次进化分析",    color: "#f97316" },
  // ⚠️ B 端旗舰：唯一会触发 IP 基因弹窗的产品
  // 主理人本人下单的常规三款（半月刊/订阅/私订）已把背景烧进代码，无需弹窗
  { id: "enterprise_flagship", label: "企业高客单旗舰款",   price: 5000, firstPrice: 4500, tag: "B 端定制",  desc: "为企业客户量身订制 · 必须先注入企业专属 IP 基因（行业身份、护城河、高客单锚点）",  color: "#6366F1", requiresIpProfile: true },
];

function calcPrice(product: typeof PRODUCTS[0], isFirst: boolean): number {
  if (isFirst && product.firstPrice !== undefined) return product.firstPrice;
  return product.price;
}

export default function GodViewPage() {
  const [, navigate] = useLocation();
  const isMobile = useIsMobile();
  const [topic, setTopic] = useState("");
  const [phase, setPhase] = useState<"idle" | "launching" | "dispatched" | "awaiting_plan" | "done" | "failed">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const [selectedProduct, setSelectedProduct] = useState<ProductType>("magazine_single");
  const [isBundlePromo, setIsBundlePromo] = useState(false);

  const currentProduct = PRODUCTS.find((p) => p.id === selectedProduct)!;
  const [isFirst, setIsFirst] = useState(() => !localStorage.getItem(PRODUCT_FIRST_KEYS["magazine_single"]));

  // ── 补充资料（半月刊专属）
  const [suppText, setSuppText] = useState("");
  const [suppFiles, setSuppFiles] = useState<Array<{ name: string; type: "image" | "pdf"; mimeType: string; url: string; gcsUri: string }>>([]);
  // inline 上传状态：最近一次上传成功 / 失败的明确字样（toast 之外的兜底，常驻在 chip 区上方）
  const [lastUploadInfo, setLastUploadInfo] = useState<{ ok: boolean; text: string } | null>(null);
  const [suppExpanded, setSuppExpanded] = useState(false);
  const [suppUploading, setSuppUploading] = useState(false);
  const suppFileInputRef = useRef<HTMLInputElement>(null);

  const handleSuppFileAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (e.target) e.target.value = "";
    const MAX = 5;
    const remaining = MAX - suppFiles.length;
    if (!remaining) {
      const m = `最多只能上传 ${MAX} 个文件，请先移除部分文件`;
      toast.error(m);
      setLastUploadInfo({ ok: false, text: `❌ ${m}` });
      return;
    }
    if (files.length > remaining) {
      toast.warning(`本次只能再上传 ${remaining} 个文件，超出部分已忽略`);
    }

    const MAX_BYTES = 100 * 1024 * 1024; // 100MB
    const ALLOWED = ["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"];

    setSuppUploading(true);
    let okCount = 0;
    let failCount = 0;
    try {
      for (const file of files.slice(0, remaining)) {
        if (!ALLOWED.includes(file.type)) {
          const m = `「${file.name}」格式不支持（仅 PNG/JPG/WebP/PDF）`;
          toast.error(m);
          setLastUploadInfo({ ok: false, text: `❌ 上传失败：${m}` });
          failCount++;
          continue;
        }
        if (file.size > MAX_BYTES) {
          const m = `「${file.name}」超过 100MB 上限（${(file.size / 1024 / 1024).toFixed(1)}MB）`;
          toast.error(m);
          setLastUploadInfo({ ok: false, text: `❌ 上传失败：${m}` });
          failCount++;
          continue;
        }

        const type: "image" | "pdf" = file.type.startsWith("image/") ? "image" : "pdf";
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        const uploadingToast = toast.loading(`正在上传「${file.name}」（${sizeMB}MB）…`);
        // chip 区也同步显示「正在上传…」（防止 toast 没渲染时用户看不到）
        setLastUploadInfo({ ok: true, text: `⏳ 正在上传「${file.name}」（${sizeMB}MB）…` });
        try {
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch("/api/magazine/upload", { method: "POST", body: formData });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            const m = `上传「${file.name}」失败：${err?.error || `HTTP ${res.status}`}`;
            toast.error(m, { id: uploadingToast });
            setLastUploadInfo({ ok: false, text: `❌ ${m}` });
            failCount++;
            continue;
          }
          const data = await res.json();
          if (!data?.url || !data?.gcsUri) {
            const m = `上传「${file.name}」失败：服务器未返回文件链接`;
            toast.error(m, { id: uploadingToast });
            setLastUploadInfo({ ok: false, text: `❌ ${m}` });
            failCount++;
            continue;
          }
          setSuppFiles((prev) => [...prev, { name: file.name, type, mimeType: file.type, url: data.url, gcsUri: data.gcsUri }]);
          toast.success(`「${file.name}」上传成功（${sizeMB}MB）`, { id: uploadingToast });
          setLastUploadInfo({ ok: true, text: `✅ 上传成功：「${file.name}」（${sizeMB}MB）已存入云端` });
          okCount++;
        } catch (netErr: any) {
          const msg = netErr?.message || "请检查网络后重试";
          toast.error(`上传「${file.name}」网络异常：${msg}`, { id: uploadingToast });
          setLastUploadInfo({ ok: false, text: `❌ 上传失败：「${file.name}」网络异常：${msg}` });
          failCount++;
        }
      }
      if (okCount > 1 || (okCount > 0 && failCount > 0)) {
        const summary = `本次上传完成：成功 ${okCount} 个${failCount ? `，失败 ${failCount} 个` : ""}`;
        toast.success(summary);
        setLastUploadInfo({ ok: failCount === 0, text: (failCount === 0 ? "✅ " : "⚠️ ") + summary });
      } else if (okCount === 0 && failCount === 0) {
        // 全被前置校验拦掉，已经各自 toast/lastUploadInfo
      }
    } finally {
      setSuppUploading(false);
    }
  };

  // supervisor debug
  const [isSupervisor, setIsSupervisor] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [launchTime, setLaunchTime] = useState<Date | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  // 企业 IP 基因（共享 PlatformPage 的 localStorage["ipProfile.v1"]）
  const [ipProfile, setIpProfile] = useState<IpProfile>(() => readIpProfile());
  const [showIpModal, setShowIpModal] = useState(false);
  // 当前正在轮询的 jobId（从 launchMutation.data 取出）
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);
  // 普通用户轮询：dispatched 后每 20s 检查一次 job 状态
  const jobDoneQuery = trpc.deepResearch.status.useQuery(
    { jobId: pollingJobId! },
    {
      enabled: phase === "dispatched" && !!pollingJobId,
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        if (s === "completed" || s === "awaiting_review" || s === "failed") return false;
        // 计划审核阶段：用户主导节奏，不需要快速轮询
        if (s === "awaiting_plan_approval") return 30_000;
        return 20_000;
      },
      retry: false,
    },
  );
  // 感知完成/失败/等待计划审核
  useEffect(() => {
    const s = jobDoneQuery.data?.status;
    if (!s) return;
    if (s === "completed" || s === "awaiting_review") setPhase("done");
    if (s === "awaiting_plan_approval") setPhase("awaiting_plan");
    if (s === "running" || s === "planning" || s === "pending") {
      // 用户批准后，状态从 awaiting_plan_approval 回到 running → 继续显示进度时间线
      if (phase === "awaiting_plan") setPhase("dispatched");
    }
    if (s === "failed") {
      setPhase("failed");
      setErrorMsg(jobDoneQuery.data?.error || "研报生成失败，积分已返还到您的账户");
    }
  }, [jobDoneQuery.data?.status]);

  // 计划批准 mutation
  const [planFeedback, setPlanFeedback] = useState("");
  const approvePlanMutation = trpc.deepResearch.approvePlan.useMutation({
    onSuccess: () => { setPhase("dispatched"); setPlanFeedback(""); },
    onError: (err) => alert("批准计划失败：" + err.message),
  });

  // 取消正在跑 / 等待审核的任务
  // ⚠️ 商业护栏（防恶意刷算力）：用户主动取消的任务**按规则不退还积分**。
  //    系统故障 / 部署中断 / 进程崩溃才会幂等返还。
  const [isCancellingJob, setIsCancellingJob] = useState(false);
  const cancelJobMutation = trpc.deepResearch.cancelJob.useMutation({
    onSuccess: (result) => {
      setIsCancellingJob(false);
      toast.success(result?.message || "任务已取消（按规则不退还积分）");
      setPhase("failed");
      setErrorMsg("任务已取消（按规则不退还积分）");
    },
    onError: (err) => {
      setIsCancellingJob(false);
      toast.error("取消失败：" + err.message);
    },
  });

  const handleCancelCurrentJob = useCallback(() => {
    if (!pollingJobId) {
      toast.error("当前没有可取消的任务");
      return;
    }
    if (isCancellingJob) return;
    const ok = window.confirm(
      `确定要取消当前推演任务「${(topic || "").slice(0, 30) || "未命名战报"}」吗？\n\n` +
        `⚠️ 重要：用户主动取消的任务不退还积分。\n` +
        `   此规则用于防止恶意消耗算力，请谨慎操作。\n\n` +
        `如因系统故障 / 部署中断导致任务失败，\n` +
        `积分会自动幂等返还到您的账户。\n\n` +
        `确认主动取消？（不退还积分）`,
    );
    if (!ok) return;
    setIsCancellingJob(true);
    cancelJobMutation.mutate({ jobId: pollingJobId });
  }, [pollingJobId, isCancellingJob, cancelJobMutation, topic]);

  // 战略 PDF 导出 · 5 套活泼模板
  const [pdfStyle, setPdfStyle] = useState<PdfStyleKey>("spring-mint");
  const exportBlackGoldPdfMutation = trpc.deepResearch.exportBlackGoldPdf.useMutation({
    onSuccess: (result) => {
      const url = result?.signedUrl;
      if (!url) { toast.error("黑金 PDF 已生成但未拿到签名链接"); return; }
      try {
        navigator.clipboard?.writeText(url).catch(() => {});
        window.open(url, "_blank", "noopener,noreferrer");
        toast.success("黑金 PDF 已生成 · 链接已复制（72 小时签名）");
      } catch {
        toast.success("黑金 PDF 已生成，签名链接：" + url);
      }
    },
    onError: (err) => toast.error("黑金 PDF 生成失败：" + err.message),
  });

  // ── 半月刊 10 天提醒
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const reminderQuery = trpc.deepResearch.magazineReminder.useQuery(undefined, {
    staleTime: 5 * 60_000,
    retry: false,
  });
  const dismissReminderMutation = trpc.deepResearch.dismissReminder.useMutation({
    onSuccess: () => setReminderDismissed(true),
  });
  const reminder = reminderQuery.data;
  const showReminder = !reminderDismissed && reminder?.reminderDue === true && phase === "idle";

  // voice recording
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setIsSupervisor(localStorage.getItem(SUPERVISOR_KEY) === "1");
  }, []);

  // ── 跨页面任务持久化：mount 时拉一次 activeJobs，自动恢复运行中的任务 ──
  // 用户跑深潜任务时跳到 MyReports 或别的页面再回来，进度条 / 取消按钮 /
  // debug terminal 都还能继续看到（不再每次都得重新点「启动」造成双扣积分）。
  const activeJobsQuery = trpc.deepResearch.activeJobs.useQuery(undefined, {
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  useEffect(() => {
    const jobs = activeJobsQuery.data?.jobs;
    if (!jobs || jobs.length === 0) return;
    if (pollingJobId) return; // 已经在轮询，别覆盖
    if (phase !== "idle") return; // 用户正在 launching/dispatched 等，别打扰
    const job = jobs[0];
    console.log("[GodView] 自动恢复运行中任务:", job.jobId, "status=", job.status);
    setPhase(job.status === "awaiting_plan_approval" ? "awaiting_plan" : "dispatched");
    setPollingJobId(job.jobId);
    setTopic(job.topic || "");
    if (job.productType && (PRODUCTS.find((p) => p.id === job.productType))) {
      setSelectedProduct(job.productType as ProductType);
    }
    // 恢复计时（用 launchedAt 反推）
    try {
      const launched = new Date(job.launchedAt);
      if (!Number.isNaN(launched.getTime())) {
        setLaunchTime(launched);
        setElapsedSec(Math.max(0, Math.floor((Date.now() - launched.getTime()) / 1000)));
      }
    } catch {}
    toast.message("已恢复正在跑的深潛任务（无需重新启动）");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobsQuery.data?.jobs?.length]);

  // 任务进入终态时清理 localStorage 兜底缓存（防止重启后误恢复 ghost job）
  useEffect(() => {
    const s = jobDoneQuery?.data?.status;
    if (s === "completed" || s === "failed" || s === "awaiting_review") {
      try { localStorage.removeItem("activeJobId_godview"); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobDoneQuery?.data?.status]);

  useEffect(() => {
    if (!launchTime) return;
    const t = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - launchTime.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [launchTime]);

  const cost = calcPrice(currentProduct, isBundlePromo ? false : isFirst);

  const launchMutation = trpc.deepResearch.launch.useMutation({
    onSuccess: (data) => {
      const firstKey = PRODUCT_FIRST_KEYS[selectedProduct];
      if (!localStorage.getItem(firstKey)) {
        localStorage.setItem(firstKey, "1");
        setIsFirst(false);
      }
      setPhase("dispatched");
      // supervisor：拿到 jobId 后立即开始轮询
      if (data?.jobId) setPollingJobId(data.jobId);
    },
    onError: (err) => {
      setPhase("failed");
      setErrorMsg(err.message || "任务启动失败");
    },
  });

  const handleProductChange = (id: ProductType) => {
    setSelectedProduct(id);
    setIsFirst(!localStorage.getItem(PRODUCT_FIRST_KEYS[id]));
    setIsBundlePromo(false);
  };

  const handleLaunch = () => {
    if (!topic.trim()) { toast.error("请输入研究课题"); return; }

    // ── IP 基因拦截规则（2026-04-29 规则）：
    //    只有「企业高客单旗舰款」(requiresIpProfile=true) 才强制要 IP 基因。
    //    主理人本人买半月刊 / 半年订阅 / 私人订制时，背景已烧进代码，跳过弹窗。
    if (currentProduct.requiresIpProfile && !isIpProfileReady(ipProfile)) {
      setShowIpModal(true);
      toast.message("「企业高客单旗舰款」必须先载入企业专属 IP 基因");
      return;
    }

    const discount = isBundlePromo ? "（满月老用户双本促销）" : isFirst && currentProduct.firstPrice !== undefined ? "（首购优惠价）" : "";
    if (!window.confirm(`启动「${currentProduct.label}」将扣除 ${cost.toLocaleString()} 点${discount}，确定执行？`)) return;
    setPhase("launching");
    setLaunchTime(new Date());
    setElapsedSec(0);
    launchMutation.mutate({
      topic,
      isFirstTime: isFirst,
      productType: selectedProduct,
      isBundlePromo,
      // ⚠️ 只有旗舰款才注入 IP 基因到推演链；其他产品 ipProfile 留空
      //    避免主理人买半月刊时混入 B 端定制基因
      ...(currentProduct.requiresIpProfile && isIpProfileReady(ipProfile) ? { ipProfile } : {}),
      ...(suppText.trim() ? { supplementaryText: suppText.trim() } : {}),
      ...(suppFiles.length ? { supplementaryFiles: suppFiles } : {}),
    });
  };

  // Supervisor 轮询：每 4s 拉一次 job 状态，job 完成/失败后停止
  const jobStatusQuery = trpc.deepResearch.supervisorJobStatus.useQuery(
    { jobId: pollingJobId! },
    {
      enabled: isSupervisor && !!pollingJobId,
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        if (s === "completed" || s === "failed") return false;
        return 4000;
      },
      retry: false,
    },
  );

  const toggleVoice = useCallback(async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("当前浏览器不支持录音，请使用 Chrome 或 Safari");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (!blob.size) { toast.error("录音内容为空，请重试"); return; }
        setIsTranscribing(true);
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          const r = await fetch("/api/google?op=transcribeAudio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: base64, mimeType: mimeType.split(";")[0] }),
          });
          const data = await r.json().catch(() => ({}));
          const text = String(data?.text || "").trim();
          if (text) {
            setTopic(text);
            toast.success("转录成功");
          } else {
            toast.error("转录结果为空，请重试");
          }
        } catch (e: any) {
          toast.error(`转录失败：${e?.message}`);
        } finally {
          setIsTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (e: any) {
      toast.error(`录音失败：${e?.message}`);
    }
  }, [isRecording]);

  return (
    <div
      style={{
        minHeight: "100vh",
        // 卡布奇諾深焙渐变：顶部奶泡米色 → 中段焦糖核心（最浓郁的质感段）→ 底部深拿铁/摩卡棕
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
      {/* B 端 IP 基因库 · 靛青色拦截弹窗（共享组件） */}
      <IpProfileModal
        open={showIpModal}
        value={ipProfile}
        onChange={setIpProfile}
        onClose={() => setShowIpModal(false)}
      />

      {/* 卡布奇諾暖金多层光晕 + 微噪点（提升质感与「咖啡的层次感」）*/}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        {/* 顶部奶泡高光（让顶端阅读区更明亮，文字更易读）*/}
        <div style={{ position: "absolute", top: "-15%", left: "50%", transform: "translateX(-50%)", width: 1100, height: 700, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,247,224,0.55) 0%,transparent 70%)", filter: "blur(70px)" }} />
        {/* 左上焦糖金光晕 · 慢呼吸动画 */}
        <div style={{ position: "absolute", top: "8%", left: "8%", width: 620, height: 620, borderRadius: "50%", background: "radial-gradient(circle,rgba(216,162,58,0.32) 0%,rgba(168,118,27,0.18) 35%,transparent 70%)", filter: "blur(90px)", animation: "godview-float 18s ease-in-out infinite" }} />
        {/* 右下深咖啡光晕 · 反向呼吸 */}
        <div style={{ position: "absolute", bottom: "8%", right: "5%", width: 480, height: 480, borderRadius: "50%", background: "radial-gradient(circle,rgba(74,54,33,0.40) 0%,rgba(122,84,16,0.22) 35%,transparent 70%)", filter: "blur(80px)", animation: "godview-float 22s ease-in-out infinite reverse" }} />
        {/* 中段焦糖核心暖光（强化「咖啡心脏」段的浓郁度）*/}
        <div style={{ position: "absolute", top: "45%", right: "20%", width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle,rgba(216,162,58,0.18) 0%,transparent 70%)", filter: "blur(60px)", animation: "godview-float 26s ease-in-out infinite" }} />
        {/* 微噪点纹理（仿咖啡粉颗粒，提升手感与质感） */}
        <div style={{ position: "absolute", inset: 0, opacity: 0.25, mixBlendMode: "overlay", backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.30  0 0 0 0 0.20  0 0 0 0 0.10  0 0 0 0.45 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")" }} />
      </div>

      {/* 顶部导航 */}
      <div style={{ borderBottom: "1px solid rgba(122,84,16,0.20)", background: "rgba(255,250,240,0.92)", backdropFilter: "blur(14px)", padding: isMobile ? "10px 14px" : "14px 24px", display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, position: "sticky", top: 0, zIndex: 50, boxShadow: "0 1px 0 rgba(122,84,16,0.05)" }}>
        <button onClick={() => navigate("/")} style={{ color: "#7a5410", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 700, minHeight: 44, padding: "0 4px" }}>
          <ChevronLeft size={16} />首页
        </button>
        <span style={{ color: "rgba(122,84,16,0.4)" }}>/</span>
        <span style={{ color: "#3d2c14", fontSize: 13, fontWeight: 800, whiteSpace: "nowrap" }}>AI 上帝视角</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: isMobile ? 6 : 10 }}>
          <button
            onClick={() => navigate("/my-reports")}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: isMobile ? "10px 12px" : "9px 18px", minHeight: 44, borderRadius: 10, background: "linear-gradient(135deg,#a8761b,#7a5410)", border: "1px solid rgba(168,118,27,0.65)", color: "#fff7df", fontSize: 12, fontWeight: 900, cursor: "pointer", transition: "all 0.2s", boxShadow: "0 4px 14px rgba(168,118,27,0.32)", flexShrink: 0 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 22px rgba(168,118,27,0.55)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "none"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 14px rgba(168,118,27,0.32)"; }}
          >
            <Crown size={13} />{isMobile ? "快照库" : "战略作品快照库"}
          </button>
          {!isMobile && (
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", color: "#7a5410", background: "rgba(168,118,27,0.15)", border: "1px solid rgba(168,118,27,0.40)", borderRadius: 99, padding: "4px 12px" }}>
              👑 至尊专享
            </span>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: isMobile ? "24px 16px 60px" : "40px 24px 80px", position: "relative", zIndex: 2 }}>

        {/* 页面标题 */}
        <div style={{ textAlign: "center", marginBottom: isMobile ? 28 : 36 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: isMobile ? 10 : 14, marginBottom: isMobile ? 14 : 18 }}>
            <div style={{ width: isMobile ? 44 : 56, height: isMobile ? 44 : 56, borderRadius: isMobile ? 13 : 16, background: "linear-gradient(135deg,#a8761b,#7a5410)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 26px rgba(122,84,16,0.30)", flexShrink: 0 }}>
              <Crown size={isMobile ? 22 : 28} color="#fff7df" />
            </div>
            <div style={{ textAlign: "left" }}>
              <h1 style={{ fontSize: isMobile ? 22 : 30, fontWeight: 900, color: "#3d2c14", margin: 0, letterSpacing: "0.01em" }}>
                AI 上帝视角
              </h1>
              <p style={{ color: "rgba(122,84,16,0.85)", fontSize: isMobile ? 12 : 13, margin: "4px 0 0", letterSpacing: isMobile ? "0.04em" : "0.10em", fontWeight: 700 }}>
                全景行业战报 · 旗舰级商业智库
              </p>
            </div>
          </div>
          <p style={{ color: "rgba(61,44,20,0.78)", fontSize: isMobile ? 14 : 15, maxWidth: isMobile ? "100%" : 640, margin: "0 auto", lineHeight: 1.85, fontWeight: 500 }}>
            停止在信息泥潭中盲目试错。派遣专属智能研究集群，独占极限算力，全网深度检索与逻辑推演，
            为您交付降维打击的<strong style={{ color: "#7a5410", background: "linear-gradient(180deg, transparent 70%, rgba(216,162,58,0.30) 70%)", padding: "0 3px" }}>全景行业战报</strong>。
            穿透赛道迷雾，锁定商业胜率。
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: isMobile ? 6 : 10, marginTop: isMobile ? 14 : 20, flexWrap: "wrap" }}>
            {["宏观趋势前瞻", "竞品变现拆解", "私域留存策略", "30天行动清单"].map((t) => (
              <span key={t} style={{ fontSize: isMobile ? 12 : 11, fontWeight: 800, color: "#7a5410", background: "rgba(168,118,27,0.12)", border: "1px solid rgba(168,118,27,0.35)", borderRadius: 99, padding: isMobile ? "4px 10px" : "5px 14px" }}>{t}</span>
            ))}
          </div>

          {/* 企业 IP 基因入口 — 仅当选中"企业高客单旗舰款"才显示
              主理人买半月刊/订阅/私订时不需要它，UI 也不出现 */}
          {currentProduct.requiresIpProfile && <button
            type="button"
            onClick={() => setShowIpModal(true)}
            style={{
              display: "block",
              margin: "20px auto 0",
              maxWidth: 720,
              width: "100%",
              padding: "14px 20px",
              borderRadius: 16,
              border: isIpProfileReady(ipProfile)
                ? "1px solid rgba(99,102,241,0.45)"
                : "1px solid rgba(252,211,77,0.55)",
              background: isIpProfileReady(ipProfile)
                ? "linear-gradient(135deg,rgba(79,70,229,0.10),rgba(99,102,241,0.05))"
                : "rgba(252,211,77,0.10)",
              cursor: "pointer",
              textAlign: "left",
              transition: "filter 200ms",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.filter = "brightness(1.06)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = "brightness(1)"; }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: isMobile ? 12 : 10, fontWeight: 800, letterSpacing: isMobile ? "0.10em" : "0.22em", color: "#4F46E5", marginBottom: 4 }}>
                  {isIpProfileReady(ipProfile) ? "企业 IP 基因（已锁定）" : "尚未载入企业 IP 基因"}
                </div>
                {isIpProfileReady(ipProfile) ? (
                  <div style={{ fontSize: 13, lineHeight: 1.6, color: "#3d2c14", whiteSpace: isMobile ? "normal" : "nowrap", overflow: "hidden", textOverflow: "ellipsis", wordBreak: isMobile ? "break-word" : "normal" }}>
                    <span style={{ color: "#4F46E5", fontWeight: 700 }}>{ipProfile.industry}</span>
                    <span style={{ margin: "0 8px", color: "rgba(122,84,16,0.45)" }}>·</span>
                    <span style={{ color: "#3d2c14" }}>{ipProfile.advantage}</span>
                    <span style={{ margin: "0 8px", color: "rgba(122,84,16,0.45)" }}>·</span>
                    <span style={{ color: "#a8761b", fontWeight: 700 }}>{ipProfile.flagship}</span>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, lineHeight: 1.6, color: "#3d2c14" }}>
                    点此校准护城河 / 高客单锚点 → 推演会在 80% 篇幅锁定你的转化路径
                  </div>
                )}
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#4F46E5", whiteSpace: "nowrap", flexShrink: 0 }}>
                {isIpProfileReady(ipProfile) ? "编辑 →" : "载入 →"}
              </div>
            </div>
          </button>}
        </div>

        {/* 战略作品快照库 · 醒目入口卡 */}
        <div
          onClick={() => navigate("/my-reports")}
          style={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            alignItems: isMobile ? "stretch" : "center",
            gap: isMobile ? 12 : 16,
            padding: isMobile ? "14px 16px" : "16px 22px",
            marginBottom: 24,
            borderRadius: 14,
            background: "linear-gradient(135deg,#fffaf0 0%,#f5ecda 100%)",
            border: "1px solid rgba(168,118,27,0.30)",
            boxShadow: "0 6px 20px rgba(122,84,16,0.10)",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(168,118,27,0.65)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 10px 30px rgba(168,118,27,0.20)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(168,118,27,0.30)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 20px rgba(122,84,16,0.10)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 0, flex: isMobile ? "none" : "0 0 auto" }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#a8761b,#7a5410)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 4px 14px rgba(168,118,27,0.30)" }}>
              <Crown size={20} color="#fff7df" />
            </div>
            {isMobile && (
              <div style={{ fontSize: 15, fontWeight: 900, color: "#3d2c14", flex: 1 }}>
                战略作品快照库
              </div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {!isMobile && (
              <div style={{ fontSize: 15, fontWeight: 900, color: "#3d2c14", marginBottom: 3 }}>
                战略作品快照库 · 历史战报一键直达
              </div>
            )}
            <div style={{ fontSize: 12, color: "rgba(61,44,20,0.65)", lineHeight: 1.5 }}>
              所有已生成的全景战报、个性化分析与半月刊都在此沉淀，支持<strong style={{ color: "#7a5410" }}>富图文 PDF 一键下载</strong>，包含个人亮点、平台赛道、产品矩阵、商业变现、生涯规划五大模块。
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: isMobile ? "10px 16px" : "8px 16px", minHeight: isMobile ? 44 : undefined, borderRadius: 10, background: "linear-gradient(135deg,#a8761b,#7a5410)", color: "#fff7df", fontSize: 12, fontWeight: 900, flexShrink: 0, width: isMobile ? "100%" : undefined }}>
            进入快照库 →
          </div>
        </div>

        {/* ── 战略智库 · 三大 Agent 场景入口 ── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: "#7a5410", letterSpacing: "0.04em" }}>
              👑 高阶 Agent 场景
            </h3>
            <span style={{ fontSize: isMobile ? 12 : 11, color: "rgba(122,84,16,0.55)" }}>
              计划→审批→深潜，支持图片 / PDF / 语音输入
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {[
              {
                title: "多平台 IP 矩阵",
                desc: "四平台爆款交叉对比 + 跨界短影音脚本与分镜，开机即录的内容资产",
                href: "/agent/platform-ip-matrix",
                icon: "🎬",
              },
              {
                title: "竞品 / 赛道雷达",
                desc: "对标账号长时间深潜分析，输出可作为「降维打击弹药」的高密度报告",
                href: "/agent/competitor-radar",
                icon: "📡",
              },
              {
                title: "VIP 客户身心抗衰",
                desc: "高净值客户专属档案 · 用 previous_interaction_id 续接，每月动态调整处方",
                href: "/agent/vip-tracker",
                icon: "👤",
              },
            ].map((c) => (
              <button
                key={c.href}
                onClick={() => navigate(c.href)}
                style={{
                  textAlign: "left",
                  padding: isMobile ? "14px 14px" : "16px 18px",
                  minHeight: isMobile ? 44 : undefined,
                  borderRadius: 14,
                  background: "linear-gradient(135deg, rgba(255,248,225,0.95), rgba(255,243,210,0.85))",
                  border: "1.2px solid rgba(168,118,27,0.32)",
                  cursor: "pointer",
                  color: "#3d2c14",
                  boxShadow: "0 2px 12px rgba(168,118,27,0.10)",
                  transition: "all 0.18s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 22px rgba(168,118,27,0.30)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "none"; (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 12px rgba(168,118,27,0.10)"; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 22 }}>{c.icon}</span>
                  <span style={{ fontSize: 15, fontWeight: 900, color: "#7a5410" }}>{c.title}</span>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: "rgba(61,44,20,0.65)", lineHeight: 1.6 }}>{c.desc}</p>
                <div style={{ marginTop: 10, fontSize: isMobile ? 12 : 11, fontWeight: 800, color: "#a87020" }}>立即派发 →</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── 实时趋势 · 一键深潜（4 平台爆款 → IP 矩阵 / 雷达） ── */}
        <div style={{ marginBottom: 24 }}>
          <TrendingHotspotsWidget />
        </div>

        {/* ── 半月刊 10 天提醒卡片 ── */}
        {showReminder && reminder && (
          <div style={{ marginBottom: 20, borderRadius: 16, overflow: "hidden", border: "1.5px solid rgba(168,118,27,0.35)", background: "linear-gradient(135deg,rgba(255,248,230,0.95),rgba(255,243,210,0.9))", boxShadow: "0 4px 24px rgba(168,118,27,0.12)" }}>
            <div style={{ padding: isMobile ? "12px 14px 8px" : "14px 18px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>🔔</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: "#7a5410", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                    战略半月刊提醒
                    {reminder.daysOverdue != null && reminder.daysOverdue > 0
                      ? <span style={{ fontSize: 12, color: "#c0392b", background: "rgba(192,57,43,0.1)", padding: "2px 8px", borderRadius: 6 }}>已逾期 {reminder.daysOverdue} 天</span>
                      : <span style={{ fontSize: 12, color: "#e67e22", background: "rgba(230,126,34,0.1)", padding: "2px 8px", borderRadius: 6 }}>首次提醒</span>
                    }
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(61,44,20,0.6)", marginTop: 2, wordBreak: "break-all" }}>
                    已发送提醒至 benjamintan0506@163.com · AI 为您推荐了以下选题
                  </div>
                </div>
              </div>
              <button
                onClick={() => dismissReminderMutation.mutate()}
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(61,44,20,0.4)", fontSize: 18, lineHeight: 1, padding: "4px 6px", minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                title="忽略本次提醒（10 天后再提醒）"
              >×</button>
            </div>

            {/* 选题列表 */}
            {reminder.topics.length > 0 && (
              <div style={{ padding: isMobile ? "0 14px 12px" : "0 18px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                {reminder.topics.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setTopic(t);
                      setSelectedProduct("magazine_single");
                      setSuppExpanded(false);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    style={{
                      textAlign: "left", padding: isMobile ? "12px 14px" : "10px 14px", minHeight: isMobile ? 44 : undefined, borderRadius: 10, border: "1px solid rgba(168,118,27,0.2)",
                      background: topic === t ? "rgba(168,118,27,0.15)" : "rgba(255,255,255,0.7)",
                      cursor: "pointer", color: "#3d2c14", fontSize: 13, lineHeight: 1.6,
                      transition: "background 0.15s", fontFamily: "inherit",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: "#a87020", marginRight: 6 }}>{i + 1}.</span>{t}
                    <span style={{ float: "right", fontSize: isMobile ? 12 : 11, color: "#a87020", marginTop: 2 }}>点击填入 →</span>
                  </button>
                ))}
              </div>
            )}
            {reminderQuery.isLoading && (
              <div style={{ padding: "10px 18px 14px", color: "rgba(61,44,20,0.5)", fontSize: 13 }}>⏳ 正在生成选题建议…</div>
            )}
          </div>
        )}

        {/* ── 定價矩陣 ── 普通三款一行 + 企业旗舰款单独占整行（高客单视觉锚点） */}
        {(phase === "idle" || phase === "launching") && (() => {
          const renderCard = (p: typeof PRODUCTS[number], opts?: { hero?: boolean }) => {
            const isSelected = selectedProduct === p.id;
            const pIsFirst = !localStorage.getItem(PRODUCT_FIRST_KEYS[p.id]);
            const displayPrice = calcPrice(p, pIsFirst);
            const hero = !!opts?.hero;
            return (
              <button
                key={p.id}
                onClick={() => handleProductChange(p.id)}
                style={{
                  textAlign: "left",
                  padding: hero ? "26px 32px" : "16px 18px",
                  borderRadius: hero ? 22 : 16,
                  cursor: "pointer",
                  background: hero
                    ? (isSelected
                        ? `linear-gradient(135deg, ${p.color}28, ${p.color}10), linear-gradient(135deg,#1E1B4B 0%,#312E81 60%,#1E1B4B 100%)`
                        : `linear-gradient(135deg, ${p.color}18, ${p.color}05), linear-gradient(180deg,#1E1B4B 0%,#312E81 100%)`)
                    : (isSelected ? "linear-gradient(135deg,#fffaf0,#f5ecda)" : "rgba(255,250,240,0.55)"),
                  border: hero
                    ? `2px solid ${isSelected ? p.color : `${p.color}66`}`
                    : `1.5px solid ${isSelected ? p.color : "rgba(168,118,27,0.25)"}`,
                  boxShadow: hero
                    ? (isSelected
                        ? `0 14px 40px ${p.color}55, 0 0 0 4px ${p.color}25 inset`
                        : `0 10px 30px rgba(99,102,241,0.30)`)
                    : (isSelected ? `0 6px 22px ${p.color}30` : "0 2px 8px rgba(122,84,16,0.06)"),
                  transition: "all 0.2s",
                  position: "relative",
                  overflow: "hidden",
                  width: "100%",
                }}
              >
                {/* 角标 */}
                {p.tag && !hero && (
                  <span style={{ position: "absolute", top: 8, right: 8, fontSize: 9, fontWeight: 900, color: "#fff", background: p.color, borderRadius: 99, padding: "2px 8px", letterSpacing: "0.05em" }}>
                    {p.tag}
                  </span>
                )}
                {hero && (
                  <span style={{ position: "absolute", top: 14, right: 18, fontSize: 10, fontWeight: 900, color: "#FFF", background: `linear-gradient(135deg, ${p.color}, #4F46E5)`, borderRadius: 99, padding: "5px 14px", letterSpacing: "0.16em", boxShadow: `0 4px 14px ${p.color}77` }}>
                    👑 B 端定制 · 旗舰款
                  </span>
                )}

                {hero ? (
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 24, alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.20em", color: "#A5B4FC", marginBottom: 8 }}>
                        ENTERPRISE FLAGSHIP
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: "#FFF", marginBottom: 10, letterSpacing: "0.02em" }}>
                        {p.label}
                      </div>
                      <div style={{ fontSize: 13, color: "rgba(199,210,254,0.85)", lineHeight: 1.7, fontWeight: 500 }}>
                        {p.desc}
                      </div>
                      <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {["护城河锚定", "高客单转化路径", "合规与定价战略", "私域闭门营变现"].map((tag) => (
                          <span key={tag} style={{ fontSize: 10, fontWeight: 700, color: "#A5B4FC", background: "rgba(165,180,252,0.12)", border: "1px solid rgba(165,180,252,0.30)", borderRadius: 99, padding: "3px 10px" }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: "rgba(199,210,254,0.65)", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 6 }}>
                        {pIsFirst && p.firstPrice !== undefined ? "首购九折" : "标准价"}
                      </div>
                      <div style={{ fontSize: 44, fontWeight: 900, color: "#FCD34D", lineHeight: 1, fontFamily: "Georgia, serif" }}>
                        {displayPrice.toLocaleString()}
                        <span style={{ fontSize: 14, color: "rgba(252,211,77,0.75)", fontWeight: 700, marginLeft: 4 }}>点</span>
                      </div>
                      {pIsFirst && p.firstPrice !== undefined && (
                        <div style={{ fontSize: 12, color: "rgba(199,210,254,0.55)", textDecoration: "line-through", marginTop: 4, fontWeight: 600 }}>
                          原价 {p.price.toLocaleString()}
                        </div>
                      )}
                      <div style={{ marginTop: 10, fontSize: 11, color: isSelected ? "#FCD34D" : "rgba(199,210,254,0.65)", fontWeight: 800 }}>
                        {isSelected ? "✓ 已选中" : "点击选择 →"}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 800, color: isSelected ? p.color : "#7a5410", marginBottom: 6 }}>{p.label}</div>
                    <div style={{ fontSize: 24, fontWeight: 900, color: isSelected ? p.color : "#3d2c14", lineHeight: 1 }}>
                      {displayPrice.toLocaleString()}
                      <span style={{ fontSize: 11, fontWeight: 700, marginLeft: 3 }}>点</span>
                      {pIsFirst && p.firstPrice !== undefined && (
                        <span style={{ fontSize: 10, color: "rgba(61,44,20,0.45)", textDecoration: "line-through", marginLeft: 6, fontWeight: 600 }}>{p.price.toLocaleString()}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(61,44,20,0.65)", marginTop: 8, lineHeight: 1.5, fontWeight: 500 }}>{p.desc}</div>
                  </>
                )}
              </button>
            );
          };

          const regular = PRODUCTS.filter((p) => !p.requiresIpProfile);
          const flagship = PRODUCTS.find((p) => p.requiresIpProfile);

          return (
            <div style={{ marginBottom: 20 }}>
              {/* 三张常规产品卡 */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 14 }}>
                {regular.map((p) => renderCard(p))}
              </div>
              {/* 旗舰款单独占整行：靛青深色背景 + 大号金色价格，高单价视觉锚点 */}
              {flagship && renderCard(flagship, { hero: true })}
            </div>
          );
        })()}

        {/* 注：模板预选已搬到「战略作品快照库 / 在线阅读」页面 ——
            用户在出刊后挑封面更直觉，启动深潛前不再让模板抢戏 */}

        {/* ── 输入区 ── */}
        {(phase === "idle" || phase === "launching") && (
          <div style={{ background: "linear-gradient(135deg,#fffaf0,#f5ecda)", border: "1px solid rgba(168,118,27,0.30)", borderRadius: 20, padding: isMobile ? 18 : 28, boxShadow: "0 6px 22px rgba(122,84,16,0.10)" }}>
            <p style={{ fontSize: 12, color: "#7a5410", fontWeight: 800, letterSpacing: "0.1em", marginBottom: 10 }}>
              输入研究课题
            </p>
            <div style={{ position: "relative" }}>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                rows={5}
                placeholder="请描述您要研究的赛道或课题，例如：2026 年小红书形体美学与心血管健康赛道的商业模式、头部变现路径与差异化破局策略…"
                style={{ width: "100%", padding: "14px 16px", paddingRight: isMobile ? 56 : 52, borderRadius: 12, background: "#fff", border: "1px solid rgba(168,118,27,0.35)", color: "#1c1407", fontSize: isMobile ? 16 : 14.5, lineHeight: 1.75, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", transition: "border-color 0.2s" }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "#a8761b"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(168,118,27,0.35)"; }}
                disabled={phase === "launching"}
              />
              <button
                onClick={toggleVoice}
                disabled={isTranscribing || phase === "launching"}
                title={isRecording ? "点击停止录音" : isTranscribing ? "转录中…" : "语音输入课题"}
                style={{
                  position: "absolute", top: isMobile ? 6 : 10, right: isMobile ? 6 : 10,
                  width: isMobile ? 44 : 34, height: isMobile ? 44 : 34, borderRadius: isMobile ? 10 : 8, display: "flex", alignItems: "center", justifyContent: "center",
                  background: isRecording ? "rgba(220,38,38,0.10)" : isTranscribing ? "rgba(217,119,6,0.10)" : "rgba(168,118,27,0.12)",
                  border: isRecording ? "1px solid rgba(220,38,38,0.5)" : isTranscribing ? "1px solid rgba(217,119,6,0.4)" : "1px solid rgba(168,118,27,0.4)",
                  color: isRecording ? "#dc2626" : isTranscribing ? "#d97706" : "#7a5410",
                  cursor: isTranscribing || phase === "launching" ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                  animation: isRecording ? "godview-mic-pulse 1.2s ease-in-out infinite" : "none",
                }}
              >
                {isRecording ? <MicOff size={isMobile ? 18 : 14} /> : isTranscribing ? <Loader2 size={isMobile ? 18 : 14} className="animate-spin" /> : <Mic size={isMobile ? 18 : 14} />}
              </button>
            </div>
            {/* ── 补充资料区（3 类产品共享） ── */}
            {(selectedProduct === "magazine_single" || selectedProduct === "magazine_sub" || selectedProduct === "personalized" || selectedProduct === "enterprise_flagship") && (
              <div style={{ marginTop: 12, border: "1px solid rgba(168,118,27,0.2)", borderRadius: 12, overflow: "hidden" }}>
                <button
                  onClick={() => setSuppExpanded(!suppExpanded)}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: isMobile ? "12px 14px" : "10px 16px", minHeight: isMobile ? 44 : undefined, gap: isMobile ? 8 : 0, background: "rgba(168,118,27,0.06)", border: "none", cursor: "pointer", color: "#7a5410", fontSize: 13, fontWeight: 700, textAlign: "left", flexWrap: isMobile ? "wrap" : "nowrap" }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    📎 {selectedProduct === "personalized" ? "客户档案与历史快照（可选）" : "补充资料（可选）"}
                    {" "}— 上传文件或输入背景说明，AI 优先参考
                  </span>
                  <span style={{ fontSize: isMobile ? 12 : 11, opacity: 0.6, flexShrink: 0 }}>
                    {suppFiles.length > 0 || suppText.trim() ? `已添加 ${suppFiles.length} 个文件${suppText.trim() ? " + 文字说明" : ""}` : "未添加"}
                    {" "}{suppExpanded ? "▲" : "▼"}
                  </span>
                </button>
                {suppExpanded && (
                  <div style={{ padding: isMobile ? "12px 14px" : "14px 16px", background: "rgba(255,250,240,0.5)", display: "flex", flexDirection: "column", gap: 12 }}>
                    {/* 文字补充 */}
                    <div>
                      <p style={{ fontSize: 12, color: "rgba(61,44,20,0.65)", margin: "0 0 6px", fontWeight: 600 }}>文字补充说明（最多 2000 字）</p>
                      <textarea
                        value={suppText}
                        onChange={(e) => setSuppText(e.target.value.slice(0, 2000))}
                        rows={4}
                        placeholder={
                          selectedProduct === "personalized"
                            ? "例如：本季度新接一位高净值 VIP，男 52 岁，主诉睡眠障碍 + 体态焦虑。希望结合上一季度报告做二次进化分析，重点对比心血管指标与情绪状态变化曲线…"
                            : "例如：上期半月刊发布后收到用户反馈，本期重点补充银发创作者的变现路径分析，请着重研究 50 岁以上创作者在哔哩哔哩的粉丝忠诚度数据…"
                        }
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(168,118,27,0.25)", background: "#fff", color: "#1c1407", fontSize: isMobile ? 16 : 13, lineHeight: 1.7, resize: "vertical", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
                      />
                      <p style={{ fontSize: isMobile ? 12 : 11, color: "rgba(61,44,20,0.4)", margin: "4px 0 0", textAlign: "right" }}>{suppText.length}/2000</p>
                    </div>
                    {/* 文件上传 */}
                    <div>
                      <p style={{ fontSize: 12, color: "rgba(61,44,20,0.65)", margin: "0 0 8px", fontWeight: 600 }}>
                        {selectedProduct === "personalized"
                          ? "上传客户档案 / 历史快照 / 体检报告 / 私域聊天截图（最多 5 个，PNG/JPG/PDF，每个 ≤ 100MB）"
                          : "上传文件（最多 5 个，支持 PNG/JPG/PDF，每个最大 100MB）"}
                      </p>
                      {/* inline 状态横条：上传成功 / 失败 / 进行中（toast 之外的兜底，绝对可见） */}
                      {lastUploadInfo && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            padding: "10px 14px",
                            marginBottom: 10,
                            borderRadius: 10,
                            background: lastUploadInfo.ok
                              ? "rgba(22,163,74,0.10)"
                              : "rgba(220,38,38,0.10)",
                            border: lastUploadInfo.ok
                              ? "1px solid rgba(22,163,74,0.45)"
                              : "1px solid rgba(220,38,38,0.45)",
                            color: lastUploadInfo.ok ? "#15803d" : "#b91c1c",
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          <span style={{ wordBreak: "break-word", flex: 1, minWidth: 0 }}>{lastUploadInfo.text}</span>
                          <button
                            onClick={() => setLastUploadInfo(null)}
                            style={{ background: "none", border: "none", color: "inherit", fontSize: 16, cursor: "pointer", lineHeight: 1, opacity: 0.6, minWidth: isMobile ? 32 : undefined, minHeight: isMobile ? 32 : undefined, flexShrink: 0 }}
                            aria-label="关闭"
                          >
                            ×
                          </button>
                        </div>
                      )}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {suppFiles.map((f, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: isMobile ? "8px 10px" : "5px 10px", minHeight: isMobile ? 36 : undefined, background: "rgba(22,163,74,0.10)", border: "1px solid rgba(22,163,74,0.30)", borderRadius: 8, fontSize: 12, color: "#15803d" }}>
                            <span>{f.type === "image" ? "🖼️" : "📄"}</span>
                            <span style={{ maxWidth: isMobile ? 140 : 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.name}>{f.name}</span>
                            <span style={{ fontSize: isMobile ? 12 : 11, fontWeight: 800, color: "#15803d" }}>✓ 已上传</span>
                            <button onClick={() => setSuppFiles((p) => p.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "#a87020", fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 2, minWidth: isMobile ? 28 : undefined, minHeight: isMobile ? 28 : undefined }}>×</button>
                          </div>
                        ))}
                        {suppUploading && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: isMobile ? "8px 12px" : "5px 12px", background: "rgba(168,118,27,0.04)", border: "1px dashed rgba(168,118,27,0.3)", borderRadius: 8, fontSize: 12, color: "#a87020" }}>
                            <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⏳</span> 上传中…
                          </div>
                        )}
                        {suppFiles.length < 5 && !suppUploading && (
                          <button
                            onClick={() => suppFileInputRef.current?.click()}
                            style={{ display: "flex", alignItems: "center", gap: 6, padding: isMobile ? "10px 14px" : "5px 12px", minHeight: isMobile ? 44 : undefined, background: "rgba(168,118,27,0.06)", border: "1px dashed rgba(168,118,27,0.35)", borderRadius: 8, cursor: "pointer", color: "#a87020", fontSize: isMobile ? 13 : 12, fontWeight: 600 }}
                          >
                            + 添加文件
                          </button>
                        )}
                        <input ref={suppFileInputRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple style={{ display: "none" }} onChange={handleSuppFileAdd} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "center", marginTop: 14, gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <p style={{ fontSize: 12, color: "rgba(61,44,20,0.60)", margin: 0, fontWeight: 600, lineHeight: 1.6 }}>
                  ⏱ 异步重算力推演，约 15-30 分钟，派发后可关闭页面到「战略作品快照库」查看
                </p>
                {selectedProduct === "magazine_single" && (
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: isMobile ? 12 : 11, color: "rgba(61,44,20,0.70)", cursor: "pointer", fontWeight: 600, minHeight: isMobile ? 32 : undefined }}>
                    <input
                      type="checkbox"
                      checked={isBundlePromo}
                      onChange={(e) => setIsBundlePromo(e.target.checked)}
                      style={{ accentColor: "#a8761b", width: isMobile ? 18 : undefined, height: isMobile ? 18 : undefined, flexShrink: 0 }}
                    />
                    满月老用户专享：两本 800 点特惠（需在平台超过 30 天）
                  </label>
                )}
              </div>
              <button
                onClick={handleLaunch}
                disabled={!topic.trim() || phase === "launching"}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: isMobile ? "14px 24px" : "13px 30px", minHeight: isMobile ? 48 : undefined, width: isMobile ? "100%" : undefined, borderRadius: 12, background: (!topic.trim() || phase === "launching") ? "rgba(168,118,27,0.20)" : "linear-gradient(135deg,#a8761b,#7a5410)", border: "1px solid rgba(168,118,27,0.55)", color: (!topic.trim() || phase === "launching") ? "rgba(61,44,20,0.45)" : "#fff7df", fontWeight: 900, fontSize: 14, cursor: (!topic.trim() || phase === "launching") ? "not-allowed" : "pointer", boxShadow: (topic.trim() && phase !== "launching") ? "0 6px 22px rgba(168,118,27,0.40)" : "none", transition: "all 0.2s", position: "relative", flexShrink: 0 }}
              >
                {phase === "launching" ? <Loader2 size={15} className="animate-spin" /> : <Crown size={15} />}
                {phase === "launching"
                  ? "正在派发任务…"
                  : `启动 ${currentProduct.label}（${cost.toLocaleString()} 点）`}
                {isFirst && currentProduct.firstPrice !== undefined && phase !== "launching" && (
                  <span style={{ position: "absolute", top: -10, right: -6, fontSize: 9, fontWeight: 900, background: "#dc2626", color: "#fff", borderRadius: 99, padding: "2px 8px" }}>首次优惠</span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── 研报已完成 ── */}
        {phase === "done" && (
          <div style={{ textAlign: "center", padding: isMobile ? "32px 18px" : "48px 24px", animation: "fadeIn 0.5s ease", background: "linear-gradient(135deg,#050d02,#081a04)", borderRadius: 20, border: "1px solid rgba(0,200,80,0.25)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
            <div style={{ width: 80, height: 80, borderRadius: "50%", background: "linear-gradient(135deg,#16a34a,#15803d)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", boxShadow: "0 8px 32px rgba(22,163,74,0.4)", fontSize: 36 }}>✅</div>
            <h2 style={{ fontSize: isMobile ? 22 : 26, fontWeight: 900, color: "#f0fdf4", marginBottom: 12 }}>战略研报已生成</h2>
            <p style={{ color: "rgba(240,253,244,0.65)", fontSize: 14, lineHeight: 1.9, maxWidth: isMobile ? "100%" : 480, margin: "0 auto 32px" }}>
              深度推演已完成，全景战略白皮书已保存至您的「战略作品快照库」。
            </p>
            {/* 模板选择器（带封面 + 内文页缩略预览） */}
            <div style={{ marginBottom: 18, padding: isMobile ? "14px 14px" : "16px 20px", borderRadius: 14, background: "rgba(255,250,240,0.06)", border: "1px solid rgba(184,134,11,0.20)" }}>
              <TemplatePicker value={pdfStyle} onChange={setPdfStyle} />
            </div>
            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 12, justifyContent: "center", flexWrap: "wrap", alignItems: isMobile ? "stretch" : "center" }}>
              <button
                onClick={() => {
                  if (!pollingJobId) { toast.error("缺少 jobId"); return; }
                  exportBlackGoldPdfMutation.mutate({ jobId: pollingJobId, style: pdfStyle });
                }}
                disabled={exportBlackGoldPdfMutation.isPending || !pollingJobId}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: isMobile ? "14px 20px" : "14px 28px", minHeight: isMobile ? 48 : undefined, width: isMobile ? "100%" : undefined, borderRadius: 12, background: exportBlackGoldPdfMutation.isPending ? "rgba(0,0,0,0.5)" : "linear-gradient(135deg,#1a1a1a 0%,#2d2415 50%,#1a1a1a 100%)", border: "1.5px solid #B8860B", color: exportBlackGoldPdfMutation.isPending ? "rgba(184,134,11,0.5)" : "#B8860B", fontWeight: 900, fontSize: 14, cursor: exportBlackGoldPdfMutation.isPending ? "not-allowed" : "pointer", boxShadow: "0 6px 22px rgba(184,134,11,0.35)" }}
                title="容器内 Puppeteer 原生渲染，存 GCS · 72 小时签名链接"
              >
                {exportBlackGoldPdfMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Crown size={16} />}
                {exportBlackGoldPdfMutation.isPending ? "正在压制 PDF…" : "导出战略 PDF（GCS 签名链接）"}
              </button>
              <button onClick={() => navigate("/my-reports")} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: isMobile ? "14px 20px" : "14px 28px", minHeight: isMobile ? 48 : undefined, width: isMobile ? "100%" : undefined, borderRadius: 12, background: "linear-gradient(135deg,#16a34a,#15803d)", border: "none", color: "#fff", fontWeight: 900, fontSize: 14, cursor: "pointer", boxShadow: "0 6px 22px rgba(22,163,74,0.35)" }}>
                <Sparkles size={16} />前往「战略作品快照库」查阅
              </button>
              <button onClick={() => { setPhase("idle"); setTopic(""); setPollingJobId(null); }} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: isMobile ? "14px 20px" : "14px 24px", minHeight: isMobile ? 48 : undefined, width: isMobile ? "100%" : undefined, borderRadius: 12, background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.3)", color: "rgba(134,239,172,0.8)", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                再发起一个新课题
              </button>
            </div>
          </div>
        )}

        {/* ── 已派发：沉浸式推演过程清单（基于 job.status / job.progress 真信号） ── */}
        {phase === "dispatched" && (
          <>
            <DeductionTimeline
              elapsedSec={elapsedSec}
              topic={topic}
              jobStatus={jobDoneQuery.data?.status as any}
              jobProgress={jobDoneQuery.data?.progress as any}
              jobUpdatedAt={(jobDoneQuery.data as any)?.updatedAt}
              onNavigate={() => navigate("/my-reports")}
              onReset={() => { setPhase("idle"); setTopic(""); }}
            />
            {/* 取消任务·主动取消不退还积分（防恶意刷算力） — 推演中阶段（含 planning / running） */}
            {pollingJobId && !(jobDoneQuery.data as any)?.cancelRequestedAt && (
              <div style={{ marginTop: 18, display: "flex", justifyContent: "center", padding: isMobile ? "0 16px" : 0 }}>
                <button
                  onClick={handleCancelCurrentJob}
                  disabled={isCancellingJob}
                  title="主动取消任务（不退还积分，防止算力恶意消耗）"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: isMobile ? "12px 18px" : "11px 22px",
                    minHeight: 44,
                    width: isMobile ? "100%" : undefined,
                    borderRadius: 11,
                    background: isCancellingJob ? "rgba(220,38,38,0.18)" : "rgba(220,38,38,0.10)",
                    border: "1px solid rgba(220,38,38,0.45)",
                    color: isCancellingJob ? "rgba(220,38,38,0.55)" : "#dc2626",
                    fontWeight: 800,
                    fontSize: 12.5,
                    cursor: isCancellingJob ? "not-allowed" : "pointer",
                    boxShadow: isCancellingJob ? "none" : "0 4px 14px rgba(220,38,38,0.18)",
                    transition: "all 0.2s",
                  }}
                >
                  {isCancellingJob ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                  {isCancellingJob ? "取消中…" : "✕ 取消任务（不退还积分）"}
                </button>
              </div>
            )}
            {(jobDoneQuery.data as any)?.cancelRequestedAt && (
              <div style={{ marginTop: 18, marginLeft: isMobile ? 16 : 0, marginRight: isMobile ? 16 : 0, padding: isMobile ? "10px 14px" : "12px 18px", textAlign: "center", borderRadius: 11, background: "rgba(220,38,38,0.06)", border: "1px dashed rgba(220,38,38,0.35)", color: "#dc2626", fontSize: 12.5, fontWeight: 700 }}>
                🛑 已发起主动取消，正在停止深潛引擎（按规则不退还积分）…
              </div>
            )}
          </>
        )}

        {/* ── 计划审核阶段（Interactions API Collaborative Planning） ── */}
        {phase === "awaiting_plan" && jobDoneQuery.data?.planText && (
          <div style={{ padding: isMobile ? "18px 16px" : "24px 28px", background: "linear-gradient(135deg, rgba(168,118,27,0.10) 0%, rgba(122,84,16,0.06) 100%)", border: "1px solid rgba(168,118,27,0.40)", borderRadius: 14, boxShadow: "0 4px 24px rgba(168,118,27,0.12)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              <span style={{ fontSize: 22 }}>📋</span>
              <h3 style={{ margin: 0, fontSize: isMobile ? 15 : 16, fontWeight: 900, color: "#a8761b", letterSpacing: "0.04em" }}>研究计划已生成 · 请审核后批准</h3>
            </div>
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "rgba(160,140,90,0.85)", lineHeight: 1.7 }}>
              战略智库 Agent 已完成研究计划制定。请审阅以下计划方向，您可以直接批准开始深潜，也可以填写补充意见后再批准（例如：「重点关注小红书数据」「不要分析快手」「补充 IP 衍生品角度」）。
            </p>

            {/* 计划文本 */}
            <div style={{ background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.25)", borderRadius: 10, padding: isMobile ? "12px 14px" : "16px 20px", marginBottom: 16, maxHeight: isMobile ? 280 : 360, overflow: "auto" }}>
              <pre style={{ margin: 0, fontFamily: "'Source Han Serif SC', Georgia, serif", fontSize: 13, lineHeight: 1.85, color: "rgba(245,235,210,0.92)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{jobDoneQuery.data.planText}</pre>
            </div>

            {/* 反馈框 */}
            <textarea
              value={planFeedback}
              onChange={(e) => setPlanFeedback(e.target.value)}
              placeholder="（可选）补充意见或调整方向，AI 会按您的反馈调整后再开始深潛..."
              style={{ width: "100%", minHeight: 80, padding: "12px 14px", borderRadius: 10, background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.25)", color: "rgba(245,235,210,0.92)", fontSize: isMobile ? 16 : 13, lineHeight: 1.7, resize: "vertical", outline: "none", marginBottom: 14, fontFamily: "inherit", boxSizing: "border-box" }}
            />

            {/* 操作按钮 */}
            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, alignItems: isMobile ? "stretch" : "center", flexWrap: "wrap" }}>
              <button
                onClick={() => approvePlanMutation.mutate({ jobId: pollingJobId!, feedback: planFeedback.trim() || undefined })}
                disabled={approvePlanMutation.isPending || !pollingJobId}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: isMobile ? "14px 20px" : "12px 26px", minHeight: isMobile ? 48 : undefined, width: isMobile ? "100%" : undefined, borderRadius: 10, background: "linear-gradient(135deg,#a8761b,#7a5410)", border: "1px solid rgba(168,118,27,0.55)", color: "#fff7df", fontWeight: 900, fontSize: 13, cursor: approvePlanMutation.isPending ? "not-allowed" : "pointer", opacity: approvePlanMutation.isPending ? 0.6 : 1, boxShadow: "0 4px 16px rgba(168,118,27,0.30)" }}
              >
                {approvePlanMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Crown size={14} />}
                {planFeedback.trim() ? "按反馈调整后开始深潛" : "批准计划 · 开始深潛"}
              </button>
              {/* 取消任务·主动取消不退还积分（防恶意刷算力） — 计划审核阶段 */}
              {pollingJobId && (
                <button
                  onClick={handleCancelCurrentJob}
                  disabled={isCancellingJob}
                  title="主动取消任务（不退还积分，防止算力恶意消耗）"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    padding: isMobile ? "12px 18px" : "11px 18px",
                    minHeight: isMobile ? 44 : undefined,
                    width: isMobile ? "100%" : undefined,
                    borderRadius: 10,
                    background: isCancellingJob ? "rgba(220,38,38,0.18)" : "rgba(220,38,38,0.08)",
                    border: "1px solid rgba(220,38,38,0.40)",
                    color: isCancellingJob ? "rgba(220,38,38,0.55)" : "#dc2626",
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: isCancellingJob ? "not-allowed" : "pointer",
                  }}
                >
                  {isCancellingJob ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                  {isCancellingJob ? "取消中…" : "✕ 取消任务（不退还积分）"}
                </button>
              )}
              <span style={{ fontSize: isMobile ? 12 : 11, color: "rgba(160,140,90,0.65)", lineHeight: 1.6 }}>
                批准后 Agent 会立即开始最长 60 分钟的全网深潛，完成后自动进入研报中心
              </span>
            </div>
          </div>
        )}

        {/* ── 启动失败 ── */}
        {phase === "failed" && (
          <div style={{ padding: isMobile ? "14px 16px" : "20px 24px", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.30)", borderRadius: 12 }}>
            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "center", gap: isMobile ? 10 : 0 }}>
              <p style={{ color: "#dc2626", fontSize: 13, margin: 0, fontWeight: 700, wordBreak: "break-word" }}>❌ {errorMsg}{errorMsg.includes("积分") ? "" : " · 积分已返还到您的账户"}</p>
              <button onClick={() => { setPhase("idle"); setErrorMsg(""); }} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: isMobile ? "10px 16px" : "7px 16px", minHeight: isMobile ? 44 : undefined, width: isMobile ? "100%" : undefined, borderRadius: 8, background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.40)", color: "#dc2626", fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
                <RotateCcw size={12} />重试
              </button>
            </div>
            {(jobDoneQuery.data as any)?.errorDetail && (
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer", color: "#dc2626", fontSize: isMobile ? 12 : 11, fontWeight: 700, padding: "4px 0", minHeight: isMobile ? 32 : undefined }}>查看详细原因（含 API 响应）</summary>
                <pre style={{ marginTop: 10, fontSize: 11, color: "#7c2d2d", background: "rgba(220,38,38,0.04)", border: "1px solid rgba(220,38,38,0.18)", borderRadius: 8, padding: "10px 12px", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 280, overflowY: "auto", lineHeight: 1.6 }}>
                  {(jobDoneQuery.data as any).errorDetail}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* ── Supervisor Debug 面板 ── */}
        {isSupervisor && (
          <div style={{ marginTop: 40 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => setShowDebug(!showDebug)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", background: "rgba(0,255,70,0.06)", border: "1px solid rgba(0,255,70,0.2)", borderRadius: 8, cursor: "pointer", color: "rgba(0,255,70,0.7)", fontSize: 11, fontWeight: 700, fontFamily: "monospace", letterSpacing: "0.05em" }}
              >
                <Bug size={12} />
                DEBUG {showDebug ? "▲ 收起" : "▼ 展开"}
                <span style={{ marginLeft: 4, color: "rgba(0,255,70,0.35)", fontWeight: 400 }}>supervisor only</span>
              </button>
              {/* 手动输入 jobId 轮询 */}
              <input
                placeholder="粘贴 jobId 查询..."
                defaultValue={pollingJobId || ""}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (v) { setPollingJobId(v); setShowDebug(true); }
                  }
                }}
                style={{ flex: 1, maxWidth: 280, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(0,255,70,0.2)", borderRadius: 8, color: "#00ff46", fontSize: 11, fontFamily: "monospace", padding: "6px 12px", outline: "none" }}
              />
              {pollingJobId && (
                <span style={{ fontSize: 10, color: "rgba(0,255,70,0.5)", fontFamily: "monospace" }}>
                  轮询中 {jobStatusQuery.isFetching ? "⏳" : "✓"} 每 4s
                </span>
              )}
            </div>

            {showDebug && (
              <div style={{ marginTop: 10, background: "#000", border: "1px solid rgba(0,255,70,0.25)", borderRadius: 12, padding: "18px 20px", fontFamily: "monospace", fontSize: 11, color: "#00ff46", lineHeight: 1.7 }}>
                <p style={{ color: "rgba(0,255,70,0.45)", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 12 }}>▶ DEEP RESEARCH DEBUG TERMINAL</p>

                {/* 基础字段 */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                  {[
                    { k: "PHASE", v: phase },
                    { k: "JOB_ID", v: pollingJobId || String((launchMutation.data as any)?.jobId || "—") },
                    { k: "LAUNCH_AT", v: launchTime ? launchTime.toLocaleTimeString("zh-CN") : "—" },
                    { k: "ELAPSED", v: launchTime ? `${elapsedSec}s` : "—" },
                    { k: "CREDITS", v: jobStatusQuery.data?.creditsUsed != null ? `${jobStatusQuery.data.creditsUsed} 点` : "—" },
                    { k: "ATTEMPT", v: jobStatusQuery.data?.attemptCount != null ? `#${jobStatusQuery.data.attemptCount}` : "—" },
                    { k: "PID", v: String(jobStatusQuery.data?.pid || "—") },
                  ].map(({ k, v }) => (
                    <div key={k} style={{ background: "rgba(0,255,70,0.05)", border: "1px solid rgba(0,255,70,0.12)", borderRadius: 6, padding: "4px 10px", minWidth: 100 }}>
                      <p style={{ color: "rgba(0,255,70,0.35)", fontSize: 9, margin: "0 0 2px", fontWeight: 700 }}>{k}</p>
                      <p style={{ color: "#00ff46", fontSize: 11, margin: 0 }}>{v}</p>
                    </div>
                  ))}
                </div>

                {/* Job 状态 + 进度 */}
                {jobStatusQuery.data && (
                  <>
                    {/* 状态徽章 */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <span style={{
                        padding: "3px 12px", borderRadius: 99, fontSize: 11, fontWeight: 800,
                        background: jobStatusQuery.data.status === "completed" ? "rgba(0,255,70,0.15)"
                          : jobStatusQuery.data.status === "failed" ? "rgba(255,50,50,0.15)"
                          : jobStatusQuery.data.status === "running" ? "rgba(0,180,255,0.15)"
                          : "rgba(200,160,0,0.15)",
                        color: jobStatusQuery.data.status === "completed" ? "#00ff46"
                          : jobStatusQuery.data.status === "failed" ? "#ff5050"
                          : jobStatusQuery.data.status === "running" ? "#00b4ff"
                          : "#c8a000",
                        border: `1px solid ${jobStatusQuery.data.status === "completed" ? "rgba(0,255,70,0.3)"
                          : jobStatusQuery.data.status === "failed" ? "rgba(255,50,50,0.3)"
                          : jobStatusQuery.data.status === "running" ? "rgba(0,180,255,0.3)"
                          : "rgba(200,160,0,0.3)"}`,
                      }}>
                        {jobStatusQuery.data.status === "running" ? "🔄 运行中" : jobStatusQuery.data.status === "completed" ? "✅ 完成" : jobStatusQuery.data.status === "failed" ? "❌ 失败" : jobStatusQuery.data.status}
                      </span>
                      {jobStatusQuery.data.lastHeartbeatAt && (
                        <span style={{ color: "rgba(0,255,70,0.4)", fontSize: 10 }}>
                          心跳 {new Date(jobStatusQuery.data.lastHeartbeatAt).toLocaleTimeString("zh-CN")}
                        </span>
                      )}
                      {jobStatusQuery.data.hasMarkdown && (
                        <span style={{ color: "rgba(0,255,70,0.5)", fontSize: 10 }}>
                          报告已生成 ({jobStatusQuery.data.markdownLen.toLocaleString()} chars)
                        </span>
                      )}
                    </div>

                    {/* 进度日志（最重要的字段） */}
                    {jobStatusQuery.data.progress && (
                      <div style={{ marginBottom: 10 }}>
                        <p style={{ color: "rgba(0,255,70,0.4)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 6 }}>PROGRESS LOG</p>
                        <div style={{ background: "rgba(0,255,70,0.04)", border: "1px solid rgba(0,255,70,0.12)", borderRadius: 8, padding: "10px 14px", maxHeight: 200, overflowY: "auto" }}>
                          {jobStatusQuery.data.progress.split("\n").map((line, i) => (
                            <div key={i} style={{ color: line.includes("❌") || line.includes("失败") ? "#ff7070" : line.includes("✅") || line.includes("完成") ? "#00ff46" : line.includes("⏳") || line.includes("进行") ? "#00b4ff" : "rgba(0,255,70,0.75)", marginBottom: 2, wordBreak: "break-all" }}>
                              {line || <span style={{ opacity: 0.2 }}>—</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 错误（失败时） */}
                    {jobStatusQuery.data.error && (
                      <div style={{ marginBottom: 10 }}>
                        <p style={{ color: "rgba(255,80,80,0.6)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 6 }}>ERROR</p>
                        <div style={{ background: "rgba(255,50,50,0.06)", border: "1px solid rgba(255,50,50,0.2)", borderRadius: 8, padding: "10px 14px", color: "#ff7070", wordBreak: "break-all" }}>
                          {jobStatusQuery.data.error}
                        </div>
                      </div>
                    )}

                    {/* 详细错误（含原始 API 响应、stage、http status、stack） */}
                    {(jobStatusQuery.data as any)?.errorDetail && (
                      <div style={{ marginBottom: 10 }}>
                        <p style={{ color: "rgba(255,80,80,0.6)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 6 }}>ERROR DETAIL · RAW API RESPONSE</p>
                        <pre style={{ fontSize: 10, color: "#ffb0b0", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 320, overflowY: "auto", margin: 0, lineHeight: 1.6, background: "rgba(255,50,50,0.04)", border: "1px solid rgba(255,50,50,0.18)", borderRadius: 8, padding: "10px 12px" }}>
                          {(jobStatusQuery.data as any).errorDetail}
                        </pre>
                      </div>
                    )}
                  </>
                )}

                {/* Launch mutation 原始返回 */}
                <p style={{ color: "rgba(0,255,70,0.4)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 6, marginTop: 4 }}>LAUNCH RESPONSE</p>
                <pre style={{ fontSize: 10, color: "rgba(0,255,70,0.65)", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 180, overflowY: "auto", margin: 0, lineHeight: 1.6, background: "rgba(0,255,70,0.03)", borderRadius: 6, padding: "10px 12px" }}>
                  {launchMutation.data
                    ? JSON.stringify(launchMutation.data, null, 2)
                    : launchMutation.error
                      ? JSON.stringify({ error: launchMutation.error.message, code: (launchMutation.error as any)?.data?.code }, null, 2)
                      : "暂无（任务启动后显示）"}
                </pre>

                {jobStatusQuery.error && (
                  <p style={{ color: "#ff7070", fontSize: 10, marginTop: 8 }}>轮询错误：{jobStatusQuery.error.message}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none} }
        @keyframes godview-float {
          0%,100%{transform:translate(0,0) scale(1)}
          40%{transform:translate(30px,-40px) scale(1.05)}
          70%{transform:translate(-20px,25px) scale(0.97)}
        }
        @keyframes blink { 0%,100%{opacity:1}50%{opacity:0} }
        @keyframes spin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} }
        @keyframes godview-mic-pulse {
          0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.4)}
          50%{box-shadow:0 0 0 6px rgba(239,68,68,0)}
        }
      `}</style>
    </div>
  );
}

// ─── 真实阶段时间轴（仅基于后端 status / progress 推进，零模拟） ──────────────
// 每个阶段对应 deepResearchService.ts 里 updateProgress() 的真实文案：
//   - pending → 等待入队
//   - planning（status="planning"）→ 📋 正在生成研究计划…
//   - dispatched_phase_a（progress 含「Deep Research Max」）→ 🚀 启动深潜
//   - phase_a_websearch（progress 含「突破信息茧房」）→ stages[0]
//   - phase_b_platform（progress 含「四平台」）→ stages[1]
//   - phase_c_cot（progress 含「思维链」或 "CoT"）→ stages[2]
//   - phase_d_writing（progress 含「白皮书」或「撰写」）→ stages[3]
//   - completed → ✅ 完成
// 不再用 elapsedSec 模拟推进——前端不知道后端到哪了，就老实显示"等待下一帧后端心跳"
type RealPhase = {
  id: string;
  /** 在 jobProgress 文本里匹配这些关键词中任意一个，命中 → 视为"已到达本阶段" */
  matchProgress: RegExp[];
  /** 如果 jobStatus 等于这些值之一，也算到达 */
  matchStatus?: string[];
  icon: string;
  text: string;
  subtext?: string;
};

const REAL_PHASES: RealPhase[] = [
  {
    id: "queued",
    matchProgress: [/^$/], // 默认就是 queued
    matchStatus: ["pending", "queued", "dispatched"],
    icon: "🔌",
    text: "任务已入队，等待 Deep Research 算力节点响应",
  },
  {
    id: "planning",
    matchProgress: [/计划|plan/i, /审核/, /已附加.*补充文件/],
    matchStatus: ["planning", "awaiting_plan_approval"],
    icon: "📋",
    text: "正在生成研究计划（Collaborative Planning）",
    subtext: "Deep Research API 第一阶段，~3-8 分钟",
  },
  {
    id: "dispatched",
    matchProgress: [/启动 Deep Research/i, /🚀/, /深潜/],
    icon: "🚀",
    text: "已分发到 Deep Research Max，开始全网检索",
  },
  {
    id: "websearch",
    matchProgress: [/突破信息茧房/, /全网检索/, /论文.*商业数据/, /已等待.*execute/i],
    icon: "📡",
    text: "全网检索行业论文与商业数据",
    subtext: "Phase A：信息接地（Grounding）",
  },
  {
    id: "platform_scan",
    matchProgress: [/四平台/, /Top.*博主/, /变现博主/, /爆款底层/],
    icon: "📊",
    text: "抓取四平台 Top 变现博主链路与爆款底层逻辑",
    subtext: "小红书 · 抖音 · 哔哩哔哩 · 快手",
  },
  {
    id: "cot",
    matchProgress: [/思维链/, /CoT/i, /推演.*战略/, /构建底层商业/],
    icon: "🧠",
    text: "构建底层商业思维链（CoT），推演差异化战略",
  },
  {
    id: "writing",
    matchProgress: [/撰写.*白皮书/, /万字商业/, /组织.*章节/, /✍️/],
    icon: "✍️",
    text: "正在撰写万字商业白皮书",
    subtext: "Phase D：合成与排版，~5-10 分钟",
  },
  {
    id: "completed",
    matchProgress: [/✅/, /已生成/, /完成/],
    matchStatus: ["completed"],
    icon: "🏁",
    text: "战报生成完成，请进入「战略作品快照库」查阅",
  },
];

/** 根据真实 status + progress 算"当前到了哪一阶段"（返回 index，-1 表示没匹配上） */
function resolveRealPhaseIndex(status: string | undefined, progress: string | undefined): number {
  // 先看显式 status
  for (let i = REAL_PHASES.length - 1; i >= 0; i -= 1) {
    if (REAL_PHASES[i].matchStatus?.includes(status || "")) return i;
  }
  // 再看 progress 文本（从最深阶段往前匹配，命中即返回）
  if (progress) {
    for (let i = REAL_PHASES.length - 1; i >= 0; i -= 1) {
      if (REAL_PHASES[i].matchProgress.some((re) => re.test(progress))) return i;
    }
  }
  // 都没匹配 → 默认在队列中
  return 0;
}

function DeductionTimeline({
  elapsedSec,
  topic,
  jobStatus,
  jobProgress,
  jobUpdatedAt,
  onNavigate,
  onReset,
}: {
  elapsedSec: number;
  topic: string;
  jobStatus?: "pending" | "planning" | "running" | "awaiting_plan_approval" | "completed" | "failed" | string;
  jobProgress?: string;
  jobUpdatedAt?: string | number | null;
  onNavigate: () => void;
  onReset: () => void;
}) {
  const isMobile = useIsMobile();
  // ✨ 进度百分比：仅有两个来源，且必须如实说明用的是哪一种
  //   1) jobProgress 文本里如果带 "X%" → 真后端百分比 (REAL PROGRESS)
  //   2) 否则按"已到第 N 阶段 / 共 8 阶段"算 (PHASE PROGRESS)
  //   ❌ 已删除"按 elapsedSec/5400 估算 90 分钟上限"那种伪进度——属于欺骗用户
  const pctMatch = (jobProgress || "").match(/(\d+(?:\.\d+)?)\s*%/);
  const realPct = pctMatch ? Math.min(100, parseFloat(pctMatch[1])) : null;

  // 真实阶段索引（基于 status + progress 关键词，不基于 elapsedSec）
  const currentPhaseIndex = resolveRealPhaseIndex(jobStatus, jobProgress);
  const phasePct = ((currentPhaseIndex + 1) / REAL_PHASES.length) * 100;
  const progressPct = realPct ?? phasePct;
  const progressLabel = realPct !== null ? "REAL PROGRESS" : "PHASE PROGRESS";

  const elapsed = elapsedSec >= 60
    ? `${Math.floor(elapsedSec / 60)} 分 ${elapsedSec % 60} 秒`
    : `${elapsedSec} 秒`;

  // 心跳新鲜度（多久没收到 progress 更新了）
  const heartbeatSec = jobUpdatedAt ? Math.max(0, Math.floor((Date.now() - new Date(jobUpdatedAt).getTime()) / 1000)) : null;
  const heartbeatFresh = heartbeatSec === null ? true : heartbeatSec < 60;

  // 状态标签
  const statusLabelMap: Record<string, string> = {
    pending: "排队中",
    planning: "计划生成中",
    running: "深潜推演中",
    awaiting_plan_approval: "等待计划批准",
    completed: "已完成",
    failed: "失败",
  };
  const statusLabel = (jobStatus && statusLabelMap[jobStatus]) || jobStatus || "运行中";

  return (
    <div style={{ animation: "fadeIn 0.5s ease" }}>
      {/* 顶部状态卡 */}
      <div style={{ background: "linear-gradient(135deg,#0a0a0a,#0f0b04)", border: "1px solid rgba(200,160,0,0.25)", borderRadius: 20, padding: isMobile ? "20px 18px 16px" : "28px 32px 24px", marginBottom: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
        {/* 雷达脉冲图标 */}
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 12 : 16, marginBottom: isMobile ? 16 : 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 16, width: isMobile ? "100%" : "auto" }}>
            <div style={{ position: "relative", width: 52, height: 52, flexShrink: 0 }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(200,160,0,0.12)", animation: "godview-mic-pulse 1.8s ease-in-out infinite" }} />
              <div style={{ position: "absolute", inset: 6, borderRadius: "50%", background: "rgba(200,160,0,0.18)", animation: "godview-mic-pulse 1.8s ease-in-out infinite 0.4s" }} />
              <div style={{ position: "absolute", inset: 13, borderRadius: "50%", background: "linear-gradient(135deg,#c8a000,#7a5410)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
                🛰️
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ color: "#c8a000", fontWeight: 900, fontSize: isMobile ? 15 : 16, margin: "0 0 4px", letterSpacing: "0.02em", wordBreak: "break-word" }}>
                全景战报深度推演中 · {statusLabel}
              </p>
              <p style={{ color: "rgba(200,160,0,0.55)", fontSize: 12, margin: 0, fontFamily: "monospace", lineHeight: 1.5 }}>
                已运行 {elapsed} · 上限 90 分钟 ·{" "}
                <span style={{ color: heartbeatFresh ? "rgba(0,220,80,0.85)" : "rgba(239,68,68,0.85)" }}>
                  {heartbeatSec === null ? "等待首次心跳" : `心跳 ${heartbeatSec}s 前`}
                </span>
              </p>
            </div>
          </div>
          <div style={{ textAlign: isMobile ? "left" : "right", width: isMobile ? "100%" : "auto", display: isMobile ? "flex" : "block", alignItems: isMobile ? "baseline" : undefined, gap: isMobile ? 10 : 0, paddingLeft: isMobile ? 64 : 0 }}>
            <p style={{ color: "rgba(200,160,0,0.4)", fontSize: 10, margin: isMobile ? 0 : "0 0 4px", fontFamily: "monospace", fontWeight: 700 }}>
              {progressLabel}
            </p>
            <p style={{ color: "#c8a000", fontSize: 18, fontWeight: 900, fontFamily: "monospace", margin: 0 }}>
              {progressPct.toFixed(1)}%
            </p>
            {realPct === null && (
              <p style={{ color: "rgba(200,160,0,0.35)", fontSize: isMobile ? 11 : 9, margin: isMobile ? 0 : "2px 0 0", fontFamily: "monospace" }}>
                第 {currentPhaseIndex + 1} / {REAL_PHASES.length} 阶段
              </p>
            )}
          </div>
        </div>

        {/* 后端真信号（job.progress 字符串） */}
        {jobProgress && (
          <div style={{ background: "rgba(245,200,80,0.06)", border: "1px solid rgba(245,200,80,0.20)", borderRadius: 10, padding: isMobile ? "10px 12px" : "10px 14px", marginBottom: 12, display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{ color: "rgba(245,200,80,0.85)", fontSize: 14, lineHeight: 1, marginTop: 2 }}>📡</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ color: "rgba(245,200,80,0.50)", fontSize: isMobile ? 11 : 9.5, fontWeight: 800, letterSpacing: isMobile ? "0.10em" : "0.16em", margin: "0 0 4px", fontFamily: "monospace" }}>
                LIVE BACKEND SIGNAL
              </p>
              <p style={{ color: "#f5c842", fontSize: 13, fontWeight: 700, margin: 0, lineHeight: 1.6, wordBreak: "break-word" }}>
                {jobProgress}
              </p>
            </div>
          </div>
        )}

        {/* 进度条 */}
        <div style={{ height: 4, background: "rgba(200,160,0,0.12)", borderRadius: 2, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ height: "100%", width: `${progressPct}%`, background: "linear-gradient(90deg,#7a5410,#c8a000,#f5c842)", borderRadius: 2, transition: "width 1s linear", boxShadow: "0 0 8px rgba(200,160,0,0.5)" }} />
        </div>

        {/* 当前课题 */}
        <div style={{ background: "rgba(200,160,0,0.06)", border: "1px solid rgba(200,160,0,0.15)", borderRadius: 8, padding: isMobile ? "8px 12px" : "8px 14px" }}>
          <span style={{ color: "rgba(200,160,0,0.45)", fontSize: isMobile ? 11 : 10, fontWeight: 700, fontFamily: "monospace" }}>RESEARCH TOPIC  </span>
          <span style={{ color: "rgba(245,200,80,0.85)", fontSize: 13, fontWeight: 600, wordBreak: "break-word" }}>{topic || "—"}</span>
        </div>
      </div>

      {/* ─── 真实推演阶段时间轴（零模拟，只渲染后端真实 status / progress 推进过的阶段） ───
            每条阶段对应 deepResearchService.ts 里 updateProgress() 真实文案，
            判定逻辑 100% 由 status + progress 关键词触发，不依赖 elapsedSec。 */}
      <div style={{ background: "linear-gradient(180deg,#080604,#0c0a04)", border: "1px solid rgba(200,160,0,0.15)", borderRadius: 16, padding: isMobile ? "16px 14px" : "20px 24px", marginBottom: 16 }}>
        <p style={{ color: "rgba(200,160,0,0.4)", fontSize: isMobile ? 11 : 10, fontWeight: 700, letterSpacing: isMobile ? "0.08em" : "0.12em", margin: "0 0 16px", fontFamily: "monospace" }}>
          ▶ 推演阶段时间轴 · 仅根据后端真信号推进
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {REAL_PHASES.map((step, idx) => {
            const isDone = idx < currentPhaseIndex;
            const isCurrent = idx === currentPhaseIndex;
            const isFuture = idx > currentPhaseIndex;
            return (
              <div key={step.id} style={{ display: "flex", gap: isMobile ? 10 : 12, alignItems: "flex-start", opacity: isFuture ? 0.22 : 1, transition: "opacity 0.6s ease" }}>
                {/* 时间轴竖线 + 节点 */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
                    background: isDone ? "rgba(0,200,80,0.12)" : isCurrent ? "rgba(200,160,0,0.18)" : "rgba(255,255,255,0.04)",
                    border: isDone ? "1px solid rgba(0,200,80,0.3)" : isCurrent ? "1px solid rgba(200,160,0,0.4)" : "1px solid rgba(255,255,255,0.08)",
                    boxShadow: isCurrent ? "0 0 12px rgba(200,160,0,0.3)" : "none",
                    animation: isCurrent ? "godview-mic-pulse 2s ease-in-out infinite" : "none",
                  }}>
                    {isDone ? "✓" : step.icon}
                  </div>
                  {idx < REAL_PHASES.length - 1 && (
                    <div style={{ width: 1, flex: 1, minHeight: 16, background: isDone ? "rgba(0,200,80,0.2)" : "rgba(200,160,0,0.08)", margin: "3px 0" }} />
                  )}
                </div>
                {/* 文字 */}
                <div style={{ paddingTop: 4, paddingBottom: 12, minWidth: 0, flex: 1 }}>
                  <p style={{
                    margin: "0 0 2px",
                    fontSize: 13,
                    fontWeight: isCurrent ? 700 : isDone ? 500 : 400,
                    color: isDone ? "rgba(0,220,80,0.7)" : isCurrent ? "#f5c842" : "rgba(200,160,0,0.35)",
                    transition: "color 0.5s ease",
                    wordBreak: "break-word",
                  }}>
                    {isDone && <span style={{ marginRight: 6, color: "rgba(0,220,80,0.6)", fontSize: isMobile ? 12 : 11 }}>DONE</span>}
                    {step.text}
                    {isCurrent && <span style={{ marginLeft: 8, animation: "blink 1s step-end infinite", color: "#f5c842" }}>|</span>}
                  </p>
                  {step.subtext && !isFuture && (
                    <p style={{ margin: 0, fontSize: isMobile ? 12 : 11, color: isCurrent ? "rgba(245,200,80,0.55)" : "rgba(0,220,80,0.4)", lineHeight: 1.5, wordBreak: "break-word" }}>{step.subtext}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 底部操作按钮 */}
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={onNavigate}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: isMobile ? "14px 20px" : "13px 24px", minHeight: isMobile ? 48 : undefined, width: isMobile ? "100%" : undefined, borderRadius: 12, background: "linear-gradient(135deg,#a8761b,#7a5410)", border: "none", color: "#fff7df", fontWeight: 900, fontSize: 13, cursor: "pointer", boxShadow: "0 4px 18px rgba(168,118,27,0.35)" }}
        >
          <Sparkles size={14} />前往「战略作品快照库」查看
        </button>
        <button
          onClick={onReset}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: isMobile ? "14px 20px" : "13px 20px", minHeight: isMobile ? 48 : undefined, width: isMobile ? "100%" : undefined, borderRadius: 12, background: "rgba(168,118,27,0.08)", border: "1px solid rgba(168,118,27,0.3)", color: "rgba(200,160,0,0.7)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
        >
          再发起一个新课题
        </button>
      </div>

      <p
        style={{
          color: "rgba(255,235,200,0.92)",
          fontSize: 14,
          textAlign: "center",
          marginTop: 14,
          fontWeight: 600,
          letterSpacing: "0.02em",
          textShadow: "0 1px 2px rgba(0,0,0,0.45)",
        }}
      >
        您现在可以安心关闭此页面 · 战报生成后将保存至「战略作品快照库」
      </p>
    </div>
  );
}

/** Markdown → 简单 HTML 渲染（轻量，无依赖） */
function ReportRenderer({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  return (
    <div style={{ color: "rgba(255,255,255,0.82)", fontSize: 14, lineHeight: 1.9 }}>
      {lines.map((line, i) => {
        const key = i;
        if (line.startsWith("# ")) return <h1 key={key} style={{ fontSize: 22, fontWeight: 900, color: "#f5c842", margin: "28px 0 12px", borderBottom: "1px solid rgba(180,130,0,0.25)", paddingBottom: 8 }}>{line.slice(2)}</h1>;
        if (line.startsWith("## ")) return <h2 key={key} style={{ fontSize: 17, fontWeight: 800, color: "#d4a840", margin: "24px 0 10px", borderLeft: "3px solid #c8a000", paddingLeft: 12 }}>{line.slice(3)}</h2>;
        if (line.startsWith("### ")) return <h3 key={key} style={{ fontSize: 15, fontWeight: 700, color: "#c09030", margin: "18px 0 8px" }}>{line.slice(4)}</h3>;
        if (line.startsWith("- ") || line.startsWith("* ")) return <div key={key} style={{ display: "flex", gap: 8, marginBottom: 4 }}><span style={{ color: "#c8a000", flexShrink: 0 }}>•</span><span>{renderInline(line.slice(2))}</span></div>;
        if (/^\d+\.\s/.test(line)) return <div key={key} style={{ display: "flex", gap: 8, marginBottom: 4 }}><span style={{ color: "#c8a000", minWidth: 20 }}>{line.match(/^\d+/)?.[0]}.</span><span>{renderInline(line.replace(/^\d+\.\s/, ""))}</span></div>;
        if (line.startsWith("> ")) return <blockquote key={key} style={{ borderLeft: "3px solid #8a6200", paddingLeft: 14, color: "rgba(245,200,80,0.65)", margin: "10px 0", fontStyle: "italic" }}>{renderInline(line.slice(2))}</blockquote>;
        if (line.startsWith("---") || line.startsWith("===")) return <hr key={key} style={{ border: "none", borderTop: "1px solid rgba(180,130,0,0.2)", margin: "20px 0" }} />;
        if (!line.trim()) return <div key={key} style={{ height: 8 }} />;
        return <p key={key} style={{ margin: "4px 0" }}>{renderInline(line)}</p>;
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
