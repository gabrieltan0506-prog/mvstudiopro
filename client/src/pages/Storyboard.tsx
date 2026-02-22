import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
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
} from "lucide-react";

import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
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
}

// Character limit constants
const AI_GENERATE_MAX_CHARS = 1000;
const OWN_SCRIPT_MAX_CHARS = 2000;
const FREE_MAX_SCENES = 10;
const PAID_MAX_SCENES = 20;

type ModelOption = "flash" | "pro";

const MODEL_OPTIONS: { value: ModelOption; label: string; desc: string; cost: string; icon: React.ElementType }[] = [
  {
    value: "flash",
    label: "GPT 5.1",
    desc: "快速生成，適合日常使用",
    cost: "免費",
    icon: Zap,
  },
  {
    value: "pro",
    label: "Gemini 3.0 Pro",
    desc: "更精準的分鏡描述與專業建議",
    cost: "15 Credits",
    icon: Crown,
  },
];

export default function StoryboardPage() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading, user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [lyricsText, setLyricsText] = useState("");
  const [sceneCount, setSceneCount] = useState("5");
  const [selectedModel, setSelectedModel] = useState<ModelOption>("flash");
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

  const generateStoryboard = trpc.storyboard.generate.useMutation();
  const checkAccessMutation = trpc.usage.checkFeatureAccess.useMutation();
  const exportPDFMutation = trpc.storyboard.exportPDF.useMutation();
  const inspirationMutation = trpc.storyboard.generateInspiration.useMutation();
  const usageStatsQuery = trpc.usage.getUsageStats.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
    refetchOnMount: true,
  });
  const subQuery = trpc.stripe.getSubscription.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
  });
  const userPlan = (subQuery.data?.plan || "free") as string;
  const userCredits = subQuery.data?.credits?.balance ?? 0;

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

  const handleGenerate = async () => {
    if (!lyricsText.trim()) {
      toast.warning("請輸入歌詞或文本內容");
      return;
    }

    if (isOverCharLimit) {
      toast.error(
        `您的文本為 ${charCount} 字，超出${scriptSource === "ai" ? "AI 生成" : "自有腳本"}的免費額度 ${currentMaxChars} 字。超出部分需消耗 Credits。`,
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
      toast.error(`免費版最多 ${FREE_MAX_SCENES} 個分鏡，請升級方案或減少分鏡數`);
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
      });

      if (result.success && result.storyboard) {
        setStoryboard(result.storyboard);
        usageStatsQuery.refetch();
        toast.success(result.message || "分鏡腳本已生成！");
      }
    } catch (error: any) {
      console.error("Error generating storyboard:", error);
      toast.error(error.message || "生成分鏡腳本失敗，請重試");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReset = () => {
    setLyricsText("");
    setSceneCount("5");
    setStoryboard(null);
    setScriptSource("own");
    setSelectedModel("flash");
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
        triggerDownload(result.pdfUrl, `${storyboard.title || 'storyboard'}.${format === 'pdf' ? 'pdf' : 'doc'}`);
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
          <div className="mt-3 bg-green-500/10 px-4 py-2.5 rounded-lg">
            <p className="text-green-500 font-semibold text-sm">
              AI 智能生成：{AI_GENERATE_MAX_CHARS} 字內免費 · 自有腳本：{OWN_SCRIPT_MAX_CHARS} 字內免費
            </p>
          </div>
        </div>

        {!storyboard && (
          <div className="px-6 py-4">
            <div className="bg-card rounded-2xl p-6 border">
              {/* AI 靈感助手 */}
              {!showInspirationModal ? (
                <button
                  onClick={() => setShowInspirationModal(true)}
                  className="mb-4 rounded-xl p-4 flex items-center w-full bg-primary/10 border border-primary/20 hover:bg-primary/20 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center mr-3 bg-primary/10">
                    <Sparkles className="w-[22px] h-[22px] text-primary" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-foreground font-semibold text-base">創作沒靈感？</p>
                    <p className="text-muted-foreground text-sm mt-0.5">給我三句話，我幫你生成完整腳本（消耗 Credits）</p>
                  </div>
                  <ChevronRight className="w-[22px] h-[22px] text-muted-foreground" />
                </button>
              ) : (
                <div className="mb-4 rounded-xl p-4 bg-primary/10 border border-primary/20">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center">
                      <Sparkles className="w-5 h-5 text-primary" />
                      <p className="text-foreground font-semibold ml-2">AI 靈感助手</p>
                      <div className="ml-2 bg-yellow-500/15 px-2 py-0.5 rounded-full">
                        <p className="text-yellow-500 text-xs font-medium">消耗 Credits</p>
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
                          <Sparkles className="w-4 h-4 mr-1" />
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
                    超出免費額度 {charCount - currentMaxChars} 字，超出部分需消耗 Credits
                  </p>
                )}
              </div>

              {/* AI 模型選擇（下拉選單） */}
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
                            <span className={`text-xs font-semibold ml-auto ${opt.value === "flash" ? "text-green-500" : "text-yellow-500"}`}>
                              {isAdmin && opt.value === "pro" ? "免費" : opt.cost}
                            </span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {selectedModel === "pro" && !isAdmin && (
                  <p className="text-yellow-500 text-xs mt-1.5">
                    Gemini 3.0 Pro 每次生成消耗 15 Credits
                  </p>
                )}
              </div>

              {/* 分鏡數量（下拉選單） */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-lg font-semibold text-foreground">分鏡數量</p>
                  <p className="text-xs text-muted-foreground">
                    {isPaidUser ? `最多 ${PAID_MAX_SCENES} 個` : `免費版最多 ${FREE_MAX_SCENES} 個`}
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
              <Button onClick={handleGenerate} disabled={!lyricsText.trim() || isGenerating} className="w-full py-6 text-lg">
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    <span>AI 生成中...</span>
                  </>
                ) : (
                  <span>生成分鏡腳本</span>
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
              </div>
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

            {/* 導出按鈕 */}
            <div className="mb-6">
              <div className="flex gap-3 mb-3">
                <Button onClick={handleReset} variant="secondary" className="flex-1 py-6 text-base">
                  重新生成
                </Button>
                <Button onClick={() => setExportMenuVisible(!exportMenuVisible)} className="flex-1 py-6 text-base">
                  <Download className="w-4 h-4 mr-2" />
                  導出腳本
                </Button>
              </div>

              {exportMenuVisible && (
                <div className="bg-card rounded-xl border overflow-hidden">
                  <button
                    onClick={() => handleExport("pdf")}
                    disabled={exportPDFMutation.isPending}
                    className="flex items-center p-4 border-b w-full text-left hover:bg-muted/50 disabled:opacity-50"
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
                    className="flex items-center p-4 w-full text-left hover:bg-muted/50 disabled:opacity-50"
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
