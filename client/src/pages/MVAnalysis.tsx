import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { UsageQuotaBanner } from "@/components/UsageQuotaBanner";
import { StudentUpgradePrompt } from "@/components/StudentUpgradePrompt";
import { TrialCountdownBanner } from "@/components/TrialCountdownBanner";
import { QuotaExhaustedModal } from "@/components/QuotaExhaustedModal";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  Compass,
  FileUp,
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

type PlatformRecommendation = {
  name: string;
  reason: string;
  action: string;
};

function getScoreTone(score: number) {
  if (score >= 80) return { label: "强", color: "text-emerald-300", chip: "border-emerald-300/20 bg-emerald-400/10 text-emerald-200" };
  if (score >= 65) return { label: "可放大", color: "text-amber-200", chip: "border-amber-300/20 bg-amber-400/10 text-amber-100" };
  return { label: "需重构", color: "text-rose-200", chip: "border-rose-300/20 bg-rose-400/10 text-rose-100" };
}

function buildPlatformRecommendations(platforms: string[], context: string, analysis: AnalysisResult): PlatformRecommendation[] {
  const normalized = (platforms || []).slice(0, 3);
  if (!normalized.length) {
    return [
      { name: "抖音", reason: "适合验证强开头和短时高冲击内容。", action: "先做 15 秒钩子版，主打前三秒情绪抓取。" },
      { name: "小红书", reason: "适合做审美、风格、生活方式类包装。", action: "补上封面标题和亮点拆解，强调收藏价值。" },
    ];
  }
  return normalized.map((platform, index) => {
    if (/抖音/i.test(platform)) {
      return {
        name: platform,
        reason: analysis.impact >= 70 ? "当前画面冲击力不错，适合快速分发与测试转化。" : "需要更强的开场刺激，但分发效率最高。",
        action: index === 0 ? "先发 9:16 短切版，前 2 秒直接给冲突点或结果。" : "追加对比封面和强钩子标题再发。",
      };
    }
    if (/小红书/i.test(platform)) {
      return {
        name: platform,
        reason: "更适合做风格包装、攻略感和审美表达。",
        action: "补一段“创作思路 / 场景拆解”，提高收藏与转发意图。",
      };
    }
    if (/B站|bilibili/i.test(platform)) {
      return {
        name: platform,
        reason: "适合发布完整叙事、幕后拆解和创作过程。",
        action: "增加创作解说版或过程版，拉高完播和评论讨论。",
      };
    }
    return {
      name: platform,
      reason: "适合作为次分发渠道，验证不同标题和封面策略。",
      action: "做一版平台适配文案，保留核心卖点但重写 opening。",
    };
  });
}

function buildBusinessInsights(analysis: AnalysisResult, context: string) {
  const monetization = analysis.viralPotential >= 75
    ? "内容已经具备较强传播底子，下一步应该把流量导向可复制的服务、课程、案例库或接单能力。"
    : "目前更适合先把内容结构做稳，再用明确的 CTA 把观众引向咨询、社群或私域留资。";
  const packaging = analysis.color + analysis.composition >= 145
    ? "视觉包装是优势，可以优先做品牌系列化栏目。"
    : "视觉统一性还不够，建议先固定封面模板、标题句式和片头格式。";
  const offer = context.trim()
    ? `你补充的背景里提到「${context.trim().slice(0, 36)}${context.trim().length > 36 ? "..." : ""}」，这很适合转成可售卖的内容主题或服务说明。`
    : "建议从“案例拆解 / 模板交付 / 陪跑服务”三种轻商业化入口里先选一个验证。";
  return [monetization, packaging, offer];
}

function buildGrowthPlan(analysis: AnalysisResult, platforms: PlatformRecommendation[]) {
  const topPlatform = platforms[0]?.name || "抖音";
  return [
    "Day 1: 重新定义这条内容的单一目标，只保留一个最强卖点，并重写开头 3 秒。",
    "Day 2: 基于当前画面生成 2 个封面版本和 2 个标题版本，准备 A/B 测试。",
    `Day 3: 先在 ${topPlatform} 发第一版，重点观察停留、完播和评论关键词。`,
    "Day 4: 根据反馈重写中段节奏，把弱镜头删掉，强化转折点。",
    "Day 5: 补一版“幕后 / 拆解 / 教学”内容，让单条内容变成内容矩阵。",
    "Day 6: 将表现最好的表达方式整理成模板，开始做系列化发布。",
    analysis.viralPotential >= 75
      ? "Day 7: 加入明确商业转化动作，比如咨询入口、服务介绍、预约表单。"
      : "Day 7: 复盘数据，确认下一轮要优先优化的是开头冲击力还是画面统一性。",
  ];
}

