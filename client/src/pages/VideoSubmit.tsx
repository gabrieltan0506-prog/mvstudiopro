// @ts-nocheck
import React, { useState, useCallback, useEffect, useRef } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Music, Video, Sparkles, MonitorPlay, Download, Timer, LayoutGrid, Upload, Brain, Calculator, BarChart3, Lightbulb, Palette, Film, Paintbrush, CheckCircle, XCircle, ChevronRight, FileText, Loader2, Info } from "lucide-react";
import { toast } from "sonner";

const PLATFORMS = [
  { id: "douyin" as const, name: "抖音", icon: Music, color: "#FE2C55", bgColor: "rgba(254,44,85,0.12)" },
  { id: "weixin_channels" as const, name: "视频号", icon: Video, color: "#07C160", bgColor: "rgba(7,193,96,0.12)" },
  { id: "xiaohongshu" as const, name: "小红书", icon: Sparkles, color: "#FF2442", bgColor: "rgba(255,36,66,0.12)" },
  { id: "bilibili" as const, name: "B站", icon: MonitorPlay, color: "#00A1D6", bgColor: "rgba(0,161,214,0.12)" },
] as const;

type PlatformId = typeof PLATFORMS[number]["id"];

type PlatformEntry = {
  platform: PlatformId;
  videoLink: string;
  dataScreenshotUrl: string;
  screenshotBase64: string | null;
};

type Step = "verify" | "upload" | "review" | "analyzing" | "result";

const SHOWCASE_CONTENT = [
    { type: "feature" as const, icon: Sparkles, title: "AI 智能分镜脚本", desc: "上传歌曲即可自动生成专业视频分镜脚本，包含画面描述、运镜指导、情绪节奏", color: "#FF6B35" },
    { type: "feature" as const, icon: Paintbrush, title: "NanoBanana 图片生成", desc: "全新 AI 图片生成引擎，支持多种风格，为你的视频创作绝美视觉素材", color: "#C77DBA" },
    { type: "feature" as const, icon: Film, title: "一键生成视频", desc: "从脚本到成片，AI 自动完成画面生成、音乐匹配、特效合成", color: "#64D2FF" },
    { type: "tip" as const, icon: Lightbulb, title: "爆款视频秘诀", desc: "前 3 秒决定留存率，开场要有冲击力！保持节奏紧凑，每 15-20 秒设置一个高潮点", color: "#FFD60A" },
    { type: "tip" as const, icon: Palette, title: "色彩运用技巧", desc: "统一的色调能提升专业感。尝试使用互补色制造视觉张力，让画面更具表现力", color: "#30D158" },
    { type: "tip" as const, icon: Music, title: "音乐与画面同步", desc: "好的视频音画同步率达 90% 以上。利用节拍点切换画面，让观众沉浸其中", color: "#FF6B6B" },
];

const ANALYSIS_STAGES = [
  { key: "downloading", label: "下载视频文档", icon: Download },
  { key: "checking", label: "检测视频时长", icon: Timer },
  { key: "extracting", label: "抽取关键帧", icon: LayoutGrid },
  { key: "uploading", label: "上传帧图片", icon: Upload },
  { key: "analyzing", label: "AI 逐帧分析", icon: Brain },
  { key: "scoring", label: "综合评分计算", icon: Calculator },
  { key: "data_scoring", label: "平台数据评分", icon: BarChart3 },
];

