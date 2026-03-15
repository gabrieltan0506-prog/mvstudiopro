import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { UsageQuotaBanner } from "@/components/UsageQuotaBanner";
import { StudentUpgradePrompt } from "@/components/StudentUpgradePrompt";
import { TrialCountdownBanner } from "@/components/TrialCountdownBanner";
import { QuotaExhaustedModal } from "@/components/QuotaExhaustedModal";
import { GrowthHandoffActions } from "@/components/growth/GrowthHandoffActions";
import { GrowthSectionCard } from "@/components/growth/GrowthSectionCard";
import { getGrowthHandoffStatus, saveGrowthHandoff } from "@/lib/growthHandoff";
import type {
  GrowthBusinessInsight,
  GrowthHandoff,
  GrowthPlanStep,
  GrowthPlatformRecommendation,
  GrowthSnapshot,
} from "@shared/growth";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  Compass,
  FileText,
  FileUp,
  Film,
  Lightbulb,
  LineChart as LineChartIcon,
  Loader2,
  Rocket,
  Send,
  Sparkles,
  TrendingUp,
  Upload,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

type AnalysisResult = {
  composition: number;
  color: number;
  lighting: number;
  impact: number;
  viralPotential: number;
  strengths: string[];
  improvements: string[];
  platforms: string[];
  summary: string;
};

type UploadStage = "idle" | "reading" | "uploading" | "analyzing" | "done" | "error";
type InputKind = "image" | "document" | "video";
type DebugInfo = Record<string, unknown> | null;

type CommercialTrack = {
  name: string;
  fit: number;
  reason: string;
  nextStep: string;
};

type StrategyPillar = {
  title: string;
  description: string;
  accent: string;
};

type ContentInsightBlock = {
  title: string;
  text: string;
  tone: "highlight" | "warning" | "neutral";
};

type PlatformOptimizationCard = {
  name: string;
  sourceLabel: string;
  sourceTone: "live" | "reference";
  summary: string;
  percentageMomentum: number;
  percentageFit: number;
  action: string;
  note: string;
};

type ExecutionBriefRow = {
  label: string;
  content: string;
};

type DashboardMetric = {
  label: string;
  value: string;
  note: string;
  tone: string;
};

const SUPERVISOR_ACCESS_KEY = "mvs-supervisor-access";
const FULL_PLATFORM_ORDER = ["douyin", "kuaishou", "bilibili", "xiaohongshu"] as const;
const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "B站",
  kuaishou: "快手",
  weixin_channels: "视频号",
};

function hasSupervisorAccess() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("supervisor") === "1") {
    localStorage.setItem(SUPERVISOR_ACCESS_KEY, "1");
    return true;
  }
  return localStorage.getItem(SUPERVISOR_ACCESS_KEY) === "1";
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(String(event.target?.result || ""));
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function getScoreTone(score: number) {
  if (score >= 80) return { label: "强", color: "text-emerald-300", chip: "border-emerald-300/20 bg-emerald-400/10 text-emerald-200" };
  if (score >= 65) return { label: "可放大", color: "text-amber-200", chip: "border-amber-300/20 bg-amber-400/10 text-amber-100" };
  return { label: "需重构", color: "text-rose-200", chip: "border-rose-300/20 bg-rose-400/10 text-rose-100" };
}

function formatPercent(value: number) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function replaceTerms(text: string) {
  return String(text || "")
    .replace(/\bCTA\b/g, "行动引导（CTA）")
    .replace(/live sample/gi, "实时样本")
    .replace(/hybrid/gi, "混合")
    .replace(/fallback/gi, "补位");
}

function translateTrendSource(source: GrowthSnapshot["status"]["source"]) {
  if (source === "live") return "实时样本";
  if (source === "hybrid") return "实时样本 + 结构补位";
  if (source === "fallback") return "结构补位";
  return "模拟样本";
}

function localizeTrendNote(note: string) {
  return replaceTerms(note)
    .replace(/^Live collectors ready for (.+)\.$/i, (_match, platforms) => {
      const names = String(platforms || "")
        .split(",")
        .map((item) => PLATFORM_LABELS[String(item).trim()] || String(item).trim())
        .filter(Boolean)
        .join("、");
      return names ? `已接入真实抓取平台：${names}。` : "当前没有已接入的真实抓取平台。";
    })
    .replace(/^No live collector configured for kuaishou\.$/i, "快手暂未接入真实抓取，仅提供结构建议。")
    .replace(/^No live collector configured for weixin_channels\.$/i, "视频号暂未接入真实抓取，仅提供结构建议。")
    .replace(/^Fetched (\d+) Douyin hot search topics\.$/i, "已抓取抖音实时样本：$1 条。")
    .replace(/^Fetched (\d+) popular Bilibili videos\.$/i, "已抓取 B 站实时样本：$1 条。");
}

function normalizeAnalysisScale(result: AnalysisResult): AnalysisResult {
  const numericValues = [
    result.composition,
    result.color,
    result.lighting,
    result.impact,
    result.viralPotential,
  ];
  const shouldUpscale = numericValues.every((value) => value >= 0 && value <= 5);
  if (!shouldUpscale) return result;
  return {
    ...result,
    composition: Math.round(result.composition * 20),
    color: Math.round(result.color * 20),
    lighting: Math.round(result.lighting * 20),
    impact: Math.round(result.impact * 20),
    viralPotential: Math.round(result.viralPotential * 20),
  };
}

function buildStrategyPillars(
  analysis: AnalysisResult,
  recommendations: GrowthPlatformRecommendation[],
  tracks: CommercialTrack[],
): StrategyPillar[] {
  const bestPlatform = recommendations[0]?.name || "抖音";
  const bestTrack = tracks[0]?.name || "品牌合作";
  return [
    {
      title: "内容定位",
      description: analysis.summary,
      accent: "text-[#ffcf92]",
    },
    {
      title: "首发渠道",
      description: `优先在 ${bestPlatform} 验证第一版表达，再按平台节奏拆成标题、封面和结构变体。`,
      accent: "text-[#9dd0ff]",
    },
    {
      title: "商业方向",
      description: `这条内容当前最适合承接「${bestTrack}」路径，报告下方会给出第一动作。`,
      accent: "text-[#b8ffcf]",
    },
  ];
}

function buildContentInsightBlocks(analysis: AnalysisResult): ContentInsightBlock[] {
  return [
    {
      title: "核心定位",
      text: analysis.summary,
      tone: "highlight",
    },
    {
      title: "当前优势",
      text: analysis.strengths.slice(0, 2).join("；") || "当前优势还不够稳定，建议先把可复用的表达亮点固定下来。",
      tone: "neutral",
    },
    {
      title: "高优先级问题",
      text: analysis.improvements.slice(0, 2).join("；") || "当前没有识别到明确问题，但建议继续做钩子、节奏和信息顺序的优化。",
      tone: "warning",
    },
    {
      title: "第一优先动作",
      text: analysis.improvements[0] || "先把开头 2-3 秒重写成结果前置版本，再进入平台测试。",
      tone: "highlight",
    },
  ];
}

function buildPlatformOptimizationCards(
  growthSnapshot: GrowthSnapshot | null,
  recommendations: GrowthPlatformRecommendation[],
): PlatformOptimizationCard[] {
  const recommendationMap = new Map(recommendations.map((item) => [item.name, item]));
  return FULL_PLATFORM_ORDER.map((platformKey) => {
    const snapshot = growthSnapshot?.platformSnapshots.find((item) => item.platform === platformKey);
    const displayName = PLATFORM_LABELS[platformKey];
    const recommendation = recommendationMap.get(displayName);
    const hasLiveSample = snapshot?.last30d.sampleSizeLabel === "live-sample-30d";
    const referencePlatform =
      platformKey === "kuaishou" ? "抖音" :
      platformKey === "bilibili" ? "B站" :
      displayName;

    return {
      name: displayName,
      sourceLabel: hasLiveSample ? "当前实时样本" : "仅结构建议",
      sourceTone: hasLiveSample ? "live" : "reference",
      percentageMomentum: snapshot?.momentumScore ?? 0,
      percentageFit: snapshot?.audienceFitScore ?? 0,
      summary: snapshot?.summary || `${displayName} 当前还没有接入真实抓取，先按结构适配给出参考建议。`,
      action: recommendation?.action || (hasLiveSample
        ? `优先参考 ${displayName} 当前更匹配的表达结构做首轮测试。`
        : `当前未接入真实抓取，先参考${referencePlatform}的优化方案做结构适配。`),
      note: hasLiveSample
        ? `当前展示的是实时抓取样本，不应表述为完整 30 天历史库。`
        : `当前没有 ${displayName} 的真实抓取数据，这里只提供结构性建议，不提供真实趋势结论。`,
    };
  });
}

