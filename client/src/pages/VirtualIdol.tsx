// @ts-nocheck
import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { ExpiryWarningBanner, CreationHistoryPanel, FavoriteButton } from "@/components/CreationManager";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { JOB_PROGRESS_MESSAGES, createJob, getJob } from "@/lib/jobs";
import { UsageQuotaBanner } from "@/components/UsageQuotaBanner";
import { StudentUpgradePrompt } from "@/components/StudentUpgradePrompt";
import { TrialCountdownBanner } from "@/components/TrialCountdownBanner";
import { QuotaExhaustedModal } from "@/components/QuotaExhaustedModal";
import { NbpEngineSelector, type EngineOption } from "@/components/NbpEngineSelector";
import { ModelViewer } from "@/components/ModelViewer";
import { toast } from "sonner";
import { Loader2, Upload, X, Bot, Sparkles, Wand2, ChevronDown, ChevronUp, Download, Check, Copy, RefreshCw, Eye, EyeOff, Palette, User, Users, Zap, Crown, Flame, Star } from "lucide-react";

// ─── TapNow-inspired glassmorphism utilities ───
const glassCard = "relative bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl overflow-hidden";
const glassCardHover = "hover:bg-white/[0.06] hover:border-white/[0.15] transition-all duration-300";
const gradientText = "bg-clip-text text-transparent bg-gradient-to-r";
const sectionTitle = "text-lg font-bold tracking-tight text-white/90";

type StyleOption = { id: string; label: string; icon: React.ElementType; gradient: string; desc: string };
type GenderOption = { id: string; label: string; icon: React.ElementType };

const STYLES: StyleOption[] = [
  { id: "anime", label: "动漫风", icon: Sparkles, gradient: "from-rose-500 to-pink-600", desc: "日系动漫角色设计，细腻线条与鲜艳色彩" },
  { id: "realistic", label: "真人风", icon: Crown, gradient: "from-cyan-400 to-blue-600", desc: "极度真人・摄影级品质，超写实渲染" },
  { id: "chibi", label: "Q版萌系", icon: Star, gradient: "from-amber-400 to-yellow-500", desc: "可爱 Q 版造型，大眼萌系风格" },
  { id: "cyberpunk", label: "赛博庞克", icon: Zap, gradient: "from-purple-500 to-fuchsia-600", desc: "未来科技风格，霓虹光影" },
  { id: "fantasy", label: "奇幻风", icon: Flame, gradient: "from-emerald-400 to-teal-600", desc: "魔幻梦境风格，奇幻世界观" },
];

const GENDERS: GenderOption[] = [
  { id: "female", label: "女性", icon: User },
  { id: "male", label: "男性", icon: User },
  { id: "neutral", label: "中性", icon: Users },
];

