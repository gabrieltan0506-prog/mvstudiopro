import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReportGeneratorPanel from "@/components/ReportGeneratorPanel";
import { ImageUpscaleBar } from "@/components/ImageUpscaleBar";
import IpProfileModal, { readIpProfile, isIpProfileReady, type IpProfile } from "@/components/IpProfileModal";
import { useAuth } from "@/_core/hooks/useAuth";
import TrialWatermarkImage from "@/components/TrialWatermarkImage";
import { useIsTrialUser } from "@/_core/hooks/useIsTrialUser";
import { getLoginUrl } from "@/const";
import { createJob, getJob } from "@/lib/jobs";
import { trpc } from "@/lib/trpc";
import type {
  GrowthAnalysisScores,
  GrowthMonetizationStrategy,
  GrowthPlatformActivity,
  GrowthPlatformRecommendation,
  GrowthSnapshot,
  GrowthTitleExecution,
} from "@shared/growth";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Award,
  BarChart3,
  BookOpen,
  Bot,
  Briefcase,
  CalendarRange,
  Camera,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  DollarSign,
  FileText,
  Film,
  Flame,
  Globe,
  Heart,
  Image,
  Landmark,
  Layers,
  Loader2,
  MessageSquareText,
  Mic,
  Palette,
  PenLine,
  PlayCircle,
  Rocket,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Stethoscope,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Video,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import VoiceInputButton from "@/components/VoiceInputButton";

const SUPERVISOR_ACCESS_KEY = "mvs-supervisor-access";

const WINDOW_OPTIONS = [
  { days: 15 as const, label: "15天", description: "看短期波动、热点与即时机会" },
  { days: 30 as const, label: "30天", description: "看平台主流结构与相对稳定方向" },
  { days: 45 as const, label: "45天", description: "看更长窗口的沉淀与长期可做性" },
] as const;

const EMPTY_ANALYSIS: GrowthAnalysisScores = {
  composition: 0,
  color: 0,
  lighting: 0,
  impact: 0,
  viralPotential: 0,
  explosiveIndex: 0,
  realityCheck: "",
  reverseEngineering: {
    hookStrategy: "",
    emotionalArc: "",
    commercialLogic: "",
  },
  premiumContent: {
    summary: "",
    strategy: "",
    actionableTopics: [],
    topics: [],
    explosiveTopicAnalysis: "",
    musicAndExpressionAnalysis: "",
    remixVisualAnalysis: "",
    remixExpressionAnalysis: "",
    musicPrompt: "",
  },
  visualSummary: "",
  openingFrameAssessment: "",
  sceneConsistency: "",
  languageExpression: "",
  emotionalExpression: "",
  cameraEmotionTension: "",
  bgmAnalysis: "",
  musicRecommendation: "",
  sunoPrompt: "",
  trustSignals: [],
  visualRisks: [],
  keyFrames: [],
  strengths: [],
  improvements: [],
  platforms: [],
  summary: "",
  titleSuggestions: [],
  creatorCenterSignals: [],
  timestampSuggestions: [],
  weakFrameReferences: [],
  commercialAngles: [],
  followUpPrompt: "",
};

type AskResult = {
  title: string;
  answer: string;
  encouragement: string;
  nextQuestions: string[];
};

type PlatformDashboard = {
  headline: string;
  subheadline: string;
  personaSummary: string;
  topSignals: Array<{ title: string; detail: string; badge?: string }>;
  platformMenu: Array<{
    platform: string;
    label: string;
    trend: string;
    lane: string;
    whyNow: string;
    recommendedFormat?: string;
    titleExample?: string;
    contentHook?: string;
    nextMove: string;
    monetizationPath?: string;
  }>;
  hotTopics: Array<{ title: string; whyHot: string; howToUse: string }>;
  contentBlueprints: Array<{
    title: string;
    format: string;
    hook: string;
    copywriting: string;
    graphicPlan?: string;
    videoPlan?: string;
    suitablePlatforms?: string[];
  }>;
  monetizationLanes: Array<{
    title: string;
    fitReason: string;
    offerShape: string;
    revenueModes: string[];
    firstValidation: string;
  }>;
  actionCards: Array<{ title: string; detail: string }>;
  conversationStarters: string[];
};

type ProcessingStepCard = {
  id: string;
  label: string;
  detail: string;
  status: "done" | "active" | "pending";
};

/**
 * renderHighlightText — parses **bold** markers and [高亮:keyword] patterns
 * from AI-generated text and renders them as highlighted spans.
 */
function renderHighlightText(text: string): React.ReactNode {
  if (!text) return null;
  const parts = text.split(/(\*\*.*?\*\*|\[高亮:[^\]]+\])/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="text-[#8cefff] font-bold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("[高亮:") && part.endsWith("]")) {
      const kw = part.slice(4, -1);
      return <mark key={i} className="rounded px-1 bg-[rgba(73,230,255,0.18)] text-[#49e6ff] font-semibold not-italic">{kw}</mark>;
    }
    return <span key={i}>{part}</span>;
  });
}

// Smart icon picker — matches persona keywords or signal content to an appropriate Lucide icon
// Returns a JSX element (LucideIcon rendered at given size/color)
function getSmartIcon(text: string, className = "h-4 w-4 text-[#8cefff]"): React.ReactElement {
  const t = String(text || "").toLowerCase();
  if (/医生|医师|心脏|临床|心血管|stethoscope|doctor|cardio/.test(t)) return <Stethoscope className={className} />;
  if (/心电图|ekg|ecg|脉搏|动脉|血管/.test(t)) return <Activity className={className} />;
  if (/文化|艺术|书画|人文|古代|历史|文物|古建|收藏/.test(t)) return <Landmark className={className} />;
  if (/美学|审美|palette|设计|色彩|风格/.test(t)) return <Palette className={className} />;
  if (/视频|短视频|短片|拍摄|分镜|film|video/.test(t)) return <Video className={className} />;
  if (/图文|图片|封面|排版|image|photo|graphic/.test(t)) return <Image className={className} />;
  if (/播客|直播|podcast|音频|声音|mic/.test(t)) return <Mic className={className} />;
  if (/变现|收入|付费|课程|knowledge|monetize|商业化/.test(t)) return <DollarSign className={className} />;
  if (/品牌|合作|赞助|brand|sponsor/.test(t)) return <Briefcase className={className} />;
  if (/赛道|方向|策略|lane|track|strategy/.test(t)) return <Target className={className} />;
  if (/热点|趋势|话题|trending|booster/.test(t)) return <Flame className={className} />;
  if (/平台|platform|分发/.test(t)) return <Globe className={className} />;
  if (/文案|copy|写作|script|脚本|内容/.test(t)) return <PenLine className={className} />;
  if (/书|阅读|knowledge|知识/.test(t)) return <BookOpen className={className} />;
  if (/奖|top|第一|冠军|award|trophy/.test(t)) return <Trophy className={className} />;
  if (/步骤|行动|action|execute|step/.test(t)) return <Zap className={className} />;
  if (/粉丝|用户|audience|followers/.test(t)) return <Users className={className} />;
  if (/分享|share|传播/.test(t)) return <Share2 className={className} />;
  if (/数据|analytics|stat|metric/.test(t)) return <BarChart3 className={className} />;
  if (/layer|level|层|structure|结构/.test(t)) return <Layers className={className} />;
  if (/情感|情绪|emotion|心理/.test(t)) return <Heart className={className} />;
  if (/article|文章|报告|文档/.test(t)) return <FileText className={className} />;
  // Rotating fallback based on hash of text (ensures different cards get different icons)
  const fallbacks = [<Sparkles className={className} />, <Star className={className} />, <Award className={className} />, <PlayCircle className={className} />, <ArrowRight className={className} />];
  let hash = 0;
  for (let i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) & 0xffff;
  return fallbacks[hash % fallbacks.length];
}

// Universal safe-text extractor — handles string | object | null from LLM outputs
// Prevents [object Object] from rendering in JSX by extracting the most likely text field
function renderSafeText(item: any, fallback = ""): string {
  if (!item && item !== 0) return fallback;
  if (typeof item === "string") return item;
  if (typeof item === "number") return String(item);
  if (typeof item === "object") {
    return String(
      item.title || item.text || item.content || item.name || item.desc ||
      item.laneName || item.label || item.value || item.detail ||
      Object.values(item).find((v) => typeof v === "string") ||
      JSON.stringify(item)
    );
  }
  return String(item);
}

function extractFocusKeywords(value: string) {
  return Array.from(
    new Set((String(value || "").match(/[\u4e00-\u9fa5A-Za-z]{2,}/g) || []).slice(0, 6)),
  );
}

function hasSupervisorAccess() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("supervisor") === "1") {
    localStorage.setItem(SUPERVISOR_ACCESS_KEY, "1");
    return true;
  }
  return localStorage.getItem(SUPERVISOR_ACCESS_KEY) === "1";
}

function getRelativeBar(value: number, max: number) {
  if (!max || max <= 0) return 0;
  return Math.max(10, Math.round((value / max) * 100));
}

function revealText(text: string, elapsedTime: number, seed = 0, speed = 18) {
  const normalized = String(text || "");
  if (!normalized) return "";
  const visibleCount = Math.max(1, Math.min(normalized.length, Math.floor(elapsedTime * speed) - seed));
  return normalized.slice(0, visibleCount);
}

function buildPlatformProcessingSteps(selectedWindowDays: 15 | 30 | 45, elapsedTime: number, focusPrompt: string): ProcessingStepCard[] {
  const phase = Math.floor(elapsedTime / 4);
  const subject = String(focusPrompt || "").trim() || "当前平台机会";
  const currentStep = Math.min(3, phase);
  return [
    {
      id: "collect",
      label: `读取近 ${selectedWindowDays} 天平台快照`,
      detail: "先把当前窗口里的平台热度、动量和样本结构取出来。",
      status: currentStep > 0 ? "done" : "active",
    },
    {
      id: "sort",
      label: "整理热点赛道与平台优先级",
      detail: `围绕“${subject}”筛出更值得先做的平台与切入方向。`,
      status: currentStep === 1 ? "active" : currentStep > 1 ? "done" : "pending",
    },
    {
      id: "advice",
      label: "生成商业化与动作建议",
      detail: "把热点翻译成可执行的选题、形式和承接动作。",
      status: currentStep === 2 ? "active" : currentStep > 2 ? "done" : "pending",
    },
    {
      id: "polish",
      label: "整理成顾问看板",
      detail: "把结论压缩成用户一眼能看懂、愿意继续追问的版本。",
      status: currentStep >= 3 ? "active" : "pending",
    },
  ];
}

function getWindowLabel(value: 15 | 30 | 45) {
  return WINDOW_OPTIONS.find((item) => item.days === value)?.label || `${value}天`;
}

function shellCardClasses(extra = "") {
  return `rounded-[28px] border border-white/10 bg-[rgba(14,9,32,0.88)] shadow-[0_18px_80px_rgba(0,0,0,0.28)] backdrop-blur ${extra}`.trim();
}