export default function MVAnalysisPage() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading } = useAuth();

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
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
  const checkAccessMutation = trpc.usage.checkFeatureAccess.useMutation();
  const usageStatsQuery = trpc.usage.getUsageStats.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
    refetchOnMount: true,
  });

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/login");
  }, [loading, isAuthenticated, navigate]);

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
    if (!isImage && !isVideo) {
      setError("请上传图片或视频文件（JPG、PNG、MP4）");
      return;
    }

    setFileName(file.name);
    setFileSize(file.size);
    setUploadStage("reading");
    setUploadProgress(0);
    setError(null);
    setAnalysis(null);

    const sizeMB = file.size / (1024 * 1024);
    setEstimatedTime(Math.max(10, Math.round(sizeMB * 2 + 15)));

    if (isImage) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setSelectedImage(dataUrl);
        setImageBase64(dataUrl.split(",")[1]);
        setUploadStage("idle");
        setUploadProgress(100);
      };
      reader.readAsDataURL(file);
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
        setError("视频读取失败，请尝试上传图片截屏");
        setUploadStage("error");
        return;
      }
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      setSelectedImage(dataUrl);
      setImageBase64(dataUrl.split(",")[1]);
      setUploadStage("idle");
      setUploadProgress(100);
      URL.revokeObjectURL(url);
    };
    video.onerror = () => {
      setError("视频读取失败，请尝试上传图片截屏");
      setUploadStage("error");
      URL.revokeObjectURL(url);
    };
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!imageBase64) return;

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

    setUploadStage("uploading");
    setUploadProgress(0);
    setError(null);
    setElapsedTime(0);
    setEstimatedTime(Math.max(12, Math.round(fileSize / (1024 * 1024) * 1.5 + 12)));

    try {
      const result = await analyzeMutation.mutateAsync({
        imageBase64,
        mimeType: "image/jpeg",
        context: context || undefined,
      });
      setAnalysis(result.analysis);
      setUploadProgress(100);
      setUploadStage("done");
      usageStatsQuery.refetch();
    } catch (analysisError: any) {
      setError(analysisError.message || "分析失败，请稍后再试");
      setUploadStage("error");
    }
  }, [imageBase64, checkAccessMutation, fileSize, analyzeMutation, context, usageStatsQuery]);

  const handleReset = useCallback(() => {
    setSelectedImage(null);
    setImageBase64(null);
    setAnalysis(null);
    setError(null);
    setContext("");
    setUploadStage("idle");
    setUploadProgress(0);
    setElapsedTime(0);
    setFileName("");
    setFileSize(0);
  }, []);

  const isProcessing = uploadStage === "uploading" || uploadStage === "analyzing";
  const remainingTime = Math.max(0, estimatedTime - elapsedTime);

  const platformRecommendations = useMemo(
    () => analysis ? buildPlatformRecommendations(analysis.platforms, context, analysis) : [],
    [analysis, context],
  );
  const businessInsights = useMemo(
    () => analysis ? buildBusinessInsights(analysis, context) : [],
    [analysis, context],
  );
  const growthPlan = useMemo(
    () => analysis ? buildGrowthPlan(analysis, platformRecommendations) : [],
    [analysis, platformRecommendations],
  );

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#08111f] text-[#f7f4ef]">
        <Loader2 className="h-8 w-8 animate-spin text-[#ff8a3d]" />
        <span className="mt-4 text-white/60">检查登录状态...</span>
      </div>
    );
  }

  if (!isAuthenticated) return null;

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
          <div className="rounded-full border border-[#ff8a3d]/30 bg-[#ff8a3d]/10 px-3 py-1 text-sm text-[#ffb37f]">
            Creator Growth Camp MVP
          </div>
        </div>

        <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(255,138,61,0.2),transparent_28%),radial-gradient(circle_at_top_right,rgba(38,132,255,0.15),transparent_24%),linear-gradient(180deg,#101d31_0%,#08111f_72%)] p-6 md:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/55">
                <Sparkles className="h-3.5 w-3.5" />
                创作商业成長營
              </div>
              <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight text-white md:text-6xl">
                不只分析一帧画面，而是给你一份可执行的内容增长与商业化报告。
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-8 text-white/70">
                这一版先复用现有视觉分析能力，输出内容结构分析、趋势洞察、商业潜力判断、推荐发布平台和 7 天增长规划。
                后续会继续接入 30 天平台趋势资料与热门内容结构数据库。
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">内容分析</div>
                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">趋势洞察</div>
                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">商业洞察</div>
                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">7 天增长规划</div>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-black/20 p-5 backdrop-blur-sm">
              {!selectedImage ? (
                <button
                  onClick={handleSelectFile}
                  className="flex min-h-[360px] w-full flex-col items-center justify-center rounded-[24px] border border-dashed border-white/15 bg-white/5 px-6 text-center transition hover:bg-white/10"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ff8a3d] text-black">
                    <Upload className="h-7 w-7" />
                  </div>
                  <div className="mt-5 text-2xl font-bold">上传图片或视频封面</div>
                  <p className="mt-3 max-w-md text-sm leading-7 text-white/60">
                    先上传一张画面，我们会用它生成“创作商业成長營”的首版诊断报告。支持 JPG、PNG、MP4。
                  </p>
                </button>
              ) : (
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/30">
                    <img src={selectedImage} alt="Selected" className="max-h-[360px] w-full object-cover" />
                  </div>
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
                accept="image/*,video/*"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="mt-5">
                <label className="mb-2 block text-sm font-semibold text-white/80">
                  业务背景 / 内容目标
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
                  disabled={!imageBase64 || isProcessing}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#ff8a3d] px-5 py-3 font-bold text-black transition hover:bg-[#ff9c5c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  开始生成成长报告
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
            <div className="grid gap-4 md:grid-cols-5">
              {[
                { label: "构图结构", value: analysis.composition },
                { label: "色彩识别", value: analysis.color },
                { label: "光线氛围", value: analysis.lighting },
                { label: "冲击强度", value: analysis.impact },
                { label: "增长潜力", value: analysis.viralPotential },
              ].map((item) => {
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
                    <h2 className="text-2xl font-bold">内容结构分析</h2>
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
                  <div className="flex items-center gap-3 text-[#90c4ff]">
                    <TrendingUp className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">趋势洞察</h2>
                  </div>
                  <div className="mt-5 grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                      <div className="text-sm font-semibold text-white">30 天平台动向</div>
                      <p className="mt-3 text-sm leading-7 text-white/65">
                        趋势数据库接入中。当前先建议你观察近 30 天同题材内容里的开头结构、标题句式和互动问题设置。
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                      <div className="text-sm font-semibold text-white">热点结构模板</div>
                      <p className="mt-3 text-sm leading-7 text-white/65">
                        你这条内容更适合靠「{analysis.impact >= 70 ? "强开头 + 快节奏推进" : "清晰信息架构 + 结果前置"}」去对齐热门结构。
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                      <div className="text-sm font-semibold text-white">后续扩展接口</div>
                      <p className="mt-3 text-sm leading-7 text-white/65">
                        后面这里会接入平台趋势资料、热门内容结构数据库和 AI 创作辅助联动。
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#f5b7ff]">
                    <BriefcaseBusiness className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">商业洞察</h2>
                  </div>
                  <div className="mt-5 space-y-3">
                    {businessInsights.map((item, index) => (
                      <div key={index} className="rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-7 text-white/70">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#ffd08f]">
                    <Send className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">推荐发布平台</h2>
                  </div>
                  <div className="mt-5 space-y-4">
                    {platformRecommendations.map((platform) => (
                      <div key={platform.name} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                        <div className="text-lg font-bold text-white">{platform.name}</div>
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
                  <div className="mt-5 space-y-3">
                    {growthPlan.map((item, index) => (
                      <div key={index} className="rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-7 text-white/70">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,138,61,0.12),rgba(255,255,255,0.03))] p-6">
                  <div className="text-sm uppercase tracking-[0.22em] text-white/45">Expansion Hooks</div>
                  <div className="mt-4 space-y-3 text-sm leading-7 text-white/70">
                    <div>• 平台趋势资料：等待 30 天快照数据接入。</div>
                    <div>• 热门内容结构数据库：等待结构标签和案例数据接入。</div>
                    <div>• 商业模式推荐引擎：后续会把内容类型映射到服务、课程、社群和品牌合作。</div>
                    <div>• AI 创作辅助联动：下一版可直接把建议同步到 workflow / storyboard。</div>
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