export default function VirtualIdol() {
  const [location, navigate] = useLocation();
  const { isAuthenticated, loading, user } = useAuth();

  const [selectedStyle, setSelectedStyle] = useState<string>("anime");
  const [selectedGender, setSelectedGender] = useState<string>("female");
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generationJobId, setGenerationJobId] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string>(JOB_PROGRESS_MESSAGES.image[0]);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ imageUrl: string; style: string; gender: string }>>([]);

  const [imageEngine, setImageEngine] = useState<EngineOption>("forge");

  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [uploadingRef, setUploadingRef] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generationPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [show3DPanel, setShow3DPanel] = useState(false);
  const [converting3D, setConverting3D] = useState(false);
  const [image3D, setImage3D] = useState<string | null>(null);
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [mode3D, setMode3D] = useState<string | null>(null);
  const [timeTaken3D, setTimeTaken3D] = useState<number>(0);
  const [enablePbr, setEnablePbr] = useState(true);
  const [error3D, setError3D] = useState<string | null>(null);
  const [textureUrl3D, setTextureUrl3D] = useState<string | null>(null);
  const [thumbnailUrl3D, setThumbnailUrl3D] = useState<string | null>(null);
  const [quotaModalVisible, setQuotaModalVisible] = useState(false);
  const [quotaModalInfo, setQuotaModalInfo] = useState<{ isTrial?: boolean; planName?: string }>({});

  const convert3DMutation = trpc.virtualIdol.convertTo3D.useMutation();
  const checkAccessMutation = trpc.usage.checkFeatureAccess.useMutation();
  const uploadScreenshotMutation = trpc.paymentSubmission.uploadScreenshot.useMutation();
  const usageStatsQuery = trpc.usage.getUsageStats.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
    refetchOnMount: true,
  });
  const subQuery = trpc.stripe.getSubscription.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
  });
  const userPlan = (subQuery.data?.plan || "free") as string;
  const userCredits = subQuery.data?.credits?.balance ?? 0;

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      setReferenceImage(base64);
      setReferenceImageUrl(null);
      setUploadingRef(true);
      try {
        const uploadResult = await uploadScreenshotMutation.mutateAsync({
          imageBase64: base64.split(',')[1],
          mimeType: file.type,
        });
        setReferenceImageUrl(uploadResult.url);
      } catch (err: any) {
        toast.error("上传失败", { description: err.message || "参考图上传失败，请重试" });
        setReferenceImage(null);
      } finally {
        setUploadingRef(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const pickReferenceImage = useCallback(() => { fileInputRef.current?.click(); }, []);
  const removeReferenceImage = useCallback(() => {
    setReferenceImage(null);
    setReferenceImageUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const startGenerationPolling = useCallback((jobId: string) => {
    if (generationPollingRef.current) {
      clearInterval(generationPollingRef.current);
      generationPollingRef.current = null;
    }
    let attempts = 0;
    setProgressMessage(JOB_PROGRESS_MESSAGES.image[0]);

    generationPollingRef.current = setInterval(async () => {
      attempts++;
      const index = Math.floor(attempts / 2) % JOB_PROGRESS_MESSAGES.image.length;
      setProgressMessage(JOB_PROGRESS_MESSAGES.image[index]);

      try {
        const job = await getJob(jobId);
        if (job.status === "succeeded") {
          if (generationPollingRef.current) {
            clearInterval(generationPollingRef.current);
            generationPollingRef.current = null;
          }
          setGenerationJobId(null);
          const imageUrl = (job.output as any)?.imageUrl as string | undefined;
          if (imageUrl) {
            setGeneratedImage(imageUrl);
            setHistory(prev => [{ imageUrl, style: selectedStyle, gender: selectedGender }, ...prev].slice(0, 6));
            usageStatsQuery.refetch();
          } else {
            setError("生成完成但未返回图片，请重试。");
          }
          setGenerating(false);
        } else if (job.status === "failed") {
          if (generationPollingRef.current) {
            clearInterval(generationPollingRef.current);
            generationPollingRef.current = null;
          }
          setGenerationJobId(null);
          setGenerating(false);
          setError("这次生成没有成功，请点击重试。");
        }
      } catch {
        // Ignore single polling failures.
      }
    }, 1800);
  }, [selectedStyle, selectedGender, usageStatsQuery]);

  const handleGenerate = useCallback(async () => {
    try {
      const accessCheck = await checkAccessMutation.mutateAsync({ featureType: "avatar" });
      if (!accessCheck.allowed) {
        setQuotaModalInfo({ isTrial: (accessCheck as any).isTrial, planName: (accessCheck as any).planName });
        setQuotaModalVisible(true);
        return;
      }
    } catch (error: any) {
      toast.error("错误", { description: error.message || "无法检查使用权限" });
      return;
    }
    if (referenceImage && !referenceImageUrl && uploadingRef) {
      toast.info("请稍候", { description: "参考图正在上传中，请等待上传完成后再生成" });
      return;
    }
    if (!user?.id) {
      setError("登录状态已失效，请重新登录后再试。");
      return;
    }
    setGenerating(true);
    setGenerationJobId(null);
    setProgressMessage(JOB_PROGRESS_MESSAGES.image[0]);
    setError(null);
    setGeneratedImage(null);
    setShow3DPanel(false);
    setImage3D(null);
    const qualityMap: Record<string, "free" | "2k" | "4k" | "kling_1k" | "kling_2k"> = {
      forge: "free", nbp_2k: "2k", nbp_4k: "4k", kling_1k: "kling_1k", kling_2k: "kling_2k",
    };
    const quality = qualityMap[imageEngine] || "free";
    try {
      const { jobId } = await createJob({
        type: "image",
        userId: String(user.id),
        input: {
          action: "virtual_idol",
          params: {
            style: selectedStyle,
            gender: selectedGender,
            description: description || undefined,
            referenceImageUrl: referenceImageUrl || undefined,
            quality,
          },
        },
      });
      setGenerationJobId(jobId);
      startGenerationPolling(jobId);
    } catch (err: any) {
      setGenerationJobId(null);
      setGenerating(false);
      setError("任务提交失败，请稍后重试。");
    }
  }, [selectedStyle, selectedGender, description, checkAccessMutation, navigate, usageStatsQuery, referenceImageUrl, referenceImage, uploadingRef, imageEngine, user?.id, startGenerationPolling]);

  const handleConvertTo3D = useCallback(async () => {
    if (!generatedImage) return;
    setConverting3D(true);
    setError3D(null);
    setImage3D(null);
    setGlbUrl(null);
    setObjUrl(null);
    setMode3D(null);
    setTimeTaken3D(0);
    try {
      const result = await convert3DMutation.mutateAsync({ imageUrl: generatedImage, enablePbr });
      setImage3D(result.imageUrl3D);
      setGlbUrl(result.glbUrl ?? null);
      setObjUrl(result.objUrl ?? null);
      setMode3D(result.mode);
      setTimeTaken3D(result.timeTaken ?? 0);
      setTextureUrl3D((result as any).textureUrl ?? null);
      setThumbnailUrl3D((result as any).thumbnailUrl ?? null);
    } catch (err: any) {
      if (err.message?.includes("仅限专业版")) {
        toast.error("需要升级", {
          description: "偶像转 3D 功能仅限专业版以上用户使用。升级后可享受 3D 转换，每次消耗 30 Credits。",
          action: { label: "立即升级", onClick: () => navigate("/pricing") },
        });
      } else {
        setError3D(err.message || "3D 转换失败，请稍后再试");
      }
    } finally {
      setConverting3D(false);
    }
  }, [generatedImage, enablePbr, convert3DMutation, navigate]);

  const currentStyleInfo = useMemo(() => STYLES.find(s => s.id === selectedStyle), [selectedStyle]);

  useEffect(() => {
    return () => {
      if (generationPollingRef.current) {
        clearInterval(generationPollingRef.current);
        generationPollingRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/login");
  }, [loading, isAuthenticated, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#08080A] flex flex-col items-center justify-center">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 rounded-full blur-2xl animate-pulse" />
          <Loader2 className="h-12 w-12 animate-spin text-white/60 relative" />
        </div>
        <p className="mt-6 text-white/40 text-sm tracking-wide">检查登录状态...</p>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-[#08080A] text-white/90">
      {/* Ambient background glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-gradient-to-br from-cyan-500/[0.04] to-purple-500/[0.02] rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-gradient-to-br from-rose-500/[0.03] to-amber-500/[0.02] rounded-full blur-[100px]" />
      </div>

      <div className="relative overflow-y-auto p-4 md:p-6 lg:p-8">
        <UsageQuotaBanner
          featureType="avatar"
          currentCount={usageStatsQuery.data?.features.avatar.currentCount ?? 0}
          freeLimit={usageStatsQuery.data?.features.avatar.limit ?? 3}
          loading={usageStatsQuery.isPending}
        />
        <TrialCountdownBanner
          isTrial={(usageStatsQuery.data as any)?.isTrial}
          trialEndDate={(usageStatsQuery.data as any)?.trialEndDate}
          trialExpired={(usageStatsQuery.data as any)?.trialExpired}
        />
        <ExpiryWarningBanner />

        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 mt-4">
          {/* ═══ Left Panel: Controls ═══ */}
          <div className="lg:col-span-4 space-y-6">
            <div className={`${glassCard} p-6`}>
              {/* Header with gradient */}
              <div className="mb-6">
                <h2 className={`text-2xl font-bold ${gradientText} from-cyan-300 via-blue-400 to-purple-400`}>
                  虚拟偶像生成
                </h2>
                <p className="text-sm text-white/40 mt-2 leading-relaxed">
                  创建属于你的虚拟偶像。选择风格、性别，并用文字描述你的想法。
                </p>
              </div>

              {/* ── Style Selector ── */}
              <div>
                <label className={sectionTitle}>选择风格</label>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  {STYLES.map((style) => {
                    const isSelected = selectedStyle === style.id;
                    const Icon = style.icon;
                    return (
                      <button
                        key={style.id}
                        onClick={() => setSelectedStyle(style.id)}
                        className={`group relative flex flex-col items-center justify-center p-4 rounded-xl transition-all duration-300 ${
                          isSelected
                            ? `bg-gradient-to-br ${style.gradient} shadow-lg shadow-white/5 scale-[1.02]`
                            : `bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.12] hover:scale-[1.02]`
                        }`}
                      >
                        {isSelected && (
                          <div className={`absolute inset-0 bg-gradient-to-br ${style.gradient} opacity-20 rounded-xl blur-xl`} />
                        )}
                        <div className="relative">
                          <Icon className={`h-6 w-6 mb-2 transition-all duration-300 ${
                            isSelected ? 'text-white drop-shadow-lg' : 'text-white/50 group-hover:text-white/70'
                          }`} />
                        </div>
                        <span className={`text-xs font-semibold relative ${
                          isSelected ? 'text-white' : 'text-white/60 group-hover:text-white/80'
                        }`}>{style.label}</span>
                      </button>
                    );
                  })}
                </div>
                {/* Style description with fade animation */}
                <div className="mt-3 min-h-[2rem]">
                  <p
                    key={selectedStyle}
                    className="text-xs text-white/40 animate-[fadeIn_0.3s_ease-out]"
                    style={{ animation: 'fadeIn 0.3s ease-out' }}
                  >
                    {currentStyleInfo?.desc}
                  </p>
                </div>
              </div>

              {/* ── Gender Selector ── */}
              <div className="mt-5">
                <label className={sectionTitle}>选择性别</label>
                <div className="flex items-center gap-3 mt-3">
                  {GENDERS.map((gender) => {
                    const isSelected = selectedGender === gender.id;
                    const Icon = gender.icon;
                    return (
                      <button
                        key={gender.id}
                        onClick={() => setSelectedGender(gender.id)}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
                          isSelected
                            ? 'bg-gradient-to-r from-cyan-500/80 to-blue-600/80 text-white shadow-lg shadow-cyan-500/10'
                            : 'bg-white/[0.04] border border-white/[0.06] text-white/50 hover:bg-white/[0.08] hover:text-white/70'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {gender.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Description Input ── */}
              <div className="mt-6">
                <label htmlFor="description" className={sectionTitle}>外貌描述 (Prompt)</label>
                <textarea
                  id="description"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="例如：1女孩，棕色长发，蓝色眼睛，穿着白色连衣裙，微笑"
                  className="w-full mt-3 bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 text-sm text-white/80 placeholder:text-white/20 focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/30 focus:bg-white/[0.06] transition-all duration-300 resize-none"
                />
              </div>

              {/* ── Reference Image ── */}
              <div className="mt-6">
                <label className={sectionTitle}>参考图 (选填)</label>
                <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
                {referenceImage ? (
                  <div className="mt-3 relative group rounded-xl overflow-hidden">
                    <img src={referenceImage} alt="Reference" className="w-full rounded-xl" />
                    <button onClick={removeReferenceImage} className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-full p-2 text-white/80 hover:bg-black/80 hover:text-white transition-all duration-200">
                      <X className="h-4 w-4" />
                    </button>
                    {uploadingRef && (
                      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center rounded-xl">
                        <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
                        <span className="ml-3 text-sm text-white/70">上传中...</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <button onClick={pickReferenceImage} className="mt-3 w-full flex flex-col items-center justify-center border-2 border-dashed border-white/[0.08] rounded-xl py-8 hover:border-white/[0.15] hover:bg-white/[0.02] transition-all duration-300 group">
                    <Upload className="h-8 w-8 text-white/20 group-hover:text-white/40 transition-colors duration-300" />
                    <span className="mt-3 text-sm text-white/30 group-hover:text-white/50 transition-colors duration-300">点击上传图片</span>
                  </button>
                )}
              </div>

              {/* ── Engine Selector ── */}
              <div className="mt-6">
                <NbpEngineSelector selected={imageEngine} onSelect={setImageEngine} plan={userPlan} creditsAvailable={userCredits} isAdmin={user?.role === "admin"} compact />
              </div>

              {/* ── Generate Button ── */}
              <button
                onClick={handleGenerate}
                disabled={generating || uploadingRef}
                className="w-full mt-8 relative group overflow-hidden rounded-xl py-3.5 font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 hover:scale-[1.02] active:scale-[0.97] hover:shadow-xl hover:shadow-blue-500/20 ripple-effect"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 via-blue-600 to-purple-600 transition-all duration-500" />
                <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <span className="relative flex items-center justify-center gap-2">
                  {generating ? (
                    <><Loader2 className="h-5 w-5 animate-spin" /> {generationJobId ? "排队中..." : "正在提交..."}</>
                  ) : (
                    <><Sparkles className="h-5 w-5" /> 开始生成</>
                  )}
                </span>
              </button>
            </div>
          </div>

          {/* ═══ Right Panel: Output ═══ */}
          <div className="lg:col-span-8 space-y-6">
            {/* Generated Image Display */}
            <div className={`${glassCard} aspect-square flex items-center justify-center p-1`}>
              {generating && (
                <div className="flex flex-col items-center">
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 rounded-full blur-3xl animate-pulse" />
                    <Loader2 className="h-16 w-16 animate-spin text-cyan-400/60 relative" />
                  </div>
                  <p className="mt-6 text-lg text-white/50">正在为你生成虚拟偶像...</p>
                  <p className="text-sm text-white/25 mt-1">{progressMessage}</p>
                </div>
              )}
              {error && !generating && (
                <div className="text-center px-8">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
                    <X className="h-8 w-8 text-red-400/60" />
                  </div>
                  <p className="font-semibold text-red-400/80">生成失败</p>
                  <p className="text-sm mt-2 text-red-400/50">{error}</p>
                  <button
                    onClick={handleGenerate}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/25 transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                    重试
                  </button>
                </div>
              )}
              {generatedImage && !generating && (
                <>
                  <img src={generatedImage} alt="Generated virtual idol" className="object-contain w-full h-full rounded-xl" />
                  <div className="absolute top-4 right-4 flex gap-2">
                    <button onClick={() => window.open(generatedImage, '_blank')} className="bg-black/50 backdrop-blur-sm p-2.5 rounded-xl text-white/70 hover:bg-black/70 hover:text-white transition-all duration-200 hover:scale-110 active:scale-95">
                      <Download className="h-5 w-5" />
                    </button>
                  </div>
                </>
              )}
              {!generatedImage && !generating && !error && (
                <div className="text-center flex flex-col items-center">
                  <div className="w-24 h-24 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-4">
                    <Bot className="h-12 w-12 text-white/15" />
                  </div>
                  <p className="text-white/30 text-lg">你的虚拟偶像将在这里出现</p>
                </div>
              )}
            </div>

            {/* ── 3D Conversion Panel ── */}
            {generatedImage && (
              <div className={`${glassCard} p-6`}>
                <div className="flex justify-between items-center cursor-pointer group" onClick={() => setShow3DPanel(!show3DPanel)}>
                  <h3 className={`text-xl font-bold ${gradientText} from-emerald-300 to-cyan-400`}>
                    一键转换为 3D 模型
                  </h3>
                  <div className="p-2 rounded-lg bg-white/[0.04] group-hover:bg-white/[0.08] transition-colors duration-200">
                    {show3DPanel ? <ChevronUp className="h-5 w-5 text-white/50" /> : <ChevronDown className="h-5 w-5 text-white/50" />}
                  </div>
                </div>
                {show3DPanel && (
                  <div className="mt-5 space-y-4 animate-[fadeIn_0.3s_ease-out]" style={{ animation: 'fadeIn 0.3s ease-out' }}>
                    <p className="text-sm text-white/35 leading-relaxed">
                     将上方生成的 2D 图片转换为 3D 模型，可用于游戏、VTuber 等场景。每次转换消耗 30 Credits（仅限专业版）。
                    </p>
                    <div className="flex items-center gap-4">
                      <label htmlFor="pbr-toggle" className="flex items-center cursor-pointer group">
                        <input type="checkbox" id="pbr-toggle" checked={enablePbr} onChange={(e) => setEnablePbr(e.target.checked)} className="sr-only" />
                        <div className={`w-11 h-6 rounded-full transition-all duration-300 ${enablePbr ? 'bg-gradient-to-r from-emerald-500 to-cyan-500' : 'bg-white/10'}`}>
                          <div className={`w-5 h-5 m-0.5 bg-white rounded-full shadow-lg transition-transform duration-300 ${enablePbr ? 'translate-x-5' : 'translate-x-0'}`} />
                        </div>
                        <span className="ml-3 text-sm font-medium text-white/60">启用 PBR 材质 (效果更好)</span>
                      </label>
                    </div>
                    <button
                      onClick={handleConvertTo3D}
                      disabled={converting3D}
                      className="w-full relative group overflow-hidden rounded-xl py-3 font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 hover:scale-[1.01]"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-emerald-500 to-cyan-600" />
                      <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                      <span className="relative flex items-center justify-center gap-2">
                        {converting3D ? (
                          <><Loader2 className="h-5 w-5 animate-spin" /> 正在转换...</>
                        ) : (
                          <><Wand2 className="h-5 w-5" /> 开始转换（消耗 30 Credits）</>
                        )}
                      </span>
                    </button>

                    {converting3D && (
                      <div className="text-center py-4">
                        <p className="text-sm text-white/30">3D 模型转换中，通常需要 1-2 分钟...</p>
                      </div>
                    )}
                    {error3D && !converting3D && (
                      <p className="text-center text-red-400/70 text-sm">{error3D}</p>
                    )}

                    {glbUrl && (
                      <div className="mt-4 space-y-4">
                        <h4 className="font-semibold text-white/80">3D 模型预览与下载</h4>
                        <div className="aspect-video bg-black/30 rounded-xl overflow-hidden border border-white/[0.06]">
                          <ModelViewer src={glbUrl} />
                        </div>
                        <div className="flex items-center gap-2">
                          <a href={glbUrl} download="virtual_idol.glb" className="px-4 py-2 bg-gradient-to-r from-cyan-500/80 to-blue-600/80 rounded-lg text-sm font-medium hover:from-cyan-400 hover:to-blue-500 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] hover:shadow-lg hover:shadow-cyan-500/20">下载 GLB</a>
                          {objUrl && <a href={objUrl} download="virtual_idol.obj" className="px-4 py-2 bg-white/[0.06] border border-white/[0.08] rounded-lg text-sm text-white/60 hover:bg-white/[0.1] transition-all duration-300">下载 OBJ</a>}
                          {textureUrl3D && <a href={textureUrl3D} download="virtual_idol_texture.png" className="px-4 py-2 bg-white/[0.06] border border-white/[0.08] rounded-lg text-sm text-white/60 hover:bg-white/[0.1] transition-all duration-300">下载贴图</a>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── History ── */}
            <div className={`${glassCard} p-6`}>
              <CreationHistoryPanel type="idol_image" title="偶像生成历史" />
            </div>
          </div>
        </div>
      </div>

      <QuotaExhaustedModal
        isOpen={quotaModalVisible}
        onClose={() => setQuotaModalVisible(false)}
        isTrial={quotaModalInfo.isTrial}
        planName={quotaModalInfo.planName}
      />

      {/* Inline keyframes */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