function buildDashboardMetrics(
  scoreItems: { label: string; value: number }[],
  growthSnapshot: GrowthSnapshot | null,
  highConfidenceTracks: CommercialTrack[],
  platformRecommendations: GrowthPlatformRecommendation[],
): DashboardMetric[] {
  const averageScore = scoreItems.length
    ? Math.round(scoreItems.reduce((sum, item) => sum + item.value, 0) / scoreItems.length)
    : 0;

  const livePlatformCount = growthSnapshot?.platformSnapshots.filter(
    (item) => item.last30d.sampleSizeLabel === "live-sample-30d",
  ).length ?? 0;

  return [
    {
      label: "综合成熟度",
      value: `${averageScore}%`,
      note: "基于五个独立维度的平均值，只用于快速判断当前整体成熟度。",
      tone: "from-[#ff8a3d]/30 via-[#ff8a3d]/10 to-transparent",
    },
    {
      label: "高匹配商业方向",
      value: `${highConfidenceTracks.length}`,
      note: "只统计匹配度达到 80% 以上的方向，避免给用户空泛结论。",
      tone: "from-[#f5b7ff]/30 via-[#f5b7ff]/10 to-transparent",
    },
    {
      label: "真实平台样本",
      value: `${livePlatformCount}`,
      note: "仅统计当前已抓到真实 collector 样本的平台，不含结构补位。",
      tone: "from-[#9df6c0]/30 via-[#9df6c0]/10 to-transparent",
    },
    {
      label: "首发建议",
      value: platformRecommendations[0]?.name || "待生成",
      note: "首发平台优先用于验证第一版表达，后续再做多平台拆分和分发。",
      tone: "from-[#90c4ff]/30 via-[#90c4ff]/10 to-transparent",
    },
  ];
}

function buildPlatformComparisonData(platforms: PlatformOptimizationCard[]) {
  return platforms.map((item) => ({
    name: item.name,
    热度动量: item.percentageMomentum,
    受众适配: item.percentageFit,
  }));
}

function buildScoreDistributionData(scoreItems: { label: string; value: number }[]) {
  return scoreItems.map((item) => ({
    name: item.label,
    value: item.value,
  }));
}

function buildCommercialTrackData(tracks: CommercialTrack[]) {
  return tracks.slice(0, 4).map((item) => ({
    name: item.name,
    value: item.fit,
  }));
}

function buildExecutionBriefRows(analysis: AnalysisResult, context: string): ExecutionBriefRow[] {
  const normalized = `${analysis.summary}\n${context}`;
  const isMedicalSports = /医生|医学|慢性病|健康管理|网球|比赛|运动损伤|康复/.test(normalized);
  if (isMedicalSports) {
    return [
      {
        label: "A. 核心分析",
        content: [
          "画面节奏与视觉：原始素材节奏平缓，无亮点。二次创作应通过关键击球慢放、运动员表情特写、关键信息字幕和数据图表来制造节奏与视觉焦点。",
          "叙事结构与口播/字幕：核心是打造“医生看比赛”的独特视角。可以做三种结构：1. 运动损伤科普。2. 慢性病管理关联。3. 励志故事与心理健康。",
        ].join("\n"),
      },
      {
        label: "B. 商业转化潜力",
        content: [
          "潜力巨大。通过上述内容，可将抽象医学知识具象化，塑造“懂健康、懂生活”的专家形象。",
          "转化路径：吸引精准用户 -> 建立信任 -> 导流到线上咨询、付费健康管理社群、相关课程或线下门诊。",
        ].join("\n"),
      },
    ];
  }

  return [
    {
      label: "A. 核心分析",
      content: [
        `画面节奏与视觉：${analysis.summary}`,
        `叙事结构与口播/字幕：优先围绕“${analysis.improvements[0] || "结果前置"}”重写表达顺序，并把关键信息做成字幕层级。`,
      ].join("\n"),
    },
    {
      label: "B. 商业转化潜力",
      content: [
        "商业转化路径：先吸引精准受众，再通过稳定栏目感建立信任，最后承接到咨询、产品、课程或服务入口。",
        "当前建议：只保留一条最清晰的商业路径，不要同时混合多个变现方向。",
      ].join("\n"),
    },
  ];
}

function buildCommercialTracks(
  analysis: AnalysisResult,
  context: string,
  growthSnapshot: GrowthSnapshot | null,
): CommercialTrack[] {
  const text = context.trim();
  const xiaohongshuFit = growthSnapshot?.platformSnapshots.find((item) => item.platform === "xiaohongshu")?.audienceFitScore || 0;
  const bilibiliFit = growthSnapshot?.platformSnapshots.find((item) => item.platform === "bilibili")?.audienceFitScore || 0;
  const douyinFit = growthSnapshot?.platformSnapshots.find((item) => item.platform === "douyin")?.audienceFitScore || 0;

  return [
    {
      name: "品牌合作",
      fit: Math.min(96, Math.round((analysis.color + analysis.composition + xiaohongshuFit) / 3 + (/品牌|招商|案例|客户|服务/.test(text) ? 6 : 0))),
      reason: "视觉包装和表达统一性较强时，更容易承接品牌合作、案例展示和商业合作页。",
      nextStep: "补一版案例导向标题和服务说明，让合作方能快速理解你擅长的商业结果。",
    },
    {
      name: "电商带货",
      fit: Math.min(96, Math.round((analysis.impact + analysis.viralPotential + douyinFit) / 3 + (/带货|商品|电商|转化/.test(text) ? 8 : 0))),
      reason: "冲击力和节奏更适合做转化型表达，但产品利益点和 CTA 需要足够直接。",
      nextStep: "把前三秒改成结果或利益点前置，并把行动指令明确到橱窗、评论区或私域入口。",
    },
    {
      name: "知识付费",
      fit: Math.min(96, Math.round((analysis.composition + analysis.viralPotential + bilibiliFit) / 3 + (/课程|教学|知识|教程|陪跑/.test(text) ? 10 : 0))),
      reason: "适合把内容拆成方法、结构、案例复盘，再沉淀成课程、模板或陪跑服务。",
      nextStep: "把当前内容整理成“结果 + 三步方法 + 常见误区”的结构，形成可复用的方法论入口。",
    },
    {
      name: "社群会员",
      fit: Math.min(96, Math.round((analysis.color + analysis.lighting + xiaohongshuFit) / 3 + 4)),
      reason: "如果能持续输出同主题内容和过程感，最容易建立陪伴感并承接社群或会员。",
      nextStep: "连续发布 3 条同主题内容，并在结尾加入系列承诺和进群/订阅理由。",
    },
  ].sort((a, b) => b.fit - a.fit);
}

function buildCreationAssistBrief(
  analysis: AnalysisResult,
  context: string,
  platforms: GrowthPlatformRecommendation[],
  tracks: CommercialTrack[],
) {
  const primaryTrack = tracks[0]?.name || "品牌合作";
  const primaryPlatform = platforms[0]?.name || "抖音";
  return [
    `内容目标：把当前素材升级成更适合 ${primaryPlatform} 分发、并服务于「${primaryTrack}」转化的内容版本。`,
    `核心分析：${analysis.summary}`,
    "开场建议：前 2-3 秒先给结果、反差或利益点，不要从铺垫开始。",
    "商业动作：结尾必须补 CTA，把观众导向案例咨询、服务介绍、商品入口或私域承接。",
    context.trim() ? `业务背景：${context.trim()}` : "业务背景：未填写，建议补充目标受众与转化目标。",
  ].join("\n");
}

