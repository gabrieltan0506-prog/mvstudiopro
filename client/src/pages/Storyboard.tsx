import React, { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { ExpiryWarningBanner, CreationHistoryPanel } from "@/components/CreationManager";
import {
  ChevronRight,
  Sparkles,
  X,
  Download,
  FileText,
  FileUp,
  Info,
  Loader2,
  Zap,
  Crown,
  Palette,
  RefreshCw,
  Music,
  Play,
  Pause,
  Upload,
  Image as ImageIcon,
  Wand2,
  Film,
  Clapperboard,
  Camera,
  Aperture,
  Rocket,
  Eye,
  Bot,
} from "lucide-react";

import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { JOB_PROGRESS_MESSAGES, createJob, getJob } from "@/lib/jobs";
import { UsageQuotaBanner } from "@/components/UsageQuotaBanner";
import { StudentUpgradePrompt } from "@/components/StudentUpgradePrompt";
import { TrialCountdownBanner } from "@/components/TrialCountdownBanner";
import { QuotaExhaustedModal } from "@/components/QuotaExhaustedModal";
import {
  NbpEngineSelector,
  type EngineOption,
} from "@/components/NbpEngineSelector";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StoryboardScene {
  sceneNumber: number;
  timestamp: string;
  duration: string;
  description: string;
  cameraMovement: string;
  mood: string;
  visualElements: string[];
  transition?: string;
  previewImageUrl?: string | null;
}

interface StoryboardResult {
  title: string;
  musicInfo: {
    bpm: number;
    emotion: string;
    style: string;
    key: string;
  };
  scenes: StoryboardScene[];
  summary: string;
  characterDescription?: string;
}

// Character limit constants
const AI_GENERATE_MAX_CHARS = 1000;
const OWN_SCRIPT_MAX_CHARS = 2000;
const FREE_MAX_SCENES = 10;
const PAID_MAX_SCENES = 20;

type ModelOption = "flash" | "gpt5" | "pro";
type VisualStyle = "cinematic" | "anime" | "documentary" | "realistic" | "scifi";

const MODEL_OPTIONS: { value: ModelOption; label: string; desc: string; cost: string; icon: React.ElementType }[] = [
  {
    value: "flash",
    label: "Gemini 3.0 Flash",
    desc: "快速生成，適合日常使用",
    cost: "8 Credits",
    icon: Zap,
  },
  {
    value: "gpt5",
    label: "GPT 5.1",
    desc: "更創意的分鏡描述與專業建議",
    cost: "20 Credits",
    icon: Crown,
  },
  {
    value: "pro",
    label: "Gemini 3.0 Pro",
    desc: "最精準的分鏡描述與專業分析",
    cost: "15 Credits",
    icon: Crown,
  },
];

const STYLE_PREVIEW_IMAGES: Record<VisualStyle, string> = {
  cinematic: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/OfYyGiJYGGEyyyaO.jpg",
  anime: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/wJFLERjbQmHglxpX.jpg",
  documentary: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/kqzgxoltqOaoIBeB.jpg",
  realistic: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/HgZpAMNOnPhuOARA.jpg",
  scifi: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/UuptArvXiNFSMyPj.jpg",
};

const VISUAL_STYLES: { value: VisualStyle; label: string; labelEn: string; icon: React.ElementType; gradient: string; desc: string }[] = [
  { value: "cinematic", label: "電影感", labelEn: "Cinematic", icon: Film, gradient: "from-amber-500/80 to-red-600/80", desc: "電影級光影、色彩分級、寬銀幕構圖。參考：王家衛、扎克·施奈德" },
  { value: "anime", label: "動漫風", labelEn: "Anime", icon: Sparkles, gradient: "from-cyan-400/80 to-blue-600/80", desc: "日系動漫視覺語言、鮮艷色彩、光效粒子。參考：新海誠、宮崎駿" },
  { value: "documentary", label: "紀錄片", labelEn: "Documentary", icon: Camera, gradient: "from-yellow-500/80 to-orange-600/80", desc: "真實感、自然光線、手持鏡頭、沉浸式敘事" },
  { value: "realistic", label: "寫實片", labelEn: "Realistic", icon: Aperture, gradient: "from-emerald-400/80 to-teal-600/80", desc: "自然色調、真實場景、生活化光線構圖" },
  { value: "scifi", label: "科幻片", labelEn: "Sci-Fi", icon: Rocket, gradient: "from-purple-500/80 to-indigo-600/80", desc: "霓虹燈光、全息投影、賽博朋克色調" },
];

export default function StoryboardPage() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading, user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [lyricsText, setLyricsText] = useState("");
  const [sceneCount, setSceneCount] = useState("5");
  const [selectedModel, setSelectedModel] = useState<ModelOption>("flash");
  const [selectedStyle, setSelectedStyle] = useState<VisualStyle>("cinematic");
  const [isGenerating, setIsGenerating] = useState(false);
  const [storyboard, setStoryboard] = useState<StoryboardResult | null>(null);
  const [editingSceneId, setEditingSceneId] = useState<number | null>(null);
  const [editedScene, setEditedScene] = useState<StoryboardScene | null>(null);
  const [imageEngine, setImageEngine] = useState<EngineOption>("forge");
  const [showInspirationModal, setShowInspirationModal] = useState(false);
  const [inspirationInput, setInspirationInput] = useState("");
  const [isGeneratingInspiration, setIsGeneratingInspiration] = useState(false);
  const [upgradePromptDismissed, setUpgradePromptDismissed] = useState(false);
  const [quotaModalVisible, setQuotaModalVisible] = useState(false);
  const [quotaModalInfo, setQuotaModalInfo] = useState<{ isTrial?: boolean; planName?: string }>({});
  const [scriptSource, setScriptSource] = useState<"own" | "ai">("own");
  const [exportMenuVisible, setExportMenuVisible] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  // AI Rewrite states
  const [showRewritePanel, setShowRewritePanel] = useState(false);
  const [rewriteFeedback, setRewriteFeedback] = useState("");
  const [isRewriting, setIsRewriting] = useState(false);

  // BGM Generation states
  const [showBgmPanel, setShowBgmPanel] = useState(false);
  const [bgmDescription, setBgmDescription] = useState("");
  const [bgmStylePreset, setBgmStylePreset] = useState("cinematic_epic");
  const [bgmModel, setBgmModel] = useState<"V4" | "V5">("V4");
  const [bgmTitle, setBgmTitle] = useState("");
  const [isGeneratingBgm, setIsGeneratingBgm] = useState(false);
  const [bgmTaskId, setBgmTaskId] = useState<string | null>(null);
  const [bgmResult, setBgmResult] = useState<any>(null);
  const [bgmErrorMessage, setBgmErrorMessage] = useState<string | null>(null);
  const [bgmProgressMessage, setBgmProgressMessage] = useState<string>(JOB_PROGRESS_MESSAGES.audio[0]);
  const bgmPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [playingAudioUrl, setPlayingAudioUrl] = useState<string | null>(null);
  const [audioRef] = useState(() => typeof Audio !== 'undefined' ? new Audio() : null);

  // AI Recommend BGM states
  const [isRecommendingBgm, setIsRecommendingBgm] = useState(false);
  const [recommendBgmModel, setRecommendBgmModel] = useState<"pro" | "gpt5">("pro");

  // Reference image states
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [referenceImagePreview, setReferenceImagePreview] = useState<string | null>(null);
  const [referenceStyleDescription, setReferenceStyleDescription] = useState<string>("");
  const [isAnalyzingRef, setIsAnalyzingRef] = useState(false);
  const refImageInputRef = useRef<HTMLInputElement>(null);

  const generateStoryboard = trpc.storyboard.generate.useMutation();
  const rewriteMutation = trpc.storyboard.rewrite.useMutation();
  const checkAccessMutation = trpc.usage.checkFeatureAccess.useMutation();
  const exportPDFMutation = trpc.storyboard.exportPDF.useMutation();
  const inspirationMutation = trpc.storyboard.generateInspiration.useMutation();
  const recommendBGMMutation = trpc.storyboard.recommendBGM.useMutation();
  const analyzeRefMutation = trpc.storyboard.analyzeReferenceImage.useMutation();
  const stylePresetsQuery = trpc.suno.getStylePresets.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
  });
  const creditCostsQuery = trpc.suno.getCreditCosts.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
  });

  const usageStatsQuery = trpc.usage.getUsageStats.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
    refetchOnMount: true,
  });
  const subQuery = trpc.stripe.getSubscription.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
  });
  const userPlan = (subQuery.data?.plan || "free") as string;
  const userCredits = subQuery.data?.credits?.balance ?? 0;

  const startBgmPolling = (jobId: string) => {
    if (bgmPollingRef.current) clearInterval(bgmPollingRef.current);
    let attempts = 0;
    setBgmProgressMessage(JOB_PROGRESS_MESSAGES.audio[0]);

    bgmPollingRef.current = setInterval(async () => {
      attempts++;
      const idx = Math.floor(attempts / 2) % JOB_PROGRESS_MESSAGES.audio.length;
      setBgmProgressMessage(JOB_PROGRESS_MESSAGES.audio[idx]);

      try {
        const job = await getJob(jobId);
        if (job.status === "succeeded") {
          if (bgmPollingRef.current) {
            clearInterval(bgmPollingRef.current);
            bgmPollingRef.current = null;
          }
          setBgmTaskId(null);
          setBgmResult(job.output);
          setBgmErrorMessage(null);
          toast.success("BGM 生成完成！");
        } else if (job.status === "failed") {
          if (bgmPollingRef.current) {
            clearInterval(bgmPollingRef.current);
            bgmPollingRef.current = null;
          }
          setBgmTaskId(null);
          setBgmErrorMessage("这次生成没有成功，请重试。");
        }
      } catch {
        // Keep polling for transient errors.
      }
    }, 1800);
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (bgmPollingRef.current) {
        clearInterval(bgmPollingRef.current);
        bgmPollingRef.current = null;
      }
      if (audioRef) {
        audioRef.pause();
        audioRef.src = "";
      }
    };
  }, [audioRef]);

  // 根據用戶方案確定最大分鏡數
  const isPaidUser = isAdmin || userPlan !== "free";
  const maxScenes = isPaidUser ? PAID_MAX_SCENES : FREE_MAX_SCENES;

  // 生成分鏡數下拉選單選項
  const sceneCountOptions = useMemo(() => {
    const options: { value: string; label: string; disabled?: boolean }[] = [];
    for (let i = 1; i <= PAID_MAX_SCENES; i++) {
      const isPaidOnly = i > FREE_MAX_SCENES;
      options.push({
        value: String(i),
        label: isPaidOnly && !isPaidUser
          ? `${i} 個分鏡（需付費）`
          : `${i} 個分鏡`,
        disabled: isPaidOnly && !isPaidUser,
      });
    }
    return options;
  }, [isPaidUser]);

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate("/login");
    }
  }, [loading, isAuthenticated, navigate]);

  const charCount = lyricsText.length;
  const currentMaxChars = scriptSource === "ai" ? AI_GENERATE_MAX_CHARS : OWN_SCRIPT_MAX_CHARS;
  const isOverCharLimit = charCount > currentMaxChars;

  // Reference image upload handler
  const handleRefImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("圖片大小不能超過 10MB");
      return;
    }

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => {
      setReferenceImagePreview(ev.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload to S3 via base64
    try {
      const base64 = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => {
          const result = r.result as string;
          resolve(result.split(",")[1]);
        };
        r.readAsDataURL(file);
      });

      // Use existing upload endpoint
      const uploadResult = await fetch("/api/trpc/paymentSubmission.uploadScreenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: { imageBase64: base64, mimeType: file.type } }),
      });
      const uploadData = await uploadResult.json();
      if (uploadData?.result?.data?.json?.url) {
        setReferenceImageUrl(uploadData.result.data.json.url);
        toast.success("參考圖已上傳");

        // Auto-analyze style
        setIsAnalyzingRef(true);
        try {
          const analysis = await analyzeRefMutation.mutateAsync({
            imageUrl: uploadData.result.data.json.url,
          });
          if (analysis.success && analysis.styleDescription) {
            setReferenceStyleDescription(analysis.styleDescription);
            toast.success("參考圖風格分析完成（3 Credits）");
          }
        } catch (err: any) {
          toast.error(err.message || "風格分析失敗");
        } finally {
          setIsAnalyzingRef(false);
        }
      }
    } catch (err: any) {
      toast.error("圖片上傳失敗");
      setReferenceImagePreview(null);
    }
  };

  const handleGenerate = async () => {
    if (!lyricsText.trim()) {
      toast.warning("請輸入歌詞或文本內容");
      return;
    }

    if (isOverCharLimit) {
      toast.error(
        `您的文本為 ${charCount} 字，超出${scriptSource === "ai" ? "AI 生成" : "自有腳本"}的額度 ${currentMaxChars} 字。超出部分需消耗 Credits。`,
        {
          action: {
            label: "查看 Credits",
            onClick: () => navigate("/pricing"),
          },
        }
      );
      return;
    }

    const numSceneCount = parseInt(sceneCount, 10);
    if (numSceneCount > maxScenes) {
      toast.error(`當前方案最多 ${FREE_MAX_SCENES} 個分鏡，請升級方案或減少分鏡數`);
      return;
    }

    try {
      const accessCheck = await checkAccessMutation.mutateAsync({ featureType: "storyboard" });
      if (!accessCheck.allowed) {
        setQuotaModalInfo({
          isTrial: (accessCheck as any).isTrial,
          planName: (accessCheck as any).planName,
        });
        setQuotaModalVisible(true);
        return;
      }
    } catch (error: any) {
      toast.error(error.message || "無法檢查使用權限");
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generateStoryboard.mutateAsync({
        lyrics: lyricsText,
        sceneCount: numSceneCount,
        model: selectedModel,
        visualStyle: selectedStyle,
        referenceImageUrl: referenceImageUrl || undefined,
        referenceStyleDescription: referenceStyleDescription || undefined,
      });

      if (result.success && result.storyboard) {
        setStoryboard(result.storyboard as StoryboardResult);
        usageStatsQuery.refetch();
        toast.success(result.message || "分鏡腳本已生成！");
        if ((result.storyboard as any).title) {
          setBgmTitle((result.storyboard as any).title + " - BGM");
        }
      }
    } catch (error: any) {
      console.error("Error generating storyboard:", error);
      toast.error(error.message || "生成分鏡腳本失敗，請重試");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReset = () => {
    if (bgmPollingRef.current) {
      clearInterval(bgmPollingRef.current);
      bgmPollingRef.current = null;
    }
    setLyricsText("");
    setSceneCount("5");
    setStoryboard(null);
    setScriptSource("own");
    setSelectedModel("flash");
    setSelectedStyle("cinematic");
    setShowRewritePanel(false);
    setRewriteFeedback("");
    setShowBgmPanel(false);
    setBgmResult(null);
    setBgmTaskId(null);
    setBgmErrorMessage(null);
    setBgmProgressMessage(JOB_PROGRESS_MESSAGES.audio[0]);
    setReferenceImageUrl(null);
    setReferenceImagePreview(null);
    setReferenceStyleDescription("");
  };

  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleExport = async (format: "pdf" | "word") => {
    if (!storyboard) {
      toast.error("請先生成分鏡腳本");
      return;
    }

    const formatName = format === 'pdf' ? 'PDF' : 'Word';
    try {
      setExportStatus(`正在生成 ${formatName}...`);
      setExportMenuVisible(false);
      const result = await exportPDFMutation.mutateAsync({ storyboard, format });
      
      if (result.success && result.pdfUrl) {
        setExportStatus(`${formatName} 已生成，正在下載...`);
        triggerDownload(result.pdfUrl, `${storyboard.title || 'storyboard'}.${format === 'pdf' ? 'pdf' : 'docx'}`);
        toast.success(`${formatName} 導出成功！`);
        setTimeout(() => setExportStatus(null), 3000);
      } else {
        setExportStatus(result.message || `${formatName} 生成失敗，請重試`);
        toast.error(`${formatName} 生成失敗`);
        setTimeout(() => setExportStatus(null), 5000);
      }
    } catch (error: any) {
      console.error(`[Export ${formatName} Error]`, error);
      const errMsg = error.message || '未知錯誤';
      setExportStatus(`導出失敗: ${errMsg}`);
      toast.error(`導出失敗: ${errMsg}`);
      setTimeout(() => setExportStatus(null), 5000);
    }
  };

  const handleEditScene = (scene: StoryboardScene) => {
    setEditingSceneId(scene.sceneNumber);
    setEditedScene({ ...scene });
  };

  const handleSaveEdit = () => {
    if (!editedScene || !storyboard) return;
    const updatedScenes = storyboard.scenes.map((scene) =>
      scene.sceneNumber === editedScene.sceneNumber ? editedScene : scene
    );
    setStoryboard({ ...storyboard, scenes: updatedScenes });
    setEditingSceneId(null);
    setEditedScene(null);
    toast.success("場景已更新！");
  };

  const handleCancelEdit = () => {
    setEditingSceneId(null);
    setEditedScene(null);
  };

  const handleUpdateField = (field: keyof StoryboardScene, value: any) => {
    if (!editedScene) return;
    setEditedScene({ ...editedScene, [field]: value });
  };

  const handleGenerateInspiration = async () => {
    if (!inspirationInput.trim()) {
      toast.warning("請輸入靈感描述");
      return;
    }
    setIsGeneratingInspiration(true);
    try {
      const result = await inspirationMutation.mutateAsync({ briefDescription: inspirationInput.trim() });
      if (result.success && result.text) {
        setLyricsText(result.text);
        setScriptSource("ai");
        setShowInspirationModal(false);
        setInspirationInput("");
        toast.success("靈感腳本已生成，您可以繼續編輯或直接生成分鏡");
      }
    } catch (error: any) {
      toast.error(error.message || "生成失敗，請重試");
    } finally {
      setIsGeneratingInspiration(false);
    }
  };

  // AI Rewrite handler
  const handleRewrite = async () => {
    if (!storyboard) return;
    if (!rewriteFeedback.trim()) {
      toast.warning("請輸入您的修改意見");
      return;
    }

    setIsRewriting(true);
    try {
      const result = await rewriteMutation.mutateAsync({
        originalStoryboard: storyboard,
        userFeedback: rewriteFeedback.trim(),
        visualStyle: selectedStyle,
        model: selectedModel,
      });

      if (result.success && result.storyboard) {
        setStoryboard(result.storyboard as StoryboardResult);
        setShowRewritePanel(false);
        setRewriteFeedback("");
        toast.success(result.message || "分鏡腳本已改寫！");
      }
    } catch (error: any) {
      toast.error(error.message || "改寫失敗，請重試");
    } finally {
      setIsRewriting(false);
    }
  };

  // AI Recommend BGM handler
  const handleRecommendBGM = async () => {
    if (!storyboard) return;
    setIsRecommendingBgm(true);
    try {
      const result = await recommendBGMMutation.mutateAsync({
        storyboard: {
          title: storyboard.title,
          musicInfo: storyboard.musicInfo,
          scenes: storyboard.scenes.map(s => ({
            sceneNumber: s.sceneNumber,
            description: s.description,
            mood: s.mood,
            visualElements: s.visualElements,
          })),
          summary: storyboard.summary,
        },
        model: recommendBgmModel,
      });

      if (result.success && result.bgm) {
        const bgm = result.bgm as any;
        setBgmTitle(bgm.title || storyboard.title + " - BGM");
        setBgmDescription(bgm.description || "");
        // Try to match style preset
        if (bgm.style) {
          const matchedPreset = (stylePresetsQuery.data || []).find(
            (p: any) => bgm.style.toLowerCase().includes(p.labelEn?.toLowerCase())
          );
          if (matchedPreset) setBgmStylePreset((matchedPreset as any).id);
        }
        toast.success(`AI 已推薦 BGM 描述（${recommendBgmModel === "gpt5" ? "GPT 5.1" : "Gemini 3.0 Pro"}，5 Credits）`);
        setShowBgmPanel(true);
      }
    } catch (error: any) {
      toast.error(error.message || "AI 推薦失敗");
    } finally {
      setIsRecommendingBgm(false);
    }
  };

  // BGM Generation handler
  const handleGenerateBgm = async () => {
    if (!bgmTitle.trim()) {
      toast.warning("請輸入 BGM 標題");
      return;
    }
    if (!user?.id) {
      toast.error("登录状态已失效，请重新登录后再试。");
      return;
    }

    setIsGeneratingBgm(true);
    setBgmErrorMessage(null);
    setBgmResult(null);
    try {
      const { jobId } = await createJob({
        type: "audio",
        userId: String(user.id),
        input: {
          action: "suno_music",
          params: {
            mode: "bgm",
            model: bgmModel,
            title: bgmTitle.trim(),
            stylePresetId: bgmStylePreset,
            customStyle: bgmStylePreset === "custom" ? bgmDescription : undefined,
            mood: bgmDescription || undefined,
          },
        },
      });

      setBgmTaskId(jobId);
      startBgmPolling(jobId);
      toast.success("BGM 任务已提交，正在生成中...");
    } catch (error: any) {
      toast.error("BGM 任务提交失败，请重试");
    } finally {
      setIsGeneratingBgm(false);
    }
  };

  // Audio playback
  const handlePlayAudio = (url: string) => {
    if (!audioRef) return;
    if (playingAudioUrl === url) {
      audioRef.pause();
      setPlayingAudioUrl(null);
    } else {
      audioRef.src = url;
      audioRef.play();
      setPlayingAudioUrl(url);
      audioRef.onended = () => setPlayingAudioUrl(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">檢查登入狀態...</p>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* CSS for smooth transitions */}
      <style>{`
        .style-card {
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          transform: scale(1);
        }
        .style-card:hover {
          transform: scale(1.03);
          box-shadow: 0 8px 30px rgba(0,0,0,0.3);
        }
        .style-card:active {
          transform: scale(0.98);
          transition-duration: 0.1s;
        }
        .style-card.selected {
          transform: scale(1.02);
          box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.6), 0 8px 25px -5px rgba(99, 102, 241, 0.3);
        }
        .style-card .preview-img {
          transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
          filter: brightness(0.6);
        }
        .style-card:hover .preview-img,
        .style-card.selected .preview-img {
          filter: brightness(0.8);
          transform: scale(1.08);
        }
        .style-card .overlay-gradient {
          transition: opacity 0.4s ease;
        }
        .style-card.selected .overlay-gradient {
          opacity: 0.85;
        }
        .style-card .icon-wrap {
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .style-card:hover .icon-wrap,
        .style-card.selected .icon-wrap {
          transform: scale(1.15);
        }
        .style-desc-enter {
          animation: fadeSlideUp 0.35s ease-out;
        }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .panel-enter {
          animation: panelSlideIn 0.3s ease-out;
        }
        @keyframes panelSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="overflow-y-auto">
        <UsageQuotaBanner
          featureType="storyboard"
          currentCount={usageStatsQuery.data?.features.storyboard.currentCount ?? 0}
          freeLimit={usageStatsQuery.data?.features.storyboard.limit ?? 1}
          loading={usageStatsQuery.isPending}
        />

        <TrialCountdownBanner
          isTrial={(usageStatsQuery.data as any)?.isTrial}
          trialEndDate={(usageStatsQuery.data as any)?.trialEndDate}
        />

        {usageStatsQuery.data?.studentPlan && (
          <StudentUpgradePrompt
            studentPlan={usageStatsQuery.data.studentPlan}
            usageData={usageStatsQuery.data.features}
            isTrial={(usageStatsQuery.data as any).isTrial}
            trialEndDate={(usageStatsQuery.data as any).trialEndDate}
            style={{ display: !upgradePromptDismissed ? 'block' : 'none' }}
            onDismiss={() => setUpgradePromptDismissed(true)}
          />
        )}

        <div className="px-6 pt-6 pb-4">
          <h1 className="text-3xl font-bold text-foreground mb-2">智能腳本與分鏡生成</h1>
          <p className="text-base text-muted-foreground">輸入歌詞或文本，AI 自動生成專業視頻分鏡腳本</p>
        </div>

        {!storyboard && (
          <div className="px-6 py-4">
            <div className="bg-card rounded-2xl p-6 border">
              {/* AI 靈感助手 */}
              {!showInspirationModal ? (
                <button
                  onClick={() => setShowInspirationModal(true)}
                  className="mb-4 rounded-xl p-4 flex items-center w-full bg-primary/10 border border-primary/20 hover:bg-primary/20 transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] hover:shadow-lg hover:shadow-primary/10 hover:border-primary/40"
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center mr-3 bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20">
                    <Wand2 className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-foreground font-semibold text-base">創作沒靈感？</p>
                    <p className="text-muted-foreground text-sm mt-0.5">給我三句話，我幫你生成完整腳本（5 Credits）</p>
                  </div>
                  <ChevronRight className="w-[22px] h-[22px] text-muted-foreground" />
                </button>
              ) : (
                <div className="mb-4 rounded-xl p-4 bg-primary/10 border border-primary/20 panel-enter">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center">
                      <Wand2 className="w-5 h-5 text-primary" />
                      <p className="text-foreground font-semibold ml-2">AI 靈感助手</p>
                      <div className="ml-2 bg-yellow-500/15 px-2 py-0.5 rounded-full">
                        <p className="text-yellow-500 text-xs font-medium">5 Credits</p>
                      </div>
                    </div>
                    <button onClick={() => { setShowInspirationModal(false); setInspirationInput(""); }}>
                      <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                  </div>
                  <p className="text-muted-foreground text-sm mb-1">接入 Gemini 大模型，根據描述生成專業腳本</p>
                  <p className="text-muted-foreground text-sm mb-3">例如：「一對情侶在雨天的東京重逢，從陳舊的咖啡廳開始」</p>
                  <Textarea
                    value={inspirationInput}
                    onChange={(e) => setInspirationInput(e.target.value)}
                    placeholder="用 1-3 句話描述你的靈感..."
                    maxLength={200}
                    rows={3}
                    className="bg-background rounded-lg p-3 text-foreground mb-3 text-base resize-none"
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-muted-foreground text-xs">{inspirationInput.length}/200</p>
                    <Button
                      onClick={handleGenerateInspiration}
                      disabled={!inspirationInput.trim() || isGeneratingInspiration}
                    >
                      {isGeneratingInspiration ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          <span>生成中...</span>
                        </>
                      ) : (
                        <>
                          <Wand2 className="w-4 h-4 mr-1" />
                          <span>生成腳本</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* 歌詞/文本輸入 */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center">
                    <p className="text-lg font-semibold text-foreground">歌詞或文本內容</p>
                    {scriptSource === "ai" && (
                      <div className="ml-2 bg-primary/15 px-2 py-0.5 rounded-full">
                        <p className="text-primary text-xs font-medium">AI 生成</p>
                      </div>
                    )}
                  </div>
                  <p className={`text-sm font-medium ${isOverCharLimit ? "text-destructive" : "text-muted-foreground"}`}>
                    {charCount}/{currentMaxChars} 字
                  </p>
                </div>
                <Textarea
                  value={lyricsText}
                  onChange={(e) => {
                    setLyricsText(e.target.value);
                    if (e.target.value.length === 0) setScriptSource("own");
                  }}
                  placeholder="請輸入歌詞或文本內容..."
                  rows={10}
                  className={`bg-background rounded-xl p-4 text-foreground text-base resize-none ${isOverCharLimit ? "border-destructive" : "border"}`}
                />
                {isOverCharLimit && (
                  <p className="text-destructive text-sm mt-2">
                    超出額度 {charCount - currentMaxChars} 字，超出部分需消耗 Credits
                  </p>
                )}
              </div>

              {/* 視覺風格選擇 - 帶預覽圖的卡片 */}
              <div className="mb-5">
                <label className="text-base font-semibold text-foreground mb-3 block">視覺風格</label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                  {VISUAL_STYLES.map((style) => {
                    const Icon = style.icon;
                    const isSelected = selectedStyle === style.value;
                    return (
                      <button
                        key={style.value}
                        onClick={() => setSelectedStyle(style.value)}
                        className={`style-card relative overflow-hidden rounded-xl aspect-[3/4] ${isSelected ? "selected ring-2 ring-indigo-500" : ""}`}
                      >
                        {/* Background preview image */}
                        <img
                          src={STYLE_PREVIEW_IMAGES[style.value]}
                          alt={style.label}
                          className="preview-img absolute inset-0 w-full h-full object-cover"
                          loading="lazy"
                        />
                        {/* Gradient overlay */}
                        <div className={`overlay-gradient absolute inset-0 bg-gradient-to-t ${style.gradient} ${isSelected ? "opacity-80" : "opacity-60"}`} />
                        {/* Content */}
                        <div className="relative z-10 flex flex-col items-center justify-center h-full p-2">
                          <div className={`icon-wrap w-10 h-10 rounded-full flex items-center justify-center mb-2 ${isSelected ? "bg-white/30 backdrop-blur-sm" : "bg-black/20 backdrop-blur-sm"}`}>
                            <Icon className="w-5 h-5 text-white drop-shadow-md" />
                          </div>
                          <span className="text-white font-bold text-sm drop-shadow-md">{style.label}</span>
                          <span className="text-white/70 text-[10px] mt-0.5 drop-shadow-sm">{style.labelEn}</span>
                        </div>
                        {/* Selected indicator */}
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center shadow-lg">
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                {/* Style description with animation */}
                <div key={selectedStyle} className="style-desc-enter mt-3 bg-muted/30 rounded-lg px-3 py-2">
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{VISUAL_STYLES.find(s => s.value === selectedStyle)?.label}</span>
                    {" — "}
                    {VISUAL_STYLES.find(s => s.value === selectedStyle)?.desc}
                  </p>
                </div>
              </div>

              {/* 參考圖上傳 */}
              <div className="mb-5">
                <label className="text-base font-semibold text-foreground mb-2 block">參考圖片（可選）</label>
                <p className="text-xs text-muted-foreground mb-3">上傳參考圖，AI 會分析其風格並生成類似視覺效果的分鏡（3 Credits）</p>
                <input
                  ref={refImageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleRefImageUpload}
                  className="hidden"
                />
                {!referenceImagePreview ? (
                  <button
                    onClick={() => refImageInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-muted-foreground/30 rounded-xl p-6 flex flex-col items-center justify-center hover:border-primary/50 hover:bg-primary/5 transition-all duration-300"
                  >
                    <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-2">
                      <Upload className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <p className="text-muted-foreground text-sm">點擊上傳參考圖片</p>
                    <p className="text-muted-foreground/60 text-xs mt-1">支持 JPG、PNG，最大 10MB</p>
                  </button>
                ) : (
                  <div className="relative rounded-xl overflow-hidden border bg-muted/20">
                    <img src={referenceImagePreview} alt="Reference" className="w-full max-h-48 object-contain" />
                    <button
                      onClick={() => {
                        setReferenceImageUrl(null);
                        setReferenceImagePreview(null);
                        setReferenceStyleDescription("");
                      }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80 transition-colors"
                    >
                      <X className="w-4 h-4 text-white" />
                    </button>
                    {isAnalyzingRef && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-sm">
                        <div className="flex items-center gap-2 bg-black/60 rounded-lg px-4 py-2">
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                          <span className="text-white text-sm">分析風格中...</span>
                        </div>
                      </div>
                    )}
                    {referenceStyleDescription && (
                      <div className="p-3 bg-indigo-500/10 border-t border-indigo-500/20">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Eye className="w-3.5 h-3.5 text-indigo-400" />
                          <span className="text-indigo-400 text-xs font-medium">風格分析結果</span>
                        </div>
                        <p className="text-muted-foreground text-xs leading-relaxed">{referenceStyleDescription}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* AI 模型選擇 */}
              <div className="mb-4">
                <p className="text-lg font-semibold text-foreground mb-2">AI 模型</p>
                <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v as ModelOption)}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue placeholder="選擇 AI 模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4" />
                            <span className="font-medium">{opt.label}</span>
                            <span className="text-muted-foreground text-xs">— {opt.desc}</span>
                            <span className="text-xs font-semibold ml-auto text-yellow-500">
                              {opt.cost}
                            </span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <p className="text-yellow-500 text-xs mt-1.5">
                  {selectedModel === "gpt5" ? "GPT 5.1 每次生成消耗 20 Credits" : selectedModel === "pro" ? "Gemini 3.0 Pro 每次生成消耗 15 Credits" : "Gemini 3.0 Flash 每次生成消耗 8 Credits"}
                </p>
              </div>

              {/* 分鏡數量 */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-lg font-semibold text-foreground">分鏡數量</p>
                  <p className="text-xs text-muted-foreground">
                    {isPaidUser ? `最多 ${PAID_MAX_SCENES} 個` : `基礎版最多 ${FREE_MAX_SCENES} 個`}
                  </p>
                </div>
                <Select value={sceneCount} onValueChange={setSceneCount}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue placeholder="選擇分鏡數量" />
                  </SelectTrigger>
                  <SelectContent>
                    {sceneCountOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 圖片引擎選擇 */}
              <div className="mb-6">
                <NbpEngineSelector
                  selected={imageEngine}
                  onSelect={setImageEngine}
                  plan={userPlan}
                  creditsAvailable={userCredits}
                  isAdmin={isAdmin}
                />
              </div>

              {/* 生成按鈕 */}
              <Button onClick={handleGenerate} disabled={!lyricsText.trim() || isGenerating} className="w-full py-6 text-lg bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-lg shadow-indigo-500/20 transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] hover:shadow-xl hover:shadow-indigo-500/30 ripple-effect">
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    <span>AI 生成中...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 mr-2" />
                    <span>生成分鏡腳本</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* 分鏡結果展示 */}
        {storyboard && (
          <div className="px-6 py-4">
            <div className="bg-card rounded-2xl p-6 border mb-4">
              <h2 className="text-xl font-bold text-foreground mb-4">{storyboard.title}</h2>
              <div className="flex flex-wrap gap-2">
                <div className="bg-primary/10 px-3 py-1 rounded-full">
                  <p className="text-primary text-sm font-medium">BPM: {storyboard.musicInfo.bpm}</p>
                </div>
                <div className="bg-primary/10 px-3 py-1 rounded-full">
                  <p className="text-primary text-sm font-medium">{storyboard.musicInfo.emotion}</p>
                </div>
                <div className="bg-primary/10 px-3 py-1 rounded-full">
                  <p className="text-primary text-sm font-medium">{storyboard.musicInfo.style}</p>
                </div>
                <div className="bg-primary/10 px-3 py-1 rounded-full">
                  <p className="text-primary text-sm font-medium">調性: {storyboard.musicInfo.key}</p>
                </div>
                <div className="bg-purple-500/10 px-3 py-1 rounded-full">
                  <p className="text-purple-400 text-sm font-medium">
                    風格: {VISUAL_STYLES.find(s => s.value === selectedStyle)?.label || "電影感"}
                  </p>
                </div>
              </div>
            </div>

            {/* AI 改寫面板 */}
            <div className="mb-4">
              {!showRewritePanel ? (
                <button
                  onClick={() => setShowRewritePanel(true)}
                  className="rounded-xl p-4 flex items-center w-full bg-orange-500/10 border border-orange-500/20 hover:bg-orange-500/20 transition-all duration-300"
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center mr-3 bg-gradient-to-br from-orange-400 to-red-500 shadow-lg shadow-orange-500/20">
                    <RefreshCw className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-foreground font-semibold text-base">不滿意？AI 幫你改</p>
                    <p className="text-muted-foreground text-sm mt-0.5">給我三句話描述修改方向，AI 重新改寫整個腳本（8 Credits）</p>
                  </div>
                  <ChevronRight className="w-[22px] h-[22px] text-muted-foreground" />
                </button>
              ) : (
                <div className="rounded-xl p-5 bg-orange-500/10 border border-orange-500/20 panel-enter">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center">
                      <RefreshCw className="w-5 h-5 text-orange-500" />
                      <p className="text-foreground font-semibold ml-2">AI 改寫腳本</p>
                      <div className="ml-2 bg-yellow-500/15 px-2 py-0.5 rounded-full">
                        <p className="text-yellow-500 text-xs font-medium">8 Credits</p>
                      </div>
                    </div>
                    <button onClick={() => { setShowRewritePanel(false); setRewriteFeedback(""); }}>
                      <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                  </div>
                  <p className="text-muted-foreground text-sm mb-3">
                    描述您希望如何修改，例如：「場景氛圍太暗了，希望更溫暖明亮」「鏡頭運動太單調，加入更多航拍和環繞鏡頭」
                  </p>
                  <Textarea
                    value={rewriteFeedback}
                    onChange={(e) => setRewriteFeedback(e.target.value)}
                    placeholder="用 1-3 句話描述您的修改意見..."
                    maxLength={500}
                    rows={3}
                    className="bg-background rounded-lg p-3 text-foreground mb-3 text-base resize-none"
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-muted-foreground text-xs">{rewriteFeedback.length}/500</p>
                    <Button
                      onClick={handleRewrite}
                      disabled={!rewriteFeedback.trim() || isRewriting}
                      className="bg-orange-500 hover:bg-orange-600 text-white"
                    >
                      {isRewriting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          <span>改寫中...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4 mr-1" />
                          <span>AI 改寫</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="mb-4">
              <h2 className="text-xl font-bold text-foreground mb-3">分鏡詳情</h2>
              {storyboard.scenes.map((scene) => {
                const isEditing = editingSceneId === scene.sceneNumber;
                const displayScene = isEditing && editedScene ? editedScene : scene;
                
                return (
                  <div key={scene.sceneNumber} className="bg-card rounded-2xl p-5 border mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-bold text-foreground">場景 {scene.sceneNumber}</h3>
                      <div className="flex items-center gap-2">
                        <p className="text-muted-foreground text-sm">
                          {scene.timestamp} ({scene.duration})
                        </p>
                        {!isEditing && (
                          <Button variant="outline" size="sm" onClick={() => handleEditScene(scene)} className="text-xs">
                            編輯
                          </Button>
                        )}
                      </div>
                    </div>
                    
                    {scene.previewImageUrl && (
                      <div className="mb-4 rounded-xl overflow-hidden bg-muted/30">
                        <img
                          src={scene.previewImageUrl}
                          alt={`Scene ${scene.sceneNumber} preview`}
                          className="w-full aspect-video object-contain"
                        />
                      </div>
                    )}

                    {!isEditing ? (
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">場景描述</p>
                          <p className="text-foreground text-sm leading-relaxed">{displayScene.description}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">鏡頭運動</p>
                          <p className="text-foreground text-sm">{displayScene.cameraMovement}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">情緒氛圍</p>
                          <p className="text-foreground text-sm">{displayScene.mood}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">視覺元素</p>
                          <div className="flex flex-wrap gap-1.5">
                            {displayScene.visualElements.map((el, idx) => (
                              <span key={idx} className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full">{el}</span>
                            ))}
                          </div>
                        </div>
                        {displayScene.transition && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">轉場建議</p>
                            <p className="text-foreground text-sm">{displayScene.transition}</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">場景描述</p>
                          <Textarea
                            value={editedScene?.description || ""}
                            onChange={(e) => handleUpdateField("description", e.target.value)}
                            rows={3}
                            className="bg-background text-sm"
                          />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">鏡頭運動</p>
                          <Textarea
                            value={editedScene?.cameraMovement || ""}
                            onChange={(e) => handleUpdateField("cameraMovement", e.target.value)}
                            rows={2}
                            className="bg-background text-sm"
                          />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">情緒氛圍</p>
                          <Textarea
                            value={editedScene?.mood || ""}
                            onChange={(e) => handleUpdateField("mood", e.target.value)}
                            rows={1}
                            className="bg-background text-sm"
                          />
                        </div>
                        <div className="flex gap-2 mt-3">
                          <Button onClick={handleSaveEdit} className="flex-1">保存</Button>
                          <Button onClick={handleCancelEdit} variant="secondary" className="flex-1">取消</Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="bg-card rounded-2xl p-6 border mb-4">
              <h3 className="text-lg font-bold text-foreground mb-3">整體建議</h3>
              <p className="text-foreground leading-relaxed">{storyboard.summary}</p>
            </div>

            {/* BGM 生成區域 */}
            <div className="mb-4">
              {!showBgmPanel ? (
                <div className="space-y-3">
                  <button
                    onClick={() => setShowBgmPanel(true)}
                    className="rounded-xl p-4 flex items-center w-full bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20 transition-all duration-300"
                  >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center mr-3 bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-500/20">
                      <Music className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-foreground font-semibold text-base">為分鏡生成 BGM 配樂</p>
                      <p className="text-muted-foreground text-sm mt-0.5">Suno AI 根據分鏡風格自動生成配樂（V4: {creditCostsQuery.data?.v4 ?? 12} Cr / V5: {creditCostsQuery.data?.v5 ?? 22} Cr）</p>
                    </div>
                    <ChevronRight className="w-[22px] h-[22px] text-muted-foreground" />
                  </button>

                  {/* AI 推薦 BGM 按鈕 */}
                  <button
                    onClick={handleRecommendBGM}
                    disabled={isRecommendingBgm}
                    className="rounded-xl p-4 flex items-center w-full bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all duration-300 disabled:opacity-50"
                  >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center mr-3 bg-gradient-to-br from-cyan-400 to-blue-600 shadow-lg shadow-cyan-500/20">
                      {isRecommendingBgm ? (
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      ) : (
                        <Bot className="w-5 h-5 text-white" />
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-foreground font-semibold text-base">
                        {isRecommendingBgm ? "AI 分析分鏡中..." : "AI 智能推薦 BGM 描述"}
                      </p>
                      <p className="text-muted-foreground text-sm mt-0.5">
                        Gemini 3.0 Pro / GPT 5.1 分析分鏡內容，自動填入最適合的 BGM 描述（5 Credits）
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select value={recommendBgmModel} onValueChange={(v) => setRecommendBgmModel(v as "pro" | "gpt5")}>
                        <SelectTrigger className="w-[130px] h-8 text-xs bg-background" onClick={(e) => e.stopPropagation()}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pro">Gemini 3.0 Pro</SelectItem>
                          <SelectItem value="gpt5">GPT 5.1</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </button>
                </div>
              ) : (
                <div className="rounded-xl p-5 bg-violet-500/10 border border-violet-500/20 panel-enter">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center">
                      <Music className="w-5 h-5 text-violet-500" />
                      <p className="text-foreground font-semibold ml-2">BGM 配樂生成</p>
                      <div className="ml-2 bg-yellow-500/15 px-2 py-0.5 rounded-full">
                        <p className="text-yellow-500 text-xs font-medium">消耗 Credits</p>
                      </div>
                    </div>
                    <button onClick={() => setShowBgmPanel(false)}>
                      <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                  </div>

                  {/* BGM Title */}
                  <div className="mb-3">
                    <p className="text-sm font-medium text-foreground mb-1">BGM 標題</p>
                    <input
                      type="text"
                      value={bgmTitle}
                      onChange={(e) => setBgmTitle(e.target.value)}
                      placeholder="輸入 BGM 標題..."
                      maxLength={80}
                      className="w-full bg-background rounded-lg px-3 py-2 text-foreground text-sm border"
                    />
                  </div>

                  {/* BGM Style Preset */}
                  <div className="mb-3">
                    <p className="text-sm font-medium text-foreground mb-1">音樂風格</p>
                    <Select value={bgmStylePreset} onValueChange={setBgmStylePreset}>
                      <SelectTrigger className="w-full bg-background">
                        <SelectValue placeholder="選擇音樂風格" />
                      </SelectTrigger>
                      <SelectContent>
                        {(stylePresetsQuery.data || []).map((preset: any) => (
                          <SelectItem key={preset.id} value={preset.id}>
                            {preset.label} ({preset.labelEn})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Custom description */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-foreground">補充描述（可選）</p>
                      <button
                        onClick={handleRecommendBGM}
                        disabled={isRecommendingBgm}
                        className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 disabled:opacity-50"
                      >
                        {isRecommendingBgm ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}
                        AI 智能填入
                      </button>
                    </div>
                    <Textarea
                      value={bgmDescription}
                      onChange={(e) => setBgmDescription(e.target.value)}
                      placeholder="描述您想要的 BGM 氛圍，例如：「開頭輕柔鋼琴，副歌時加入弦樂和鼓點，結尾漸弱」"
                      maxLength={500}
                      rows={2}
                      className="bg-background rounded-lg p-3 text-foreground text-sm resize-none"
                    />
                  </div>

                  {/* Suno Model Selection */}
                  <div className="mb-4">
                    <p className="text-sm font-medium text-foreground mb-1">Suno 引擎</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setBgmModel("V4")}
                        className={`rounded-lg p-3 text-left transition-all duration-300 border-2 ${
                          bgmModel === "V4"
                            ? "border-violet-500 bg-violet-500/10"
                            : "border-transparent bg-muted/30 hover:bg-muted/50"
                        }`}
                      >
                        <p className={`font-semibold text-sm ${bgmModel === "V4" ? "text-violet-400" : "text-foreground"}`}>
                          Suno V4
                        </p>
                        <p className="text-muted-foreground text-xs mt-0.5">性價比高</p>
                        <p className="text-yellow-500 text-xs font-semibold mt-1">{creditCostsQuery.data?.v4 ?? 12} Credits</p>
                      </button>
                      <button
                        onClick={() => setBgmModel("V5")}
                        className={`rounded-lg p-3 text-left transition-all duration-300 border-2 ${
                          bgmModel === "V5"
                            ? "border-violet-500 bg-violet-500/10"
                            : "border-transparent bg-muted/30 hover:bg-muted/50"
                        }`}
                      >
                        <p className={`font-semibold text-sm ${bgmModel === "V5" ? "text-violet-400" : "text-foreground"}`}>
                          Suno V5
                        </p>
                        <p className="text-muted-foreground text-xs mt-0.5">最新模型，更高音質</p>
                        <p className="text-yellow-500 text-xs font-semibold mt-1">{creditCostsQuery.data?.v5 ?? 22} Credits</p>
                      </button>
                    </div>
                  </div>

                  {/* Generate Button */}
                  <Button
                    onClick={handleGenerateBgm}
                    disabled={!bgmTitle.trim() || isGeneratingBgm || !!bgmTaskId}
                    className="w-full bg-gradient-to-r from-violet-500 to-fuchsia-600 hover:from-violet-600 hover:to-fuchsia-700 text-white shadow-lg shadow-violet-500/20"
                  >
                    {isGeneratingBgm || bgmTaskId ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        <span>{bgmTaskId ? "生成中，請稍候..." : "提交中..."}</span>
                      </>
                    ) : (
                      <>
                        <Music className="w-4 h-4 mr-1" />
                        <span>生成 BGM</span>
                      </>
                    )}
                  </Button>

                  {/* BGM Result */}
                  {bgmResult && bgmResult.songs && bgmResult.songs.length > 0 && (
                    <div className="mt-4 space-y-3">
                      <p className="text-sm font-semibold text-foreground">生成結果：</p>
                      {bgmResult.songs.map((song: any, idx: number) => (
                        <div key={song.id || idx} className="bg-background rounded-lg p-3 border flex items-center gap-3">
                          {song.imageUrl && (
                            <img src={song.imageUrl} alt="cover" className="w-12 h-12 rounded-lg object-cover" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-foreground text-sm font-medium truncate">{song.title || `BGM ${idx + 1}`}</p>
                            <p className="text-muted-foreground text-xs">{song.tags || "Instrumental"}</p>
                            {song.duration && (
                              <p className="text-muted-foreground text-xs">{Math.round(song.duration)}s</p>
                            )}
                          </div>
                          {(song.audioUrl || song.streamUrl) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePlayAudio(song.audioUrl || song.streamUrl)}
                              className="shrink-0"
                            >
                              {playingAudioUrl === (song.audioUrl || song.streamUrl) ? (
                                <Pause className="w-4 h-4" />
                              ) : (
                                <Play className="w-4 h-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* BGM Polling Status */}
                  {bgmTaskId && !bgmResult && (
                    <div className="mt-3 bg-background rounded-lg p-3 border flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
                      <p className="text-muted-foreground text-sm">{bgmProgressMessage}</p>
                    </div>
                  )}

                  {bgmErrorMessage && (
                    <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                      <p className="text-sm text-red-300">{bgmErrorMessage}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={handleGenerateBgm}
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-1" />
                        重试 BGM
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 導出按鈕 */}
            <div className="mb-6">
              <div className="flex gap-3 mb-3">
                <Button onClick={handleReset} variant="secondary" className="flex-1 py-6 text-base transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]">
                  重新生成
                </Button>
                <Button onClick={() => setExportMenuVisible(!exportMenuVisible)} className="flex-1 py-6 text-base transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg">
                  <Download className="w-4 h-4 mr-2" />
                  導出腳本
                </Button>
              </div>

              {exportMenuVisible && (
                <div className="bg-card rounded-xl border overflow-hidden">
                  <button
                    onClick={() => handleExport("pdf")}
                    disabled={exportPDFMutation.isPending}
                    className="flex items-center p-4 border-b w-full text-left hover:bg-muted/50 disabled:opacity-50 transition-all duration-200 hover:translate-x-1"
                  >
                    <FileText className="w-6 h-6 text-red-600" />
                    <div className="ml-3 flex-1">
                      <p className="text-foreground font-semibold">導出 PDF</p>
                      <p className="text-muted-foreground text-xs mt-0.5">含分鏡圖片，適合列印和分享</p>
                    </div>
                    {exportPDFMutation.isPending && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                  </button>
                  <button
                    onClick={() => handleExport("word")}
                    disabled={exportPDFMutation.isPending}
                    className="flex items-center p-4 w-full text-left hover:bg-muted/50 disabled:opacity-50 transition-all duration-200 hover:translate-x-1"
                  >
                    <FileUp className="w-6 h-6 text-blue-600" />
                    <div className="ml-3 flex-1">
                      <p className="text-foreground font-semibold">導出 Word</p>
                      <p className="text-muted-foreground text-xs mt-0.5">可編輯格式，適合團隊協作</p>
                    </div>
                    {exportPDFMutation.isPending && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                  </button>
                </div>
              )}

              {exportStatus && (
                <div className="bg-card rounded-xl border border-primary p-3 mt-3">
                  <div className="flex items-center">
                    {exportPDFMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    ) : (
                      <Info className="w-4 h-4 text-primary" />
                    )}
                    <p className="text-foreground text-sm ml-2 flex-1">{exportStatus}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 生成歷史和收藏 */}
      <div className="max-w-6xl mx-auto px-4 pb-8">
        <div className="bg-card rounded-2xl p-6">
          <CreationHistoryPanel type="storyboard" title="分鏡生成歷史" />
        </div>
      </div>

      <QuotaExhaustedModal
        style={{ display: quotaModalVisible ? 'flex' : 'none' }}
        featureName="智能腳本與分鏡生成"
        isTrial={quotaModalInfo.isTrial}
        planName={quotaModalInfo.planName}
        onClose={() => setQuotaModalVisible(false)}
      />
    </div>
  );
}