function splitAnswerParagraphs(value: string) {
  return String(value || "")
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanUserCopy(value: string, fallback = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;

  const softened = normalized
    .replace(/\bfallback\b/gi, "当前参考")
    .replace(/\blive sample(?:-\d+d)?\b/gi, "近期样本")
    .replace(/\bhistorical\b/gi, "中期沉淀")
    .replace(/\bverify\b/gi, "先验证")
    .replace(/\bcollector\b/gi, "")
    .replace(/\bcurrentTotal\b/gi, "")
    .replace(/\barchivedTotal\b/gi, "");

  if (/(后台|工程|数据库|主链|样本裂缝|日期覆盖|补位|live sample|historical|fallback|collector|coverage)/i.test(softened)) {
    return fallback;
  }

  return softened.trim() || fallback;
}

function TopicImageGenerator({
  title,
  hook,
  format,
  supervisorAccess,
  executionDetails,
}: {
  title: string;
  hook: string;
  format: "图文" | "短视频";
  supervisorAccess: boolean;
  executionDetails?: any;
}) {
  const isTrial = useIsTrialUser();
  const [imageUrl, setImageUrl] = useState("");
  const generateMutation = trpc.mvAnalysis.generateTopicImage.useMutation({
    onSuccess: (res) => { setImageUrl(res.imageUrl); },
    onError: (err) => toast.error(err.message || "生成失败，请重试"),
  });


  const handleGenerateImage = () => {
    let promptText = title + " " + hook;
    if (executionDetails) {
      const env = renderSafeText(executionDetails.environmentAndWardrobe);
      const light = renderSafeText(executionDetails.lightingAndCamera);
      if (env || light) {
        promptText = `场景与服装：${env}，灯光与镜头：${light}。主题：${title} ${hook}`;
      }
    }
    generateMutation.mutate({ topicHook: promptText, format });
  };

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      {!imageUrl ? (
        <button
          type="button"
          disabled={generateMutation.isPending}
          onClick={handleGenerateImage}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
        >
          {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin text-[#ffdd44]" /> : <Palette className="h-4 w-4 text-[#ffdd44]" />}
          {generateMutation.isPending ? "正在绘制高质感参考图..." : `🎨 生成视觉参考图 ${supervisorAccess ? "" : "(扣除 3 积分)"}`}
        </button>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-[rgba(14,9,32,0.88)] p-2">
          <div className="mb-2 flex items-center justify-between px-2 pt-2 text-[11px] font-semibold text-[#b7add8]">
            <span>参考视觉风格</span>
            <button onClick={() => { setImageUrl(""); }} className="hover:text-white">重置</button>
          </div>

          <TrialWatermarkImage src={imageUrl} isTrial={isTrial} className="w-full rounded-xl" />

          <div className="px-2 pb-2">
            <ImageUpscaleBar
              imageUrl={imageUrl}
              baseCreditKey="forgeImage"
              className="mt-2"
              onUpscaled={(url) => setImageUrl(url)}
            />
          </div>
        </div>
      )}

    </div>
  );
}

export default function PlatformPage() {
  const [supervisorAccess] = useState(() => hasSupervisorAccess());
  const [debugMode, setDebugMode] = useState(false);
  const { isAuthenticated, loading, user } = useAuth({
    autoFetch: true,
    redirectOnUnauthenticated: !supervisorAccess,
    redirectPath: getLoginUrl(),
  });
  const [selectedWindowDays, setSelectedWindowDays] = useState<15 | 30 | 45>(15);
  const [focusPrompt, setFocusPrompt] = useState("");
  const [voiceDebugLog, setVoiceDebugLog] = useState<string[]>([]);
  const addVoiceDebug = (msg: string) => setVoiceDebugLog((prev) => [...prev.slice(-30), msg]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [question, setQuestion] = useState("");
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [rotatingCardIndex, setRotatingCardIndex] = useState(0);
  // Separate state for dashboard — populated by the second call after snapshot loads
  const [platformDashboard, setPlatformDashboard] = useState<PlatformDashboard | null>(null);
  const [dashboardDebug, setDashboardDebug] = useState<Record<string, unknown> | null>(null);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);
  // Call 3 state — content blueprints and monetization
  const [platformContent, setPlatformContent] = useState<{ contentBlueprints: PlatformDashboard["contentBlueprints"]; monetizationLanes: PlatformDashboard["monetizationLanes"] } | null>(null);
  const [contentDebug, setContentDebug] = useState<Record<string, unknown> | null>(null);
  const [isContentLoading, setIsContentLoading] = useState(false);

  const growthSnapshotQuery = trpc.mvAnalysis.getGrowthSnapshot.useQuery(
    {
      context: focusPrompt || undefined,
      modelName: "gemini-3.1-pro-preview",
      requestedPlatforms: ["douyin", "xiaohongshu", "bilibili", "kuaishou"],
      analysis: EMPTY_ANALYSIS,
      windowDays: selectedWindowDays,
      interactivePlatform: true,
    },
    {
      enabled: false,
      staleTime: 300_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: false,
    },
  );

  const getPlatformDashboardMutation = trpc.mvAnalysis.getPlatformDashboard.useMutation({
    onSuccess: (result) => {
      if (result.platformDashboard) {
        setPlatformDashboard(result.platformDashboard as PlatformDashboard);
        // Chain Call 3 immediately after Call 2 succeeds
        setIsContentLoading(true);
        getPlatformContentMutation.mutate({
          context: focusPrompt || undefined,
          windowDays: selectedWindowDays,
          platformMenu: (result.platformDashboard as PlatformDashboard).platformMenu,
          snapshotSummary: (getPlatformDashboardMutation.variables as any)?.snapshotSummary || {},
        });
      }
      setDashboardDebug(result.debug as Record<string, unknown>);
      setIsDashboardLoading(false);
    },
    onError: (error) => {
      console.warn("[PlatformPage] dashboard mutation error:", error.message);
      setIsDashboardLoading(false);
    },
  });

  const getPlatformContentMutation = trpc.mvAnalysis.getPlatformContent.useMutation({
    onSuccess: (result) => {
      if (result.platformContent) {
        setPlatformContent(result.platformContent as any);
      }
      setContentDebug(result.debug as Record<string, unknown>);
      setIsContentLoading(false);
    },
    onError: (error) => {
      console.warn("[PlatformPage] content mutation error:", error.message);
      setIsContentLoading(false);
    },
  });

  const askPlatformFollowUpMutation = trpc.mvAnalysis.askPlatformFollowUp.useMutation({
    onSuccess: (result) => {
      setAskResult(result.result);
    },
    onError: (error) => {
      toast.error(error.message || "平台追问失败");
    },
  });

  // ── Async Job Queue mutations ──────────────────────────────────────────────
  const createPlatformAnalysisJobMutation = trpc.mvAnalysis.createPlatformAnalysisJob.useMutation();
  const createPlatformQAJobMutation = trpc.mvAnalysis.createPlatformQAJob.useMutation();
  const recordSnapshotMutation = trpc.mvAnalysis.recordAnalysisSnapshot.useMutation();

  const downloadPlatformPdfMutation = trpc.mvAnalysis.downloadPlatformPdf.useMutation({
    onSuccess: (result) => {
      setIsDownloadingPdf(false);
      if (!result.pdfBase64) { toast.error("PDF 生成成功但内容为空，请重试"); return; }
      try {
        const bytes = Uint8Array.from(atob(result.pdfBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `platform-analysis-${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        toast.success("平台分析 PDF 已开始下载，快照已保存至「我的作品」");
        // Save snapshot record (GMT+8 title) with summary content
        const gmt8Label = new Date().toLocaleDateString("zh-TW", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
        const summaryLines: string[] = [];
        if (platformDashboard?.headline) summaryLines.push(platformDashboard.headline);
        if (platformDashboard?.subheadline) summaryLines.push(platformDashboard.subheadline);
        if (platformDashboard?.hotTopics?.length) {
          summaryLines.push("\n🔥 热门趋势");
          platformDashboard.hotTopics.slice(0, 5).forEach((t: any) => {
            summaryLines.push(`• ${t.title || t.topic || t}`);
          });
        }
        if (platformDashboard?.platformMenu?.length) {
          summaryLines.push("\n📊 平台分析");
          platformDashboard.platformMenu.slice(0, 4).forEach((p: any) => {
            summaryLines.push(`• ${p.label || p.name || p}`);
          });
        }
        recordSnapshotMutation.mutate({
          analysisType: "platform",
          title: `平台趋势分析 ${gmt8Label}`,
          summary: summaryLines.join("\n").slice(0, 1800),
          analysisDate: new Date().toISOString(),
        });
      } catch { toast.error("PDF 下载时出错，请重试"); }
    },
    onError: (err) => { setIsDownloadingPdf(false); toast.error(err.message || "PDF 导出失败"); },
  });

  // ── B 端 IP 基因库（拦截弹窗，共享组件 IpProfileModal）─────────────────────
  // 落地需求：handleAnalyze 启动前必须先填齐 IP 护城河 + 高客单锚点，
  // 否则弹「靛青色」拦截弹窗，强制用户校准战略预设。
  // ipProfile 同步写 localStorage(`ipProfile.v1`)，GodView 一键深潜也会读它注入 prompt。
  const [ipProfile, setIpProfile] = useState<IpProfile>(() => readIpProfile());
  const [showIpModal, setShowIpModal] = useState(false);

  // ── Job polling state ──────────────────────────────────────────────────────
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);
  const [qaJobId, setQaJobId] = useState<string | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const analysisPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qaPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [analysisPollCount, setAnalysisPollCount] = useState(0);
  const [analysisJobStatus, setAnalysisJobStatus] = useState<string>("idle");
  // QA file attachment state
  const [qaFileUri, setQaFileUri] = useState<string | null>(null);
  const [qaFileMimeType, setQaFileMimeType] = useState<string>("");
  const [qaFileName, setQaFileName] = useState<string>("");
  const [isUploadingQaFile, setIsUploadingQaFile] = useState(false);
  const [qaUploadStatus, setQaUploadStatus] = useState<"idle" | "success" | "error">("idle");
  const [isQaLoading, setIsQaLoading] = useState(false);
  const qaFileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup polling intervals on unmount
  useEffect(() => {
    return () => {
      if (analysisPollingRef.current) clearInterval(analysisPollingRef.current);
      if (qaPollingRef.current) clearInterval(qaPollingRef.current);
    };
  }, []);

  const startAnalysisPolling = useCallback((jobId: string) => {
    if (analysisPollingRef.current) clearInterval(analysisPollingRef.current);
    let transientFailures = 0;
    let pollCount = 0;
    setAnalysisPollCount(0);
    setAnalysisJobStatus("queued");
    analysisPollingRef.current = setInterval(async () => {
      try {
        const job = await getJob(jobId);
        transientFailures = 0;
        pollCount += 1;
        setAnalysisPollCount(pollCount);
        setAnalysisJobStatus(job.status || "unknown");
        if (job.status === "succeeded") {
          clearInterval(analysisPollingRef.current!);
          analysisPollingRef.current = null;
          const output = job.output as any;
          if (output?.platformDashboard) {
            setPlatformDashboard(output.platformDashboard);
          }
          setIsDashboardLoading(false);
          if (output?.platformContent) {
            setPlatformContent(output.platformContent);
          }
          setIsContentLoading(false);
          toast.success("深度分析已完成");
        } else if (job.status === "failed") {
          clearInterval(analysisPollingRef.current!);
          analysisPollingRef.current = null;
          setIsDashboardLoading(false);
          setIsContentLoading(false);
          // Write job.error to dashboardDebug so it shows in the debug panel error section
          setDashboardDebug((prev) => ({ ...(prev || {}), error: job.error || "unknown error" }));
          toast.error(`分析任务失败: ${job.error || "未知错误"}`);
        }
      } catch {
        transientFailures += 1;
        if (transientFailures >= 5) {
          clearInterval(analysisPollingRef.current!);
          analysisPollingRef.current = null;
          setIsDashboardLoading(false);
          setIsContentLoading(false);
          setAnalysisJobStatus("polling_error");
          toast.error("轮询分析任务时出错，请重试");
        }
      }
    }, 3000);
  }, []);

  const startQAPolling = useCallback((jobId: string) => {
    if (qaPollingRef.current) clearInterval(qaPollingRef.current);
    let transientFailures = 0;
    qaPollingRef.current = setInterval(async () => {
      try {
        const job = await getJob(jobId);
        transientFailures = 0;
        if (job.status === "succeeded") {
          clearInterval(qaPollingRef.current!);
          qaPollingRef.current = null;
          setIsQaLoading(false);
          const output = job.output as any;
          if (output?.result) {
            setAskResult(output.result);
          } else if (output?.answer || typeof output === "string") {
            setAskResult({
              title: "深度追问解答",
              answer: typeof output === "string" ? output : (output.answer || ""),
              encouragement: "以上是结合最新数据的专属执行建议。",
              nextQuestions: [],
            });
          }
        } else if (job.status === "failed") {
          clearInterval(qaPollingRef.current!);
          qaPollingRef.current = null;
          setIsQaLoading(false);
          toast.error(`追问任务失败: ${job.error || "未知错误"}`);
        }
      } catch {
        transientFailures += 1;
        if (transientFailures >= 5) {
          clearInterval(qaPollingRef.current!);
          qaPollingRef.current = null;
          setIsQaLoading(false);
          toast.error("轮询追问任务时出错，请重试");
        }
      }
    }, 3000);
  }, []);

  const handleDownloadPlatformPdf = useCallback(() => {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script").forEach((n) => n.remove());
    const base = document.createElement("base");
    base.href = window.location.origin + "/";
    clone.querySelector("head")?.prepend(base);

    const htmlContent = "<!DOCTYPE html>" + clone.outerHTML;
    setIsDownloadingPdf(true);
    toast.info("云端压制 PDF 中，多数约 15～45 分钟，请保持页面打开。", { duration: 10_000 });
    downloadPlatformPdfMutation.mutate({ html: htmlContent, token: `wait=360000&selector=%23platform-report` });
  }, [downloadPlatformPdfMutation]);

  const snapshot = growthSnapshotQuery.data?.snapshot as GrowthSnapshot | undefined;
  const snapshotDebug = growthSnapshotQuery.data?.debug as Record<string, unknown> | undefined;
  const askDebug = askPlatformFollowUpMutation.data?.debug as Record<string, unknown> | undefined;
  const mainPath = snapshot?.decisionFramework.mainPath;
  const assetAdaptation = snapshot?.decisionFramework.assetAdaptation;
  const topRecommendation = snapshot?.platformRecommendations[0];
  const topMonetization = snapshot?.monetizationStrategies[0];
  const validationPlan = snapshot?.decisionFramework.validationPlan ?? [];
  const businessTranslation = snapshot?.decisionFramework.businessTranslation ?? [];
  const materialFacts = snapshot?.decisionFramework.materialFacts ?? [];
  const audienceTriggers = snapshot?.decisionFramework.audienceTriggers ?? [];
  const titleExecutions = snapshot?.titleExecutions ?? [];
  const platformActivities = snapshot?.platformActivities ?? [];
  const monetizationStrategies = snapshot?.monetizationStrategies ?? [];

  const primaryPlatforms = useMemo(() => snapshot?.platformSnapshots.slice(0, 4) ?? [], [snapshot]);
  const maxFit = Math.max(...primaryPlatforms.map((item) => item.audienceFitScore), 100);
  const maxMomentum = Math.max(...primaryPlatforms.map((item) => item.momentumScore), 100);
  const topTopics = useMemo(
    () =>
      platformDashboard?.hotTopics.length
        ? platformDashboard.hotTopics
        : (snapshot?.topicLibrary.slice(0, 8).map((item) => ({
            title: item.title,
            whyHot: item.rationale,
            howToUse: item.executionHint,
          })) ?? []),
    [platformDashboard, snapshot],
  );
  const recommendedPlatforms = useMemo(() => snapshot?.platformRecommendations.slice(0, 4) ?? [], [snapshot]);
  const actionSteps = useMemo(
    () => {
      if (platformDashboard?.actionCards && platformDashboard.actionCards.length > 0) {
        return platformDashboard.actionCards.map((item: any, index: number) => ({
          day: index + 1,
          title: cleanUserCopy(item.title || item["动作"] || item["标题"] || "", `第 ${index + 1} 步`),
          // Fix #5: pass "" as fallback — never show generic "先做一个可以快速拿到反馈的动作"
          action: cleanUserCopy(item.detail || item.action || item["详情"] || item["建议"] || "", ""),
        }));
      }
      if (validationPlan.length) {
        return validationPlan.slice(0, 4).map((item, index) => ({
          day: index + 1,
          title: cleanUserCopy(item.label, `第 ${index + 1} 步`),
          action: cleanUserCopy(item.nextMove || item.successSignal, ""),
        }));
      }
      return (snapshot?.growthPlan.slice(0, 4) ?? []).map((item, index) => ({
        day: index + 1,
        title: cleanUserCopy(item.title, `第 ${index + 1} 步`),
        action: cleanUserCopy(item.action, ""),
      }));
    },
    [platformDashboard, snapshot, validationPlan],
  );
  const keyInsights = useMemo(
    () =>
      platformDashboard?.topSignals && platformDashboard.topSignals.length > 0
        ? platformDashboard.topSignals.map((item: any) => typeof item === "string"
            ? { title: item, detail: "", badge: "" }
            : { title: item.title || item["标题"] || item["核心判断"] || "", detail: item.detail || item.desc || item.description || item["详情"] || "", badge: item.badge || item["标签"] || "" })
        : (snapshot?.businessInsights.slice(0, 4).map((item) => ({
            title: item.title,
            detail: item.detail,
            badge: "结论",
          })) ?? []),
    [platformDashboard, snapshot],
  );
  const focusKeywords = useMemo(() => extractFocusKeywords(focusPrompt), [focusPrompt]);
  const personalizedSubject = useMemo(() => {
    if (focusKeywords.length) return focusKeywords.join(" / ");
    return topTopics[0]?.title || platformDashboard?.headline || "当前内容方向";
  }, [focusKeywords, platformDashboard, topTopics]);
  const recommendationHeadline = useMemo(() => {
    // Prefer LLM-generated headline first to avoid snapshot "电商带货" leaking here
    if (platformDashboard?.headline) return platformDashboard.headline;
    if (mainPath?.title) return cleanUserCopy(mainPath.title, mainPath.title);
    const topPlatform = recommendedPlatforms[0]?.name || "当前优先平台";
    return `围绕 ${personalizedSubject}，先把 ${topPlatform} 做透`;
  }, [mainPath, personalizedSubject, platformDashboard, recommendedPlatforms]);
  const hotQuestionSuggestions = useMemo(() => {
    const platformLead = topRecommendation?.name || recommendedPlatforms[0]?.name || "小红书";
    const topicLead = titleExecutions[0]?.title || topTopics[0]?.title || personalizedSubject;
    if (platformDashboard?.conversationStarters.length) return platformDashboard.conversationStarters.slice(0, 4);
    return [
      `如果我先发${platformLead}，围绕“${topicLead}”应该先做哪三个选题？`,
      `在${selectedWindowDays}天维度里，现在哪个平台最值得优先押注？`,
      `如果我只做图文，不做视频，围绕“${personalizedSubject}”应该怎么切入？`,
      `结合这轮趋势，${personalizedSubject} 最容易做成哪种商业承接？`,
    ];
  }, [personalizedSubject, platformDashboard, recommendedPlatforms, selectedWindowDays, titleExecutions, topRecommendation, topTopics]);

  const heroTrustPoints = useMemo(
    () => [
      { label: "交付内容", value: "平台优先级 + 热点赛道 + 商业化建议" },
      { label: "分析方式", value: `${getWindowLabel(selectedWindowDays)} 时间窗口，不做泛建议` },
      { label: "使用场景", value: "适合你决定先做哪个平台、发什么形式、怎么承接时使用" },
    ],
    [selectedWindowDays],
  );

  const resultSummaryCards = useMemo(() => {
    if (!snapshot) {
      return [
        { label: "你会拿到", value: "优先平台判断", detail: "不是平台百科，而是告诉你先打哪里" },
        { label: "你会拿到", value: "热点和赛道切口", detail: "把热点翻成可执行题目和表达方式" },
        { label: "你会拿到", value: "商业化承接建议", detail: "告诉你什么能接单、什么暂时别做" },
        { label: "你会拿到", value: "顾问式追问", detail: "继续问到形式、节奏、承接动作这一级" },
      ];
    }

    if (platformDashboard) {
      // If we have LLM analysis, prefer topSignals over snapshot
      const getSignal = (idx: number, fallbackValue: string, fallbackDetail: string) => {
        const signal: any = platformDashboard.topSignals[idx];
        if (!signal) return { value: fallbackValue, detail: fallbackDetail };
        if (typeof signal === "string") return { value: signal, detail: fallbackDetail };
        return {
          value: cleanUserCopy(signal.title || signal["标题"] || fallbackValue, fallbackValue),
          detail: cleanUserCopy(signal.detail || signal.desc || signal.description || signal["详情"] || fallbackDetail, fallbackDetail)
        };
      };

      const sig0 = getSignal(0, platformDashboard.headline || "先收口成一个明确方向", platformDashboard.subheadline || "先把最容易拿到反馈的平台和切口做透。");
      const sig1 = getSignal(1, platformDashboard.platformMenu?.[0]?.platform || "先做当前优先平台", platformDashboard.platformMenu?.[0]?.whyNow || "先做最容易拿到正反馈的平台版本。");
      
      // Task 1: 彻底物理消灭"电商带货"幽灵 — 严格的 Skeleton 状态，不显示任何兜底文本
      const sig2 = isContentLoading
        ? { isLoadingSkeleton: true, value: "正在推演专属商业变现路径...", detail: "深度定制，请稍候。" }
        : getSignal(2, "先收口一个可承接方向", "把内容先做成有人愿意继续咨询或收藏的版本。");
      
      const sig3 = isContentLoading
        ? { isLoadingSkeleton: true, value: "正在生成首发微小行动指令...", detail: "保姆级拆解，请稍候。" }
        : getSignal(3, "先写出第一条内容", "先做一轮验证，再决定是否放大。");

      const ipScarcity = (platformDashboard as any)?.ipScarcity;
      const trafficForecast = (platformDashboard as any)?.trafficForecast;
      const conversionRate = (platformDashboard as any)?.conversionRate;

      return [
        { label: "当前判断", value: sig0.value, detail: sig0.detail },
        { label: "优先平台", value: sig1.value, detail: sig1.detail },
        { label: "商业赛道", value: sig2.value, detail: sig2.detail, isLoadingSkeleton: (sig2 as any).isLoadingSkeleton },
        { label: "首发动作", value: sig3.value, detail: sig3.detail, isLoadingSkeleton: (sig3 as any).isLoadingSkeleton },
      ];
    }

    return [
      {
        label: "当前判断",
        value: cleanUserCopy(mainPath?.summary || snapshot.overview.summary, "先收口成一个明确方向"),
        detail: cleanUserCopy(mainPath?.whyNow || snapshot.overview.trendNarrative, "先把最容易拿到反馈的平台和切口做透。"),
      },
      {
        label: "优先平台",
        value: cleanUserCopy(topRecommendation?.name || recommendationHeadline, "先做当前优先平台"),
        detail: cleanUserCopy(topRecommendation?.reason || businessTranslation[0]?.detail || "先做最容易拿到正反馈的平台版本。", "先做最容易拿到正反馈的平台版本。"),
      },
      {
        label: "商业赛道",
        value: "专属变现路径分析中...",
        detail: "基于当前窗口热点重新推演，不使用往期模板...",
        isLoadingSkeleton: true,
      },
      {
        label: "首发动作",
        value: "首发具体动作推演中...",
        detail: "正在提取近期验证过的内容格式...",
        isLoadingSkeleton: true,
      },
    ];
  }, [businessTranslation, isContentLoading, mainPath, recommendationHeadline, snapshot, topRecommendation, platformDashboard]);

  const platformDecisionRows = useMemo(
    () => {
      if (platformDashboard?.platformMenu.length) {
        return platformDashboard.platformMenu.slice(0, 4).map((item: any, index: number) => {
          // Keep raw objects — rendering code at referenceAccounts.map handles both string | {account,reason} polymorphically
          // DO NOT call .map(String) here — that converts {account,reason} objects to "[object Object]"
          const refs: any[] = Array.isArray(item.referenceAccounts) ? item.referenceAccounts : [];
          // Use renderSafeText to prevent [object Object] when Gemini returns nested objects
          const boosters = Array.isArray(item.trafficBoosters) ? item.trafficBoosters.map((b: any) => renderSafeText(b)) : [];
          const rSafe = (v: any) => renderSafeText(v);
          return {
            id: `${item.platform || item.name || item["平台"] || index}-${item.label || item.displayName || index}`,
            name: item.label || item.displayName || item.name || item.platform || item["平台"] || `平台 ${index + 1}`,
            lane: cleanUserCopy(rSafe(item.lane || item.contentAngle || item["赛道"] || item["内容赛道"] || ""), item.label || `平台 ${index + 1}`),
            trend: cleanUserCopy(rSafe(item.recommendedFormat || item.trend || item.format || item["内容形式"] || item["推荐形式"] || ""), "先从更顺手的表达方式切入"),
            whyNow: cleanUserCopy(rSafe(item.whyNow || item.reason || item.summary || item["为什么"] || item["推荐理由"] || ""), "当前窗口里，这个平台更容易拿到第一轮反馈。"),
            nextMove: cleanUserCopy(rSafe(item.titleExample || item.nextMove || item.action || item["标题示例"] || item["下一步"] || ""), "先发一版内容拿反馈。"),
            hook: cleanUserCopy(rSafe(item.contentHook || item.hook || item.nextMove || item["开头怎么说"] || item["开头钩子"] || ""), "先把第一句判断说出来。"),
            monetization: cleanUserCopy(rSafe(item.monetizationPath || item.monetization || item["商业承接路径"] || item["变现路径"] || ""), ""),
            referenceAccounts: refs,
            primaryTrack: item.primaryTrack || "",
            estimatedTraffic: item.estimatedTraffic || "",
            ipUniqueness: item.ipUniqueness || "",
            commercialConversion: item.commercialConversion || "",
            trafficBoosters: boosters,
          };
        });
      }

      // If we are loading the dashboard, return empty placeholders to avoid flashing generic snapshot data
      if (isDashboardLoading) {
        return [];
      }

      const rows = (snapshot?.platformRecommendations.length ? snapshot.platformRecommendations : recommendedPlatforms).slice(0, 4);
      return rows.map((item: GrowthPlatformRecommendation, index) => {
        const activity = platformActivities[index] as GrowthPlatformActivity | undefined;
        const platformSnapshot = primaryPlatforms[index];
        return {
          id: `${item.name}-${index}`,
          name: item.name,
          lane: cleanUserCopy(activity?.contentAngle || item.topicIdeas[0]?.title || platformSnapshot?.fitLabel || "先做与你当前身份更匹配的表达方向", "先做与你当前身份更匹配的表达方向"),
          trend: cleanUserCopy(activity?.recommendedFormat || item.playbook || `动量 ${platformSnapshot?.momentumScore || 0} / 适配 ${platformSnapshot?.audienceFitScore || 0}`, "先用更适合的平台内容形式启动"),
          whyNow: cleanUserCopy(item.reason || activity?.summary || platformSnapshot?.summary || "这个平台更适合你当前这轮内容验证。", "这个平台更适合你当前这轮内容验证。"),
          nextMove: cleanUserCopy(item.action || activity?.optimizationPlan || validationPlan[index]?.nextMove || "正在推演专属于你的行动建议...", "正在推演专属于你的行动建议..."),
          hook: cleanUserCopy(titleExecutions[index]?.openingHook || titleExecutions[index]?.copywriting || "", ""),
          monetization: cleanUserCopy(monetizationStrategies[index]?.primaryTrack || "", ""),
          referenceAccounts: [] as string[],
          primaryTrack: "",
          estimatedTraffic: "",
          ipUniqueness: "",
          commercialConversion: "",
          trafficBoosters: [] as string[],
        };
      });
    },
    [monetizationStrategies, platformActivities, platformDashboard, primaryPlatforms, recommendedPlatforms, snapshot, titleExecutions, validationPlan],
  );

  const monetizationCards = useMemo(() => {
    try {
      // Data normalizer: maps Gemini raw item → clean { revenueModes: string[] } shape
      // Handles: missing key, Chinese key, string-instead-of-array type drift
      const normalizeMonetizationItem = (it: any) => {
        const rawRev =
          it?.revenueModes ||
          it?.["商业承接路径"] ||
          it?.["商业化路径"] ||
          it?.["变现路径"] ||
          it?.["变现方式"] ||
          it?.revenue_modes;
        const normalizedRev: string[] = Array.isArray(rawRev)
          ? rawRev.map((r) => renderSafeText(r))
          : typeof rawRev === "string" && rawRev.trim()
          ? [rawRev]
          : [];
        return { ...it, revenueModes: normalizedRev };
      }

      // Prefer Call 3 result, fall back to Call 2
      const rawLanes =
        Array.isArray(platformContent?.monetizationLanes) && platformContent!.monetizationLanes.length > 0
          ? platformContent!.monetizationLanes
          : Array.isArray(platformDashboard?.monetizationLanes) && platformDashboard!.monetizationLanes.length > 0
          ? platformDashboard!.monetizationLanes
          : null;

      const monetizationSource = rawLanes ? rawLanes.map(normalizeMonetizationItem) : null;

      if (monetizationSource && monetizationSource.length > 0) {
        return monetizationSource.slice(0, 2).map((item: any, index: number) => {
          // Task II: Support laneName / feasibility / actionItem keys from strict JSON template
          const title = item.title || item.laneName || item["变现方向名"] || item["标题"] || "";
          const summary = item.fitReason || item.feasibility || item.summary || item["为什么适合此人设"] || "";
          const actionPieces = [
            item.offerShape || item["交付形态"],
            ...item.revenueModes,
            item.firstValidation || item.actionItem || item["第一步如何做轻量验证"]
          ];
          return {
            id: `${title || index}-${index}`,
            title: cleanUserCopy(renderSafeText(title, `变现路径 ${index + 1}`), `变现路径 ${index + 1}`),
            summary: cleanUserCopy(renderSafeText(summary), ""),
            action: cleanUserCopy(
              actionPieces.map((p) => renderSafeText(p)).filter(Boolean).join(" / "),
              ""
            ),
          };
        });
      }

      if (isDashboardLoading || isContentLoading || platformDashboard || platformContent) {
        return [];
      }

      // If Call 3 is loading or completed, only show real LLM data.
      // 绝对禁止 fallback 到 snapshot 里的写死内容，避免泄漏"电商带货"
      return [];
    } catch (err) {
      console.error("[monetizationCards] render error:", err);
      return [];
    }
  }, [platformContent, platformDashboard]);

  const contentExecutionCards = useMemo(() => {
    // Prefer Call 3 result, fall back to Call 2
    const blueprintsSource =
      Array.isArray(platformContent?.contentBlueprints) && platformContent!.contentBlueprints.length > 0
        ? platformContent!.contentBlueprints
        : Array.isArray(platformDashboard?.contentBlueprints) && platformDashboard!.contentBlueprints.length > 0
        ? platformDashboard!.contentBlueprints
        : null;
    if (blueprintsSource && blueprintsSource.length > 0) {
      return blueprintsSource.slice(0, 4).map((item: any, index: number) => {
        const format = item.format || item["格式"] || item["内容形式"] || item["形式"] || "";
        const title = item.title || item["标题"] || item["选题标题"] || "";
        const hook = item.hook || item.openingHook || item["开头文案钩子"] || item["hook"] || item["开头钩子"] || "";
        const copywriting = item.copywriting || item.body || item["核心文案方向"] || item["文案"] || item["正文"] || "";
        const productionRaw =
          item.graphicPlan ||
          item.videoPlan ||
          item["图文怎么排版/视频怎么拍"] ||
          item["图文排版"] ||
          item["视频拍摄"] ||
          item["制作建议"] ||
          "";
        // Normalize suitablePlatforms: Gemini sometimes returns a comma-separated string instead of array
        const rawPlatforms = item.suitablePlatforms || item["适合平台"] || item["平台"] || [];
        const suitablePlatforms: string[] = Array.isArray(rawPlatforms)
          ? rawPlatforms.map((r) => renderSafeText(r))
          : typeof rawPlatforms === "string" && rawPlatforms.trim()
          ? rawPlatforms.split(/[,，、/]+/).map((s: string) => s.trim()).filter(Boolean)
          : [];
          
        const actionSteps: string[] = Array.isArray(item.actionableSteps) ? item.actionableSteps.map((a: any) => renderSafeText(a)) : [];

        const execDetails = typeof item.executionDetails === "object" && item.executionDetails !== null ? item.executionDetails : {};
        const envWardrobe = execDetails.environmentAndWardrobe || execDetails["拍摄环境服装"] || execDetails["环境服装"] || "";
        const lightCam = execDetails.lightingAndCamera || execDetails["灯光机位"] || execDetails["灯光镜头"] || "";
        
        let scriptSteps: string[] = [];
        if (Array.isArray(execDetails.stepByStepScript)) {
          scriptSteps = execDetails.stepByStepScript.map((s: any) => renderSafeText(s));
        } else if (typeof execDetails.stepByStepScript === "string" && execDetails.stepByStepScript.trim()) {
          scriptSteps = [execDetails.stepByStepScript];
        } else if (typeof execDetails.stepByStepScript === "object" && execDetails.stepByStepScript !== null) {
          scriptSteps = [renderSafeText(execDetails.stepByStepScript)];
        }

        return {
          id: `${title || index}-${index}`,
          // Task II: Support theme / titleExample / contentHook keys from strict JSON template
          title: cleanUserCopy(renderSafeText(title || item.theme || item.titleExample, `内容方案 ${index + 1}`), `内容方案 ${index + 1}`),
          hook: cleanUserCopy(renderSafeText(hook || item.contentHook, "先用一句明确判断开头。"), "先用一句明确判断开头。"),
          copywriting: cleanUserCopy(renderSafeText(copywriting, "把这条内容写成用户一看就知道你在解决什么问题的版本。"), "把这条内容写成用户一看就知道你在解决什么问题的版本。"),
          production: cleanUserCopy(renderSafeText(productionRaw), ""),
          format: renderSafeText(format),
          suitablePlatforms,
          actionableSteps: actionSteps,
          detailedScript: renderSafeText(item.detailedScript || ""),
          publishingAdvice: renderSafeText(item.publishingAdvice || ""),
          executionDetails: {
            environmentAndWardrobe: renderSafeText(envWardrobe),
            lightingAndCamera: renderSafeText(lightCam),
            stepByStepScript: scriptSteps
          },
        };
      });
    }

    // Once LLM analysis is in flight or complete, refuse snapshot fallbacks to prevent generic text leaking.
    // Show loading state via empty array — the JSX layer handles the spinner.
    if (isContentLoading || isDashboardLoading || platformDashboard || platformContent) {
      return [];
    }

    // Pre-analysis state only: show snapshot topics as preview placeholders
    return topTopics.slice(0, 4).map((item, index) => ({
      id: `${item.title}-${index}`,
      title: cleanUserCopy(item.title, `内容方案 ${index + 1}`),
      hook: cleanUserCopy(item.howToUse, "先把用户最关心的问题直接说出来。"),
      copywriting: cleanUserCopy(item.whyHot, "围绕这个切口写成用户能立刻代入的内容。"),
      production: "",
      format: recommendedPlatforms[index]?.topicIdeas?.[0] ? "短视频" : "图文",
    }));
  }, [isContentLoading, isDashboardLoading, platformDashboard, platformContent, recommendedPlatforms, topTopics]);

  const evidenceNotes = useMemo(() => {
    if (!snapshot) {
      return [
        "分析按 15 天 / 30 天 / 45 天三种窗口切开看，不把短期噪音和中期趋势混在一起。",
        "输出重点是先做哪个平台、切哪条赛道、怎样承接商业价值。",
        "追问继续基于本轮分析，不会把问题重新打回泛泛的平台介绍。",
      ];
    }
    return [
      ...materialFacts.slice(0, 2).map((item) => cleanUserCopy(item.detail, "")),
      cleanUserCopy(businessTranslation[0]?.detail || audienceTriggers[0]?.reason || "", ""),
    ].filter(Boolean);
  }, [audienceTriggers, businessTranslation, materialFacts, snapshot]);

  const directConclusion = useMemo(
    () => cleanUserCopy(platformDashboard?.subheadline || mainPath?.whyNow || snapshot?.overview.trendNarrative || "", "先把最值得验证的一条内容路线做透。"),
    [mainPath, platformDashboard, snapshot],
  );

  const personaSummary = useMemo(
    () => cleanUserCopy(platformDashboard?.personaSummary || "", "把专业身份和中国文化审美结合成一个更容易创建信任的IP入口。"),
    [platformDashboard],
  );

  const executionBlueprint = useMemo(
    () => {
      // Prioritize platformContent.contentBlueprints[0] over snapshot assetAdaptation
      const bestBlueprint: any =
        Array.isArray(platformContent?.contentBlueprints) && platformContent!.contentBlueprints.length > 0
          ? platformContent!.contentBlueprints[0]
          : Array.isArray(platformDashboard?.contentBlueprints) && platformDashboard!.contentBlueprints.length > 0
          ? platformDashboard!.contentBlueprints[0]
          : null;

      if (bestBlueprint) {
        return [
          {
            label: "内容开头",
            // Fix #4: prefer hook field; never use generic fallback
            detail: cleanUserCopy(bestBlueprint.hook || bestBlueprint.openingHook || bestBlueprint["开头文案钩子"] || bestBlueprint["hook"] || bestBlueprint["开头钩子"] || contentExecutionCards[0]?.hook || "", ""),
          },
          {
            label: "内容结构",
            detail: cleanUserCopy(bestBlueprint.copywriting || bestBlueprint.body || bestBlueprint["核心文案方向"] || bestBlueprint["文案"] || bestBlueprint["正文"] || contentExecutionCards[0]?.copywriting || "", ""),
          },
          {
            label: "行动引导",
            // Fix #4: pull from actionableSteps first, then production/graphicPlan — never generic template
            detail: cleanUserCopy(
              (Array.isArray(bestBlueprint.actionableSteps) && bestBlueprint.actionableSteps.length > 0
                ? bestBlueprint.actionableSteps.join(" → ")
                : "") ||
              bestBlueprint.graphicPlan || bestBlueprint.videoPlan || bestBlueprint["图文怎么排版/视频怎么拍"] || bestBlueprint["图文排版"] || bestBlueprint["视频拍摄"] || bestBlueprint["制作建议"] || contentExecutionCards[0]?.production || "",
              ""
            ),
          },
        ].filter((item) => item.detail);
      }

      return [
        {
          label: "内容开头",
          detail: isContentLoading ? "正在重构开场三秒钩子..." : "",
        },
        {
          label: "内容结构",
          detail: isContentLoading ? "正在搭建高留存内容骨架..." : "",
        },
        {
          label: "行动引导",
          detail: isContentLoading ? "正在规划商业承接卡点..." : "",
        },
      ].filter((item) => item.detail);
    },
    [isContentLoading, assetAdaptation, contentExecutionCards, topMonetization, platformContent, platformDashboard],
  );

  const isAnalyzing = growthSnapshotQuery.isFetching;
  const processingSteps = useMemo(
    () => buildPlatformProcessingSteps(selectedWindowDays, elapsedTime, focusPrompt),
    [selectedWindowDays, elapsedTime, focusPrompt],
  );
  const activeProcessingStep = processingSteps.find((item) => item.status === "active") || processingSteps[processingSteps.length - 1] || null;
  const animatedProcessingSteps = useMemo(
    () => processingSteps.map((step, index) => ({
      ...step,
      animatedLabel: step.status === "done" ? step.label : revealText(step.label, elapsedTime, index * 10, 10),
      animatedDetail: step.status === "done" ? step.detail : revealText(step.detail, elapsedTime, index * 14, 16),
    })),
    [processingSteps, elapsedTime],
  );
  const immersiveRotatingCards = useMemo(() => {
    const platformCards = primaryPlatforms.slice(0, 3).map((item) => ({
      title: `${item.displayName} 当前信号`,
      summary: item.summary,
      detail: `动量 ${item.momentumScore} / 适配 ${item.audienceFitScore} / 竞争 ${item.competitionLevel}`,
      tone: "platform",
    }));
    const topicCards = topTopics.slice(0, 3).map((item) => ({
      title: item.title,
      summary: item.whyHot,
      detail: item.howToUse,
      tone: "topic",
    }));
    const actionCards = actionSteps.slice(0, 3).map((item) => ({
      title: item.title,
      summary: item.action,
      detail: `第 ${item.day} 步先做这个。`,
      tone: "action",
    }));
    const fallback = [
      {
        title: "平台优先级正在整理",
        summary: "先把近窗口里的平台动量和适配度压成一页看板。",
        detail: "你最终看到的是“先做哪里、为什么、先验证什么”。",
        tone: "platform",
      },
      {
        title: "热点赛道正在筛选",
        summary: "不是泛热点，而是与你当前方向更接近的切口。",
        detail: "会直接翻成可执行题目和表达方式。",
        tone: "topic",
      },
      {
        title: "商业化建议正在整理",
        summary: "重点不是平台介绍，而是怎么形成真实承接。",
        detail: "会优先告诉你先做什么、别做什么、怎么验证。",
        tone: "action",
      },
    ];
    return [...platformCards, ...topicCards, ...actionCards].length ? [...platformCards, ...topicCards, ...actionCards] : fallback;
  }, [actionSteps, primaryPlatforms, topTopics]);
  const activeRotatingCard = immersiveRotatingCards[rotatingCardIndex % immersiveRotatingCards.length] || null;

  useEffect(() => {
    if (!isAnalyzing) {
      setElapsedTime(0);
      setRotatingCardIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setElapsedTime((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isAnalyzing]);

  useEffect(() => {
    if (!isAnalyzing || immersiveRotatingCards.length <= 1) return;
    const timer = window.setInterval(() => {
      setRotatingCardIndex((value) => (value + 1) % immersiveRotatingCards.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [immersiveRotatingCards.length, isAnalyzing]);

  const handleAnalyze = async () => {
    // ── B 端拦截：必须先注入 IP 基因库（行业身份 / 优势 / 受众 / 旗舰交付）
    if (!isIpProfileReady(ipProfile)) {
      setShowIpModal(true);
      toast.message("启动战略推演前，请先载入企业专属 IP 基因");
      return;
    }
    setAskResult(null);
    setPlatformDashboard(null);
    setDashboardDebug(null);
    setIsDashboardLoading(false);
    setPlatformContent(null);
    setContentDebug(null);
    setIsContentLoading(false);
    setElapsedTime(0);
    setRotatingCardIndex(0);

    // Call 1: fast snapshot (skips dashboard)
    const result = await growthSnapshotQuery.refetch();
    if (!result.data?.snapshot) {
      toast.error("平台分析暂时没有返回结果");
      return;
    }
    setHasAnalyzed(true);
    toast.success(`快照已生成，正在进行深度分析...`);

    // Dispatch async Job — returns jobId immediately, polls every 3s for result
    const snap = result.data.snapshot;
    setIsDashboardLoading(true);
    setIsContentLoading(true);
    try {
      const { jobId } = await createPlatformAnalysisJobMutation.mutateAsync({
        context: focusPrompt || undefined,
        windowDays: selectedWindowDays,
        snapshotSummary: snap as any,
      });
      setAnalysisJobId(jobId);
      setDashboardDebug((prev) => ({ ...(prev || {}), jobId, jobStatus: "queued", stage1: "dispatched", stage2: "pending" }));
      startAnalysisPolling(jobId);
    } catch (err: any) {
      console.error("[PlatformPage] Job creation crashed:", err);
      setIsDashboardLoading(false);
      setIsContentLoading(false);
      toast.error(`任务派发失败: ${err.message || "未知错误"}`);
      // 将错误写入 Debug 面板，不再静默失败
      setDashboardDebug((prev) => ({ ...(prev || {}), error: err.message || String(err) }));
    }
  };

  const handleUploadQaFile = useCallback(async (file: File) => {
    setIsUploadingQaFile(true);
    setQaUploadStatus("idle");
    setQaFileUri(null);
    setQaFileMimeType("");
    setQaFileName("");
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      const response = await fetch("/api/platform/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Upload failed (${response.status})`);
      }
      const data = await response.json();
      setQaFileUri(data.fileUri);
      setQaFileMimeType(data.mimeType);
      setQaFileName(file.name);
      setQaUploadStatus("success");
      toast.success(`✅ 已上传 ${file.name}`);
    } catch (err: any) {
      setQaUploadStatus("error");
      toast.error(err.message || "文档上传失败");
    } finally {
      setIsUploadingQaFile(false);
    }
  }, []);

  const handleAsk = async (nextQuestion?: string) => {
    const finalQuestion = String(nextQuestion || question).trim();
    if (!snapshot) {
      toast.error("请先完成平台分析");
      return;
    }
    if (!finalQuestion) {
      toast.error("先输入一个你想进一步了解的问题");
      return;
    }
    setQuestion(finalQuestion);
    setIsQaLoading(true);
    // Dispatch async QA Job — Vertex 3.1 Pro Preview answers in background
    // If a file was uploaded, pass fileUri + fileMimeType for multimodal analysis
    try {
      const { jobId } = await createPlatformQAJobMutation.mutateAsync({
        question: finalQuestion,
        context: focusPrompt || undefined,
        windowDays: selectedWindowDays,
        snapshot: snapshot as any,
        fileUri: qaFileUri || undefined,
        fileMimeType: qaFileMimeType || undefined,
      });
      setQaJobId(jobId);
      // Clear file after dispatch — GCS cleanup handled by server finally block
      setQaFileUri(null);
      setQaFileMimeType("");
      setQaFileName("");
      startQAPolling(jobId);
    } catch {
      // Fallback to synchronous askPlatformFollowUp if job creation fails
      await askPlatformFollowUpMutation.mutateAsync({
        question: finalQuestion,
        context: focusPrompt || undefined,
        windowDays: selectedWindowDays,
        snapshot,
      });
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0620] text-white">
        <Loader2 className="h-8 w-8 animate-spin text-[#49e6ff]" />
      </div>
    );
  }

  if (!isAuthenticated && !supervisorAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#080618_0%,#13092e_48%,#090715_100%)] px-6 text-white">
        <div className="max-w-lg rounded-[28px] border border-[#2b1f52] bg-[#100926]/95 p-8 text-center shadow-[0_20px_80px_rgba(0,0,0,0.35)]">
          <div className="text-sm uppercase tracking-[0.24em] text-[#8cefff]">Platform Intelligence</div>
          <div className="mt-4 text-3xl font-black">需要先登录</div>
          <p className="mt-4 text-sm leading-7 text-[#c8bfe7]">
            平台分析页不会再显示黑屏。当前会自动跳转登录；如果浏览器拦截了跳转，这里也会明确提示，而不是整页空白。
          </p>
          <a
            href={getLoginUrl()}
            className="mt-6 inline-flex items-center justify-center rounded-full border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#15c8ff,#6a5cff,#b25cff)] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(73,230,255,0.18)] transition hover:brightness-110"
          >
            去登录
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(82,32,165,0.34),transparent_26%),radial-gradient(circle_at_top_right,rgba(25,121,166,0.22),transparent_20%),linear-gradient(180deg,#06030f_0%,#0d0820_24%,#140b2e_100%)] text-[#f7f2ff]">
      <style>{`@keyframes pulseHighlight{0%,95%,100%{box-shadow:none}96%{box-shadow:0 0 0 2px rgba(73,230,255,0.7),0 0 24px rgba(73,230,255,0.3)}98%{box-shadow:0 0 0 3px rgba(127,103,255,0.8),0 0 32px rgba(127,103,255,0.4)}}`}</style>

      {/* B 端 IP 基因库 · 靛青色拦截弹窗（共享组件 IpProfileModal） */}
      <IpProfileModal
        open={showIpModal}
        value={ipProfile}
        onChange={setIpProfile}
        onClose={() => setShowIpModal(false)}
      />

      <div className="mx-auto max-w-[1500px] px-4 py-6 md:px-6 md:py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="rounded-full border border-white/10 bg-white/5 p-2 transition hover:bg-white/10"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="rounded-full border border-[#49e6ff]/20 bg-[rgba(73,230,255,0.08)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#8cefff]">
            Platform Intelligence
          </div>
        </div>


        {(supervisorAccess || user?.role === "supervisor" || user?.role === "admin") ? (
          <div className="mb-4 flex items-center justify-end">
            <button
              type="button"
              onClick={() => setDebugMode((value) => !value)}
              className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                debugMode
                  ? "border-[#49e6ff]/30 bg-[rgba(73,230,255,0.12)] text-[#8cefff]"
                  : "border-white/10 bg-white/5 text-[#b7add8] hover:bg-white/10"
              }`}
            >
              {debugMode ? "Debug On" : "Debug Off"}
            </button>
          </div>
        ) : null}
        {debugMode && (
          <div className="mb-6 rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#ff7fd5]">🎤 语音输入 Debug Log</div>
              <button onClick={() => setVoiceDebugLog([])} className="text-[10px] text-white/30 hover:text-white/60">清空</button>
            </div>
            {voiceDebugLog.length === 0 ? (
              <div className="mt-3 text-xs text-white/30">暂无记录，点击麦克风按钮开始…</div>
            ) : (
              <div className="mt-3 space-y-1">
                {voiceDebugLog.map((line, i) => (
                  <div key={i} className={`font-mono text-[11px] leading-5 ${line.includes("❌") ? "text-red-400" : line.includes("✅") ? "text-green-400" : "text-[#d7d0ef]"}`}>
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <section className={shellCardClasses("overflow-hidden p-6 md:p-8")}>
          <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(73,230,255,0.55),transparent)]" />
          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#362561] bg-[rgba(23,13,53,0.9)] px-3 py-1 text-xs uppercase tracking-[0.22em] text-[#aa95dc]">
                <TrendingUp className="h-3.5 w-3.5" />
                平台顾问台
              </div>
              <h1 className="mt-5 max-w-5xl text-[40px] font-black leading-[0.92] text-white md:text-[64px] xl:text-[76px]">
                不是告诉你"平台都能做"
                <span className="mt-2 block bg-[linear-gradient(135deg,#5af2ff,#7d73ff_45%,#ff75bd_85%)] bg-clip-text text-transparent">
                  而是告诉你现在该先打哪里
                </span>
              </h1>
              <p className="mt-5 max-w-3xl text-sm leading-8 text-[#d3caef] md:text-base">
                {personaSummary}
              </p>
              <p className="mt-3 max-w-3xl text-sm leading-8 text-[#b8afd9] md:text-[15px]">
                {platformDashboard?.subheadline
                  || "这个页面不做视频上传，不做二次创作流程，不讲空泛平台画像。它只解决三件事：当前时间窗口里，哪个平台值得优先做；热点赛道该怎么切；以及你怎样把这轮内容机会变成真实商业承接。"}
              </p>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                {heroTrustPoints.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[#8cefff]">{item.label}</div>
                    <div className="mt-2 text-sm leading-7 text-white">{item.value}</div>
                  </div>
                ))}
              </div>

              {/* IP 基因库入口（已填则显示战略锚点摘要 + 编辑按钮；未填则提示载入） */}
              <button
                type="button"
                onClick={() => setShowIpModal(true)}
                className={`mt-5 w-full rounded-2xl border px-5 py-4 text-left transition ${
                  isIpProfileReady(ipProfile)
                    ? "border-[#6366F1]/40 bg-[linear-gradient(135deg,rgba(79,70,229,0.18),rgba(99,102,241,0.10))] hover:border-[#818CF8]/60"
                    : "border-[#FCD34D]/30 bg-[rgba(252,211,77,0.06)] hover:border-[#FCD34D]/60 animate-[pulseHighlight_2.4s_ease-in-out_infinite]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-[#A5B4FC] mb-1">
                      {isIpProfileReady(ipProfile) ? "企业 IP 基因（已锁定）" : "尚未载入企业 IP 基因"}
                    </div>
                    {isIpProfileReady(ipProfile) ? (
                      <div className="text-[13px] leading-6 text-white truncate">
                        <span className="text-[#A5B4FC]">{ipProfile.industry}</span>
                        <span className="mx-2 text-white/30">·</span>
                        <span className="text-white/85">{ipProfile.advantage}</span>
                        <span className="mx-2 text-white/30">·</span>
                        <span className="text-[#FCD34D]">{ipProfile.flagship}</span>
                      </div>
                    ) : (
                      <div className="text-[13px] leading-6 text-white/85">
                        点此校准护城河 / 高客单锚点 → AI 推演会在 80% 篇幅锁定你的转化路径
                      </div>
                    )}
                  </div>
                  <div className="text-xs font-semibold text-[#A5B4FC] whitespace-nowrap">
                    {isIpProfileReady(ipProfile) ? "编辑 →" : "载入 →"}
                  </div>
                </div>
              </button>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[26px] border border-[#2a1c55] bg-[linear-gradient(180deg,rgba(28,16,60,0.96),rgba(12,8,28,0.96))] p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <CalendarRange className="h-4 w-4 text-[#49e6ff]" />
                  选择分析窗口
                </div>
                <div className="mt-4 grid gap-3">
                  {WINDOW_OPTIONS.map((item) => {
                    const active = item.days === selectedWindowDays;
                    return (
                      <button
                        key={item.days}
                        type="button"
                        onClick={() => setSelectedWindowDays(item.days)}
                        className={`rounded-2xl border px-4 py-4 text-left transition ${
                          active
                            ? "border-[#49e6ff]/45 bg-[linear-gradient(135deg,rgba(73,230,255,0.14),rgba(125,115,255,0.10))] shadow-[0_0_0_1px_rgba(73,230,255,0.15)]"
                            : "border-white/10 bg-white/5 hover:bg-white/10"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className={`text-lg font-bold ${active ? "text-[#8cefff]" : "text-white"}`}>{item.label}</div>
                          {active ? <div className="rounded-full bg-[rgba(73,230,255,0.12)] px-2 py-1 text-[11px] text-[#8cefff]">当前窗口</div> : null}
                        </div>
                        <div className="mt-1 text-sm leading-6 text-[#b7add8]">{item.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[26px] border border-[#2a1c55] bg-[rgba(11,7,26,0.94)] p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Target className="h-4 w-4 text-[#ffdd44]" />
                  你这轮最想判断什么
                </div>
                <div className="relative mt-4">
                  <textarea
                    value={focusPrompt}
                    onChange={(event) => setFocusPrompt(event.target.value)}
                    placeholder="例如：我现在是做女性健康/本地服务，想知道先做小红书还是抖音；应该先做图文、短视频，还是先验证某个商业化切口。"
                    className="min-h-[136px] w-full rounded-2xl border border-white/10 bg-[#0c061e] px-4 py-3 pr-12 text-sm leading-7 text-white outline-none transition focus:border-[#49e6ff]/35"
                  />
                  <div className="absolute right-3 top-3">
                    <VoiceInputButton
                      onTranscript={(t) => setFocusPrompt((prev) => prev ? prev + " " + t : t)}
                      onDebugLog={addVoiceDebug}
                      size={28}
                    />
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] text-white/30">🎤 支持 Chrome、Edge、Safari 浏览器</p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleAnalyze()}
                    disabled={growthSnapshotQuery.isFetching}
                    className="inline-flex items-center gap-2 rounded-full border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#15c8ff,#6a5cff,#b25cff)] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(73,230,255,0.18)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {growthSnapshotQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    开始平台分析
                  </button>
                  {hasAnalyzed ? (
                    <div className="rounded-full border border-[#2f2260] bg-[#130b31] px-4 py-2 text-xs text-[#8cefff]">
                      当前窗口：近 {selectedWindowDays} 天
                    </div>
                  ) : null}
                  {hasAnalyzed && !isDashboardLoading && !isContentLoading && (
                    <button
                      type="button"
                      onClick={handleDownloadPlatformPdf}
                      disabled={isDownloadingPdf}
                      className="inline-flex items-center gap-2 rounded-full border border-[#49e6ff]/30 bg-[rgba(73,230,255,0.08)] px-4 py-2 text-xs font-semibold text-[#49e6ff] transition hover:bg-[rgba(73,230,255,0.15)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isDownloadingPdf ? <><Loader2 className="h-3 w-3 animate-spin" />生成中...</> : <><FileText className="h-3 w-3" />下载 PDF</>}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {isAnalyzing ? (
          <section className="mt-6 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className={shellCardClasses("p-6")}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Loader2 className="h-4 w-4 animate-spin text-[#49e6ff]" />
                平台分析进行中
              </div>
              <div className="mt-3 text-sm leading-7 text-[#c8bfe7]">
                这一版会先读取近 {selectedWindowDays} 天平台快照，再整理热点、赛道和商业化建议。就算需要更长时间，也会把每一步拆给用户看。
              </div>
              {/* Phase 2-A: Show wait notice after 20s to prevent user from thinking the page is frozen */}
              {elapsedTime >= 20 ? (
                <div className="mt-4 rounded-2xl border border-[#ffdd44]/20 bg-[rgba(255,221,68,0.06)] p-4 text-sm leading-7 text-[#ffeea0]">
                  ⏳ 顾问报告正在生成中，通常需要 15–35 秒。请勿关闭页面，结果会自动显示。
                </div>
              ) : null}
              {activeProcessingStep ? (
                <div className="mt-5 rounded-2xl border border-[#2f2558] bg-[rgba(255,255,255,0.04)] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#8cefff]">当前阶段</div>
                  <div className="mt-2 text-lg font-semibold text-white">{activeProcessingStep.label}</div>
                  <div className="mt-2 text-sm leading-7 text-[#d3caef]">{activeProcessingStep.detail}</div>
                </div>
              ) : null}
              <div className="mt-5 space-y-3">
                {animatedProcessingSteps.map((step) => (
                  <div key={step.id} className={`rounded-2xl border p-4 transition ${
                    step.status === "done"
                      ? "border-[#284f4c] bg-[rgba(111,255,176,0.08)]"
                      : step.status === "active"
                        ? "border-[#2f5a7a] bg-[rgba(73,230,255,0.10)]"
                        : "border-white/10 bg-[rgba(255,255,255,0.04)]"
                  }`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-white">{step.animatedLabel}</div>
                      <div className={`rounded-full px-2 py-1 text-[11px] ${
                        step.status === "done"
                          ? "bg-[rgba(111,255,176,0.12)] text-[#92ffc1]"
                          : step.status === "active"
                            ? "bg-[rgba(73,230,255,0.12)] text-[#8cefff]"
                            : "bg-[rgba(255,255,255,0.05)] text-[#b5abd5]"
                      }`}>
                        {step.status === "done" ? "完成" : step.status === "active" ? "进行中" : "待处理"}
                      </div>
                    </div>
                    <div className="mt-2 text-sm leading-7 text-[#d3caef]">{step.animatedDetail}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className={shellCardClasses("p-6")}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Sparkles className="h-4 w-4 text-[#ffdd44]" />
                    轮播看板
                  </div>
                  <div className="mt-2 text-sm leading-7 text-[#c8bfe7]">
                    在报告生成过程中，先把当前窗口里最关键的平台、热点和承接线索轮播出来，避免用户空等。
                  </div>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-[#b7add8]">
                  每 4.5 秒轮播
                </div>
              </div>
              {activeRotatingCard ? (
                <div className="mt-5 rounded-[28px] border border-[#2f2558] bg-[linear-gradient(135deg,rgba(73,230,255,0.10),rgba(125,115,255,0.08),rgba(255,117,189,0.08))] p-6">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#8cefff]">
                    {activeRotatingCard.tone === "platform" ? "平台信号" : activeRotatingCard.tone === "topic" ? "热点切口" : "动作建议"}
                  </div>
                  <div className="mt-3 text-2xl font-bold text-white">{activeRotatingCard.title}</div>
                  <div className="mt-4 text-sm leading-8 text-[#eef5ff]">{activeRotatingCard.summary}</div>
                  <div className="mt-4 rounded-2xl border border-white/10 bg-[rgba(9,6,24,0.36)] p-4 text-sm leading-7 text-[#d3caef]">
                    {activeRotatingCard.detail}
                  </div>
                </div>
              ) : null}
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {immersiveRotatingCards.slice(0, 3).map((item, index) => (
                  <div key={`${item.title}-${index}`} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                    <div className="text-sm font-semibold text-white">{item.title}</div>
                    <div className="mt-2 text-sm leading-7 text-[#c8bfe7]">{item.summary}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {resultSummaryCards.map((item, index) => (
            <div key={`${item.label}-${index}`} className={shellCardClasses("p-5 flex flex-col justify-center")}>
              {item.isLoadingSkeleton ? (
                <div className="flex h-full w-full animate-pulse flex-col justify-center rounded-lg border border-white/5 bg-[rgba(255,255,255,0.02)] p-4 text-center">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-[#49e6ff]/50" />
                  <div className="text-[13px] font-semibold text-[#8cefff]/70">{item.value}</div>
                  <div className="mt-1 text-[11px] text-[#c9c0e6]/50">{item.detail}</div>
                </div>
              ) : (
                <>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#9ddcff]">{item.label}</div>
                  <div className="mt-3 text-xl font-bold leading-8 text-white">{item.value}</div>
                  <div className="mt-3 text-sm leading-7 text-[#c9c0e6]">{item.detail}</div>
                </>
              )}
            </div>
          ))}
        </section>

        {/* Debug panel: show as soon as snapshot is available */}
        {snapshot && debugMode ? (
          <section className="mt-6">
            <div className={shellCardClasses("p-5")}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Bot className="h-4 w-4 text-[#49e6ff]" />
                Debug Flow
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-3">
                <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">前端状态</div>
                  <div className="mt-3 space-y-2 text-xs leading-6 text-[#d7d0ef]">
                    <div>windowDays: {selectedWindowDays}</div>
                    <div>focusPrompt: {focusPrompt || "-"}</div>
                    <div>query.status: {growthSnapshotQuery.status}</div>
                    <div>query.isFetching: {String(growthSnapshotQuery.isFetching)}</div>
                    <div>hasSnapshot: {String(Boolean(snapshot))}</div>
                    <div>hasPlatformDashboard: {String(Boolean(platformDashboard))}</div>
                    <div>isDashboardLoading: {String(isDashboardLoading)}</div>
                  </div>
                </div>
                <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#ffdd44]">分析步骤 · 模型使用明细</div>
                  <div className="mt-3 space-y-1 text-xs leading-6 text-[#d7d0ef]">
                    <div className="text-[#8cefff] font-semibold">── Call 1: 快照 ──</div>
                    <div>1. 快照分析 (getGrowthSnapshot — 同步 tRPC query)</div>
                    <div>1a. 状态: {growthSnapshotQuery.isFetched ? `✅ 已返回 (${snapshotDebug?.baseSource})` : growthSnapshotQuery.isFetching ? "⏳ 进行中" : "⏸ 未开始"}</div>
                    <div>1b. 真实采集: {String(snapshotDebug?.hasAnyLiveCollection ?? "?")} / 平台数: {(snapshotDebug as any)?.stalePlatforms !== undefined ? `${(snapshotDebug as any)?.platformCount ?? 4}` : "?"}</div>
                    <div>1c. storeMs: {String((snapshotDebug?.timing as any)?.storeMs ?? "?")}</div>
                    <div className="text-[#8cefff] font-semibold mt-1">── Job Queue 派发 ──</div>
                    <div>2. Job ID: <span className="font-mono text-[#ffdd44]">{analysisJobId || "未创建"}</span></div>
                    <div>2a. DB 状态: <span className="font-mono">{analysisJobStatus}</span> / 轮询次数: <span className="text-[#ffdd44] font-bold">{analysisPollCount}</span></div>
                    <div>2b. 轮询: {isDashboardLoading ? `✅ 进行中，每 3 秒 GET /api/jobs/${analysisJobId || "..."}` : platformDashboard ? "✅ 已完成，已停止" : "⏸ 等待"}</div>
                    <div className="text-[#8cefff] font-semibold mt-1">── Stage 1: 原创内容 (先执行) ──</div>
                    <div>3. 深度原创分析（不看趋势数据）</div>
                    <div>3a. system instruction: 导演模式 — 7条铁律强制执行，禁止大纲</div>
                    <div>3b. 状态: {isContentLoading ? "⏳ 运行中" : platformContent ? "✅ 成功" : "⏸ 等待"}</div>
                    <div>3c. contentBlueprints: {(platformContent as any)?.contentBlueprints?.length ?? "-"} 条</div>
                    <div>3d. monetizationLanes: {(platformContent as any)?.monetizationLanes?.length ?? "-"} 条</div>
                    <div className="text-[#8cefff] font-semibold mt-1">── Stage 2: 趋势校准 (后执行) ──</div>
                    <div>4. 趋势校准分析（含 primaryTrack/estimatedTraffic/ipUniqueness/commercialConversion）</div>
                    <div>4a. 状态: {isDashboardLoading ? "⏳ 运行中" : platformDashboard ? "✅ 成功" : "⏸ 等待 Stage1"}</div>
                    <div>4b. headline: {(platformDashboard as any)?.headline?.slice(0, 60) || "-"}</div>
                    <div>4c. hotTopics: {(platformDashboard as any)?.hotTopics?.length ?? "-"} 条</div>
                    <div className="text-[#8cefff] font-semibold mt-1">── QA 答疑 Job ──</div>
                    <div>5. 纯文本对话分析（支持 fileUri 多模态）</div>
                    <div>5a. QA Job ID: <span className="font-mono text-[#ffdd44]">{qaJobId || "未创建"}</span></div>
                    <div>5b. 状态: {isQaLoading ? "⏳ 运行中，轮询每 3 秒" : qaJobId ? "✅ job 已完成" : "⏸ 等待提问"}</div>
                  </div>
                </div>
                <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#ff7fd5]">错误</div>
                  <div className="mt-3 whitespace-pre-wrap text-xs leading-6 text-[#d7d0ef]">
                    {String(growthSnapshotQuery.error?.message || getPlatformDashboardMutation.error?.message || dashboardDebug?.error || "-")}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">getGrowthSnapshot.debug</div>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                    {JSON.stringify(snapshotDebug || null, null, 2)}
                  </pre>
                </div>
                <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#ffdd44]">getPlatformDashboard.debug</div>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                    {JSON.stringify(dashboardDebug || null, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {/* Show loading state while waiting for dashboard (Call 2) */}
        {snapshot && !platformDashboard && isDashboardLoading ? (
          <section className="mt-6">
            <div className={shellCardClasses("p-6")}>
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-[#49e6ff]" />
                <div>
                  <div className="text-sm font-semibold text-white">平台数据已就绪，正在生成个性化分析...</div>
                  <div className="mt-1 text-xs text-[#b7add8]">正在根据你的背景生成专属平台策略与选题文案，通常需要 30–90 秒。</div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {snapshot && platformDashboard ? (
          <section id="platform-report" className="mt-8 space-y-6">
            {debugMode ? (
              <div className={shellCardClasses("p-5")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Bot className="h-4 w-4 text-[#49e6ff]" />
                  Debug Flow
                </div>
                <div className="mt-4 grid gap-4 xl:grid-cols-3">
                  <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">前端状态</div>
                    <div className="mt-3 space-y-2 text-xs leading-6 text-[#d7d0ef]">
                      <div>auth: {supervisorAccess ? "supervisor" : isAuthenticated ? "user" : "guest"}</div>
                      <div>windowDays: {selectedWindowDays}</div>
                      <div>focusPrompt: {focusPrompt || "-"}</div>
                      <div>query.status: {growthSnapshotQuery.status}</div>
                      <div>query.fetchStatus: {growthSnapshotQuery.fetchStatus}</div>
                      <div>query.isFetching: {String(growthSnapshotQuery.isFetching)}</div>
                      <div>ask.isPending: {String(askPlatformFollowUpMutation.isPending)}</div>
                      <div>hasSnapshot: {String(Boolean(snapshot))}</div>
                      <div>hasPlatformDashboard: {String(Boolean(platformDashboard))}</div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#ffdd44]">分析步骤</div>
                    <div className="mt-3 space-y-2 text-xs leading-6 text-[#d7d0ef]">
                      <div>1. getGrowthSnapshot 请求: {growthSnapshotQuery.isFetched ? "已返回" : growthSnapshotQuery.isFetching ? "进行中" : "未开始"}</div>
                      <div>2. snapshot 构建: {snapshotDebug?.baseSource ? `已完成 (${snapshotDebug.baseSource})` : "未知"}</div>
                      <div>3. personalization: {String(snapshotDebug?.personalizedApplied ?? false)}</div>
                      <div>4. [Job] analysisJobId: {analysisJobId || "-"} / Stage1(2.5Pro dashboard): {isDashboardLoading ? "⏳" : platformDashboard ? "✅" : "⏸"} / Stage2(3.1Pro content): {isContentLoading ? "⏳" : platformContent ? "✅" : "⏸"}</div>
                      <div>5. hasPlatformDashboard: {String(Boolean(platformDashboard))} / hasPlatformContent: {String(Boolean(platformContent))}</div>
                      <div>6. 继续追问: {askPlatformFollowUpMutation.isSuccess ? "已返回" : askPlatformFollowUpMutation.isPending ? "进行中" : "未开始"}</div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#ff7fd5]">错误</div>
                    <div className="mt-3 whitespace-pre-wrap text-xs leading-6 text-[#d7d0ef]">
                      {String(growthSnapshotQuery.error?.message || askPlatformFollowUpMutation.error?.message || "-")}
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">getGrowthSnapshot.debug</div>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                      {JSON.stringify(snapshotDebug || null, null, 2)}
                    </pre>
                  </div>
                  <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#ffdd44]">getPlatformDashboard.debug</div>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                      {JSON.stringify(dashboardDebug || null, null, 2)}
                    </pre>
                  </div>
                  <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">askPlatformFollowUp.debug</div>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                      {JSON.stringify(askDebug || null, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className={`${shellCardClasses("p-6")} relative`} style={{ animation: "pulseHighlight 30s ease-in-out infinite" }}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#2f2558] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#8cefff]">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      为什么这个方向现在值得做
                    </div>
                    <div className="mt-4 max-w-3xl text-3xl font-black leading-tight text-white md:text-4xl">
                      {recommendationHeadline}
                    </div>
                    <div className="mt-4 max-w-3xl text-sm leading-8 text-[#d3caef]">
                      {directConclusion}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#2f2558] bg-[rgba(255,255,255,0.04)] px-4 py-3 text-right">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[#9ddcff]">时间口径</div>
                    <div className="mt-2 text-xl font-bold text-white">{getWindowLabel(selectedWindowDays)}</div>
                  </div>
                </div>

                {keyInsights.filter(item => item.title || item.detail).length > 0 ? (
                  <div className="mt-6 grid gap-3 md:grid-cols-3">
                    {keyInsights.filter(item => item.title || item.detail).slice(0, 3).map((item, index) => (
                      <div key={`${item.title}-${index}`} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            {getSmartIcon((item.title || "") + " " + (item.detail || ""), "h-4 w-4 text-[#8cefff] shrink-0")}
                            <div className="text-sm font-semibold text-white">{item.title}</div>
                          </div>
                          {item.badge ? (
                            <div className="rounded-full border border-[#2f2558] bg-[rgba(255,255,255,0.04)] px-2 py-1 text-[11px] text-[#8cefff]">
                              {item.badge}
                            </div>
                          ) : null}
                        </div>
                        {item.detail ? <div className="mt-3 text-sm leading-7 text-[#c9c0e6]">{item.detail}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

            </div>

            <div className="grid gap-4">
              <div className={shellCardClasses("p-6")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <TrendingUp className="h-4 w-4 text-[#49e6ff]" />
                  平台优先级与切入方式
                </div>
                <div className="mt-5 grid gap-4">
                  {platformDecisionRows.map((item, index) => (
                    <div key={item.id} className="rounded-[24px] border border-white/10 bg-[rgba(255,255,255,0.04)] p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-3">
                            <div className="rounded-full border border-[#2f2558] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#8cefff]">
                              Priority {index + 1}
                            </div>
                            <div className="text-xl font-bold text-white">{item.name}</div>
                          </div>
                          <div className="mt-3 text-sm leading-7 text-[#b9afd9]">{renderSafeText(item.trend)}</div>
                            </div>
                            <div className="rounded-full border border-white/10 bg-[rgba(255,255,255,0.04)] px-3 py-2 text-xs text-[#d6cdf0]">
                              {renderSafeText(item.lane)}
                            </div>
                          </div>
                          {Array.isArray((item as any).trafficBoosters) && (item as any).trafficBoosters.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {(item as any).trafficBoosters.map((b: any, bi: number) => (
                                <span key={bi} className="inline-flex items-center gap-1 rounded-full border border-[#ff6b2b]/40 bg-[rgba(255,100,30,0.12)] px-3 py-1 text-[11px] font-medium text-[#ff9966] animate-pulse">
                                  <Flame className="h-3 w-3" />
                                  {renderSafeText(b)}
                                </span>
                              ))}
                            </div>
                          ) : null}
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div className="rounded-2xl border border-[#2f2558] bg-[rgba(18,13,43,0.9)] p-4">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-[#9ddcff]">为什么现在做</div>
                          <div className="mt-2 text-sm leading-7 text-white whitespace-pre-wrap">{renderSafeText(item.whyNow)}</div>
                        </div>
                        <div className="rounded-2xl border border-[#2f2558] bg-[rgba(18,13,43,0.9)] p-4">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-[#ffdd44]">建议动作</div>
                          <div className="mt-2 text-sm leading-7 text-white whitespace-pre-wrap">{renderSafeText(item.nextMove)}</div>
                        </div>
                      </div>
                      {(item.hook || item.monetization) ? (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {item.hook ? (
                            <div className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-[#8cefff]">开头怎么说</div>
                              <div className="mt-2 text-sm leading-7 text-[#d3caef] whitespace-pre-wrap">{renderSafeText(item.hook)}</div>
                            </div>
                          ) : null}
                          {item.monetization ? (
                            <div className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-[#ffdd44]">更适合的承接</div>
                              <div className="mt-2 text-sm leading-7 text-[#d3caef] whitespace-pre-wrap">{renderSafeText(item.monetization)}</div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {((item as any).primaryTrack || (item as any).estimatedTraffic || (item as any).ipUniqueness || (item as any).commercialConversion) ? (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {(item as any).primaryTrack ? (<div className="rounded-xl border border-[#2b1f52] bg-[rgba(18,13,43,0.9)] p-3"><div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-[#9ddcff]"><Target className="h-3 w-3" />赛道</div><div className="mt-1 text-xs leading-6 text-white">{renderSafeText((item as any).primaryTrack, '分析中...')}</div></div>) : null}
                          {(item as any).estimatedTraffic ? (<div className="rounded-xl border border-[#2b1f52] bg-[rgba(18,13,43,0.9)] p-3"><div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-[#9ddcff]"><BarChart3 className="h-3 w-3" />预估流量</div><div className="mt-1 text-xs leading-6 text-white">{renderSafeText((item as any).estimatedTraffic, '分析中...')}</div></div>) : null}
                          {(item as any).ipUniqueness ? (<div className="rounded-xl border border-[#2b1f52] bg-[rgba(18,13,43,0.9)] p-3"><div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-[#9ddcff]"><Star className="h-3 w-3" />IP稀缺度</div><div className="mt-1 text-xs leading-6 text-white">{renderSafeText((item as any).ipUniqueness, '分析中...')}</div></div>) : null}
                          {(item as any).commercialConversion ? (<div className="rounded-xl border border-[#2b1f52] bg-[rgba(18,13,43,0.9)] p-3"><div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-[#9ddcff]"><DollarSign className="h-3 w-3" />商业转化</div><div className="mt-1 text-xs leading-6 text-white">{renderSafeText((item as any).commercialConversion, '分析中...')}</div></div>) : null}
                        </div>
                      ) : null}
                      {/* Fix #3: 对标账号 — show 用户画像 when accounts are objects or absent */}
                      {Array.isArray((item as any).referenceAccounts) && (item as any).referenceAccounts.length > 0 ? (
                        <div className="mt-3 rounded-xl border border-[#2b1f52] bg-[rgba(18,13,43,0.9)] p-3">
                          <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-[#9ddcff]"><Users className="h-3 w-3" />目标受众 &amp; 对标账号</div>
                          <div className="mt-2 space-y-2">
                            {(item as any).referenceAccounts.map((acc: any, ai: number) => {
                              // Support: string | {account, reason} | {name, reason} — never show [object Object]
                              const accountText = typeof acc === "string"
                                ? acc
                                : typeof acc === "object" && acc !== null
                                  ? String(acc?.account || acc?.name || acc?.title || acc?.用户画像 || acc?.portrait || JSON.stringify(acc) || "")
                                  : "";
                              const reasonText = typeof acc === "object" && acc !== null
                                ? String(acc?.reason || acc?.description || acc?.desc || acc?.为什么 || "")
                                : "";
                              // Skip entirely if both are empty (malformed entry)
                              if (!accountText && !reasonText && accountText !== "{}") return null;
                              return (
                                <div key={ai} className="rounded-lg border border-[#3a2b6a] bg-[#170d35] px-3 py-2">
                                  {accountText ? <div className="text-[11px] font-semibold text-[#c9c0e6]">{accountText}</div> : null}
                                  {reasonText ? <div className="mt-1 text-[11px] leading-5 text-[#9080b8]">{reasonText}</div> : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <div className={shellCardClasses("p-6")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Sparkles className="h-4 w-4 text-[#ff4fb8]" />
                  选题方向与文案内容
                </div>
                {/* Fix #2: Vertical stacked rows (single-column), not side-by-side grid */}
                <div className="mt-5 space-y-4">
                  {contentExecutionCards.length === 0 && (isDashboardLoading || isContentLoading) ? (
                    <div className="flex h-32 w-full animate-pulse flex-col items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-center text-[#ff4fb8]/70">
                      <Loader2 className="mb-2 h-6 w-6 animate-spin" />
                      正在生成专属选题与配套文案...
                    </div>
                  ) : contentExecutionCards.length === 0 && platformDashboard ? (
                    <div className="flex h-32 w-full flex-col items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-center text-[#c9c0e6]/70">
                      无对应的选题方向数据
                    </div>
                  ) : (
                    contentExecutionCards.map((item) => (
                      <div key={item.id} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-5">
                        <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          {item.format === "图文" ? <Image className="h-4 w-4 text-[#ff7fd5] shrink-0" /> : <Video className="h-4 w-4 text-[#49e6ff] shrink-0" />}
                          <div className="text-base font-bold text-white">{item.title}</div>
                        </div>
                        <div className="rounded-full border border-[#2f2558] bg-[rgba(255,255,255,0.04)] px-2 py-1 text-[11px] text-[#8cefff]">
                          {item.format}
                        </div>
                      </div>
                      <div className="mt-3 rounded-2xl border border-[#2f2558] bg-[rgba(18,13,43,0.9)] p-3 text-sm leading-7 text-[#8cefff]">
                        {item.hook}
                      </div>
                      <div className="mt-3 text-sm leading-7 text-[#d3caef] whitespace-pre-wrap">{renderHighlightText(item.copywriting || "")}</div>
                      {item.production ? (
                        <div className="mt-3 rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-3 text-sm leading-7 text-white">
                          {item.production}
                        </div>
                      ) : null}
                      {(item as any).executionDetails?.environmentAndWardrobe ? (
                        <div className="mt-3 rounded-2xl border border-[#2b1f52] bg-[rgba(18,13,43,0.9)] p-3 space-y-2">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-[#9ddcff]">拍摄环境 &amp; 服装道具</div>
                          <div className="text-sm leading-7 text-[#d3caef]">{(item as any).executionDetails.environmentAndWardrobe}</div>
                        </div>
                      ) : null}
                      {(item as any).executionDetails?.lightingAndCamera ? (
                        <div className="mt-2 rounded-2xl border border-[#2b1f52] bg-[rgba(18,13,43,0.9)] p-3 space-y-2">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-[#9ddcff]">灯光 &amp; 机位</div>
                          <div className="text-sm leading-7 text-[#d3caef]">{(item as any).executionDetails.lightingAndCamera}</div>
                        </div>
                      ) : null}
                      {Array.isArray((item as any).executionDetails?.stepByStepScript) && (item as any).executionDetails.stepByStepScript.length > 0 ? (
                        <div className="mt-2 rounded-2xl border border-[#2b1f52] bg-[rgba(18,13,43,0.9)] p-3 space-y-1">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-[#9ddcff]">逐步执行脚本</div>
                          {(item as any).executionDetails.stepByStepScript.map((step: string, si: number) => (
                            <div key={si} className="text-sm leading-7 text-[#d3caef]">{step}</div>
                          ))}
                        </div>
                      ) : null}
                      {Array.isArray((item as any).actionableSteps) && (item as any).actionableSteps.length > 0 ? (
                        <div className="mt-2 rounded-2xl border border-[#2b1f52] bg-[rgba(18,13,43,0.9)] p-3 space-y-2">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-[#9ddcff]">落地三步曲</div>
                          {(item as any).actionableSteps.map((step: string, si: number) => (
                            <div key={si} className="flex items-start gap-2 text-sm leading-7 text-white">
                              <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#3a2b6a] text-[10px] text-[#c9c0e6]">{si + 1}</span>
                              {step}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {(item as any).detailedScript ? (
                        <div className="mt-2 rounded-2xl border border-[#2b1f52] bg-[rgba(18,13,43,0.9)] p-3">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-[#9ddcff]">详细脚本与大纲</div>
                          <div className="mt-2 text-sm leading-7 text-[#d3caef] whitespace-pre-wrap">{(item as any).detailedScript}</div>
                        </div>
                      ) : null}
                      {(item as any).publishingAdvice ? (
                        <div className="mt-2 rounded-2xl border border-[#2b1f52] bg-[rgba(18,13,43,0.9)] p-3">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-[#9ddcff]">发布建议</div>
                          <div className="mt-1 text-sm leading-7 text-[#d3caef]">{(item as any).publishingAdvice}</div>
                        </div>
                      ) : null}
                      
                        <TopicImageGenerator
                          title={item.title}
                          format={item.format as any}
                          hook={item.hook}
                          supervisorAccess={supervisorAccess}
                          executionDetails={(item as any).executionDetails}
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className={shellCardClasses("p-6")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <CircleDollarSign className="h-4 w-4 text-[#ffdd44]" />
                  商业化建议先磨到可落地
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {monetizationCards.length === 0 && (isDashboardLoading || isContentLoading) ? (
                    <div className="col-span-2 flex h-32 w-full animate-pulse flex-col items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-center text-[#8cefff]/70">
                      <Loader2 className="mb-2 h-6 w-6 animate-spin" />
                      正在推演专属商业变现路径...
                    </div>
                  ) : monetizationCards.length === 0 ? (
                    <div className="col-span-2 flex h-32 w-full flex-col items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-center text-[#c9c0e6]">
                      没有生成相关变现路径
                    </div>
                  ) : (
                    monetizationCards.map((item) => (
                      <div key={item.id} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                        <div className="flex items-center gap-2">
                          {getSmartIcon(item.title + " 变现 付费", "h-4 w-4 text-[#ffdd44] shrink-0")}
                          <div className="text-sm font-semibold text-white">{item.title}</div>
                        </div>
                        <div className="mt-2 text-sm leading-7 text-[#d3caef]">{item.summary}</div>
                        {item.action ? (
                          <div className="mt-3 rounded-2xl border border-[#2f2558] bg-[rgba(18,13,43,0.9)] p-3 text-sm leading-7 text-[#ffdd44]">
                            {item.action}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <div className={shellCardClasses("p-6")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Rocket className="h-4 w-4 text-[#49e6ff]" />
                  视频怎么拍 / 图文怎么写
                </div>
                <div className="mt-5 space-y-3">
                  {/* Show loading skeleton while Call 3 is running */}
                  {isContentLoading && executionBlueprint.length === 0 ? (
                    <div className="flex h-24 w-full animate-pulse flex-col items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-center text-[#8cefff]/60">
                      <Loader2 className="mb-2 h-5 w-5 animate-spin" />
                      <span className="text-sm">正在重构开场三秒钩子、搭建高留存内容骨架...</span>
                    </div>
                  ) : executionBlueprint.length === 0 ? (
                    <div className="flex h-24 w-full flex-col items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-center text-[#c9c0e6]/60 text-sm">
                      完成平台分析后将显示专属执行细节
                    </div>
                  ) : (
                    executionBlueprint.map((item) => (
                      <div key={item.label} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                        <div className="text-sm font-semibold text-white">{item.label}</div>
                        <div className="mt-2 text-sm leading-7 text-[#d3caef]">{item.detail}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className={shellCardClasses("p-6")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Target className="h-4 w-4 text-[#6fffb0]" />
                  个性化分析
                </div>
                <div className="mt-5 space-y-3">
                  {/* Prefer LLM topSignals (Call 2) — never fall back to snapshot generic text */}
                  {isDashboardLoading ? (
                    <div className="flex h-16 w-full animate-pulse items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-sm text-[#8cefff]/60">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      正在生成个性化判断...
                    </div>
                  ) : platformDashboard?.topSignals && platformDashboard.topSignals.length > 0 ? (
                    platformDashboard.topSignals.slice(0, 4).map((signal: any, idx: number) => {
                      const sigTitle = typeof signal === "string" ? signal : cleanUserCopy(signal?.title || signal?.["标题"] || signal?.["核心判断"] || "", "");
                      const sigDetail = typeof signal === "object" ? cleanUserCopy(signal?.detail || signal?.desc || signal?.description || signal?.["详情"] || "", "") : "";
                      if (!sigTitle && !sigDetail) return null;
                      return (
                        <div key={`sig-${idx}`} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                          {sigTitle ? <div className="text-sm font-semibold text-white">{sigTitle}</div> : null}
                          {sigDetail ? <div className="mt-2 text-sm leading-7 text-[#d3caef]">{sigDetail}</div> : null}
                        </div>
                      );
                    })
                  ) : (
                    // No LLM data — show empty state rather than stale snapshot text
                    <div className="flex h-16 w-full flex-col items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-sm text-[#c9c0e6]/60">
                      暂无个性化判断数据
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
              <div className={shellCardClasses("p-6")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Rocket className="h-4 w-4 text-[#6fffb0]" />
                  现在就能执行的动作
                </div>
                <div className="mt-5 space-y-3">
                  {actionSteps.map((item) => (
                    <div key={`step-${item.day}-${item.title}`} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          {getSmartIcon(item.title + " " + item.action, "h-4 w-4 text-[#6fffb0] shrink-0")}
                          <div className="font-semibold text-white">{item.title}</div>
                        </div>
                        <div className="rounded-full border border-[#2f2558] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-[11px] text-[#8cefff]">
                          第 {item.day} 步
                        </div>
                      </div>
                      <div className="mt-2 text-sm leading-7 text-[#d3caef]">{item.action}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={shellCardClasses("p-6")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <MessageSquareText className="h-4 w-4 text-[#8cefff]" />
                  深度追问
                </div>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-[#c8bfe7]">
                  这一轮追问会继续锁定在近 {selectedWindowDays} 天的数据，把结论继续往"选题、形式、节奏、承接动作"推进。点击问题加载到输入框后可以补充或修改，再点击发送。
                </p>

                <div className="mt-5 flex flex-wrap gap-2">
                  {hotQuestionSuggestions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setQuestion(item)}
                      className="rounded-full border border-[#3a2b6a] bg-[#140b31] px-3 py-2 text-sm text-[#d7d0ef] transition hover:border-[#49e6ff]/25 hover:bg-[rgba(73,230,255,0.08)]"
                    >
                      {item}
                    </button>
                  ))}
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
                  <div className="flex flex-col gap-2">
                    <div className="relative">
                      <textarea
                        value={question}
                        onChange={(event) => setQuestion(event.target.value)}
                        placeholder="例如：如果我现在先做小红书，应该先做图文还是视频？为什么？"
                        className="min-h-[128px] w-full rounded-2xl border border-white/10 bg-[#0c061e] px-4 py-3 pr-12 text-sm leading-7 text-white outline-none transition focus:border-[#49e6ff]/35"
                      />
                      <div className="absolute right-3 top-3">
                        <VoiceInputButton
                          onTranscript={(t) => setQuestion((prev) => prev ? prev + " " + t : t)}
                          onDebugLog={addVoiceDebug}
                          size={28}
                        />
                      </div>
                    </div>
                    <p className="mt-1.5 text-[11px] text-white/30">🎤 支持 Chrome、Edge、Safari 浏览器</p>
                    {/* File attachment for multimodal QA */}
                    <div className="flex items-center gap-2">
                      <input
                        ref={qaFileInputRef}
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleUploadQaFile(f);
                          e.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => qaFileInputRef.current?.click()}
                        disabled={isUploadingQaFile}
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition disabled:opacity-50 ${
                          qaUploadStatus === "success"
                            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
                            : qaUploadStatus === "error"
                              ? "border-rose-400/30 bg-rose-400/10 text-rose-300 hover:bg-rose-400/20"
                              : "border-white/10 bg-white/5 text-[#c8bfe7] hover:bg-white/10"
                        }`}
                      >
                        {isUploadingQaFile
                          ? <><Loader2 className="h-3 w-3 animate-spin" />上传中...</>
                          : qaUploadStatus === "success"
                            ? <><FileText className="h-3 w-3" />✅ 已上传</>
                            : qaUploadStatus === "error"
                              ? <><Image className="h-3 w-3" />❌ 上传失败，重试</>
                              : <><Image className="h-3 w-3" />上传参考图片/PDF（可选）</>
                        }
                      </button>
                      {qaFileName && qaUploadStatus === "success" && (
                        <span className="flex items-center gap-1 text-xs text-emerald-300">
                          <FileText className="h-3 w-3" />
                          {qaFileName}
                          <button
                            type="button"
                            onClick={() => { setQaFileUri(null); setQaFileMimeType(""); setQaFileName(""); setQaUploadStatus("idle"); }}
                            className="ml-1 text-white/40 hover:text-white/70"
                          >×</button>
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleAsk()}
                    disabled={isQaLoading || isUploadingQaFile}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#14d6ff,#5f6bff)] px-5 py-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isQaLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                    {isQaLoading ? "AI 思考中..." : qaFileUri ? "多模态追问" : "继续追问"}
                  </button>
                </div>

                {askResult ? (
                  <div className="mt-6 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                    <div className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-5">
                      <div className="flex items-center gap-2 text-lg font-bold text-white">
                        <MessageSquareText className="h-5 w-5 text-[#8cefff]" />
                        {askResult.title}
                      </div>
                      <div className="mt-4 space-y-4 text-sm leading-8 text-[#d7d0ef]">
                        {splitAnswerParagraphs(askResult.answer).map((paragraph, index) => (
                          <p key={`${paragraph.slice(0, 24)}-${index}`}>{renderHighlightText(paragraph)}</p>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-5">
                        <div className="text-sm font-semibold text-[#8cefff]">顾问建议</div>
                        <div className="mt-3 text-sm leading-7 text-[#d7d0ef]">{askResult.encouragement}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-5">
                        <div className="text-sm font-semibold text-[#ffdd44]">继续往下问</div>
                        <div className="mt-3 space-y-2">
                          {askResult.nextQuestions.map((item) => (
                            <button
                              key={item}
                              type="button"
                              onClick={() => {
                                setQuestion(item);
                                void handleAsk(item);
                              }}
                              className="block w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-left text-sm text-[#d7d0ef] transition hover:bg-white/10"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <span>{item}</span>
                                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[#8cefff]" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            {/* Feature #6c: Trend Report Generator — supervisor bypass credits */}
            <div className="grid gap-4">
              <ReportGeneratorPanel supervisorAccess={supervisorAccess} />
            </div>
            {/* PDF Download — captures current rendered page via Cloud Run Puppeteer */}
            {hasAnalyzed && (
              <div className="mt-4 space-y-3">
                {/* 时效性提醒 */}
                <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-300">
                  <span className="text-lg leading-none mt-0.5">⚡</span>
                  <div>
                    <div className="font-semibold mb-0.5">分析结果具有时效性</div>
                    <div className="text-xs text-amber-200/80">平台数据每日更新，本次分析基于当前时间点快照。建议立即下载 PDF 保存，下载后快照记录将同步保存至「我的作品」。</div>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <a href="/my-works" className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 px-4 py-2.5 text-sm font-semibold text-purple-300 transition hover:bg-purple-500/20">
                    📁 我的作品
                  </a>
                  <button
                    type="button"
                    onClick={handleDownloadPlatformPdf}
                    disabled={isDownloadingPdf || isDashboardLoading || isContentLoading}
                    className="inline-flex items-center gap-2 rounded-full border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#15c8ff,#6a5cff)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_32px_rgba(73,230,255,0.15)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isDownloadingPdf ? (
                      <><Loader2 className="h-4 w-4 animate-spin" />生成 PDF 中...</>
                    ) : (
                      <><FileText className="h-4 w-4" />下载平台分析 PDF</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {/* 邀请码管理已迁移至 /admin 页面 */}
      </div>
    </div>
  );
}

