// @ts-nocheck
import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { UsageQuotaBanner } from "@/components/UsageQuotaBanner";
import { StudentUpgradePrompt } from "@/components/StudentUpgradePrompt";
import { TrialCountdownBanner } from "@/components/TrialCountdownBanner";
import { QuotaExhaustedModal } from "@/components/QuotaExhaustedModal";
import { NbpEngineSelector, type EngineOption } from "@/components/NbpEngineSelector";
import { ModelViewer } from "@/components/ModelViewer";
import { toast } from "sonner";
import { Loader2, Upload, X, Bot, Sparkles, Wand2, ChevronDown, ChevronUp, Download, Check, Copy, RefreshCw, Eye, EyeOff } from "lucide-react";


type StyleOption = { id: string; label: string; icon: React.ElementType; color: string; desc: string };
type GenderOption = { id: string; label: string; icon: React.ElementType };

const STYLES: StyleOption[] = [
  { id: "anime", label: "动漫风", icon: Sparkles, color: "text-[#FF6B6B]", desc: "日系动漫角色设计" },
  { id: "realistic", label: "真人风", icon: Wand2, color: "text-[#64D2FF]", desc: "极度真人・摄影级品质" },
  { id: "chibi", label: "Q版萌系", icon: Bot, color: "text-[#FFD60A]", desc: "可爱 Q 版造型" },
  { id: "cyberpunk", label: "赛博庞克", icon: Bot, color: "text-[#C77DBA]", desc: "未来科技风格" },
  { id: "fantasy", label: "奇幻风", icon: Sparkles, color: "text-[#30D158]", desc: "魔幻梦境风格" },
];

const GENDERS: GenderOption[] = [
  { id: "female", label: "女性", icon: Bot },
  { id: "male", label: "男性", icon: Bot },
  { id: "neutral", label: "中性", icon: Bot },
];