export default function VideoSubmit() {
  const { isAuthenticated, user } = useAuth();
  const [location, setLocation] = useLocation();

  const [step, setStep] = useState<Step>("verify");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [realName, setRealName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [idFrontBase64, setIdFrontBase64] = useState<string | null>(null);
  const [idFrontUrl, setIdFrontUrl] = useState("");

  const [videoTitle, setVideoTitle] = useState("");
  const [videoDescription, setVideoDescription] = useState("");
  const [videoBase64, setVideoBase64] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [thumbnailBase64, setThumbnailBase64] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [platformEntries, setPlatformEntries] = useState<PlatformEntry[]>([]);
  const [licenseAgreed, setLicenseAgreed] = useState(false);
  const [showLicense, setShowLicense] = useState(false);

  const [submitResult, setSubmitResult] = useState<any>(null);

  const [analysisVideoId, setAnalysisVideoId] = useState<number | null>(null);
  const [analysisStage, setAnalysisStage] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisDetail, setAnalysisDetail] = useState("");
  const [analysisFrames, setAnalysisFrames] = useState<Array<{ frameIndex: number; timestamp: number; imageUrl: string; dropped?: boolean; frameScore?: number }>>([]);
  const [carouselIndex, setCarouselIndex] = useState(0);

  const verificationStatus = trpc.mvAnalysis.getVerificationStatus.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const submitVerification = trpc.mvAnalysis.submitVerification.useMutation();
  const uploadFile = trpc.mvAnalysis.uploadFile.useMutation();
  const submitVideo = trpc.mvAnalysis.submitVideoForAnalysis.useMutation();
  const licenseQuery = trpc.mvAnalysis.getLicenseAgreement.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const analysisProgressQuery = trpc.mvAnalysis.getAnalysisProgress.useQuery(
    { videoId: analysisVideoId! },
    {
      enabled: step === "analyzing" && analysisVideoId !== null,
      refetchInterval: 3000,
    }
  );

  useEffect(() => {
    if (!analysisProgressQuery.data) return;
    const data = analysisProgressQuery.data;
    setAnalysisStage(data.stage);
    setAnalysisProgress(data.progress);
    setAnalysisDetail(data.detail || "");
    if (data.frameAnalyses) {
      setAnalysisFrames(data.frameAnalyses as any);
    }

    if (data.completed) {
      if (data.stage === "completed" && (data as any).score !== undefined) {
        setSubmitResult({
          status: "scored",
          score: (data as any).score,
          creditsRewarded: (data as any).creditsRewarded || 0,
          scoreDetails: (data as any).scoreDetails,
        });
        setStep("result");
        toast.success("分析完成!");
      } else if ((data as any).error) {
        setSubmitResult({ status: "pending_review", message: data.detail });
        setStep("result");
      }
    }
  }, [analysisProgressQuery.data]);

  useEffect(() => {
    if (step !== "analyzing") return;
    const timer = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % SHOWCASE_CONTENT.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [step]);

  useEffect(() => {
    if (verificationStatus.data?.verified) {
      setStep("upload");
    }
  }, [verificationStatus.data]);

  useEffect(() => {
    if (!isAuthenticated) {
      window.location.href = "/login";
    }
  }, [isAuthenticated]);

  if (!isAuthenticated) return null;

  const handleFilePick = (accept: string, callback: (base64: string, file: File) => void) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files[0]) {
        const file = target.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64 = (event.target?.result as string).split(',')[1];
          callback(base64, file);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const uploadToS3 = async (base64: string, folder: "id-photos" | "data-screenshots" | "videos" | "thumbnails", mimeType = "image/jpeg") => {
    const result = await uploadFile.mutateAsync({
      fileBase64: base64,
      mimeType,
      folder,
    });
    return result.url;
  };

  const handleSubmitVerification = async () => {
    if (!realName.trim()) { setError("请输入真实姓名"); return; }
    if (!idNumber.trim() || idNumber.length < 15) { setError("请输入有效的身份证号码"); return; }
    if (!idFrontBase64) { setError("请上传身份证正面照片"); return; }

    setLoading(true);
    setError("");
    try {
      const uploadedIdFrontUrl = await uploadToS3(idFrontBase64, "id-photos");
      setIdFrontUrl(uploadedIdFrontUrl);

      await submitVerification.mutateAsync({
        realName,
        idNumber,
        idCardImageUrl: uploadedIdFrontUrl,
      });

      toast.success("实名认证信息已提交审核");
      setStep("review");
    } catch (e: any) {
      setError(e.message || "提交失败，请重试");
      toast.error(e.message || "提交失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  const handleAddPlatform = () => {
    const nextPlatform = PLATFORMS[platformEntries.length % PLATFORMS.length];
    if (platformEntries.length < PLATFORMS.length) {
        setPlatformEntries([...platformEntries, { platform: nextPlatform.id, videoLink: "", dataScreenshotUrl: "", screenshotBase64: null }]);
    }
  };

  const handleUpdatePlatform = (index: number, field: keyof PlatformEntry, value: any) => {
    const newEntries = [...platformEntries];
    (newEntries[index] as any)[field] = value;
    setPlatformEntries(newEntries);
  };

  const handleRemovePlatform = (index: number) => {
    setPlatformEntries(platformEntries.filter((_, i) => i !== index));
  };

  const handleFinalSubmit = async () => {
    if (!videoTitle.trim()) { setError("请输入视频标题"); return; }
    if (!videoBase64) { setError("请上传视频文件"); return; }
    if (!thumbnailBase64) { setError("请上传视频封面"); return; }
    if (platformEntries.some(p => !p.videoLink || !p.screenshotBase64)) { setError("请完善所有平台信息，包括链接和截图"); return; }
    if (!licenseAgreed) { setError("请阅读并同意授权协议"); return; }

    setLoading(true);
    setError("");

    try {
      const uploadedVideoUrl = await uploadToS3(videoBase64, "videos", "video/mp4");
      setVideoUrl(uploadedVideoUrl);

      const uploadedThumbnailUrl = await uploadToS3(thumbnailBase64, "thumbnails");
      setThumbnailUrl(uploadedThumbnailUrl);

      const uploadedPlatformEntries = await Promise.all(
        platformEntries.map(async (entry) => {
          const screenshotUrl = await uploadToS3(entry.screenshotBase64!, "data-screenshots");
          return { ...entry, dataScreenshotUrl: screenshotUrl };
        })
      );

      const result = await submitVideo.mutateAsync({
        title: videoTitle,
        description: videoDescription,
        videoUrl: uploadedVideoUrl,
        thumbnailUrl: uploadedThumbnailUrl,
        platformData: uploadedPlatformEntries.map(({ platform, videoLink, dataScreenshotUrl }) => ({ platform, videoLink, dataScreenshotUrl })),
      });

      setAnalysisVideoId(result.videoId);
      setStep("analyzing");

    } catch (e: any) {
      setError(e.message || "提交失败，请重试");
      toast.error(e.message || "提交失败，请重试");
      setLoading(false);
    }
  };

  const renderHeader = (title: string, subtitle: string) => (
    <div className="mb-8 text-center">
      <h1 className="text-3xl font-bold text-white">{title}</h1>
      <p className="text-sm text-white/60 mt-2">{subtitle}</p>
    </div>
  );

  const renderVerification = () => (
    <div className="w-full max-w-lg mx-auto">
      {renderHeader("创作者实名认证", "为保障平台内容真实性，我们需要验证您的身份")}
      <div className="space-y-6">
        <input type="text" placeholder="真实姓名" value={realName} onChange={(e) => setRealName(e.target.value)} className="w-full bg-[#1C1C1E] border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/40 focus:ring-2 focus:ring-blue-500 outline-none" />
        <input type="text" placeholder="身份证号码" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} className="w-full bg-[#1C1C1E] border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/40 focus:ring-2 focus:ring-blue-500 outline-none" />
        <div className="text-sm text-white/60">请上传您的身份证正面照片，仅用于平台审核。</div>
        <button onClick={() => handleFilePick('image/*', (base64, file) => { setIdFrontBase64(base64); setIdFrontUrl(URL.createObjectURL(file)); })} className="w-full h-48 border-2 border-dashed border-white/20 rounded-lg flex items-center justify-center hover:border-white/40 transition-colors">
          {idFrontUrl ? <img src={idFrontUrl} alt="ID Front" className="h-full w-full object-contain rounded-lg" /> : <div className="text-center text-white/60"><Upload className="mx-auto h-8 w-8 mb-2" />点击上传</div>}
        </button>
      </div>
      {error && <p className="text-red-500 text-center mt-4">{error}</p>}
      <button onClick={handleSubmitVerification} disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg mt-8 transition-colors disabled:opacity-50 flex items-center justify-center">
        {loading ? <Loader2 className="animate-spin h-5 w-5" /> : "提交审核"}
      </button>
    </div>
  );

  const renderReview = () => (
    <div className="w-full max-w-lg mx-auto text-center">
        {renderHeader("审核中", "您的实名认证信息已提交，我们会在 24 小时内完成审核")}
        <CheckCircle className="h-24 w-24 text-green-500 mx-auto mb-6" />
        <p className="text-white/80">审核结果将通过系统消息通知您。</p>
        <p className="text-white/60 text-sm mt-2">审核通过后，您即可提交视频进行分析。</p>
        <button onClick={() => verificationStatus.refetch()} className="mt-8 text-blue-400 hover:text-blue-500 transition-colors">刷新状态</button>
    </div>
  );

  const renderUpload = () => (
    <div className="w-full max-w-3xl mx-auto">
      {renderHeader("提交视频进行分析", "上传您的原创视频，AI 将为您提供深度分析报告")}
      <div className="space-y-8">
        <div className="p-6 bg-[#1C1C1E] border border-white/10 rounded-lg">
            <h2 className="text-xl font-semibold text-white mb-4">基本信息</h2>
            <div className="space-y-4">
                <input type="text" placeholder="视频标题" value={videoTitle} onChange={(e) => setVideoTitle(e.target.value)} className="w-full bg-[#0A0A0C] border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/40" />
                <textarea placeholder="视频简介 (可选)" value={videoDescription} onChange={(e) => setVideoDescription(e.target.value)} rows={3} className="w-full bg-[#0A0A0C] border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/40" />
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="p-6 bg-[#1C1C1E] border border-white/10 rounded-lg">
                <h2 className="text-xl font-semibold text-white mb-4">视频文件</h2>
                <button onClick={() => handleFilePick('video/*', (base64, file) => { setVideoBase64(base64); setVideoUrl(URL.createObjectURL(file)); })} className="w-full h-40 border-2 border-dashed border-white/20 rounded-lg flex items-center justify-center hover:border-white/40 transition-colors">
                    {videoUrl ? <video src={videoUrl} className="h-full w-full object-contain rounded-lg" /> : <div className="text-center text-white/60"><Upload className="mx-auto h-8 w-8 mb-2" />点击上传视频</div>}
                </button>
            </div>
            <div className="p-6 bg-[#1C1C1E] border border-white/10 rounded-lg">
                <h2 className="text-xl font-semibold text-white mb-4">视频封面</h2>
                <button onClick={() => handleFilePick('image/*', (base64, file) => { setThumbnailBase64(base64); setThumbnailUrl(URL.createObjectURL(file)); })} className="w-full h-40 border-2 border-dashed border-white/20 rounded-lg flex items-center justify-center hover:border-white/40 transition-colors">
                    {thumbnailUrl ? <img src={thumbnailUrl} alt="Thumbnail" className="h-full w-full object-contain rounded-lg" /> : <div className="text-center text-white/60"><Upload className="mx-auto h-8 w-8 mb-2" />点击上传封面</div>}
                </button>
            </div>
        </div>

        <div className="p-6 bg-[#1C1C1E] border border-white/10 rounded-lg">
            <h2 className="text-xl font-semibold text-white mb-4">发布平台数据</h2>
            <div className="space-y-4">
                {platformEntries.map((entry, index) => {
                    const platformInfo = PLATFORMS.find(p => p.id === entry.platform)!;
                    return (
                        <div key={index} className="p-4 border border-white/10 rounded-lg bg-[#0A0A0C]">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <platformInfo.icon size={20} color={platformInfo.color} />
                                    <span className="font-semibold text-white">{platformInfo.name}</span>
                                </div>
                                <button onClick={() => handleRemovePlatform(index)} className="text-red-500 hover:text-red-400"><XCircle size={18} /></button>
                            </div>
                            <div className="space-y-3">
                                <input type="text" placeholder={`${platformInfo.name} 视频链接`} value={entry.videoLink} onChange={(e) => handleUpdatePlatform(index, 'videoLink', e.target.value)} className="w-full bg-[#1C1C1E] border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
                                <button onClick={() => handleFilePick('image/*', (base64, file) => { handleUpdatePlatform(index, 'screenshotBase64', base64); handleUpdatePlatform(index, 'dataScreenshotUrl', URL.createObjectURL(file)); })} className="w-full text-sm h-24 border border-dashed border-white/20 rounded-lg flex items-center justify-center hover:border-white/40">
                                    {entry.dataScreenshotUrl ? <img src={entry.dataScreenshotUrl} alt="Screenshot" className="h-full w-full object-contain" /> : <div className="text-center text-xs text-white/60"><Upload className="mx-auto h-5 w-5 mb-1" />上传数据截图</div>}
                                </button>
                            </div>
                        </div>
                    );
                })}
                {platformEntries.length < PLATFORMS.length && <button onClick={handleAddPlatform} className="w-full border border-dashed border-white/20 rounded-lg py-3 text-sm text-white/60 hover:bg-white/5">+ 添加平台</button>}
            </div>
        </div>

        <div className="flex items-center space-x-3 mt-6">
            <input type="checkbox" id="license" checked={licenseAgreed} onChange={(e) => setLicenseAgreed(e.target.checked)} className="h-4 w-4 rounded bg-[#1C1C1E] border-white/20 text-blue-600 focus:ring-blue-500" />
            <label htmlFor="license" className="text-sm text-white/60">
                我已阅读并同意 <button onClick={() => setShowLicense(true)} className="text-blue-400 hover:underline">《视频内容分析授权协议》</button>
            </label>
        </div>

        {error && <p className="text-red-500 text-center mt-4">{error}</p>}
        <button onClick={handleFinalSubmit} disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg mt-4 transition-colors disabled:opacity-50 flex items-center justify-center">
            {loading ? <Loader2 className="animate-spin h-5 w-5" /> : "提交分析"}
        </button>
      </div>
      {showLicense && renderLicenseModal()}
    </div>
  );

  const renderLicenseModal = () => (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
        <div className="bg-[#1C1C1E] rounded-xl shadow-lg max-w-2xl w-full max-h-[80vh] flex flex-col border border-white/10">
            <div className="p-6 border-b border-white/10">
                <h2 className="text-xl font-bold text-white">视频内容分析授权协议</h2>
            </div>
            <div className="p-6 overflow-y-auto space-y-4 text-white/70 text-sm">
                {licenseQuery.isPending ? <Loader2 className="animate-spin h-8 w-8 mx-auto" /> : <p className="whitespace-pre-wrap">{licenseQuery.data?.content}</p>}
            </div>
            <div className="p-4 border-t border-white/10 flex justify-end">
                <button onClick={() => { setLicenseAgreed(true); setShowLicense(false); }} className="bg-blue-600 text-white px-6 py-2 rounded-lg">同意并关闭</button>
            </div>
        </div>
    </div>
  );

  const renderAnalyzing = () => {
    const currentStageInfo = ANALYSIS_STAGES.find(s => s.key === analysisStage);
    const showcaseItem = SHOWCASE_CONTENT[carouselIndex];

    return (
        <div className="w-full max-w-4xl mx-auto text-center flex flex-col items-center justify-center h-full">
            <div className="relative w-48 h-48 flex items-center justify-center mb-8">
                {currentStageInfo && <currentStageInfo.icon className="h-24 w-24 text-blue-400 animate-pulse" />}
                <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full"></div>
                <div style={{ transform: `rotate(${analysisProgress * 3.6}deg)` }} className="absolute inset-0 border-4 border-t-blue-500 border-l-blue-500 border-r-blue-500/0 border-b-blue-500/0 rounded-full transition-transform duration-500"></div>
                <span className="absolute text-2xl font-bold text-white">{analysisProgress}%</span>
            </div>

            <h2 className="text-2xl font-bold text-white">{currentStageInfo?.label || "正在准备分析..."}</h2>
            <p className="text-white/60 mt-2 mb-12">{analysisDetail}</p>

            <div className="w-full bg-[#1C1C1E] border border-white/10 rounded-xl p-6 flex items-center gap-6">
                <div style={{ color: showcaseItem.color }} className="flex-shrink-0"><showcaseItem.icon size={48} /></div>
                <div>
                    <h3 className="text-lg font-bold text-white text-left">{showcaseItem.title}</h3>
                    <p className="text-sm text-white/60 text-left mt-1">{showcaseItem.desc}</p>
                </div>
            </div>
        </div>
    );
  };

  const renderResult = () => (
    <div className="w-full max-w-2xl mx-auto text-center">
        {submitResult?.status === 'scored' ? (
            <>
                {renderHeader(`分析完成，综合得分: ${submitResult.score}`, `恭喜！您获得了 ${submitResult.creditsRewarded} 创作积分`)}
                <CheckCircle className="h-24 w-24 text-green-500 mx-auto mb-6" />
                <div className="bg-[#1C1C1E] border border-white/10 rounded-lg p-6 text-left space-y-4">
                    {submitResult.scoreDetails?.map((detail: any, i: number) => (
                        <div key={i} className="flex justify-between items-center">
                            <span className="text-white/80">{detail.label}</span>
                            <span className="font-bold text-white">{detail.score}</span>
                        </div>
                    ))}
                </div>
                <Link href={`/mv-analysis/${analysisVideoId}`} className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg mt-8 transition-colors">查看详细报告</Link>
            </>
        ) : (
            <>
                {renderHeader("提交成功，等待人工审核", submitResult?.message || "您的视频已进入人工审核流程，通常需要 1-2 个工作日")}
                <Info className="h-24 w-24 text-yellow-500 mx-auto mb-6" />
                <p className="text-white/80">审核通过后，AI 将开始分析您的视频。</p>
                <Link href="/my-content" className="inline-block mt-8 text-blue-400 hover:text-blue-500 transition-colors">返回我的内容</Link>
            </>
        )}
    </div>
  );

  const renderContent = () => {
    switch (step) {
      case "verify": return renderVerification();
      case "review": return renderReview();
      case "upload": return renderUpload();
      case "analyzing": return renderAnalyzing();
      case "result": return renderResult();
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF] p-4 sm:p-8 flex items-center justify-center">
        {verificationStatus.isPending ? <Loader2 className="animate-spin h-12 w-12" /> : renderContent()}
    </div>
  );
}
