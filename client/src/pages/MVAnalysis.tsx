import React, { useState, useRef, useCallback, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { UsageQuotaBanner } from "@/components/UsageQuotaBanner";
import { StudentUpgradePrompt } from "@/components/StudentUpgradePrompt";
import { TrialCountdownBanner } from "@/components/TrialCountdownBanner";
import { QuotaExhaustedModal } from "@/components/QuotaExhaustedModal";
import { ArrowLeft, Upload, Plus, Lightbulb, RefreshCw, Timer, Loader2, File as FileIcon, BrainCircuit } from "lucide-react";
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

export default function MVAnalysisPage() {
  const [location, navigate] = useLocation();
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const [quotaModalVisible, setQuotaModalVisible] = useState(false);
  const [quotaModalInfo, setQuotaModalInfo] = useState<{ isTrial?: boolean; planName?: string }>({});

  const analyzeMutation = trpc.mvAnalysis.analyzeFrame.useMutation();
  const checkAccessMutation = trpc.usage.checkFeatureAccess.useMutation();
  const usageStatsQuery = trpc.usage.getUsageStats.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
    refetchOnMount: true,
  });

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      console.log("[Analyze] Not authenticated, redirecting to login...");
      navigate("/login");
    }
  }, [loading, isAuthenticated, navigate]);

  useEffect(() => {
    if (uploadStage === "uploading" || uploadStage === "analyzing") {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [uploadStage]);

  const handleSelectFile = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
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
    const est = Math.max(10, Math.round(sizeMB * 2 + 15));
    setEstimatedTime(est);

    if (isImage) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setSelectedImage(dataUrl);
        const base64 = dataUrl.split(",")[1];
        setImageBase64(base64);
        setUploadStage("idle");
        setUploadProgress(100);
      };
      reader.readAsDataURL(file);
    } else if (isVideo) {
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
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
          setSelectedImage(dataUrl);
          const base64 = dataUrl.split(",")[1];
          setImageBase64(base64);
          setUploadStage("idle");
          setUploadProgress(100);
          URL.revokeObjectURL(url);
        } else {
          URL.revokeObjectURL(url);
        }
      };
      video.onerror = () => {
        setError("视频读取失败，请尝试上传图片截屏");
        setUploadStage("error");
        URL.revokeObjectURL(url);
      };
    }
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
    } catch (error: any) {
      toast.error(error.message || "无法检查使用权限");
      return;
    }

    setUploadStage("uploading");
    setUploadProgress(0);
    setError(null);
    setElapsedTime(0);

    const sizeMB = fileSize / (1024 * 1024);
    setEstimatedTime(Math.max(12, Math.round(sizeMB * 1.5 + 12)));

    try {
      const result = await analyzeMutation.mutateAsync({
        imageBase64,
        mimeType: "image/jpeg",
        context: context || undefined,
      });
      setUploadProgress(100);
      setUploadStage("done");
      setAnalysis(result.analysis);
      usageStatsQuery.refetch();
    } catch (err: any) {
      setError(err.message || "分析失败，请稍后再试");
      setUploadStage("error");
    }
  }, [imageBase64, context, analyzeMutation, fileSize, usageStatsQuery, checkAccessMutation]);

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

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}秒`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}分${s}秒`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-500";
    if (score >= 60) return "text-yellow-400";
    if (score >= 40) return "text-orange-400";
    return "text-red-500";
  };

  const getStageLabel = () => {
    switch (uploadStage) {
      case "reading": return "读取文件中...";
      case "uploading": return "上传画面中...";
      case "analyzing": return "AI 智能分析中...";
      case "done": return "分析完成！";
      case "error": return "处理失败";
      default: return "";
    }
  };

  const isProcessing = uploadStage === "uploading" || uploadStage === "analyzing";
  const remainingTime = Math.max(0, estimatedTime - elapsedTime);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0C] flex flex-col items-center justify-center text-[#F7F4EF]">
        <Loader2 className="h-8 w-8 animate-spin text-[#0a7ea4]" />
        <span className="mt-4 text-gray-400">检查登录状态...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="container mx-auto px-4 py-8">
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
        {usageStatsQuery.data?.studentPlan && (
          <StudentUpgradePrompt
            studentPlan={usageStatsQuery.data.studentPlan}
            usageData={usageStatsQuery.data.features}
            isTrial={(usageStatsQuery.data as any).isTrial}
            trialEndDate={(usageStatsQuery.data as any).trialEndDate}
          />
        )}

        <div className="relative flex items-center justify-center py-4 mb-6">
          <button onClick={() => window.history.back()} className="absolute left-0 p-2 rounded-full hover:bg-gray-800 transition-colors">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-2xl font-bold">视频 PK 评分</h1>
        </div>

        <div className="max-w-4xl mx-auto">
          {!selectedImage ? (
            <div className="flex flex-col items-center">
              <div className="w-full max-w-lg border-2 border-dashed border-gray-700 rounded-xl bg-gray-900/50 p-8 text-center card-hover-lift">
                <button onClick={handleSelectFile} className="w-full">
                  <div className="flex justify-center items-center">
                    <Upload className="w-12 h-12 text-blue-400" />
                  </div>
                  <p className="mt-4 text-xl font-semibold">上传视频画面</p>
                  <p className="mt-2 text-sm text-gray-400">
                    支持图片（JPG、PNG）或视频（MP4）<br />
                    视频将自动截取画面进行分析
                  </p>
                  <div className="mt-6 inline-flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] hover:shadow-lg hover:shadow-blue-600/25 ripple-effect">
                    <Plus className="w-5 h-5 mr-2" />
                    选择文件
                  </div>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              {uploadStage === "reading" && (
                <div className="w-full max-w-lg mt-6 p-4 bg-gray-900 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium text-blue-300 flex items-center"><FileIcon className="w-4 h-4 mr-2" /> {fileName}</span>
                    <span className="text-sm font-medium">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2.5">
                    <div className="bg-blue-500 h-2.5 rounded-full" style={{ width: `${uploadProgress}%` }}></div>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">读取文件中... {formatFileSize(fileSize)}</p>
                </div>
              )}

              <div className="w-full max-w-lg mt-8 p-6 bg-yellow-900/20 border border-yellow-700/50 rounded-xl">
                <h3 className="text-lg font-semibold flex items-center text-yellow-300">
                  <Lightbulb className="w-5 h-5 mr-2" /> 分析提示
                </h3>
                <ul className="mt-3 space-y-2 text-sm text-yellow-200/80 list-disc list-inside">
                  <li>选择视频中最具代表性的画面</li>
                  <li>高分辨率图片能获得更准确的分析</li>
                  <li>AI 将从构图、色彩、光影、冲击力等维度评分</li>
                  <li>分析结果包含爆款潜力评估和平台推荐</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-8">
              <div className="flex flex-col items-center">
                <div className="w-full aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center">
                  <img src={selectedImage} alt="Preview" className="max-w-full max-h-full object-contain" />
                </div>
                {!isProcessing && uploadStage !== "done" && (
                  <div className="w-full flex justify-between items-center mt-4 p-3 bg-gray-800 rounded-lg">
                     <div className="flex items-center text-sm text-gray-400">
                       <FileIcon className="w-4 h-4 mr-2" />
                       <span>{fileName} ({formatFileSize(fileSize)})</span>
                     </div>
                    <button onClick={handleReset} className="flex items-center text-sm font-medium text-white bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-md transition-colors">
                      <RefreshCw className="w-4 h-4 mr-2" />
                      重新选择
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-col justify-center">
                {isProcessing && (
                  <div className="w-full p-6 bg-gray-900 rounded-xl">
                    <div className="flex justify-between items-center mb-3">
                      <p className="text-lg font-semibold flex items-center">
                        {uploadStage === "uploading" ? <Upload className="w-6 h-6 mr-3 text-blue-400" /> : <BrainCircuit className="w-6 h-6 mr-3 text-purple-400" />}
                        {getStageLabel()}
                      </p>
                      <p className="text-lg font-bold">{uploadProgress}%</p>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-3">
                      <div className={`h-3 rounded-full transition-all duration-500 ${uploadStage === "uploading" ? "bg-blue-500" : "bg-purple-500"}`} style={{ width: `${uploadProgress}%` }}></div>
                    </div>
                    <div className="flex justify-between items-center mt-3 text-sm text-gray-400">
                      <span className="flex items-center"><Timer className="w-4 h-4 mr-1.5" /> 已用时间：{formatTime(elapsedTime)}</span>
                      <span>预估剩余：{remainingTime > 0 ? `~${formatTime(remainingTime)}` : "即将完成"}</span>
                    </div>
                    <div className="flex items-center justify-between mt-6 text-xs text-gray-500">
                        <div className="flex flex-col items-center text-center">
                            <div className={`w-3 h-3 rounded-full ${uploadProgress > 0 ? 'bg-blue-500' : 'bg-gray-600'}`}></div>
                            <span className={`mt-1 ${uploadProgress > 0 ? 'text-white' : ''}`}>上传</span>
                        </div>
                        <div className={`flex-1 h-0.5 mx-2 ${uploadProgress >= 50 ? 'bg-blue-500' : 'bg-gray-600'}`}></div>
                        <div className="flex flex-col items-center text-center">
                            <div className={`w-3 h-3 rounded-full ${uploadProgress >= 50 ? 'bg-purple-500' : 'bg-gray-600'}`}></div>
                            <span className={`mt-1 ${uploadProgress >= 50 ? 'text-white' : ''}`}>AI 分析</span>
                        </div>
                        <div className={`flex-1 h-0.5 mx-2 ${uploadProgress >= 100 ? 'bg-purple-500' : 'bg-gray-600'}`}></div>
                        <div className="flex flex-col items-center text-center">
                            <div className={`w-3 h-3 rounded-full ${uploadProgress >= 100 ? 'bg-green-500' : 'bg-gray-600'}`}></div>
                            <span className={`mt-1 ${uploadProgress >= 100 ? 'text-white' : ''}`}>完成</span>
                        </div>
                    </div>
                  </div>
                )}

                {!analysis && !isProcessing && uploadStage !== "done" && (
                  <div className="w-full">
                    <label htmlFor="context" className="block text-md font-medium mb-2">补充说明（可选）</label>
                    <textarea
                      id="context"
                      rows={4}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                      placeholder="例如：这是副歌高潮部分的画面..."
                      value={context}
                      onChange={(e) => setContext(e.target.value)}
                    />
                    <button
                      onClick={handleAnalyze}
                      disabled={analyzeMutation.isPending}
                      className="w-full mt-4 flex items-center justify-center px-6 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-bold text-lg transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg hover:shadow-green-600/25 disabled:opacity-50 disabled:cursor-not-allowed ripple-effect"
                    >
                      {analyzeMutation.isPending ? (
                        <Loader2 className="w-6 h-6 animate-spin mr-3" />
                      ) : (
                        <BrainCircuit className="w-6 h-6 mr-3" />
                      )}
                      开始 AI 分析
                    </button>
                  </div>
                )}

                {error && (
                  <div className="mt-6 p-4 bg-red-900/50 border border-red-700 rounded-lg text-center">
                    <p className="text-red-400 font-semibold">{error}</p>
                    <button onClick={handleReset} className="mt-3 text-sm font-medium text-white underline">重试</button>
                  </div>
                )}

                {analysis && (
                  <div className="w-full animate-fade-in">
                    <h2 className="text-2xl font-bold mb-4">分析报告</h2>
                    <div className="space-y-6">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-center">
                        <div className="p-4 bg-gray-800 rounded-lg">
                          <p className="text-sm text-gray-400">构图</p>
                          <p className={`text-2xl font-bold ${getScoreColor(analysis.composition)}`}>{analysis.composition}</p>
                        </div>
                        <div className="p-4 bg-gray-800 rounded-lg">
                          <p className="text-sm text-gray-400">色彩</p>
                          <p className={`text-2xl font-bold ${getScoreColor(analysis.color)}`}>{analysis.color}</p>
                        </div>
                        <div className="p-4 bg-gray-800 rounded-lg">
                          <p className="text-sm text-gray-400">光影</p>
                          <p className={`text-2xl font-bold ${getScoreColor(analysis.lighting)}`}>{analysis.lighting}</p>
                        </div>
                        <div className="p-4 bg-gray-800 rounded-lg">
                          <p className="text-sm text-gray-400">冲击力</p>
                          <p className={`text-2xl font-bold ${getScoreColor(analysis.impact)}`}>{analysis.impact}</p>
                        </div>
                        <div className="p-4 bg-gray-800 rounded-lg col-span-2 md:col-span-1">
                          <p className="text-sm text-gray-400">爆款潜力</p>
                          <p className={`text-2xl font-bold ${getScoreColor(analysis.viralPotential)}`}>{analysis.viralPotential}</p>
                        </div>
                      </div>

                      <div>
                        <h3 className="font-semibold text-lg mb-2 text-green-400">优势分析</h3>
                        <ul className="space-y-1.5 text-gray-300 list-disc list-inside">
                          {analysis.strengths.map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                      </div>

                      <div>
                        <h3 className="font-semibold text-lg mb-2 text-orange-400">改进建议</h3>
                        <ul className="space-y-1.5 text-gray-300 list-disc list-inside">
                          {analysis.improvements.map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                      </div>

                      <div>
                        <h3 className="font-semibold text-lg mb-2">综合评价</h3>
                        <p className="text-gray-300">{analysis.summary}</p>
                      </div>
                      
                      <div>
                        <h3 className="font-semibold text-lg mb-2">推荐发布平台</h3>
                        <div className="flex flex-wrap gap-2">
                          {analysis.platforms.map((p) => <span key={p} className="px-3 py-1 bg-blue-900/50 text-blue-300 text-sm rounded-full">{p}</span>)}
                        </div>
                      </div>

                      <button onClick={handleReset} className="w-full mt-6 flex items-center justify-center px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-bold text-lg transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg hover:shadow-blue-600/25 ripple-effect">
                        <Plus className="w-6 h-6 mr-3" />
                        分析下一个画面
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <QuotaExhaustedModal
        isOpen={quotaModalVisible}
        onClose={() => setQuotaModalVisible(false)}
        isTrial={quotaModalInfo.isTrial}
        planName={quotaModalInfo.planName}
      />
    </div>
  );
}