export default function VirtualIdol() {
  const [location, navigate] = useLocation();
  const { isAuthenticated, loading, user } = useAuth();

  const [selectedStyle, setSelectedStyle] = useState<string>("anime");
  const [selectedGender, setSelectedGender] = useState<string>("female");
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ imageUrl: string; style: string; gender: string }>>([]);

  const [imageEngine, setImageEngine] = useState<EngineOption>("forge");

  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [uploadingRef, setUploadingRef] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const generateMutation = trpc.virtualIdol.generate.useMutation();
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

  const pickReferenceImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const removeReferenceImage = useCallback(() => {
    setReferenceImage(null);
    setReferenceImageUrl(null);
    if(fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    try {
      const accessCheck = await checkAccessMutation.mutateAsync({ featureType: "avatar" });
      
      if (!accessCheck.allowed) {
        setQuotaModalInfo({
          isTrial: (accessCheck as any).isTrial,
          planName: (accessCheck as any).planName,
        });
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
    
    setGenerating(true);
    setError(null);
    setGeneratedImage(null);
    setShow3DPanel(false);
    setImage3D(null);
    const qualityMap: Record<string, "free" | "2k" | "4k"> = {
      forge: "free",
      nbp_2k: "2k",
      nbp_4k: "4k",
    };
    const quality = qualityMap[imageEngine] || "free";

    try {
      const result = await generateMutation.mutateAsync({
        style: selectedStyle as any,
        gender: selectedGender as any,
        description: description || undefined,
        referenceImageUrl: referenceImageUrl || undefined,
        quality,
      });
      if (result.success === false) {
        setError((result as any).error || "生成失败");
      } else if (result.imageUrl) {
        setGeneratedImage(result.imageUrl);
        setHistory(prev => [{ imageUrl: result.imageUrl!, style: selectedStyle, gender: selectedGender }, ...prev].slice(0, 6));
      }
      usageStatsQuery.refetch();
    } catch (err: any) {
      setError(err.message || "生成失败，请稍后再试");
    } finally {
      setGenerating(false);
    }
  }, [selectedStyle, selectedGender, description, generateMutation, checkAccessMutation, navigate, usageStatsQuery, referenceImageUrl, referenceImage, uploadingRef, imageEngine]);

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
      const result = await convert3DMutation.mutateAsync({
        imageUrl: generatedImage,
        enablePbr,
      });
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
          description: "偶像转 3D 功能仅限专业版以上用户使用。升级后可享受 3D 转换，每次消耗 10 Credits。",
          action: {
            label: "立即升级",
            onClick: () => navigate("/pricing"),
          },
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
    if (!loading && !isAuthenticated) {
      console.log("[Avatar] Not authenticated, redirecting to login...");
      navigate("/login");
    }
  }, [loading, isAuthenticated, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">检查登录状态...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="overflow-y-auto p-4 md:p-6 lg:p-8">
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

        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 mt-4">
          {/* Left Panel: Controls */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-[#1A1A1C] p-6 rounded-2xl">
              <h2 className="text-2xl font-bold mb-4">虚拟偶像生成</h2>
              <p className="text-sm text-gray-400 mb-6">创建属于你的虚拟偶像。选择风格、性别，并用文字描述你的想法。</p>

              {/* Style Selector */}
              <div>
                <label className="text-base font-semibold text-gray-300">选择风格</label>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  {STYLES.map((style) => (
                    <button
                      key={style.id}
                      onClick={() => setSelectedStyle(style.id)}
                      className={`flex flex-col items-center justify-center p-3 rounded-lg transition-all duration-200 ${selectedStyle === style.id ? 'bg-blue-600/80 ring-2 ring-blue-400' : 'bg-[#2A2A2C] hover:bg-[#3A3A3C]'}`}>
                      <style.icon className={`h-6 w-6 mb-1 ${style.color}`} />
                      <span className="text-xs font-medium">{style.label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">{currentStyleInfo?.desc}</p>
              </div>

              {/* Gender Selector */}
              <div className="mt-6">
                <label className="text-base font-semibold text-gray-300">选择性别</label>
                <div className="flex items-center space-x-3 mt-3">
                  {GENDERS.map((gender) => (
                    <button
                      key={gender.id}
                      onClick={() => setSelectedGender(gender.id)}
                      className={`flex items-center px-4 py-2 rounded-full text-sm font-medium transition-colors ${selectedGender === gender.id ? 'bg-blue-600 text-white' : 'bg-[#2A2A2C] hover:bg-[#3A3A3C]'}`}>
                      <gender.icon className="h-4 w-4 mr-2" />
                      {gender.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description Input */}
              <div className="mt-6">
                <label htmlFor="description" className="text-base font-semibold text-gray-300">外貌描述 (Prompt)</label>
                <textarea
                  id="description"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="例如：1女孩，棕色长发，蓝色眼睛，穿着白色连衣裙，微笑"
                  className="w-full mt-3 bg-[#2A2A2C] border border-gray-600 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                />
              </div>

              {/* Reference Image */}
              <div className="mt-6">
                <label className="text-base font-semibold text-gray-300">参考图 (选填)</label>
                <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
                {referenceImage ? (
                  <div className="mt-3 relative group">
                    <img src={referenceImage} alt="Reference" className="w-full rounded-lg" />
                    <button onClick={removeReferenceImage} className="absolute top-2 right-2 bg-black/50 rounded-full p-1.5 text-white hover:bg-black/80 transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                    {uploadingRef && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-lg">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span className="ml-2 text-sm">上传中...</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <button onClick={pickReferenceImage} className="mt-3 w-full flex flex-col items-center justify-center border-2 border-dashed border-gray-600 rounded-lg py-8 hover:border-gray-500 transition-colors">
                    <Upload className="h-8 w-8 text-gray-500" />
                    <span className="mt-2 text-sm text-gray-400">点击上传图片</span>
                  </button>
                )}
              </div>

              {/* Engine Selector */}
              <div className="mt-6">
                 <NbpEngineSelector selectedValue={imageEngine} onValueChange={setImageEngine} userPlan={userPlan} feature="avatar" />
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={generating || uploadingRef}
                className="w-full mt-8 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold py-3 rounded-lg flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition-transform transform hover:scale-105">
                {generating ? (
                  <><Loader2 className="h-5 w-5 animate-spin mr-2" /> 正在生成...</>
                ) : (
                  <><Sparkles className="h-5 w-5 mr-2" /> 开始生成</>
                )}
              </button>
            </div>
          </div>

          {/* Right Panel: Output */}
          <div className="lg:col-span-8">
            {/* Generated Image Display */}
            <div className="bg-[#1A1A1C] rounded-2xl p-4 aspect-square flex items-center justify-center relative">
              {generating && (
                <div className="flex flex-col items-center text-gray-400">
                  <Loader2 className="h-16 w-16 animate-spin text-blue-500" />
                  <p className="mt-4 text-lg">正在为你生成虚拟偶像...</p>
                  <p className="text-sm text-gray-500">通常需要 15-30 秒</p>
                </div>
              )}
              {error && !generating && (
                <div className="text-center text-red-400">
                  <p className="font-semibold">生成失败</p>
                  <p className="text-sm mt-2">{error}</p>
                </div>
              )}
              {generatedImage && !generating && (
                <>
                  <img src={generatedImage} alt="Generated virtual idol" className="object-contain w-full h-full rounded-lg" />
                  <div className="absolute top-3 right-3 flex space-x-2">
                     <button onClick={() => window.open(generatedImage, '_blank')} className="bg-black/50 p-2 rounded-full text-white hover:bg-black/70 transition-colors">
                        <Download className="h-5 w-5" />
                     </button>
                  </div>
                </>
              )}
              {!generatedImage && !generating && !error && (
                <div className="text-center text-gray-500 flex flex-col items-center">
                  <Bot className="h-20 w-20" />
                  <p className="mt-4 text-lg">你的虚拟偶像将在这里出现</p>
                </div>
              )}
            </div>

            {/* 3D Conversion Panel */}
            {generatedImage && (
              <div className="mt-6 bg-[#1A1A1C] p-6 rounded-2xl">
                <div className="flex justify-between items-center cursor-pointer" onClick={() => setShow3DPanel(!show3DPanel)}>
                  <h3 className="text-xl font-bold">一键转换为 3D 模型</h3>
                  {show3DPanel ? <ChevronUp /> : <ChevronDown />}
                </div>
                {show3DPanel && (
                  <div className="mt-4">
                    <p className="text-sm text-gray-400 mb-4">将上方生成的 2D 图片转换为 3D 模型，可用于游戏、VTuber 等场景。每次转换消耗 10 点数 (仅限专业版)。</p>
                    <div className="flex items-center space-x-4 mb-4">
                      <label htmlFor="pbr-toggle" className="flex items-center cursor-pointer">
                        <input type="checkbox" id="pbr-toggle" checked={enablePbr} onChange={(e) => setEnablePbr(e.target.checked)} className="sr-only" />
                        <div className={`w-10 h-5 rounded-full transition-colors ${enablePbr ? 'bg-blue-600' : 'bg-gray-500'}`}>
                          <div className={`w-4 h-4 m-0.5 bg-white rounded-full transition-transform ${enablePbr ? 'translate-x-5' : 'translate-x-0'}`}></div>
                        </div>
                        <span className="ml-3 text-sm font-medium">启用 PBR 材质 (效果更好)</span>
                      </label>
                    </div>
                    <button
                      onClick={handleConvertTo3D}
                      disabled={converting3D}
                      className="w-full bg-green-600 text-white font-bold py-3 rounded-lg flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition-transform transform hover:scale-105">
                      {converting3D ? (
                        <><Loader2 className="h-5 w-5 animate-spin mr-2" /> 正在转换...</>
                      ) : (
                        <><Wand2 className="h-5 w-5 mr-2" /> 开始转换 (消耗 10 点数)</>
                      )}
                    </button>

                    {converting3D && (
                      <div className="mt-4 text-center">
                        <p className="text-sm text-gray-400">3D 模型转换中，通常需要 1-2 分钟...</p>
                      </div>
                    )}
                    {error3D && !converting3D && (
                       <p className="mt-4 text-center text-red-400">{error3D}</p>
                    )}
                    
                    {glbUrl && (
                      <div className="mt-6">
                        <h4 className="font-semibold mb-2">3D 模型预览与下载</h4>
                        <div className="aspect-video bg-gray-800 rounded-lg overflow-hidden">
                           <ModelViewer src={glbUrl} />
                        </div>
                        <div className="flex items-center space-x-2 mt-2">
                          <a href={glbUrl} download="virtual_idol.glb" className="px-4 py-2 bg-blue-600 rounded-md text-sm">下载 GLB</a>
                          <a href={objUrl} download="virtual_idol.obj" className="px-4 py-2 bg-gray-600 rounded-md text-sm">下载 OBJ</a>
                          <a href={textureUrl3D} download="virtual_idol_texture.png" className="px-4 py-2 bg-gray-600 rounded-md text-sm">下载贴图</a>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* History Panel */}
            {history.length > 0 && (
              <div className="mt-6 bg-[#1A1A1C] p-6 rounded-2xl">
                <h3 className="text-xl font-bold mb-4">生成历史</h3>
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {history.map((item, index) => (
                    <div key={index} className="relative group cursor-pointer" onClick={() => setGeneratedImage(item.imageUrl)}>
                      <img src={item.imageUrl} alt={`History ${index}`} className="w-full aspect-square object-cover rounded-lg" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-white text-xs text-center">点击查看</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
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
