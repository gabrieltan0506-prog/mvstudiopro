import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { UsageQuotaBanner } from "@/components/UsageQuotaBanner";
import { StudentUpgradePrompt } from "@/components/StudentUpgradePrompt";
import { TrialCountdownBanner } from "@/components/TrialCountdownBanner";
import { QuotaExhaustedModal } from "@/components/QuotaExhaustedModal";
import { saveGrowthHandoff } from "@/lib/growthHandoff";
import type {
  GrowthBusinessInsight,
  GrowthHandoff,
  GrowthIndustryTemplate,
  GrowthPlanStep,
  GrowthPlatformRecommendation,
  GrowthSnapshot,
  GrowthTopicLibraryItem,
} from "@shared/growth";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Compass,
  FileUp,
  Film,
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
type InputKind = "document" | "video";
type DebugInfo = Record<string, unknown> | null;

type CommercialTrack = {
  name: string;
  fit: number;
  reason: string;
  nextStep: string;
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

type InsightTableRow = {
  label: string;
  insight: string;
  action: string;
  highlight?: string;
};

type TrendTableRow = {
  platform: string;
  topic: string;
  reason: string;
  action: string;
  highlight?: string;
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

function compactText(text: string, maxLength = 72) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function normalizeText(text: string) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function replaceTerms(text: string) {
  return String(text || "")
    .replace(/\bCTA\b/g, "行动引导（CTA）")
    .replace(/live sample/gi, "实时样本")
    .replace(/hybrid/gi, "混合")
    .replace(/fallback/gi, "补位");
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

function buildDashboardMetrics(
  scoreItems: { label: string; value: number }[],
  highConfidenceTracks: CommercialTrack[],
  platformRecommendations: GrowthPlatformRecommendation[],
): DashboardMetric[] {
  const averageScore = scoreItems.length
    ? Math.round(scoreItems.reduce((sum, item) => sum + item.value, 0) / scoreItems.length)
    : 0;

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
      label: "内容角色",
      value: averageScore >= 80 ? "可放大" : averageScore >= 65 ? "可优化" : "需重构",
      note: "先判断当前内容该直接放大、重剪，还是需要先重写定位与钩子。",
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

function buildScoreDistributionData(scoreItems: { label: string; value: number }[]) {
  return scoreItems.map((item) => ({
    name: item.label,
    value: item.value,
  }));
}

function buildPositioningRows(
  analysis: AnalysisResult,
  context: string,
  tracks: CommercialTrack[],
  platforms: GrowthPlatformRecommendation[],
  industryTemplate?: GrowthIndustryTemplate | null,
): InsightTableRow[] {
  const audience = normalizeText(
    industryTemplate?.audience || context || "当前没有明确写出受众与成交目标，建议后续补全。",
  );
  const bestTrack = tracks.find((track) => track.fit >= 60);
  const firstPlatform = platforms[0]?.name || "小红书";
  const primaryDirection = bestTrack?.name || "先不主打变现";
  const roleFixPlan = industryTemplate?.positioningHint
    ? `先把内容角色改成「${industryTemplate.positioningHint}」，再统一脚本、封面和结尾动作。`
    : "先把这条内容定义成引流内容、信任内容或成交内容中的一个，再写脚本和结尾动作。";
  return [
    {
      label: "受众痛点",
      insight: audience,
      action: normalizeText(industryTemplate?.painPoint || "先明确你要吸引哪类人，以及最终要导向什么成交动作。"),
      highlight: "没有明确受众时，后面所有商业判断都会发散。",
    },
    {
      label: "内容角色",
      insight: normalizeText(analysis.summary || "这条内容当前更像素材，不是可以直接成交的完整内容。"),
      action: roleFixPlan,
      highlight: "先定角色，再定脚本和平台。",
    },
    {
      label: "首发路径",
      insight: `先用 ${firstPlatform} 验证表达，不再同时谈多个平台。`,
      action: firstPlatform === "小红书"
        ? "先做一版适合小红书的图文/笔记结构：封面主标题、收藏理由、方法拆解、结尾行动。"
        : "只做一个首发版本，不要一稿通发。",
    },
    {
      label: "主商业方向",
      insight: primaryDirection === "先不主打变现"
        ? "当前商业闭环不成熟，先不要把品牌合作、带货、社群同时写上去。"
        : `当前优先验证「${primaryDirection}」这一条路径。`,
      action: primaryDirection === "先不主打变现"
        ? "先把内容角色、受众痛点、首发平台和结尾动作统一，再去谈商业承接。"
        : normalizeText(industryTemplate?.primaryConversion || "结尾只保留一个明确承接动作，避免同时推多个变现方向。"),
      highlight: primaryDirection === "先不主打变现"
        ? "先跑通内容入口，再谈后续商业化。"
        : "单一路径比多方向堆叠更容易转化。",
    },
  ];
}

function buildContentAnalysisRows(analysis: AnalysisResult, industryTemplate?: GrowthIndustryTemplate | null): InsightTableRow[] {
  return [
    {
      label: "当前优势",
      insight: normalizeText(analysis.strengths[0] || industryTemplate?.trustAsset || "素材真实、有可延展的内容基础。"),
      action: normalizeText(analysis.strengths[1] || "把现有优势固定成可复用的标题、封面或镜头模板。"),
      highlight: "先固定可复用优势，不要每条都重来。",
    },
    {
      label: "优先优化点",
      insight: normalizeText(analysis.improvements[0] || "开头抓力不足，信息进入过慢。"),
      action: normalizeText(analysis.improvements[1] || industryTemplate?.analysisHint || "先重写前 2 到 3 秒，再处理字幕、节奏和转场。"),
      highlight: "先修最影响停留的问题。",
    },
    {
      label: "表达问题",
      insight: normalizeText(analysis.improvements[2] || industryTemplate?.painPoint || "信息顺序和视觉重点不够集中，用户很难快速理解卖点。"),
      action: normalizeText(industryTemplate?.positioningHint || "把一句核心结论放到最前面，剩下内容只服务这一句。"),
    },
    {
      label: "建议方向",
      insight: normalizeText(analysis.summary || industryTemplate?.commercialFocus || "当前内容有基础，但需要更强的结构和承接动作。"),
      action: normalizeText(industryTemplate?.commercialFocus || "按“痛点 -> 方案 -> 行动”三段重写，不再堆砌过程描述。"),
      highlight: "说明越短，行动越清楚。",
    },
  ];
}

function buildTrendRows(
  growthSnapshot: GrowthSnapshot | null,
  _context: string,
  _platforms: GrowthPlatformRecommendation[],
): TrendTableRow[] {
  return (growthSnapshot?.topicLibrary || []).slice(0, 6).map((item: GrowthTopicLibraryItem) => ({
    platform: item.platformLabel,
    topic: compactText(item.title, 30),
    reason: compactText(item.rationale, 72),
    action: compactText(item.executionHint, 72),
    highlight: compactText(item.commercialAngle, 60),
  }));
}

function buildPlatformRecommendationRows(
  recommendations: GrowthPlatformRecommendation[],
  growthSnapshot: GrowthSnapshot | null,
): InsightTableRow[] {
  return recommendations.slice(0, 1).map((platform) => {
    const snapshot = growthSnapshot?.platformSnapshots.find((item) => item.displayName === platform.name);
    return {
      label: platform.name,
      insight: normalizeText(platform.reason),
      action: normalizeText(platform.action),
      highlight: snapshot?.watchouts?.[0] ? `避免：${normalizeText(snapshot.watchouts[0])}` : undefined,
    };
  });
}

function buildBusinessTrackRows(tracks: CommercialTrack[], context: string, industryTemplate?: GrowthIndustryTemplate | null): InsightTableRow[] {
  const viableTracks = tracks.filter((track) => track.fit >= 60).slice(0, 2);
  if (!viableTracks.length) {
    return [{
      label: "当前阶段",
      insight: "这条内容现在还不适合直接讲品牌合作、带货或社群。先把入口、角色、案例表达和结尾动作跑通。",
      action: "先用 7 天计划把小红书首发版本做出来，验证收藏、停留、评论关键词，再决定后续承接方式。",
      highlight: "中长期商业化先放后面，短期先把内容入口做成熟。",
    }];
  }
  return viableTracks.map((track) => ({
    label: `${track.name} ${track.fit}%`,
    insight: normalizeText(replaceTerms(track.reason)),
    action: normalizeText(replaceTerms(track.nextStep)),
    highlight: /品牌合作/.test(track.name) && /美妆|穿搭|形象|妆|护肤|造型/.test(context)
      ? "合作类别优先看运动美妆、防晒、功能护肤、运动服饰、造型工具与生活方式品牌。"
      : track.name === "社群会员"
        ? "只有固定主题、固定更新和固定权益三件事都成立，社群才值得做。"
        : industryTemplate?.offerExamples?.[0]
          ? `优先验证：${industryTemplate.offerExamples.slice(0, 2).join("、")}`
          : undefined,
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
      reason: /美妆|穿搭|形象|妆|护肤|造型/.test(text)
        ? "只有当你能把审美表达直接翻译成“适合什么场景、解决什么问题、能给品牌带来什么结果”时，品牌合作才成立。"
        : "品牌合作只适合那些表达统一、案例清楚、服务说明完整的内容，不适合泛泛谈曝光。",
      nextStep: /美妆|穿搭|形象|妆|护肤|造型/.test(text)
        ? "先补一版“场景问题 -> 解决方案 -> 可合作品类”的案例页，聚焦运动美妆、防晒、功能护肤、服饰与配件。"
        : "补一版案例导向标题和服务说明，让合作方能快速理解你擅长的商业结果。",
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
      reason: "社群不是默认答案，只有当你能稳定更新同主题内容、持续交付群内价值时，才值得做会员或长期社群。",
      nextStep: "先验证是否存在固定主题、固定更新节奏和固定权益，再决定要不要把社群作为主承接方式。",
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
  const [supervisorAccess, setSupervisorAccess] = useState(() => hasSupervisorAccess());
  const { isAuthenticated, loading } = useAuth({ autoFetch: !supervisorAccess });

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
    refetchInterval: debugMode ? 10_000 : false,
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

    const isVideo = file.type.startsWith("video/");
    const isDocument =
      file.type === "application/pdf" ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      /\.pdf$/i.test(file.name) ||
      /\.docx$/i.test(file.name);

    if (!isVideo && !isDocument) {
      setError("请上传图文档案（Word、PDF）或 MP4 视频文件");
      return;
    }

    setFileName(file.name);
    setFileSize(file.size);
    setFileMimeType(file.type || "");
    setInputKind(isVideo ? "video" : "document");
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
      const result = inputKind === "document"
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
  }, [fileBase64, inputKind, supervisorAccess, checkAccessMutation, fileSize, analyzeDocumentMutation, analyzeVideoMutation, fileMimeType, fileName, context, usageStatsQuery]);

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
  const growthHandoff = growthSnapshot?.growthHandoff ?? null;
  const positioningRows = useMemo(
    () => analysis ? buildPositioningRows(analysis, context, commercialTracks, platformRecommendations, growthSnapshot?.industryTemplate) : [],
    [analysis, context, commercialTracks, platformRecommendations, growthSnapshot?.industryTemplate],
  );
  const contentAnalysisRows = useMemo(
    () => analysis ? buildContentAnalysisRows(analysis, growthSnapshot?.industryTemplate) : [],
    [analysis, growthSnapshot?.industryTemplate],
  );
  const trendRows = useMemo(
    () => buildTrendRows(growthSnapshot, context, platformRecommendations),
    [growthSnapshot, context, platformRecommendations],
  );
  const platformRecommendationRows = useMemo(
    () => buildPlatformRecommendationRows(platformRecommendations, growthSnapshot),
    [platformRecommendations, growthSnapshot],
  );
  const highConfidenceTracks = useMemo(
    () => commercialTracks.filter((track) => track.fit >= 80),
    [commercialTracks],
  );
  const businessTrackRows = useMemo(
    () => buildBusinessTrackRows(highConfidenceTracks.length ? highConfidenceTracks : commercialTracks, context, growthSnapshot?.industryTemplate),
    [highConfidenceTracks, commercialTracks, context, growthSnapshot?.industryTemplate],
  );
  const executionBriefRows = useMemo(
    () => analysis ? buildExecutionBriefRows(analysis, context) : [],
    [analysis, context],
  );
  const dashboardMetrics = useMemo(
    () => buildDashboardMetrics(scoreItems, highConfidenceTracks, platformRecommendations),
    [scoreItems, highConfidenceTracks, platformRecommendations],
  );
  const scoreDistributionData = useMemo(
    () => buildScoreDistributionData(scoreItems),
    [scoreItems],
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
          <div className="space-y-8">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/55">
                <Sparkles className="h-3.5 w-3.5" />
                创作商业成长营
              </div>
              <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight text-white md:text-6xl">
                让你的图文与视频创意，发挥它们的商业价值。
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-8 text-white/70">
                直接指出内容卡在哪里、该先修什么、先发哪里，以及怎么把流量接到可成交的商业动作。
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
                  className="flex min-h-[320px] w-full flex-col items-center justify-center rounded-[24px] border border-dashed border-white/15 bg-white/5 px-6 text-center transition hover:bg-white/10"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ff8a3d] text-black">
                    <Upload className="h-7 w-7" />
                  </div>
                  <div className="mt-5 text-2xl font-bold">上传图文档案或视频素材</div>
                  <p className="mt-3 max-w-md text-sm leading-7 text-white/60">
                    支持 Word、PDF、MP4。上传后会直接帮你找出内容卖点、转化缺口与可放大的商业方向，让分析结果值得你采用。
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
                      {inputKind === "document" ? <FileUp className="h-12 w-12 text-[#ffb37f]" /> : <Film className="h-12 w-12 text-[#ffb37f]" />}
                      <div className="mt-4 text-xl font-bold text-white">
                        {inputKind === "document" ? "文档已就绪" : "视频文件已就绪"}
                      </div>
                      <p className="mt-2 text-sm leading-7 text-white/60">
                        {inputKind === "document"
                          ? "会先提取内容，再输出定位、平台与商业建议。"
                          : "会先抽帧与理解节奏，再输出可直接执行的分析报告。"}
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
                accept=".docx,application/pdf,video/mp4"
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
                  placeholder="例如：我是形象穿搭美妆博主，想知道这支素材能承接什么商业价值，以及该先发哪个平台。"
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
                生成后会只保留和你身份、题材与商业目标高度相关的内容方向，不把无关热点硬塞给你。
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

        {debugMode ? (
          <section className="mt-8 space-y-6">
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
                      <div>周末 / 节假日 live：每 20 分钟抓取一次</div>
                      <div>17:00 - 22:00：每 2 小时抓取一次</div>
                      <div>22:00 - 06:00：每 3 小时抓取一次</div>
                      <div>06:00 - 17:00：每 4 小时抓取一次</div>
                      <div>数据量明显放大：立即切到每 20 分钟一次</div>
                      <div>历史回填 burst：按 30-60 秒真人节奏抖动抓取，目标步长 10，受限时回落到 5</div>
                    </div>
                    {growthSystemStatusQuery.data.scheduler.map((item) => (
                      <div key={String(item.platform)} className="grid gap-1 md:grid-cols-2">
                        <div>{String(item.platform)} last success: {String(item.lastSuccessAt || "-")}</div>
                        <div>{String(item.platform)} next run: {String(item.nextRunAt || "-")}</div>
                        <div>{String(item.platform)} failures: {String(item.failureCount ?? 0)}</div>
                        <div>{String(item.platform)} burst mode: {String(item.burstMode ?? false)}</div>
                        <div>{String(item.platform)} last count: {String(item.lastCollectedCount ?? 0)}</div>
                        <div>{String(item.platform)} burst since: {String(item.burstTriggeredAt || "-")}</div>
                        <div>{String(item.platform)} error: {String(item.lastError || "-")}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {growthSystemStatusQuery.data?.backfill ? (
                  <div className="mt-4 space-y-2 rounded-2xl border border-amber-200/15 bg-black/15 p-4 text-xs text-white/72">
                    <div className="font-semibold text-amber-100">数据仓回填进度</div>
                    <div className="grid gap-1 md:grid-cols-2">
                      <div>status: {String(growthSystemStatusQuery.data.backfill.status || "-")}</div>
                      <div>active: {String(growthSystemStatusQuery.data.backfill.active ?? false)}</div>
                      <div>round: {String(growthSystemStatusQuery.data.backfill.currentRound || 0)} / {String(growthSystemStatusQuery.data.backfill.maxRounds || 0)}</div>
                      <div>target / platform: {String(growthSystemStatusQuery.data.backfill.targetPerPlatform || 0)}</div>
                      <div>window days: {String(growthSystemStatusQuery.data.backfill.selectedWindowDays || "-")}</div>
                      <div>started: {String(growthSystemStatusQuery.data.backfill.startedAt || "-")}</div>
                      <div>updated: {String(growthSystemStatusQuery.data.backfill.updatedAt || "-")}</div>
                      <div>finished: {String(growthSystemStatusQuery.data.backfill.finishedAt || "-")}</div>
                    </div>
                    <div className="rounded-xl border border-amber-200/15 bg-amber-400/5 p-3 leading-6">
                      {String(growthSystemStatusQuery.data.backfill.note || "-")}
                    </div>
                    <div className="space-y-2">
                      {growthSystemStatusQuery.data.backfill.platforms?.map((item) => (
                        <div key={String(item.platform)} className="grid gap-1 md:grid-cols-2">
                          <div>{String(item.platform)} status: {String(item.status || "-")}</div>
                          <div>{String(item.platform)} total: {String(item.currentTotal || 0)} / {String(item.target || 0)}</div>
                          <div>{String(item.platform)} archived: {String(item.archivedTotal || 0)}</div>
                          <div>{String(item.platform)} added: {String(item.addedCount || 0)}</div>
                          <div>{String(item.platform)} merged: {String(item.mergedCount || 0)}</div>
                          <div>{String(item.platform)} plateau: {String(item.plateauCount || 0)}</div>
                          <div className="md:col-span-2">{String(item.platform)} error: {String(item.error || "-")}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
          </section>
        ) : null}

        {analysis ? (
          <section className="mt-8 space-y-6">
            {showPremiumReport ? (
              <div className="space-y-6">
                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#ffcf92]">
                    <Sparkles className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">商业分析总览</h2>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-white/62">
                    先看能不能做、先做哪裡、先修哪一段，再决定后面怎么放大。
                  </p>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {dashboardMetrics.map((item) => (
                      <div key={item.label} className={`rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02)),radial-gradient(circle_at_top_left,var(--tw-gradient-stops))] ${item.tone} p-4`}>
                        <div className="text-xs uppercase tracking-[0.18em] text-white/45">{item.label}</div>
                        <div className="mt-3 text-3xl font-black text-white">{item.value}</div>
                        <p className="mt-3 text-sm leading-6 text-white/62">{item.note}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center justify-between">
                    <div className="text-lg font-bold text-white">五维度成熟度</div>
                    <div className="text-xs text-white/45">满分 100</div>
                  </div>
                  <div className="mt-4 h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={scoreDistributionData} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" horizontal={true} vertical={false} />
                        <XAxis type="number" domain={[0, 100]} tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis dataKey="name" type="category" width={88} tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 12 }} axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={{ background: "#0b1628", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, color: "#fff" }}
                          formatter={(value: number) => [`${value}%`, "成熟度"]}
                        />
                        <Bar dataKey="value" radius={[0, 10, 10, 0]}>
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

            <div className="space-y-6">
              {!showPremiumReport ? (
              <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                <div className="flex items-center gap-3 text-[#ffb37f]">
                  <Sparkles className="h-5 w-5" />
                  <h2 className="text-2xl font-bold">内容分析</h2>
                </div>
                <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black/15">
                  <table className="w-full table-fixed border-collapse text-sm leading-7 text-white/75">
                    <tbody>
                      {contentAnalysisRows.map((row) => (
                        <tr key={row.label} className="border-b border-white/10 last:border-b-0">
                          <td className="w-32 bg-white/5 px-4 py-4 align-top font-semibold text-white">{row.label}</td>
                          <td className="w-[32%] px-4 py-4 align-top whitespace-normal break-words">{row.insight}</td>
                          <td className="w-[34%] px-4 py-4 align-top whitespace-normal break-words text-white/65">{row.action}</td>
                          <td className="w-[22%] px-4 py-4 align-top whitespace-normal break-words text-[#ffd08f]">{row.highlight || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              ) : null}

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
                      {refreshGrowthMutation.isPending ? "刷新中..." : "刷新趋势"}
                    </button>
                  </div>
                  {growthSnapshotQuery.isLoading ? (
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      {[0, 1].map((item) => (
                        <div key={item} className="animate-pulse rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="h-4 w-24 rounded bg-white/10" />
                          <div className="mt-4 h-20 rounded bg-white/5" />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {growthSnapshot ? (
                    <div className="mt-5 space-y-4">
                      <div className="rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-7 text-white/70">
                        <div className="font-semibold text-white">趋势判断</div>
                        <p className="mt-2">{replaceTerms(growthSnapshot.overview.trendNarrative)}</p>
                      </div>
                      {trendRows.length ? (
                        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/15">
                          <table className="w-full border-collapse text-sm leading-7 text-white/75">
                            <tbody>
                              {trendRows.map((row) => (
                                <tr key={`${row.platform}-${row.topic}`} className="border-b border-white/10 last:border-b-0">
                                  <td className="w-28 bg-white/5 px-4 py-4 align-top font-semibold text-white">{row.platform}</td>
                                  <td className="px-4 py-4 text-[#9dd0ff]">{row.topic}</td>
                                  <td className="px-4 py-4">{row.reason}</td>
                                  <td className="px-4 py-4 text-white/65">{row.action}</td>
                                  <td className="px-4 py-4 text-[#ffd08f]">{row.highlight || "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-7 text-white/65">
                          当前没有足够高相关度的话题可直接展示，所以不把无关热词硬塞给用户。
                        </div>
                      )}
                    </div>
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
                    趋势判断、平台建议、商业承接和 7 天计划都属于付费版内容，不在免费版展示范围内。
                  </p>
                </div>
              )}

              {showPremiumReport ? (
                <>
                  <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,138,61,0.12),rgba(255,255,255,0.03))] p-6">
                    <div className="flex items-center gap-3 text-[#ffd08f]">
                      <Rocket className="h-5 w-5" />
                      <h2 className="text-2xl font-bold">创作执行简报</h2>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-white/60">先看这部分。这里是你这一条内容最该立刻执行的判断和改法。</p>
                    <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/15">
                      <table className="w-full table-fixed border-collapse text-sm leading-7 text-white/72">
                        <tbody>
                          {executionBriefRows.map((row) => (
                            <tr key={row.label} className="border-b border-white/10 last:border-b-0">
                              <td className="w-40 bg-white/5 px-4 py-4 align-top font-semibold text-white">{row.label}</td>
                              <td className="px-4 py-4 whitespace-pre-wrap break-words">{row.content}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                    <div className="flex items-center gap-3 text-[#9df6c0]">
                      <LineChartIcon className="h-5 w-5" />
                      <div>
                        <h2 className="text-2xl font-bold">7 天增长规划</h2>
                        <div className="mt-1 text-sm text-white/55">短期执行方案，目标是在 7 天内先把第一轮结果跑出来。</div>
                      </div>
                    </div>
                    <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black/15">
                      <table className="w-full border-collapse text-sm leading-7 text-white/75">
                        <tbody>
                          {growthPlan.map((item) => (
                            <tr key={item.day} className="border-b border-white/10 last:border-b-0">
                              <td className="w-24 bg-white/5 px-4 py-4 align-top font-semibold text-[#9df6c0]">Day {item.day}</td>
                              <td className="w-40 px-4 py-4 font-semibold text-white">{item.title}</td>
                              <td className="px-4 py-4">{item.action}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4">
                      <a
                        href="/storyboard?supervisor=1"
                        onClick={() => handleStoreHandoff(growthHandoff, "handoff 已写入本地，可交给 storyboard")}
                        className="block rounded-2xl border border-[#ff8a3d]/20 bg-[#ff8a3d]/10 px-4 py-3 text-sm font-semibold text-[#ffd4b7] transition hover:bg-[#ff8a3d]/15"
                      >
                        进入分镜创作
                      </a>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                    <div className="flex items-center gap-3 text-[#ffd08f]">
                      <Send className="h-5 w-5" />
                      <h2 className="text-2xl font-bold">推荐发布平台</h2>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-white/60">当前只围绕首发平台展开，不再把多个平台方案混在一起。</p>
                    <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black/15">
                      <table className="w-full table-fixed border-collapse text-sm leading-7 text-white/75">
                        <tbody>
                          {platformRecommendationRows.map((row) => (
                            <tr key={row.label} className="border-b border-white/10 last:border-b-0">
                              <td className="w-28 bg-white/5 px-4 py-4 align-top font-semibold text-white">{row.label}</td>
                              <td className="w-[32%] px-4 py-4 align-top whitespace-normal break-words">{row.insight}</td>
                              <td className="w-[34%] px-4 py-4 align-top whitespace-normal break-words text-white/65">{row.action}</td>
                              <td className="w-[22%] px-4 py-4 align-top whitespace-normal break-words text-[#ffd08f]">{row.highlight || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : null}

              {showPremiumReport ? (
                <>
                  <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                    <div className="flex items-center gap-3 text-[#ffcf92]">
                      <Compass className="h-5 w-5" />
                      <h2 className="text-2xl font-bold">内容定位</h2>
                    </div>
                    <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black/15">
                      <table className="w-full table-fixed border-collapse text-sm leading-7 text-white/75">
                        <tbody>
                          {positioningRows.map((row) => (
                            <tr key={row.label} className="border-b border-white/10 last:border-b-0">
                              <td className="w-32 bg-white/5 px-4 py-4 align-top font-semibold text-white">{row.label}</td>
                              <td className="w-[32%] px-4 py-4 align-top whitespace-normal break-words">{row.insight}</td>
                              <td className="w-[34%] px-4 py-4 align-top whitespace-normal break-words text-white/65">{row.action}</td>
                              <td className="w-[22%] px-4 py-4 align-top whitespace-normal break-words text-[#ffd08f]">{row.highlight || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                    <div className="flex items-center gap-3 text-[#ffb37f]">
                      <Sparkles className="h-5 w-5" />
                      <h2 className="text-2xl font-bold">内容分析</h2>
                    </div>
                    <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black/15">
                      <table className="w-full table-fixed border-collapse text-sm leading-7 text-white/75">
                        <tbody>
                          {contentAnalysisRows.map((row) => (
                            <tr key={row.label} className="border-b border-white/10 last:border-b-0">
                              <td className="w-32 bg-white/5 px-4 py-4 align-top font-semibold text-white">{row.label}</td>
                              <td className="w-[32%] px-4 py-4 align-top whitespace-normal break-words">{row.insight}</td>
                              <td className="w-[34%] px-4 py-4 align-top whitespace-normal break-words text-white/65">{row.action}</td>
                              <td className="w-[22%] px-4 py-4 align-top whitespace-normal break-words text-[#ffd08f]">{row.highlight || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                    <div className="flex items-center gap-3 text-[#f5b7ff]">
                      <BriefcaseBusiness className="h-5 w-5" />
                      <div>
                        <h2 className="text-2xl font-bold">商业洞察</h2>
                        <div className="mt-1 text-sm text-white/55">中长期发展方案，不和 7 天短期执行混在一起。</div>
                      </div>
                    </div>
                    <div className="mt-5 space-y-4">
                      {businessInsights.map((item) => (
                        <div key={item.title} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="text-sm font-semibold text-white">{item.title}</div>
                          <p className="mt-2 text-sm leading-7 text-white/70">{replaceTerms(item.detail)}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black/15">
                      <table className="w-full table-fixed border-collapse text-sm leading-7 text-white/75">
                        <tbody>
                          {businessTrackRows.map((row) => (
                            <tr key={row.label} className="border-b border-white/10 last:border-b-0">
                              <td className="w-36 bg-white/5 px-4 py-4 align-top font-semibold text-white">{row.label}</td>
                              <td className="w-[32%] px-4 py-4 align-top whitespace-normal break-words">{row.insight}</td>
                              <td className="w-[34%] px-4 py-4 align-top whitespace-normal break-words text-white/65">{row.action}</td>
                              <td className="w-[18%] px-4 py-4 align-top whitespace-normal break-words text-[#f5b7ff]">{row.highlight || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
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
