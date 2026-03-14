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
  LineChart,
  Loader2,
  Rocket,
  Send,
  Sparkles,
  TrendingUp,
  Upload,
} from "lucide-react";
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

const SUPERVISOR_ACCESS_KEY = "mvs-supervisor-access";
const GROWTH_HANDOFF_STORAGE_KEY = "mvsp-growth-handoff";

function hasSupervisorAccess() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("supervisor") === "1") {
    localStorage.setItem(SUPERVISOR_ACCESS_KEY, "1");
    return true;
  }
  return localStorage.getItem(SUPERVISOR_ACCESS_KEY) === "1";
}

function persistGrowthHandoff(handoff: GrowthHandoff | null) {
  if (!handoff || typeof window === "undefined") return;
  localStorage.setItem(
    GROWTH_HANDOFF_STORAGE_KEY,
    JSON.stringify({
      ...handoff,
      source: "creator-growth-camp",
      savedAt: new Date().toISOString(),
    }),
  );
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const analyzeMutation = trpc.mvAnalysis.analyzeFrame.useMutation();
  const analyzeDocumentMutation = trpc.mvAnalysis.analyzeDocument.useMutation();
  const analyzeVideoMutation = trpc.mvAnalysis.analyzeVideo.useMutation();
  const checkAccessMutation = trpc.usage.checkFeatureAccess.useMutation();
  const refreshGrowthMutation = trpc.mvAnalysis.refreshGrowthTrends.useMutation();
  const growthSnapshotQuery = trpc.mvAnalysis.getGrowthSnapshot.useQuery(
    {
      context: context || undefined,
      requestedPlatforms: analysis?.platforms || [],
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
      enabled: Boolean(analysis),
      staleTime: 60_000,
    },
  );
  const usageStatsQuery = trpc.usage.getUsageStats.useQuery(undefined, {
    enabled: isAuthenticated && !loading && !supervisorAccess,
    refetchOnMount: true,
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
      setAnalysis(result.analysis);
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
    setUploadStage("idle");
    setUploadProgress(0);
    setElapsedTime(0);
    setFileName("");
    setFileSize(0);
  }, []);

  const handleRefreshGrowth = useCallback(async () => {
    try {
      await refreshGrowthMutation.mutateAsync({
        platforms: ["douyin", "xiaohongshu", "bilibili"],
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
    persistGrowthHandoff(handoff);
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
  const strategyPillars = useMemo(
    () => analysis ? buildStrategyPillars(analysis, platformRecommendations, commercialTracks) : [],
    [analysis, platformRecommendations, commercialTracks],
  );

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
            <div className="grid gap-4 lg:grid-cols-3">
              {strategyPillars.map((item) => (
                <div key={item.title} className="rounded-[24px] border border-white/10 bg-[#0f1a2c] p-5">
                  <div className={`text-sm font-semibold ${item.accent}`}>{item.title}</div>
                  <p className="mt-3 text-sm leading-7 text-white/68">{item.description}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-5">
              {scoreItems.map((item) => {
                const tone = getScoreTone(item.value);
                return (
                  <div key={item.label} className="rounded-[24px] border border-white/10 bg-[#0f1a2c] p-5">
                    <div className="text-sm text-white/55">{item.label}</div>
                    <div className={`mt-4 text-4xl font-black ${tone.color}`}>{item.value}</div>
                    <div className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs ${tone.chip}`}>{tone.label}</div>
                  </div>
                );
              })}
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-6">
                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#ffb37f]">
                    <Sparkles className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">内容分析</h2>
                  </div>
                  <p className="mt-4 text-base leading-8 text-white/70">{analysis.summary}</p>
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
                          source: {growthSnapshot.status.source}
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                          freshness: {growthSnapshot.status.freshnessLabel}
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                          window: {growthSnapshot.status.windowDays} 天
                        </div>
                      </div>
                      <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-7 text-white/70">
                        <div className="font-semibold text-white">趋势摘要</div>
                        <p className="mt-2">{growthSnapshot.overview.trendNarrative}</p>
                        <p className="mt-2 text-white/55">{growthSnapshot.overview.nextCollectionPlan}</p>
                      </div>
                      <div className="mt-5 grid gap-4 md:grid-cols-3">
                        {growthSnapshot.platformSnapshots.map((platform) => (
                          <div key={platform.platform} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold text-white">{platform.displayName}</div>
                              <div className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70">
                                {platform.fitLabel}
                              </div>
                            </div>
                            <p className="mt-3 text-sm leading-7 text-white/65">{platform.summary}</p>
                            <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-white/70">
                              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <div className="text-white/45">热度动量</div>
                                <div className="mt-1 text-xl font-bold text-white">{platform.momentumScore}</div>
                              </div>
                              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <div className="text-white/45">受众适配</div>
                                <div className="mt-1 text-xl font-bold text-white">{platform.audienceFitScore}</div>
                              </div>
                            </div>
                            <div className="mt-4 text-xs leading-6 text-white/60">
                              <div>近 30 天样本：{platform.last30d.postsAnalyzed} 条 / {platform.last30d.creatorsTracked} 位创作者</div>
                              <div>中位互动率：{platform.last30d.engagementRateMedian}%</div>
                              <div>增长率：{platform.last30d.growthRate}%</div>
                              <div>推荐时长：{platform.last30d.topDurationRange}</div>
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
                              商业提示：{pattern.monetizationHint}
                          </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 grid gap-4 md:grid-cols-3">
                        {growthSnapshot.structurePatterns.map((pattern) => (
                          <div key={pattern.id} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                            <div className="text-sm font-semibold text-white">{pattern.title}</div>
                            <p className="mt-3 text-sm leading-7 text-white/65">{pattern.angle}</p>
                            <div className="mt-3 rounded-xl border border-[#90c4ff]/15 bg-[#90c4ff]/10 p-3 text-sm text-[#d5e8ff]">
                              钩子：{pattern.hook}
                            </div>
                            <div className="mt-3 text-sm leading-7 text-white/60">CTA：{pattern.cta}</div>
                            <div className="mt-2 text-xs text-white/40">依据：{pattern.evidence}</div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        {growthSnapshot.opportunities.map((item) => (
                          <div key={item.id} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                            <div className="text-sm font-semibold text-white">{item.title}</div>
                            <p className="mt-3 text-sm leading-7 text-white/65">{item.whyNow}</p>
                            <div className="mt-3 rounded-xl border border-[#ff8a3d]/20 bg-[#ff8a3d]/10 p-3 text-sm text-[#ffd4b7]">
                              下一步：{item.nextAction}
                            </div>
                          </div>
                        ))}
                      </div>
                      {growthSnapshot.status.notes.length ? (
                        <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-7 text-white/60">
                          {growthSnapshot.status.notes.map((note, index) => (
                            <div key={index}>• {note}</div>
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

                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#f5b7ff]">
                    <BriefcaseBusiness className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">商业洞察</h2>
                  </div>
                  <div className="mt-5 space-y-3">
                    {businessInsights.map((item) => (
                      <GrowthSectionCard
                        key={item.title}
                        title={item.title}
                        description={item.detail}
                      />
                    ))}
                  </div>
                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    {commercialTracks.map((track) => {
                      const tone = getScoreTone(track.fit);
                      return (
                        <div key={track.name} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-white">{track.name}</div>
                            <div className={`rounded-full border px-3 py-1 text-xs ${tone.chip}`}>匹配度 {track.fit}</div>
                          </div>
                          <p className="mt-3 text-sm leading-7 text-white/65">{track.reason}</p>
                          <div className="mt-3 rounded-xl border border-[#f5b7ff]/15 bg-[#f5b7ff]/10 p-3 text-sm text-[#fbe1ff]">
                            第一动作：{track.nextStep}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

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
                    <LineChart className="h-5 w-5" />
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
                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-4">
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-white/70">{creationAssistBrief}</pre>
                  </div>
                  <GrowthHandoffActions
                    handoff={growthHandoff}
                    growthPlan={growthPlan}
                    fallbackBrief={creationAssistBrief}
                    onCopyText={handleCopyText}
                    onStoreHandoff={handleStoreHandoff}
                  />
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