export default function MVAnalysisPage() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading } = useAuth();
  const [supervisorAccess, setSupervisorAccess] = useState(() => hasSupervisorAccess());

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [inputKind, setInputKind] = useState<InputKind | null>(null);
  const [fileMimeType, setFileMimeType] = useState("");
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [estimatedTime, setEstimatedTime] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [quotaModalVisible, setQuotaModalVisible] = useState(false);
  const [quotaModalInfo, setQuotaModalInfo] = useState<{ isTrial?: boolean; planName?: string }>({});
  const [debugMode, setDebugMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("debug") === "1";
  });
  const [debugInfo, setDebugInfo] = useState<DebugInfo>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const analyzeMutation = trpc.mvAnalysis.analyzeFrame.useMutation();
  const analyzeDocumentMutation = trpc.mvAnalysis.analyzeDocument.useMutation();
  const analyzeVideoMutation = trpc.mvAnalysis.analyzeVideo.useMutation();
  const checkAccessMutation = trpc.usage.checkFeatureAccess.useMutation();
  const refreshGrowthMutation = trpc.mvAnalysis.refreshGrowthTrends.useMutation();
  const usageStatsQuery = trpc.usage.getUsageStats.useQuery(undefined, {
    enabled: isAuthenticated && !loading && !supervisorAccess,
    refetchOnMount: true,
  });
  const hasPaidGrowthAccess = Boolean(
    supervisorAccess ||
      (usageStatsQuery.data as any)?.isAdmin ||
      usageStatsQuery.data?.hasSubscription,
  );
  const growthSnapshotQuery = trpc.mvAnalysis.getGrowthSnapshot.useQuery(
    {
      context: context || undefined,
      requestedPlatforms: analysis?.platforms?.length ? analysis.platforms : [...FULL_PLATFORM_ORDER],
      analysis: analysis || {
        composition: 0,
        color: 0,
        lighting: 0,
        impact: 0,
        viralPotential: 0,
        strengths: [],
        improvements: [],
        platforms: [],
        summary: "",
      },
    },
    {
      enabled: Boolean(analysis && hasPaidGrowthAccess),
      staleTime: 60_000,
    },
  );
  const growthSystemStatusQuery = trpc.mvAnalysis.getGrowthSystemStatus.useQuery(undefined, {
    enabled: debugMode,
    staleTime: 30_000,
    refetchInterval: debugMode ? 30_000 : false,
  });

  useEffect(() => {
    setSupervisorAccess(hasSupervisorAccess());
  }, []);

  useEffect(() => {
    if (!loading && !isAuthenticated && !supervisorAccess) navigate("/login");
  }, [loading, isAuthenticated, supervisorAccess, navigate]);

  useEffect(() => {
    if (uploadStage === "uploading" || uploadStage === "analyzing") {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [uploadStage]);

  const handleSelectFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target?.files?.[0];
    if (!file) return;

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const isDocument =
      file.type === "application/pdf" ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      /\.pdf$/i.test(file.name) ||
      /\.docx$/i.test(file.name);

    if (!isImage && !isVideo && !isDocument) {
      setError("请上传图片、Word、PDF 或 MP4 文件");
      return;
    }

    setFileName(file.name);
    setFileSize(file.size);
    setFileMimeType(file.type || "");
    setInputKind(isImage ? "image" : isVideo ? "video" : "document");
    setUploadStage("reading");
    setUploadProgress(0);
    setError(null);
    setAnalysis(null);
    setDebugInfo(null);
    setPreviewUrl(null);

    const sizeMB = file.size / (1024 * 1024);
    setEstimatedTime(Math.max(10, Math.round(sizeMB * 2 + 15)));

    void (async () => {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        setFileBase64(dataUrl.split(",")[1] || "");

        if (isImage) {
          setPreviewUrl(dataUrl);
          setUploadStage("idle");
          setUploadProgress(100);
          return;
        }

        if (isDocument) {
          setUploadStage("idle");
          setUploadProgress(100);
          return;
        }

        const video = document.createElement("video");
        const url = URL.createObjectURL(file);
        video.src = url;
        video.muted = true;
        video.currentTime = 1;
        video.onloadeddata = () => {
          video.currentTime = Math.min(1, video.duration / 4);
        };
        video.onseeked = () => {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            URL.revokeObjectURL(url);
            setError("视频读取失败，请重试");
            setUploadStage("error");
            return;
          }
          ctx.drawImage(video, 0, 0);
          setPreviewUrl(canvas.toDataURL("image/jpeg", 0.9));
          setUploadStage("idle");
          setUploadProgress(100);
          URL.revokeObjectURL(url);
        };
        video.onerror = () => {
          setError("视频读取失败，请重试");
          setUploadStage("error");
          URL.revokeObjectURL(url);
        };
      } catch (fileError: any) {
        setError(fileError.message || "文件读取失败");
        setUploadStage("error");
      }
    })();
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!fileBase64 || !inputKind) return;

    if (!supervisorAccess) {
      try {
        const accessCheck = await checkAccessMutation.mutateAsync({ featureType: "analysis" });
        if (!accessCheck.allowed) {
          setQuotaModalInfo({
            isTrial: (accessCheck as any).isTrial,
            planName: (accessCheck as any).planName,
          });
          setQuotaModalVisible(true);
          return;
        }
      } catch (accessError: any) {
        toast.error(accessError.message || "无法检查使用权限");
        return;
      }
    }

    setUploadStage("uploading");
    setUploadProgress(0);
    setError(null);
    setElapsedTime(0);
    setEstimatedTime(Math.max(12, Math.round(fileSize / (1024 * 1024) * 1.5 + 12)));

    try {
      const result = inputKind === "image"
        ? await analyzeMutation.mutateAsync({
            imageBase64: fileBase64,
            mimeType: fileMimeType || "image/jpeg",
            context: context || undefined,
          })
        : inputKind === "document"
          ? await analyzeDocumentMutation.mutateAsync({
              fileBase64,
              mimeType: fileMimeType || "application/octet-stream",
              fileName,
              context: context || undefined,
            })
          : await analyzeVideoMutation.mutateAsync({
              fileBase64,
              mimeType: fileMimeType || "video/mp4",
              fileName,
              context: context || undefined,
            });
      setAnalysis(normalizeAnalysisScale(result.analysis));
      setDebugInfo({
        inputKind,
        fileName,
        mimeType: fileMimeType || null,
        fileSize,
        ...((result as any).debug || {}),
      });
      setUploadProgress(100);
      setUploadStage("done");
      if (!supervisorAccess) {
        usageStatsQuery.refetch();
      }
    } catch (analysisError: any) {
      setError(analysisError.message || "分析失败，请稍后再试");
      setUploadStage("error");
    }
  }, [fileBase64, inputKind, supervisorAccess, checkAccessMutation, fileSize, analyzeMutation, analyzeDocumentMutation, analyzeVideoMutation, fileMimeType, fileName, context, usageStatsQuery]);

  const handleReset = useCallback(() => {
    setPreviewUrl(null);
    setFileBase64(null);
    setInputKind(null);
    setFileMimeType("");
    setAnalysis(null);
    setError(null);
    setContext("");
    setDebugInfo(null);
    setUploadStage("idle");
    setUploadProgress(0);
    setElapsedTime(0);
    setFileName("");
    setFileSize(0);
  }, []);

  const handleRefreshGrowth = useCallback(async () => {
    try {
      await refreshGrowthMutation.mutateAsync({
        platforms: [...FULL_PLATFORM_ORDER],
      });
      await growthSnapshotQuery.refetch();
      toast.success("趋势数据已刷新");
    } catch (refreshError: any) {
      toast.error(refreshError.message || "趋势数据刷新失败");
    }
  }, [refreshGrowthMutation, growthSnapshotQuery]);

  const handleCopyText = useCallback(async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMessage);
    } catch (copyError: any) {
      toast.error(copyError.message || "复制失败");
    }
  }, []);

  const handleStoreHandoff = useCallback((handoff: GrowthHandoff | null, successMessage = "handoff 已暂存") => {
    if (!handoff) return;
    saveGrowthHandoff(handoff);
    toast.success(successMessage);
  }, []);

  const scoreItems = useMemo(() => {
    if (!analysis) return [];
    if (inputKind === "document") {
      return [
        { label: "结构质量", value: analysis.composition },
        { label: "包装潜力", value: analysis.color },
        { label: "信息清晰", value: analysis.lighting },
        { label: "表达钩子", value: analysis.impact },
        { label: "商业放大空间", value: analysis.viralPotential },
      ];
    }
    if (inputKind === "video") {
      return [
        { label: "叙事结构", value: analysis.composition },
        { label: "视觉包装", value: analysis.color },
        { label: "信息清晰", value: analysis.lighting },
        { label: "节奏冲击", value: analysis.impact },
        { label: "商业放大空间", value: analysis.viralPotential },
      ];
    }
    return [
      { label: "构图结构", value: analysis.composition },
      { label: "色彩识别", value: analysis.color },
      { label: "光线氛围", value: analysis.lighting },
      { label: "冲击强度", value: analysis.impact },
      { label: "商业放大空间", value: analysis.viralPotential },
    ];
  }, [analysis, inputKind]);

  const isProcessing = uploadStage === "uploading" || uploadStage === "analyzing";
  const remainingTime = Math.max(0, estimatedTime - elapsedTime);

  const growthSnapshot: GrowthSnapshot | null = growthSnapshotQuery.data?.snapshot ?? null;
  const platformRecommendations = growthSnapshot?.platformRecommendations ?? [];
  const businessInsights: GrowthBusinessInsight[] = growthSnapshot?.businessInsights ?? [];
  const growthPlan: GrowthPlanStep[] = growthSnapshot?.growthPlan ?? [];
  const commercialTracks = useMemo(
    () => {
      if (!analysis) return [];
      return growthSnapshot?.monetizationTracks?.length
        ? growthSnapshot.monetizationTracks
        : buildCommercialTracks(analysis, context, growthSnapshot);
    },
    [analysis, context, growthSnapshot],
  );
  const creationAssistBrief = useMemo(
    () => {
      if (!analysis) return "";
      return growthSnapshot?.creationAssist?.brief
        ? growthSnapshot.creationAssist.brief
        : buildCreationAssistBrief(analysis, context, platformRecommendations, commercialTracks);
    },
    [analysis, context, platformRecommendations, commercialTracks, growthSnapshot],
  );
  const growthHandoff = growthSnapshot?.growthHandoff ?? null;
  const growthHandoffStatus = useMemo(() => getGrowthHandoffStatus(growthHandoff), [growthHandoff]);
  const strategyPillars = useMemo(
    () => analysis ? buildStrategyPillars(analysis, platformRecommendations, commercialTracks) : [],
    [analysis, platformRecommendations, commercialTracks],
  );
  const contentInsightBlocks = useMemo(
    () => analysis ? buildContentInsightBlocks(analysis) : [],
    [analysis],
  );
  const platformOptimizationCards = useMemo(
    () => buildPlatformOptimizationCards(growthSnapshot, platformRecommendations),
    [growthSnapshot, platformRecommendations],
  );
  const trendLayerGroups = useMemo(() => {
    const layers = growthSnapshot?.trendLayers || [];
    return {
      topics: layers.filter((item) => item.layerType === "topic"),
      content: layers.filter((item) => item.layerType === "content"),
      structure: layers.filter((item) => item.layerType === "structure"),
    };
  }, [growthSnapshot]);
  const highConfidenceTracks = useMemo(
    () => commercialTracks.filter((track) => track.fit >= 80),
    [commercialTracks],
  );
  const executionBriefRows = useMemo(
    () => analysis ? buildExecutionBriefRows(analysis, context) : [],
    [analysis, context],
  );
  const dashboardMetrics = useMemo(
    () => buildDashboardMetrics(scoreItems, growthSnapshot, highConfidenceTracks, platformRecommendations),
    [scoreItems, growthSnapshot, highConfidenceTracks, platformRecommendations],
  );
  const platformComparisonData = useMemo(
    () => buildPlatformComparisonData(platformOptimizationCards),
    [platformOptimizationCards],
  );
  const scoreDistributionData = useMemo(
    () => buildScoreDistributionData(scoreItems),
    [scoreItems],
  );
  const commercialTrackData = useMemo(
    () => buildCommercialTrackData(highConfidenceTracks),
    [highConfidenceTracks],
  );
  const showPremiumReport = Boolean(analysis && hasPaidGrowthAccess);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#08111f] text-[#f7f4ef]">
        <Loader2 className="h-8 w-8 animate-spin text-[#ff8a3d]" />
        <span className="mt-4 text-white/60">检查登录状态...</span>
      </div>
    );
  }

  if (!isAuthenticated && !supervisorAccess) return null;

  return (
    <div className="min-h-screen bg-[#08111f] text-[#f7f4ef]">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <UsageQuotaBanner
          featureType="analysis"
          currentCount={usageStatsQuery.data?.features.analysis.currentCount ?? 0}
          freeLimit={usageStatsQuery.data?.features.analysis.limit ?? 2}
          loading={usageStatsQuery.isPending}
        />
        <TrialCountdownBanner
          isTrial={(usageStatsQuery.data as any)?.isTrial}
          trialEndDate={(usageStatsQuery.data as any)?.trialEndDate}
          trialExpired={(usageStatsQuery.data as any)?.trialExpired}
        />
        {usageStatsQuery.data?.studentPlan ? (
          <StudentUpgradePrompt
            studentPlan={usageStatsQuery.data.studentPlan}
            usageData={usageStatsQuery.data.features}
            isTrial={(usageStatsQuery.data as any).isTrial}
            trialEndDate={(usageStatsQuery.data as any).trialEndDate}
          />
        ) : null}

          <div className="mb-8 flex items-center justify-between">
          <button onClick={() => window.history.back()} className="rounded-full border border-white/10 bg-white/5 p-2 transition hover:bg-white/10">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setDebugMode((prev) => !prev)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/75 transition hover:bg-white/10"
            >
              {debugMode ? "Debug ON" : "Debug OFF"}
            </button>
            {supervisorAccess ? (
              <div className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-sm text-emerald-200">
                Supervisor Mode
              </div>
            ) : null}
            <div className="rounded-full border border-[#ff8a3d]/30 bg-[#ff8a3d]/10 px-3 py-1 text-sm text-[#ffb37f]">
              Creator Growth Camp
            </div>
          </div>
        </div>

        <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(255,138,61,0.2),transparent_28%),radial-gradient(circle_at_top_right,rgba(38,132,255,0.15),transparent_24%),linear-gradient(180deg,#101d31_0%,#08111f_72%)] p-6 md:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/55">
                <Sparkles className="h-3.5 w-3.5" />
                創作商業成長營
              </div>
              <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight text-white md:text-6xl">
                从一张画面开始，直接产出你的内容增长与商业化行动方案。
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-8 text-white/70">
                这不是单纯的画面打分页。系统会结合素材分析、近 30 天平台样本、商业承接路径和发布建议，
                输出一份可以立刻执行的成长营报告。
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">内容分析</div>
                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">趋势洞察</div>
                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">商业洞察</div>
                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">推荐平台</div>
                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">7 天增长规划</div>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-black/20 p-5 backdrop-blur-sm">
              {!fileBase64 ? (
                <button
                  onClick={handleSelectFile}
                  className="flex min-h-[360px] w-full flex-col items-center justify-center rounded-[24px] border border-dashed border-white/15 bg-white/5 px-6 text-center transition hover:bg-white/10"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ff8a3d] text-black">
                    <Upload className="h-7 w-7" />
                  </div>
                  <div className="mt-5 text-2xl font-bold">上传图片、Word、PDF 或 MP4</div>
                  <p className="mt-3 max-w-md text-sm leading-7 text-white/60">
                    成长营现在支持图片、`.docx`、`.pdf`、`.mp4`，会按文件类型自动选择分析链路并统一产出报告。
                  </p>
                </button>
              ) : (
                <div className="space-y-4">
                  {previewUrl ? (
                    <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/30">
                      <img src={previewUrl} alt="Selected" className="max-h-[360px] w-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[24px] border border-white/10 bg-black/30 px-6 text-center">
                      {inputKind === "document" ? <FileText className="h-12 w-12 text-[#ffb37f]" /> : <Film className="h-12 w-12 text-[#ffb37f]" />}
                      <div className="mt-4 text-xl font-bold text-white">
                        {inputKind === "document" ? "文档已就绪" : "视频文件已就绪"}
                      </div>
                      <p className="mt-2 text-sm leading-7 text-white/60">
                        {inputKind === "document"
                          ? "将先抽取正文或页面内容，再输出统一的成长营报告。"
                          : "将先抽帧并尝试转写音频，再输出统一的成长营报告。"}
                      </p>
                    </div>
                  )}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2">
                        <FileUp className="h-4 w-4 text-[#ffb37f]" />
                        {fileName || "未命名文件"}
                      </span>
                      <span>{(fileSize / (1024 * 1024)).toFixed(1)} MB</span>
                    </div>
                    <div className="mt-4 h-2 rounded-full bg-white/10">
                      <div className="h-2 rounded-full bg-[#ff8a3d]" style={{ width: `${uploadProgress}%` }} />
                    </div>
                    {isProcessing ? (
                      <div className="mt-3 text-xs text-white/55">
                        正在生成诊断中，预计还需 {remainingTime} 秒。
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.docx,application/pdf,video/mp4"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="mt-5">
                <label className="mb-2 block text-sm font-semibold text-white/80">
                  业务背景 / 商业目标
                </label>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  rows={4}
                  placeholder="例如：这是给餐饮品牌做的招商内容；或这是想转化课程报名的短视频。"
                  className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-white/30"
                />
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  onClick={handleAnalyze}
                  disabled={!fileBase64 || isProcessing}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#ff8a3d] px-5 py-3 font-bold text-black transition hover:bg-[#ff9c5c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  生成成长营报告
                </button>
                <button
                  onClick={handleReset}
                  className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white/80 transition hover:bg-white/10"
                >
                  重置
                </button>
              </div>

              {error ? <div className="mt-4 text-sm text-rose-300">{error}</div> : null}
            </div>
          </div>
        </section>

        {!analysis ? (
          <section className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
              <div className="flex items-center gap-3 text-[#ffb37f]">
                <Compass className="h-5 w-5" />
                <span className="font-semibold">趋势洞察</span>
              </div>
              <p className="mt-4 text-sm leading-7 text-white/65">
                接下来会接入 30 天平台趋势快照、热门题材变化和内容结构数据库，这一版先把承接结构搭起来。
              </p>
            </div>
            <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
              <div className="flex items-center gap-3 text-[#90c4ff]">
                <BriefcaseBusiness className="h-5 w-5" />
                <span className="font-semibold">商业洞察</span>
              </div>
              <p className="mt-4 text-sm leading-7 text-white/65">
                分析结果不会停在“好不好看”，而会继续判断它更适合吸粉、转化、案例展示还是服务售卖。
              </p>
            </div>
            <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
              <div className="flex items-center gap-3 text-[#9df6c0]">
                <Send className="h-5 w-5" />
                <span className="font-semibold">推荐平台</span>
              </div>
              <p className="mt-4 text-sm leading-7 text-white/65">
                报告会把推荐平台做成明确动作建议，而不是只列平台名，便于你直接发布验证。
              </p>
            </div>
          </section>
        ) : null}

        {analysis ? (
          <section className="mt-8 space-y-6">
            {debugMode ? (
              <div className="rounded-[24px] border border-cyan-300/20 bg-cyan-400/10 p-5">
                <div className="text-sm font-semibold text-cyan-100">Debug 面板</div>
                <div className="mt-3 grid gap-2 text-sm text-white/75 md:grid-cols-2">
                  <div>input: {String(debugInfo?.inputKind || inputKind || "-")}</div>
                  <div>route: {String(debugInfo?.route || "-")}</div>
                  <div>provider: {String(debugInfo?.provider || "-")}</div>
                  <div>model: {String(debugInfo?.model || "-")}</div>
                  <div>fallback: {String(debugInfo?.fallback ?? "-")}</div>
                  <div>trend source: {String(growthSnapshot?.status.source || "-")}</div>
                  <div>mime: {String(debugInfo?.mimeType || fileMimeType || "-")}</div>
                  <div>file: {String(debugInfo?.fileName || fileName || "-")}</div>
                  <div>smtp configured: {String(growthSystemStatusQuery.data?.smtp?.configured ?? "-")}</div>
                  <div>mail to: {String(growthSystemStatusQuery.data?.targetEmail || "-")}</div>
                  <div>smtp from: {String(growthSystemStatusQuery.data?.smtp?.from || "-")}</div>
                  <div>smtp missing: {Array.isArray(growthSystemStatusQuery.data?.smtp?.missing) ? growthSystemStatusQuery.data?.smtp?.missing.join(", ") || "-" : "-"}</div>
                  {debugInfo?.extractionMethod ? <div>extract: {String(debugInfo.extractionMethod)}</div> : null}
                  {debugInfo?.videoDuration ? <div>video sec: {String(debugInfo.videoDuration)}</div> : null}
                  {debugInfo?.transcriptChars ? <div>transcript chars: {String(debugInfo.transcriptChars)}</div> : null}
                </div>
                {growthSystemStatusQuery.data?.scheduler?.length ? (
                  <div className="mt-4 space-y-2 rounded-2xl border border-cyan-200/15 bg-black/15 p-4 text-xs text-white/72">
                    <div className="font-semibold text-cyan-100">抓取调度状态</div>
                    <div className="rounded-xl border border-cyan-200/15 bg-cyan-400/5 p-3 leading-6">
                      <div>17:00 - 22:00：每 2 小时抓取一次</div>
                      <div>22:00 - 06:00：每 3 小时抓取一次</div>
                      <div>06:00 - 17:00：每 4 小时抓取一次</div>
                    </div>
                    {growthSystemStatusQuery.data.scheduler.map((item) => (
                      <div key={String(item.platform)} className="grid gap-1 md:grid-cols-2">
                        <div>{String(item.platform)} last success: {String(item.lastSuccessAt || "-")}</div>
                        <div>{String(item.platform)} next run: {String(item.nextRunAt || "-")}</div>
                        <div>{String(item.platform)} failures: {String(item.failureCount ?? 0)}</div>
                        <div>{String(item.platform)} error: {String(item.lastError || "-")}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {showPremiumReport ? (
              <div className="grid gap-4 xl:grid-cols-[1.05fr_1.2fr]">
                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#ffcf92]">
                    <Sparkles className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">商业分析总览</h2>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-white/62">
                    这一块不是静态摘要，而是把内容成熟度、商业方向、样本覆盖和首发建议压成 dashboard 入口，方便客户先看重点再读说明。
                  </p>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    {dashboardMetrics.map((item) => (
                      <div key={item.label} className={`rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02)),radial-gradient(circle_at_top_left,var(--tw-gradient-stops))] ${item.tone} p-4`}>
                        <div className="text-xs uppercase tracking-[0.18em] text-white/45">{item.label}</div>
                        <div className="mt-3 text-3xl font-black text-white">{item.value}</div>
                        <p className="mt-3 text-sm leading-6 text-white/62">{item.note}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr_0.8fr]">
                    {strategyPillars.map((item) => (
                      <div key={item.title} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                        <div className={`text-sm font-semibold ${item.accent}`}>{item.title}</div>
                        <p className={`mt-3 text-sm leading-7 text-white/68 ${item.title === "内容定位" ? "min-h-[220px]" : "min-h-[120px]"}`}>{item.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                    <div className="flex items-center justify-between">
                      <div className="text-lg font-bold text-white">五维度成熟度</div>
                      <div className="text-xs text-white/45">满分 100</div>
                    </div>
                    <div className="mt-4 h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={scoreDistributionData} margin={{ top: 12, right: 8, left: -24, bottom: 8 }}>
                          <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                          <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis domain={[0, 100]} tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} axisLine={false} tickLine={false} />
                          <Tooltip
                            cursor={{ fill: "rgba(255,255,255,0.04)" }}
                            contentStyle={{ background: "#0b1628", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, color: "#fff" }}
                          />
                          <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                            {scoreDistributionData.map((entry) => (
                              <Cell
                                key={entry.name}
                                fill={entry.value >= 80 ? "#8ef0b1" : entry.value >= 65 ? "#ffd08f" : "#ff9cab"}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="mt-4 text-sm leading-7 text-white/60">
                      说明：以上 5 个维度是独立评分，满分均为 100 分，数值越高代表该维度越成熟，并不是综合总分。
                    </p>
                  </div>

                  <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                    <div className="flex items-center justify-between">
                      <div className="text-lg font-bold text-white">商业方向匹配度</div>
                      <div className="text-xs text-white/45">仅展示高匹配项</div>
                    </div>
                    <div className="mt-4 h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={commercialTrackData.length ? commercialTrackData : [{ name: "暂无高匹配项", value: 100 }]}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={58}
                            outerRadius={92}
                            paddingAngle={3}
                          >
                            {(commercialTrackData.length ? commercialTrackData : [{ name: "暂无高匹配项", value: 100 }]).map((entry, index) => (
                              <Cell key={entry.name} fill={["#ff8a3d", "#f5b7ff", "#90c4ff", "#9df6c0"][index % 4]} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ background: "#0b1628", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, color: "#fff" }}
                            formatter={(value: number) => [`${value}%`, "匹配度"]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="mt-4 text-sm leading-7 text-white/60">
                      商业洞察只保留高分方向，低于 80% 的方向不直接给客户，避免制造“看起来很多、其实不可做”的误导。
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-[1.05fr_1.2fr]">
                <div className="rounded-[28px] border border-[#ff8a3d]/15 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#ffcf92]">
                    <Sparkles className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">基础内容诊断</h2>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-white/65">
                    免费版只提供素材本身的基础判断，包括五维度评分、当前优势和优先问题。优化方案、商业分析、平台建议和增长规划属于付费服务，不在免费版展示范围内。
                  </p>
                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-7 text-white/68">
                    <div className="font-semibold text-white">当前可查看</div>
                    <div className="mt-2">1. 五维度成熟度</div>
                    <div>2. 内容优点</div>
                    <div>3. 优先问题</div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-400/10 p-4 text-sm leading-7 text-amber-50">
                    升级后可解锁：趋势洞察、平台优化方案、商业分析、推荐发布平台、7 天增长规划与创作执行简报。
                  </div>
                </div>
                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center justify-between">
                    <div className="text-lg font-bold text-white">五维度成熟度</div>
                    <div className="text-xs text-white/45">满分 100</div>
                  </div>
                  <div className="mt-4 h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={scoreDistributionData} margin={{ top: 12, right: 8, left: -24, bottom: 8 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip
                          cursor={{ fill: "rgba(255,255,255,0.04)" }}
                          contentStyle={{ background: "#0b1628", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, color: "#fff" }}
                        />
                        <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                          {scoreDistributionData.map((entry) => (
                            <Cell
                              key={entry.name}
                              fill={entry.value >= 80 ? "#8ef0b1" : entry.value >= 65 ? "#ffd08f" : "#ff9cab"}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-white/60">
                    说明：以上 5 个维度是独立评分，满分均为 100 分，数值越高代表该维度越成熟，并不是综合总分。
                  </p>
                </div>
              </div>
            )}

            <div className={`grid gap-6 ${showPremiumReport ? "xl:grid-cols-[1.2fr_0.8fr]" : ""}`}>
              <div className="space-y-6">
                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#ffb37f]">
                    <Sparkles className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">内容分析</h2>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {contentInsightBlocks.map((item) => (
                      <div
                        key={item.title}
                        className={`rounded-2xl border p-4 ${
                          item.tone === "highlight"
                            ? "border-[#ff8a3d]/20 bg-[#ff8a3d]/10"
                            : item.tone === "warning"
                              ? "border-amber-300/15 bg-amber-400/8"
                              : "border-white/10 bg-black/15"
                        }`}
                      >
                        <div className="text-sm font-semibold text-white">{item.title}</div>
                        <p className="mt-3 text-sm leading-7 text-white/75">{item.text}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-emerald-300/10 bg-emerald-400/5 p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                        <CheckCircle2 className="h-4 w-4" />
                        当前优势
                      </div>
                      <ul className="mt-3 space-y-2 text-sm leading-7 text-white/70">
                        {analysis.strengths.map((item, index) => <li key={index}>• {item}</li>)}
                      </ul>
                    </div>
                    <div className="rounded-2xl border border-amber-300/10 bg-amber-400/5 p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
                        <Lightbulb className="h-4 w-4" />
                        优先优化点
                      </div>
                      <ul className="mt-3 space-y-2 text-sm leading-7 text-white/70">
                        {analysis.improvements.map((item, index) => <li key={index}>• {item}</li>)}
                      </ul>
                    </div>
                  </div>
                </div>
                {showPremiumReport ? (
                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 text-[#90c4ff]">
                      <TrendingUp className="h-5 w-5" />
                      <h2 className="text-2xl font-bold">趋势洞察</h2>
                    </div>
                    <button
                      onClick={handleRefreshGrowth}
                      disabled={refreshGrowthMutation.isPending}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {refreshGrowthMutation.isPending ? "刷新中..." : "刷新 30 天样本"}
                    </button>
                  </div>
                  {growthSnapshotQuery.isLoading ? (
                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      {[0, 1, 2].map((item) => (
                        <div key={item} className="animate-pulse rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="h-4 w-24 rounded bg-white/10" />
                          <div className="mt-4 h-20 rounded bg-white/5" />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {growthSnapshot ? (
                    <>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/60">
                        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                          数据来源：{translateTrendSource(growthSnapshot.status.source)}
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                          数据时效：{replaceTerms(growthSnapshot.status.freshnessLabel)}
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                          样本窗口：{growthSnapshot.status.windowDays} 天
                        </div>
                      </div>
                      <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-400/10 p-4 text-sm leading-7 text-amber-50">
                        <div className="font-semibold text-white">数据口径说明</div>
                        <p className="mt-2">
                          当前这里展示的是<strong>实时抓取样本 + 结构化补位</strong>，不是完整的 30 天历史数据库。
                          其中抖音、快手、B站、小红书以真实 collector 为准；若某个平台当前未抓到真实样本，只会降级为结构建议，不会作为真实趋势证据使用。
                        </p>
                      </div>
                      <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-7 text-white/70">
                        <div className="font-semibold text-white">趋势摘要</div>
                        <p className="mt-2">{replaceTerms(growthSnapshot.overview.trendNarrative)}</p>
                        <p className="mt-2 text-white/55">{replaceTerms(growthSnapshot.overview.nextCollectionPlan)}</p>
                      </div>
                      <div className="mt-5 grid gap-4 xl:grid-cols-3">
                        <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="text-sm font-semibold text-white">热榜趋势</div>
                          <p className="mt-2 text-sm leading-7 text-white/58">
                            这里只放热榜/热点词样本，不和真实内容样本混写。
                          </p>
                          <div className="mt-4 space-y-3">
                            {trendLayerGroups.topics.length ? trendLayerGroups.topics.map((layer) => (
                              <div key={layer.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-sm font-semibold text-white">{layer.platformLabel}</div>
                                  <div className="rounded-full border border-[#ff8a3d]/20 bg-[#ff8a3d]/10 px-2 py-1 text-[11px] text-[#ffd4b7]">
                                    {layer.sampleLabel}
                                  </div>
                                </div>
                                <p className="mt-2 text-sm leading-6 text-white/65">{layer.summary}</p>
                                <div className="mt-2 text-xs text-white/45">样本数：{layer.sampleCount}</div>
                                {layer.items.length ? (
                                  <div className="mt-2 space-y-1 text-xs leading-6 text-white/55">
                                    {layer.items.map((item) => (
                                      <div key={item}>• {item}</div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            )) : (
                              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/55">当前没有可展示的热榜趋势样本。</div>
                            )}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="text-sm font-semibold text-white">真实内容样本</div>
                          <p className="mt-2 text-sm leading-7 text-white/58">
                            这里只放平台真实内容样本，用来判断标题、叙事和素材表达，不和热榜热点混在一起。
                          </p>
                          <div className="mt-4 space-y-3">
                            {trendLayerGroups.content.length ? trendLayerGroups.content.map((layer) => (
                              <div key={layer.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-sm font-semibold text-white">{layer.platformLabel}</div>
                                  <div className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-[11px] text-emerald-200">
                                    {layer.sampleLabel}
                                  </div>
                                </div>
                                <p className="mt-2 text-sm leading-6 text-white/65">{layer.summary}</p>
                                <div className="mt-2 text-xs text-white/45">样本数：{layer.sampleCount}</div>
                                {layer.items.length ? (
                                  <div className="mt-2 space-y-1 text-xs leading-6 text-white/55">
                                    {layer.items.map((item) => (
                                      <div key={item}>• {item}</div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            )) : (
                              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/55">当前没有可展示的真实内容样本。</div>
                            )}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="text-sm font-semibold text-white">结构补位</div>
                          <p className="mt-2 text-sm leading-7 text-white/58">
                            这里只放没有真实 collector 时的结构建议，不能写成真实趋势结论。
                          </p>
                          <div className="mt-4 space-y-3">
                            {trendLayerGroups.structure.length ? trendLayerGroups.structure.map((layer) => (
                              <div key={layer.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-sm font-semibold text-white">{layer.platformLabel}</div>
                                  <div className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-100">
                                    {layer.sampleLabel}
                                  </div>
                                </div>
                                <p className="mt-2 text-sm leading-6 text-white/65">{layer.summary}</p>
                              </div>
                            )) : (
                              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/55">当前所有展示平台都已有可用样本，没有额外结构补位说明。</div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="mt-5 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                        <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="text-sm font-semibold text-white">平台动量与适配对比</div>
                          <p className="mt-2 text-sm leading-7 text-white/58">
                            这张图把真实样本或结构建议统一拉到一个可比视图里，客户能先看平台差异，再看下面每个平台的文字建议。
                          </p>
                          <div className="mt-4 h-[280px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={platformComparisonData} margin={{ top: 12, right: 12, left: -24, bottom: 8 }}>
                                <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                                <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }} axisLine={false} tickLine={false} />
                                <YAxis domain={[0, 100]} tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} axisLine={false} tickLine={false} />
                                <Tooltip
                                  contentStyle={{ background: "#0b1628", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, color: "#fff" }}
                                  formatter={(value: number) => [`${value}%`, ""]}
                                />
                                <Bar dataKey="热度动量" fill="#ff8a3d" radius={[8, 8, 0, 0]} />
                                <Bar dataKey="受众适配" fill="#90c4ff" radius={[8, 8, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="text-sm font-semibold text-white">结构模式占比</div>
                          <p className="mt-2 text-sm leading-7 text-white/58">
                            这里不是“真实市场份额”，而是当前抓到的高频结构模式，方便客户理解什么样的叙事与钩子更值得优先复用。
                          </p>
                          <div className="mt-4 h-[280px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={growthSnapshot.structurePatterns.slice(0, 4).map((item, index) => ({
                                    name: item.title,
                                    value: Math.max(12, 40 - index * 7),
                                  }))}
                                  dataKey="value"
                                  nameKey="name"
                                  innerRadius={54}
                                  outerRadius={96}
                                  paddingAngle={3}
                                >
                                  {growthSnapshot.structurePatterns.slice(0, 4).map((item, index) => (
                                    <Cell key={item.id} fill={["#ffd08f", "#90c4ff", "#9df6c0", "#f5b7ff"][index % 4]} />
                                  ))}
                                </Pie>
                                <Tooltip
                                  contentStyle={{ background: "#0b1628", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, color: "#fff" }}
                                  formatter={(value: number) => [`${value}%`, "结构占比"]}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>
                      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {platformOptimizationCards.map((platform) => (
                          <div key={platform.name} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold text-white">{platform.name}</div>
                              <div className={`rounded-full border px-2 py-1 text-[11px] ${platform.sourceTone === "live" ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-200" : "border-amber-300/20 bg-amber-400/10 text-amber-100"}`}>
                                {platform.sourceLabel}
                              </div>
                            </div>
                            <p className="mt-3 text-sm leading-7 text-white/65">{platform.summary}</p>
                            <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-white/70">
                              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <div className="text-white/45">热度动量</div>
                                <div className="mt-1 text-xl font-bold text-white">{formatPercent(platform.percentageMomentum)}</div>
                              </div>
                              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <div className="text-white/45">受众适配</div>
                                <div className="mt-1 text-xl font-bold text-white">{formatPercent(platform.percentageFit)}</div>
                              </div>
                            </div>
                            <div className="mt-4 rounded-xl border border-[#ff8a3d]/20 bg-[#ff8a3d]/10 p-3 text-sm text-[#ffd4b7]">
                              平台优化建议：{platform.action}
                            </div>
                            <div className="mt-3 text-xs leading-6 text-white/60">
                              {platform.note}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        {growthSnapshot.contentPatterns.map((pattern) => (
                          <div key={pattern.id} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold text-white">{pattern.title}</div>
                              <div className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70">
                                {pattern.momentum}
                              </div>
                            </div>
                            <p className="mt-3 text-sm leading-7 text-white/65">{pattern.description}</p>
                          <div className="mt-3 rounded-xl border border-[#90c4ff]/15 bg-[#90c4ff]/10 p-3 text-sm text-[#d5e8ff]">
                              内容切口：{pattern.hookTemplate}
                          </div>
                          <div className="mt-3 text-xs text-white/60">
                              商业提示：{replaceTerms(pattern.monetizationHint)}
                          </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {growthSnapshot.structurePatterns.map((pattern) => (
                          <div key={pattern.id} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                            <div className="text-sm font-semibold text-white">{pattern.title}</div>
                            <p className="mt-3 text-sm leading-7 text-white/65">{pattern.angle}</p>
                            <div className="mt-3 rounded-xl border border-[#90c4ff]/15 bg-[#90c4ff]/10 p-3 text-sm text-[#d5e8ff]">
                              钩子：{pattern.hook}
                            </div>
                            <div className="mt-3 text-sm leading-7 text-white/60">行动引导（CTA）：{pattern.cta}</div>
                            <div className="mt-2 text-xs text-white/40">依据：{pattern.evidence}</div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-4">
                        <div className="text-sm font-semibold text-white">平台化优化原则</div>
                        <div className="mt-3 space-y-2 text-sm leading-7 text-white/68">
                          <div>• 抖音、快手优先参考强钩子和结果前置版本。</div>
                          <div>• 小红书优先参考拆解感、收藏理由和封面主信息版本。</div>
                          <div>• B站优先参考幕后复盘、案例拆解和长尾讨论版本。</div>
                          <div>• 如果不同平台建议重复，直接沿用已验证平台的方案，不重复重做。</div>
                        </div>
                      </div>
                      {growthSnapshot.status.notes.length ? (
                        <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-7 text-white/60">
                          {growthSnapshot.status.notes.map((note, index) => (
                            <div key={index}>• {localizeTrendNote(note)}</div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {growthSnapshotQuery.error ? (
                    <div className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm text-rose-100">
                      趋势数据加载失败：{growthSnapshotQuery.error.message}
                    </div>
                  ) : null}
                </div>
                ) : (
                  <div className="rounded-[28px] border border-[#ff8a3d]/15 bg-[#0f1a2c] p-6">
                    <div className="flex items-center gap-3 text-[#ffcf92]">
                      <BriefcaseBusiness className="h-5 w-5" />
                      <h2 className="text-2xl font-bold">付费版可解锁内容</h2>
                    </div>
                    <p className="mt-4 text-sm leading-7 text-white/65">
                      当前免费版到这里为止。后续的趋势判断、平台优化方案、商业方向、增长规划和创作执行简报，都会直接影响内容放大与商业转化，属于付费服务。
                    </p>
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      {[
                        "趋势洞察与真实平台样本",
                        "平台优化方案与首发渠道建议",
                        "商业分析与高匹配变现方向",
                        "7 天增长规划与执行简报",
                      ].map((item) => (
                        <div key={item} className="rounded-2xl border border-white/10 bg-black/15 p-4 text-sm text-white/72">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {showPremiumReport ? (
                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#f5b7ff]">
                    <BriefcaseBusiness className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">商业洞察</h2>
                  </div>
                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-4">
                    <div className="text-sm font-semibold text-white">可执行商业方向总览</div>
                    <p className="mt-2 text-sm leading-7 text-white/58">
                      这部分改成 dashboard 视图后，客户会先看到“哪些方向真的值得做”，再往下看每个方向的文字解释、第一动作和包装建议。
                    </p>
                    <div className="mt-4 h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={commercialTrackData} layout="vertical" margin={{ top: 12, right: 12, left: 8, bottom: 8 }}>
                          <CartesianGrid stroke="rgba(255,255,255,0.08)" horizontal={true} vertical={false} />
                          <XAxis type="number" domain={[0, 100]} tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis dataKey="name" type="category" tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11 }} axisLine={false} tickLine={false} width={84} />
                          <Tooltip
                            contentStyle={{ background: "#0b1628", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, color: "#fff" }}
                            formatter={(value: number) => [`${value}%`, "匹配度"]}
                          />
                          <Bar dataKey="value" fill="#f5b7ff" radius={[0, 8, 8, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="mt-5 space-y-3">
                    {businessInsights.map((item) => (
                      <GrowthSectionCard
                        key={item.title}
                        title={item.title}
                        description={replaceTerms(item.detail)}
                      />
                    ))}
                  </div>
                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-7 text-white/68">
                    术语说明：行动引导（CTA）指的是你希望用户下一步做什么，比如咨询、留言、进入社群、预约服务或点击商品入口。
                  </div>
                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    {highConfidenceTracks.map((track) => {
                      const tone = getScoreTone(track.fit);
                      return (
                        <div key={track.name} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-white">{track.name}</div>
                            <div className={`rounded-full border px-3 py-1 text-xs ${tone.chip}`}>匹配度 {track.fit}%</div>
                          </div>
                          <p className="mt-3 text-sm leading-7 text-white/65">{replaceTerms(track.reason)}</p>
                          <div className="mt-3 rounded-xl border border-[#f5b7ff]/15 bg-[#f5b7ff]/10 p-3 text-sm text-[#fbe1ff]">
                            第一动作：{replaceTerms(track.nextStep)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {!highConfidenceTracks.length ? (
                    <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-400/10 p-4 text-sm leading-7 text-amber-50">
                      当前没有达到 80% 以上匹配度的商业方向。此时不应该直接给出“品牌合作”或“带货”结论，而应该继续先优化内容包装、结构和承接入口。
                    </div>
                  ) : null}
                </div>
                ) : null}
              </div>

              {showPremiumReport ? (
              <div className="space-y-6">
                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#ffd08f]">
                    <Send className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">推荐发布平台</h2>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-white/60">
                    先跑最适合的首发渠道，再把同一条内容拆成不同标题、封面和叙事强度做二次分发。
                  </p>
                  <div className="mt-5 space-y-4">
                    {platformRecommendations.map((platform, index) => (
                      <div key={platform.name} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-lg font-bold text-white">{platform.name}</div>
                          <div className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70">
                            #{index + 1}
                          </div>
                        </div>
                        <p className="mt-2 text-sm leading-7 text-white/70">{platform.reason}</p>
                        <div className="mt-3 rounded-xl border border-[#ff8a3d]/20 bg-[#ff8a3d]/10 p-3 text-sm text-[#ffd4b7]">
                          建议动作：{platform.action}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#9df6c0]">
                    <LineChartIcon className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">7 天增长规划</h2>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-white/60">
                    这 7 天不是泛泛建议，而是按“先验证，再放大，再承接商业动作”的顺序推进。
                  </p>
                  <div className="mt-5 space-y-3">
                    {growthPlan.map((item) => (
                      <div key={item.day} className="rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-7 text-white/70">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9df6c0]">Day {item.day}</div>
                        <div className="mt-2 text-base font-semibold text-white">{item.title}</div>
                        <div className="mt-2">{item.action}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,138,61,0.12),rgba(255,255,255,0.03))] p-6">
                  <div className="flex items-center gap-3 text-[#ffd08f]">
                    <Rocket className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">创作执行简报</h2>
                  </div>
                  <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/15">
                    <table className="w-full border-collapse text-sm leading-7 text-white/72">
                      <tbody>
                        {executionBriefRows.map((row) => (
                          <tr key={row.label} className="border-b border-white/10 last:border-b-0">
                            <td className="w-40 bg-white/5 px-4 py-4 align-top font-semibold text-white">{row.label}</td>
                            <td className="px-4 py-4 whitespace-pre-wrap">{row.content}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <GrowthHandoffActions
                    handoff={growthHandoff}
                    growthPlan={growthPlan}
                    fallbackBrief={creationAssistBrief}
                    onCopyText={handleCopyText}
                    onStoreHandoff={handleStoreHandoff}
                  />
                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-7 text-white/68">
                    <div className="font-semibold text-white">handoff 交接状态</div>
                    <div className="mt-2">
                      {growthHandoffStatus.ready
                        ? "当前 payload 已包含创作简报、分镜提示词、工作流提示词、商业目标、推荐方向与推荐平台，可直接交给 storyboard / workflow。"
                        : `当前 payload 还缺少：${growthHandoffStatus.missing.join("、")}。这会影响后续创作流接收。`}
                    </div>
                    {growthHandoff?.recommendedPlatforms?.length ? (
                      <div className="mt-2 text-white/55">
                        当前推荐平台：{growthHandoff.recommendedPlatforms.map((item) => PLATFORM_LABELS[item] || item).join("、")}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-3">
                    <a
                      href="/storyboard"
                      onClick={() => handleStoreHandoff(growthHandoff, "handoff 已写入本地，可交给 storyboard")}
                      className="rounded-2xl border border-[#ff8a3d]/20 bg-[#ff8a3d]/10 px-4 py-3 text-sm font-semibold text-[#ffd4b7] transition hover:bg-[#ff8a3d]/15"
                    >
                      进入分镜创作
                    </a>
                    <a
                      href="/workflow"
                      onClick={() => handleStoreHandoff(growthHandoff, "handoff 已写入本地，可交给 workflow")}
                      className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/10"
                    >
                      进入工作流执行
                    </a>
                  </div>
                </div>
              </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      <QuotaExhaustedModal
        isOpen={quotaModalVisible}
        onClose={() => setQuotaModalVisible(false)}
        featureType="analysis"
        isTrial={quotaModalInfo.isTrial}
        planName={quotaModalInfo.planName}
      />
    </div>
  );
}
